import { Octokit } from "@octokit/rest";
import { generateCacheKey, getFromCache, saveToCache } from "./cache.js";
import { getChangelogChanges } from "./changelog.js";
import { findProductInfo } from "./product.js";
import { getRelevantPullRequests } from "./pulls.js";
import type { RepoUpdate } from "./types.js";

// Configuration
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function getRepoUpdates(
  org: string,
  repo: string,
  startDate: Date,
  endDate: Date,
): Promise<Omit<RepoUpdate, "cacheKey"> | null> {
  try {
    // Get repository details
    const { data: result } = await octokit.repos.get({ owner: org, repo });
    if (!result.pushed_at) {
      console.warn(`Skipping ${repo} - no push date available`);
      return null;
    }

    const repoUpdatedAt = new Date(result.pushed_at);
    if (repoUpdatedAt <= startDate) {
      console.info(`Skipping ${repo} - last updated ${repoUpdatedAt.toISOString()}`);
      return null;
    }

    // Get product info
    const fullRepo = `${org}/${repo}`;
    const productInfo = await findProductInfo(fullRepo);

    // Get pull requests and changelog info
    const pulls = await getRelevantPullRequests(org, repo, startDate, endDate);
    const changes = await getChangelogChanges(org, repo, startDate, endDate);
    console.info(
      `Adding ${repo} to updates with ${changes.length} changelog entries and ${pulls.length} PRs`,
    );

    return {
      product: {
        name: repo,
        title: productInfo ? productInfo.title : result.name,
        description: result.description || repo,
        link: result.html_url,
        ...(productInfo && {
          title: productInfo.title,
          store: productInfo.store || "",
          docs: productInfo.docs || "",
          website: productInfo.website || "",
          description: productInfo.description || "",
          intro: productInfo.intro || "",
          community: productInfo.community || "",
        }),
      },
      changes,
      pulls,
    };
  } catch (error) {
    console.error(`Error processing repository ${repo}:`, error);
    return null;
  }
}

export function getWeeklyUpdates(
  startDate: Date,
  endDate: Date,
  target: string,
  useCache = true,
): Promise<RepoUpdate | null> {
  if (!target) {
    throw new Error("No repository provided");
  }

  const [org, repo] = target.split("/");
  if (!org || !repo) {
    throw new Error('Invalid repository format. Please use "organization/repository"');
  }

  // Normalize dates to improve cache hit rate
  const normalizedStartDate = new Date(startDate);
  normalizedStartDate.setHours(0, 0, 0, 0);

  const normalizedEndDate = new Date(endDate);
  normalizedEndDate.setHours(23, 59, 59, 999);

  console.info(
    `Collecting updates for ${target} from ${normalizedStartDate.toISOString()} to ${normalizedEndDate.toISOString()}`,
  );

  // Generate cache key
  const cacheKey = generateCacheKey(target, normalizedStartDate, normalizedEndDate);

  // Wrap the actual implementation in an async function
  const fetchData = async (): Promise<RepoUpdate | null> => {
    // Check if we have this data cached
    const cachedData = await getFromCache(cacheKey);
    if (cachedData && useCache) {
      return { ...cachedData, cacheKey };
    }

    // If not cached or cache is expired, fetch fresh data
    console.info(`No valid cache found for ${target}, fetching fresh data...`);
    const result = await getRepoUpdates(org, repo, normalizedStartDate, normalizedEndDate);

    // Cache the result
    if (result) {
      await saveToCache(cacheKey, result);
    }

    return result ? { ...result, cacheKey } : null;
  };

  // Return a promise that will be resolved with either cached or fresh data
  return fetchData();
}
