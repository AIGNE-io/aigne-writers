import fs from "node:fs/promises";
import path from "node:path";
import { FunctionAgent } from "@aigne/core";
import fetch from "node-fetch";
import { z } from "zod";

// Cache to track downloaded files to avoid duplicate downloads
const downloadCache = new Map<string, string>();

/**
 * Extracts the file ID from a GitHub user-attachments URL
 * @param url GitHub user-attachments URL
 * @returns File ID (last part of the URL)
 */
function extractFileId(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * Checks if a file with the given ID exists in the download directory
 * @param fileId File ID to check
 * @param downloadDir Base directory for downloads
 * @param repoName Repository name for subfolder organization
 * @returns Path to the existing file or null if not found
 */
async function findExistingFile(
  fileId: string,
  downloadDir: string,
  repoName: string,
): Promise<string | null> {
  try {
    const repoDir = path.join(downloadDir, repoName);

    // Check if the directory exists
    try {
      await fs.access(repoDir);
    } catch {
      return null;
    }

    // Read all files in the directory
    const files = await fs.readdir(repoDir);

    // Look for a file that starts with the fileId
    for (const file of files) {
      if (file.startsWith(fileId)) {
        return path.join(repoDir, file);
      }
    }

    return null;
  } catch (error) {
    console.error(`Error checking for existing file ${fileId}:`, error);
    return null;
  }
}

/**
 * Downloads a file from GitHub
 * @param url GitHub user-attachments URL
 * @param downloadDir Base directory for downloads
 * @param repoName Repository name for subfolder organization
 * @returns Path to the downloaded file
 */
async function downloadFile(url: string, downloadDir: string, repoName: string): Promise<string> {
  const fileId = extractFileId(url);

  // First check if file is already in memory cache
  if (downloadCache.has(fileId)) {
    // We know the value exists because we just checked with has()
    return downloadCache.get(fileId) as string;
  }

  // Then check if file exists on disk
  const existingFile = await findExistingFile(fileId, downloadDir, repoName);
  if (existingFile) {
    // Add to memory cache for future use
    downloadCache.set(fileId, existingFile);
    return existingFile;
  }

  try {
    // Create repo-specific directory
    const repoDir = path.join(downloadDir, repoName.toLowerCase());
    await fs.mkdir(repoDir, { recursive: true });

    // Download the file directly from the URL
    const response = await fetch(url, {
      headers: {
        // Add a user agent to avoid being blocked
        "User-Agent": "AIGNE-Framework/1.0",
        // Add authorization if token is available
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    // Get content type from response headers
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    // Determine file extension based on content type
    let extension = ".bin";
    if (contentType.includes("image/jpeg")) extension = ".jpg";
    else if (contentType.includes("image/png")) extension = ".png";
    else if (contentType.includes("image/gif")) extension = ".gif";
    else if (contentType.includes("image/webp")) extension = ".webp";
    else if (contentType.includes("image/svg+xml")) extension = ".svg";
    else if (contentType.includes("video/")) extension = ".mp4";
    else if (contentType.includes("audio/")) extension = ".mp3";

    // Save the file
    const filePath = path.join(repoDir, `${fileId}${extension}`);
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));

    // Cache the result
    downloadCache.set(fileId, filePath);

    return filePath;
  } catch (error) {
    console.error(`Failed to download file ${url}:`, error);
    throw new Error(`Failed to download file ${url}: ${(error as Error).message}`);
  }
}

/**
 * Downloads multiple files concurrently
 * @param urls Array of GitHub user-attachments URLs
 * @param downloadDir Base directory for downloads
 * @param repoName Repository name for subfolder organization
 * @param concurrency Maximum number of concurrent downloads
 * @returns Array of paths to downloaded files
 */
async function downloadFiles(
  urls: string[],
  downloadDir: string,
  repoName: string,
  concurrency = 5,
): Promise<string[]> {
  const results: string[] = [];
  const errors: Error[] = [];

  // Process URLs in chunks to control concurrency
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency);
    const promises = chunk.map((url) =>
      downloadFile(url, downloadDir, repoName).catch((error) => {
        errors.push(error as Error);
        return null;
      }),
    );

    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults.filter((result): result is string => result !== null));
  }

  if (errors.length > 0) {
    console.info(
      `Failed to download ${errors.length} files: ${errors.map((e) => e.message).join("; ")}`,
    );
  }

  return results;
}

export const downloader = FunctionAgent.from({
  name: "downloader",
  description: "Downloads media files from GitHub user-attachments",
  fn: async ({ urls, downloadDir, repoName, concurrency }) => {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN is not set");
    }

    // Default download directory if not provided
    const baseDir = downloadDir || path.join(process.cwd(), "output/downloads");

    // Download files
    const filePaths = await downloadFiles(urls, baseDir, repoName.toLowerCase(), concurrency);

    return {
      filePaths,
    };
  },
  inputSchema: z.object({
    urls: z.array(z.string().url()).describe("Array of GitHub user-attachments URLs"),
    repoName: z.string().describe("Repository name for subfolder organization"),
    downloadDir: z.string().optional().describe("Base directory for downloads"),
    concurrency: z
      .number()
      .optional()
      .default(5)
      .describe("Maximum number of concurrent downloads"),
  }),
  outputSchema: z.object({
    filePaths: z.array(z.string()).describe("Paths to downloaded files"),
  }),
});

// Example usage
// downloader
//   .call({
//     urls: [
//       "https://github.com/user-attachments/assets/4e29ea85-d75d-430e-8c5a-f1c384bc5a44",
//       "https://github.com/user-attachments/assets/011da947-5fd9-457c-ad15-7a8cd622dd83",
//       "https://github.com/user-attachments/assets/bdf3e0b0-02eb-4e5a-b5b6-8d1cbb156982",
//       "https://github.com/user-attachments/assets/104cb623-ab67-413d-929f-5f699e4f8851",
//       "https://github.com/user-attachments/assets/da69071a-3041-4a89-b8ea-2e687936ac74",
//     ],
//     repoName: "arcblock/blocklet-server",
//     concurrency: 5,
//   })
//   .then(console.info)
//   .catch(console.error);
