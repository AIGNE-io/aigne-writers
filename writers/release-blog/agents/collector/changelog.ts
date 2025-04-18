import { Octokit } from "@octokit/rest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
// @ts-ignore
import semver from "semver";
import type { ChangelogEntry } from "./types.js";
import { sleep } from "./utils.js";
import { parseChangelogDate } from "./utils.js";

// Configuration
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Extract version and date from changelog heading
export function extractVersionAndDate(
  headingText: string,
): { version: string; date: Date; dateStr: string } | null {
  if (!headingText) return null;

  // Pattern: "## x.y.z (YYYY-MM-DD)" or "## vx.y.z (YYYY-MM-DD)"
  let match = headingText.match(/^v?(\d+\.\d+\.\d+)(?:\s*)\(([^)]+)\)/);
  if (match) {
    const [, versionStr, dateStr] = match;
    const version = semver.valid(semver.coerce(versionStr));
    const date = parseChangelogDate(dateStr as string);

    if (version && date) {
      return { version, date, dateStr: dateStr as string };
    }
  }

  // Pattern: "## x.y.z - YYYY-MM-DD" or "## vx.y.z - YYYY-MM-DD"
  match = headingText.match(/^v?(\d+\.\d+\.\d+)(?:\s*)-(?:\s*)([^)]+)/);
  if (match) {
    const [, versionStr, dateStr] = match;
    const version = semver.valid(semver.coerce(versionStr));
    const date = parseChangelogDate(dateStr as string);

    if (version && date) {
      return { version, date, dateStr: dateStr as string };
    }
  }

  // Fallback for other formats with semver - try to extract just the version
  // and look for any date-like string in the heading
  const versionMatch = headingText.match(/v?(\d+\.\d+\.\d+)/);
  if (versionMatch) {
    const [, versionStr] = versionMatch;
    const version = semver.valid(semver.coerce(versionStr));

    // Try to find date-like patterns in the heading
    const datePattern =
      /(\d{4}[-/]\d{1,2}[-/]\d{1,2})|([a-zA-Z\u4e00-\u9fa5]+\s+\d{1,2}(?:[,\s]+)?\d{4})|(\d{1,2}\s+[a-zA-Z\u4e00-\u9fa5]+(?:[,\s]+)?\d{4})/i;
    const dateMatch = headingText.match(datePattern);
    if (dateMatch?.[0]) {
      const date = parseChangelogDate(dateMatch[0]);
      if (version && date) {
        return { version, date, dateStr: dateMatch[0] };
      }
    }

    // If we have a version but no date, try to use today's date as fallback
    if (version) {
      console.warn(
        `Found version ${version} but no valid date in heading: ${headingText}. Using today as fallback.`,
      );
      const today = new Date();
      return {
        version,
        date: today,
        dateStr: today.toISOString().split("T")[0] as string,
      };
    }
  }

  console.warn(`Could not extract version and date from heading: ${headingText}`);
  return null;
}

// Parse changelog content and extract entries within date range
export function parseChangelog(content: string, startDate: Date, endDate: Date): ChangelogEntry[] {
  try {
    const mdAST = fromMarkdown(content);
    const mdASTChildren = mdAST?.children || [];
    const h2IndexList: number[] = [];
    const changes: ChangelogEntry[] = [];

    // Find all h2 headings (version sections)
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    mdASTChildren.forEach((element: any, index: number) => {
      if (element.type === "heading" && element.depth === 2) {
        h2IndexList.push(index);
      }
    });

    console.info(`Found ${h2IndexList.length} version entries in changelog`);

    // Process each version section
    h2IndexList.forEach((h2Index, index) => {
      const titleNode = mdASTChildren[h2Index];

      // Extract title text safely - try/catch to handle type errors
      let titleText = "";
      try {
        // @ts-ignore
        if (titleNode?.children?.[0]?.value) {
          // @ts-ignore
          titleText = titleNode.children[0].value;
        }
      } catch (err) {
        console.warn("Error extracting title text:", (err as Error).message);
      }

      if (!titleText) {
        console.warn("Empty heading detected, skipping");
        return;
      }

      // Extract version and date with enhanced function
      const versionInfo = extractVersionAndDate(titleText);
      if (!versionInfo) {
        console.warn(`Skipping malformed version header: ${titleText}`);
        return;
      }

      const { version, date, dateStr } = versionInfo;

      // Check if the version is within our date range
      if (date >= startDate && date <= endDate) {
        // Get the content between this h2 and the next one (or end)
        const startIndex = h2Index + 1;
        const endIndex = h2IndexList[index + 1];
        const body = mdASTChildren.slice(startIndex, endIndex);

        if (body.length > 0) {
          // Convert body back to markdown
          const bodyMd = toMarkdown({ type: "root", children: body });
          console.info(`Found version ${version} (${dateStr})`);
          changes.push({
            version,
            date: dateStr,
            changes: bodyMd,
          });
        }
      }
    });

    console.info(`Found ${changes.length} relevant versions in changelog`);
    return changes;
  } catch (error) {
    console.error("Error parsing changelog:", error);
    return [];
  }
}

// Search for changelog files in a repository and get their contents
export async function getChangelogContent(owner: string, repo: string): Promise<string | null> {
  try {
    console.info(`Searching for CHANGELOG.md files in ${owner}/${repo}`);

    // Search for CHANGELOG.md files in the repository
    const searchResult = await octokit.rest.search.code({
      q: `filename:CHANGELOG.md repo:${owner}/${repo}`,
      per_page: 100,
    });

    console.info(`Found ${searchResult.data.items.length} changelog files in ${owner}/${repo}`);

    let content = null;

    // Check each changelog file found
    for (const item of searchResult.data.items) {
      if (item.path.includes("tests/")) {
        continue;
      }

      try {
        console.info(`Checking changelog at ${item.path}`);

        // Get the file content
        const { data: fileData } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: item.path,
        });

        // Ensure we're dealing with a file object with content
        if (Array.isArray(fileData) || fileData.type !== "file" || !("content" in fileData)) {
          console.warn(`Unexpected response type for ${item.path} in ${owner}/${repo}`);
          continue;
        }

        // GitHub API returns content as base64
        const fileContent = Buffer.from(fileData.content, "base64").toString("utf8");
        content = fileContent;

        console.info(`Successfully retrieved changelog from ${item.path}`);
      } catch (err) {
        console.warn(
          `Error reading changelog at ${item.path} in ${owner}/${repo}:`,
          (err as Error).message,
        );
        continue;
      }

      await sleep(100);
    }

    if (!content) {
      console.warn(`No valid changelog found in ${owner}/${repo}`);
    }

    return content;
  } catch (error) {
    console.error(`Error searching changelogs for ${owner}/${repo}:`, (error as Error).message);
    return null;
  }
}

export async function getChangelogChanges(
  org: string,
  repo: string,
  startDate: Date,
  endDate: Date,
): Promise<ChangelogEntry[]> {
  try {
    // Get changelog content
    const changelogContent = await getChangelogContent(org, repo);
    console.info(`Found ${changelogContent ? "a" : "no"} changelog content in ${repo}`);

    if (changelogContent) {
      return parseChangelog(changelogContent, startDate, endDate);
    }

    return [];
  } catch (error) {
    console.error(`Error processing changelog for ${repo}:`, error);
    return [];
  }
}
