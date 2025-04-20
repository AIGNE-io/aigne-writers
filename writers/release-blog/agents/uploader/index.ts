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
  mediaFiles: z
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
  results: z.array(
    z.object({
      originalUrl: z.string().url().describe("The original URL from mediaFiles input"),
      diskUrl: z.string().describe("The path to local disk file"),
      url: z.string().describe("The URL of the uploaded image on the website"),
    })
  )
});

// Define types for the upload results
type UploadResult = {
  originalUrl: string;
  diskUrl: string;
  url: string;
};

// Create the uploader agent
export const uploader = FunctionAgent.from({
  name: "uploader",
  description: "Uploads media files from github pull requests to Media Kit",
  inputSchema: UploaderInputSchema,
  outputSchema: UploaderOutputSchema,
  fn: async (input) => {
    const {
      appUrl,
      mediaFolder,
      mediaFiles,
      concurrency = 5,
      accessToken,
    } = input;

    // Create a map of filename to URL for quick lookup
    const urlMap = new Map<string, string>();
    for (const url of mediaFiles) {
      const filename = path.basename(url);
      urlMap.set(filename, url);
    }

    // Get all files in the media folder
    const files = fs.readdirSync(mediaFolder);

    // Filter files that match the URLs
    const filesToUpload = files.filter((file) => {
      // Extract the base filename without extension
      const baseFilename = path.basename(file, path.extname(file));
      const isMatch = urlMap.has(baseFilename);
      return isMatch;
    });
    console.log(`Files to upload: ${filesToUpload.length}`, filesToUpload);

    // Initialize results array with all original URLs
    const results: UploadResult[] = mediaFiles.map(url => ({
      originalUrl: url,
      diskUrl: "",
      url: ""
    }));

    if (filesToUpload.length === 0) {
      return { results };
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
        const originalUrl = urlMap.get(baseFilename);

        if (!originalUrl) {
          console.error(`No matching URL found for file: ${file}`);
          return null;
        }

        console.log(`Processing file: ${file}, baseFilename: ${baseFilename}, originalUrl: ${originalUrl}`);

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

          // Get the uploaded file URL from the response JSON
          const uploadResult = await uploadResponse.json();
          const uploadedFileUrl = uploadResult.url;
          if (!uploadedFileUrl) {
            throw new Error('No URL found in the upload response');
          }
          console.log(`File ${file} uploaded successfully: ${uploadedFileUrl}`);

          // Update the result for this file
          const resultIndex = results.findIndex(r => r.originalUrl === originalUrl);
          if (resultIndex !== -1) {
            results[resultIndex] = {
              originalUrl,
              diskUrl: filePath,
              url: uploadedFileUrl
            };
          }

          return {
            originalUrl,
            diskUrl: filePath,
            url: uploadedFileUrl
          };
        } catch (error) {
          console.error(`Error uploading ${file}:`, error);
          return {
            originalUrl,
            diskUrl: filePath,
            url: ""
          };
        }
      }),
    );

    // Wait for all uploads to complete
    await Promise.all(uploadPromises);

    return { results };
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
//   mediaFiles: [
//     "https://github.com/user-attachments/assets/4e29ea85-d75d-430e-8c5a-f1c384bc5a44",
//     "https://github.com/user-attachments/assets/011da947-5fd9-457c-ad15-7a8cd622dd83",
//     "https://github.com/user-attachments/assets/bdf3e0b0-02eb-4e5a-b5b6-8d1cbb156982",
//     "https://github.com/user-attachments/assets/104cb623-ab67-413d-929f-5f699e4f8851",
//     "https://github.com/user-attachments/assets/da69071a-3041-4a89-b8ea-2e687936ac74",
//   ],
//   concurrency: 3,
// });
// console.log(result);
