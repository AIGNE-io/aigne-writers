import { FunctionAgent } from "@aigne/core";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { getComponentMountPoint } from "../publisher.js";

// Define the input schema for the uploader agent
const UploaderInputSchema = z.object({
  appUrl: z.string().url().describe("The website URL to upload files to"),
  mediaFolder: z.string().describe("The folder containing media files to upload"),
  mediaUrls: z
    .array(z.string().url())
    .describe("List of media file URLs to match with local files"),
  concurrency: z
    .number()
    .int()
    .positive()
    .default(5)
    .describe("Maximum number of concurrent uploads"),
  accessToken: z.string().describe("The access token for the blocklet"),
});

// Define the output schema for the uploader agent
const UploaderOutputSchema = z.object({
  success: z.array(
    z.object({
      localFile: z.string(),
      remoteUrl: z.string(),
      status: z.literal("success"),
    }),
  ),
  failed: z.array(
    z.object({
      localFile: z.string(),
      error: z.string(),
      status: z.literal("failed"),
    }),
  ),
});

// Define types for the upload results
type UploadSuccess = {
  localFile: string;
  remoteUrl: string;
  status: "success";
};

type UploadFailure = {
  localFile: string;
  error: string;
  status: "failed";
};

// Create the uploader agent
export const uploader = FunctionAgent.from({
  name: "uploader",
  description: "Uploads media files to Media Kit using TUS protocol",
  inputSchema: UploaderInputSchema,
  outputSchema: UploaderOutputSchema,
  fn: async (input) => {
    const {
      appUrl,
      mediaFolder,
      mediaUrls,
      concurrency = 5,
      accessToken,
    } = input;

    // Create a map of filename to URL for quick lookup
    const urlMap = new Map<string, string>();
    for (const url of mediaUrls) {
      const filename = path.basename(url);
      urlMap.set(filename, url);
      console.log(`Mapped URL: ${url} to filename: ${filename}`);
    }

    // Get all files in the media folder
    const files = fs.readdirSync(mediaFolder);
    console.log(`Found ${files.length} files in media folder:`, files);

    // Filter files that match the URLs
    const filesToUpload = files.filter((file) => {
      // Extract the base filename without extension
      const baseFilename = path.basename(file, path.extname(file));
      const isMatch = urlMap.has(baseFilename);
      console.log(`Checking file: ${file}, baseFilename: ${baseFilename}, match: ${isMatch}`);
      return isMatch;
    });

    console.log(`Files to upload: ${filesToUpload.length}`, filesToUpload);

    if (filesToUpload.length === 0) {
      return {
        success: [],
        failed: [
          {
            localFile: "none",
            error: "No matching files found in the media folder",
            status: "failed",
          },
        ],
      };
    }

    const url = new URL(appUrl);
    const mountPoint = await getComponentMountPoint(appUrl, "z8ia1mAXo8ZE7ytGF36L5uBf9kD2kenhqFGp9");
    const uploadEndpoint = `${url.origin}${mountPoint}/api/uploads`;
    console.log(`Upload endpoint: ${uploadEndpoint}`);

    // Set up concurrency limit based on input parameter
    const limit = pLimit(concurrency);

    // Upload files concurrently
    const uploadPromises = filesToUpload.map((file) =>
      limit(async () => {
        const filePath = path.join(mediaFolder, file);
        // Extract the base filename without extension to match with URL
        const baseFilename = path.basename(file, path.extname(file));
        const remoteUrl = urlMap.get(baseFilename);

        console.log(`Processing file: ${file}, baseFilename: ${baseFilename}, remoteUrl: ${remoteUrl}`);

        try {
          // Get file stats for size
          const stats = fs.statSync(filePath);
          const fileSize = stats.size;
          const fileExt = path.extname(file).substring(1); // Remove the dot
          const mimeType = getMimeType(file);

          // Generate uploader ID
          const uploaderId = "Uploader";
          const fileId = `${uploaderId}-${baseFilename.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`;

          // Create metadata for the upload
          const metadata = {
            uploaderId,
            relativePath: `${baseFilename}.${fileExt}`,
            name: `${baseFilename}.${fileExt}`,
            type: mimeType,
            filetype: mimeType,
            filename: `${baseFilename}.${fileExt}`
          };

          // Encode metadata for headers
          const encodedMetadata = Object.entries(metadata)
            .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
            .join(',');

          console.log(`Starting upload for ${file}...`);

          // Step 1: Create the upload (POST request)
          const createResponse = await fetch(uploadEndpoint, {
            method: 'POST',
            headers: {
              'Tus-Resumable': '1.0.0',
              'Upload-Length': fileSize.toString(),
              'Upload-Metadata': encodedMetadata,
              'Cookie': `login_token=${accessToken}`,
              // Add required x-uploader-* headers
              'x-uploader-file-name': `${baseFilename}.${fileExt}`,
              'x-uploader-file-id': fileId,
              'x-uploader-file-ext': fileExt,
              'x-uploader-base-url': `${mountPoint}/api/uploads`,
              'x-uploader-endpoint-url': uploadEndpoint,
              'x-uploader-metadata': JSON.stringify({
                uploaderId: 'Uploader',
                relativePath: `${baseFilename}.${fileExt}`,
                name: `${baseFilename}.${fileExt}`,
                type: mimeType,
              }),
              'x-component-did': 'z8ia1WEiBZ7hxURf6LwH21Wpg99vophFwSJdu',
            }
          });

          if (!createResponse.ok) {
            const errorText = await createResponse.text();
            throw new Error(`Failed to create upload: ${createResponse.status} ${createResponse.statusText}\n${errorText}`);
          }

          const uploadUrl = createResponse.headers.get('Location');
          if (!uploadUrl) {
            throw new Error('No upload URL received from server');
          }

          console.log(`Upload created at ${uploadUrl}`);

          // Step 2: Upload the file content
          const fileBuffer = fs.readFileSync(filePath);
          const uploadResponse = await fetch(`${url.origin}${uploadUrl}`, {
            method: 'PATCH',
            headers: {
              'Tus-Resumable': '1.0.0',
              'Upload-Offset': '0',
              'Content-Type': 'application/offset+octet-stream',
              'Cookie': `login_token=${accessToken}`,
              // Add required x-uploader-* headers
              'x-uploader-file-name': `${baseFilename}.${fileExt}`,
              'x-uploader-file-id': fileId,
              'x-uploader-file-ext': fileExt,
              'x-uploader-base-url': `${mountPoint}/api/uploads`,
              'x-uploader-endpoint-url': uploadEndpoint,
              'x-uploader-metadata': JSON.stringify({
                uploaderId: 'Uploader',
                relativePath: `${baseFilename}.${fileExt}`,
                name: `${baseFilename}.${fileExt}`,
                type: mimeType,
              }),
              'x-component-did': 'z8ia1WEiBZ7hxURf6LwH21Wpg99vophFwSJdu',
              'x-uploader-file-exist': 'true',
            },
            body: fileBuffer
          });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText}\n${errorText}`);
          }

          console.log(`File ${file} uploaded successfully`);
          return {
            localFile: file,
            remoteUrl: uploadUrl,
            status: "success" as const,
          };
        } catch (error) {
          console.error(`Error uploading ${file}:`, error);
          return {
            localFile: file,
            error: error instanceof Error ? error.message : String(error),
            status: "failed" as const,
          };
        }
      }),
    );

    // Wait for all uploads to complete
    const results = await Promise.all(uploadPromises);

    // Separate successful and failed uploads
    const success = results.filter(
      (result): result is UploadSuccess => result.status === "success",
    );
    const failed = results.filter(
      (result): result is UploadFailure => result.status === "failed",
    );

    return {
      success,
      failed,
    };
  },
});

// Helper function to determine MIME type based on file extension
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

// Example usage
// const result = await uploader.call({
//   appUrl: process.env.BLOCKLET_APP_URL as string,
//   mediaFolder: path.join(process.cwd(), "output/downloads/arcblock/blocklet-server"),
//   mediaUrls: [
//     "https://github.com/user-attachments/assets/4e29ea85-d75d-430e-8c5a-f1c384bc5a44",
//     "https://github.com/user-attachments/assets/011da947-5fd9-457c-ad15-7a8cd622dd83",
//     "https://github.com/user-attachments/assets/bdf3e0b0-02eb-4e5a-b5b6-8d1cbb156982",
//     "https://github.com/user-attachments/assets/104cb623-ab67-413d-929f-5f699e4f8851",
//     "https://github.com/user-attachments/assets/da69071a-3041-4a89-b8ea-2e687936ac74",
//   ],
//   concurrency: 3,
// });
// console.log(result);
