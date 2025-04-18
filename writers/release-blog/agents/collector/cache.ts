import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoUpdate } from "./types.js";

/**
 * Create cache directory if it doesn't exist
 * @returns {Promise<string>} Path to the cache directory
 */
export async function ensureCacheDir(): Promise<string> {
  const cacheDir = join(process.cwd(), "output");
  try {
    await mkdir(cacheDir, { recursive: true });
  } catch (error) {
    console.warn("Failed to create cache directory:", (error as Error).message);
  }
  return cacheDir;
}

/**
 * Generate a cache key based on input parameters
 * @param {string} repo - Repository name
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {string} Cache key
 */
export function generateCacheKey(repo: string, startDate: Date, endDate: Date): string {
  return `${repo.replace("/", "-")}-${startDate.toISOString().split("T")[0]}-${endDate.toISOString().split("T")[0]}`;
}

/**
 * Check if cached data exists and is valid
 * @param {string} key - Cache key
 * @param {number} maxAge - Maximum age in milliseconds (default: 24 hours)
 * @returns {Promise<Object|null>} Cached data or null if expired or not found
 */
export async function getFromCache(
  key: string,
  maxAge = 24 * 60 * 60 * 1000,
): Promise<RepoUpdate | null> {
  const cacheDir = await ensureCacheDir();
  const cacheFile = join(cacheDir, `${key}.json`);

  try {
    // Check if cache file exists and is not too old
    const stats = await stat(cacheFile);
    const fileAge = Date.now() - stats.mtime.getTime();

    if (fileAge > maxAge) {
      console.info(`Cache for ${key} is expired (${Math.round(fileAge / 1000 / 60)} minutes old)`);
      return null;
    }

    // Read and parse cache file
    const data = await readFile(cacheFile, "utf8");
    const result = JSON.parse(data) as RepoUpdate;
    console.info(`Using cached data for ${key} (${Math.round(fileAge / 1000 / 60)} minutes old)`);
    return result;
  } catch {
    // If file doesn't exist or can't be parsed, return null
    return null;
  }
}

/**
 * Save data to cache
 * @param {string} key - Cache key
 * @param {Object} data - Data to cache
 * @returns {Promise<void>}
 */
export async function saveToCache(key: string, data: Omit<RepoUpdate, "cacheKey">): Promise<void> {
  const cacheDir = await ensureCacheDir();
  const cacheFile = join(cacheDir, `${key}.json`);

  try {
    await writeFile(cacheFile, JSON.stringify(data, null, 2), "utf8");
    console.info(`Saved data to cache with key ${key}`);
  } catch (error) {
    console.warn(`Failed to save cache for ${key}:`, (error as Error).message);
  }
}
