import { Octokit } from "@octokit/rest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import type { PullRequest } from "./types.js";
import { sleep } from "./utils.js";
import { extractLinks } from "./utils.js";

const MEDIA_FILE_PREFIX = "https://github.com/user-attachments/assets/";

// Configuration
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/**
 * Extract description from markdown content based on specific headings
 * @param {string} content - Markdown content
 * @returns {string} Extracted description
 */
export function extractSummaryFromMarkdown(content: string): string {
  if (!content) return "";

  try {
    // Parse markdown to AST
    const mdAST = fromMarkdown(content);
    const mdASTChildren = mdAST?.children || [];

    // Keywords to look for in headings
    const keywords = ["主要改动", "Major Changes", "Summary by"];

    // Find headings that contain our keywords
    const headingIndices: number[] = [];

    mdASTChildren.forEach((element: any, index: number) => {
      if (element.type === "heading") {
        // Extract heading text
        let headingText = "";
        try {
          // @ts-ignore
          if (element?.children?.[0]?.value) {
            // @ts-ignore
            headingText = element.children[0].value;
          }
        } catch (err) {
          console.warn("Error extracting heading text:", (err as Error).message);
        }

        // Check if heading contains any of our keywords
        if (keywords.some((keyword) => headingText.includes(keyword))) {
          headingIndices.push(index);
        }
      }
    });

    // If no matching headings found, return empty string
    if (headingIndices.length === 0) {
      return "";
    }

    // For each matching heading, extract content until the next heading
    const extractedContent: string[] = [];

    for (const headingIndex of headingIndices) {
      // Get the content between this heading and the next one (or end)
      const startIndex = headingIndex;
      let endIndex = mdASTChildren.length;

      // Find the next heading after this one
      for (let i = headingIndex + 1; i < mdASTChildren.length; i++) {
        if ((mdASTChildren[i] as any).type === "heading") {
          endIndex = i;
          break;
        }
      }

      const body = mdASTChildren.slice(startIndex, endIndex);

      if (body.length > 0) {
        // Convert body back to markdown
        const bodyMd = toMarkdown({ type: "root", children: body });
        extractedContent.push(bodyMd);
      }
    }

    // Join all extracted content
    return extractedContent.join("\n\n");
  } catch (error) {
    console.warn("Error extracting description from markdown:", (error as Error).message);
    return "";
  }
}

export async function getRelevantPullRequests(
  org: string,
  repo: string,
  startDate: Date,
  endDate: Date,
): Promise<PullRequest[]> {
  // Get pull requests
  console.info(`Fetching pull requests for ${repo}`);
  try {
    const pullRequests = await octokit.paginate(
      octokit.pulls.list,
      {
        owner: org,
        repo,
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        since: startDate.toISOString(),
      },
      (response: any, done: () => void) => {
        // Stop pagination if we've gone past our date range
        const oldestPR = response.data[response.data.length - 1];
        if (oldestPR && new Date(oldestPR.updated_at) < startDate) {
          done();
        }
        return response.data;
      },
    );

    // Filter PRs within date range
    const relevantPRs = pullRequests.filter(
      (pr: any) =>
        pr.merged_at && new Date(pr.merged_at) >= startDate && new Date(pr.merged_at) <= endDate,
    );

    console.info(`Found ${relevantPRs.length} relevant pull requests in ${repo}`);

    // Get detailed PR info including descriptions and media files
    const detailedPulls = await Promise.all(
      relevantPRs.map(async (pr: any) => {
        await sleep(100);

        try {
          // Get PR details to extract description and media files
          const { data: prDetails } = await octokit.pulls.get({
            owner: org,
            repo,
            pull_number: pr.number,
          });

          // Get PR body text and strip markdown comments
          const bodyText = (prDetails.body || "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/\r\n/g, "\n");

          if (bodyText.match(/@aignewriter\s*:\s*ignore/)) {
            return null;
          }

          // Extract links from PR body and title
          const allLinks = [...extractLinks(bodyText), ...extractLinks(pr.title)];

          // Extract media files from PR body
          const mediaFiles = allLinks.filter((x) => x.startsWith(MEDIA_FILE_PREFIX));
          const links = allLinks.filter((x) => x.startsWith(MEDIA_FILE_PREFIX) === false);

          // Categorize links
          const categorizedLinks = {
            community: links.filter((url) => url?.includes("community.arcblock.io") || false),
            github: links.filter(
              (url) => (url?.includes("github.com") && !url?.includes(pr.html_url)) || false,
            ),
            team: links.filter((url) => url?.includes("team.arcblock.io") || false),
            other: links.filter((url) => {
              return (
                url &&
                !url.includes("community.arcblock.io") &&
                !url.includes("github.com") &&
                !url.includes("team.arcblock.io")
              );
            }),
          };

          // Extract description using markdown AST
          const description = extractSummaryFromMarkdown(bodyText);

          return {
            title: pr.title,
            number: pr.number,
            url: pr.html_url,
            mergedAt: pr.merged_at,
            author: pr.user ? pr.user.login : "unknown",
            description,
            mediaFiles,
            links: categorizedLinks,
          };
        } catch (error) {
          console.warn(`Error fetching details for PR #${pr.number}:`, (error as Error).message);
          return {
            title: pr.title,
            number: pr.number,
            url: pr.html_url,
            mergedAt: pr.merged_at,
            author: pr.user ? pr.user.login : "unknown",
            description: "",
            mediaFiles: [],
            links: { community: [], github: [], team: [], other: [] },
          };
        }
      }),
    );

    return detailedPulls.filter(Boolean);
  } catch (error) {
    console.error(`Error fetching pull requests for ${repo}:`, error);
    return [];
  }
}
