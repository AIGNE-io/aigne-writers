import type { DateRange } from "./types.js";
import { MONTH_NAMES } from "./types.js";

// eslint-disable-next-line no-promise-executor-return
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get date range for a specific period
 * @param {number} days - Number of days to look back (default: 7)
 * @param {string} [endDateStr] - Optional end date in YYYY-MM-DD format (default: today)
 * @returns {Object} Object with startDate and endDate
 */
export function getDateRange(days = 7, endDateStr?: string): DateRange {
  let endDate = endDateStr ? new Date(endDateStr) : new Date();
  if (Number.isNaN(endDate.getTime())) {
    console.warn(`Invalid end date: ${endDateStr}, using today instead`);
    endDate = new Date();
  }

  endDate.setHours(23, 59, 59, 999);

  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  console.info(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()} (${days} days)`);
  return { startDate, endDate };
}

/**
 * Parse date string with various formats
 * @param {string} dateStr - Date string to parse
 * @returns {Date|null} Parsed date or null if parsing failed
 */
export function parseChangelogDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  try {
    // Try direct Date parsing first (for ISO and similar formats)
    const directDate = new Date(dateStr);
    if (!Number.isNaN(directDate.getTime())) {
      return directDate;
    }

    // Try to parse YYYY-MM-DD format
    const isoMatch = dateStr.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return new Date(
        Number.parseInt(year as string, 10),
        Number.parseInt(month as string, 10) - 1,
        Number.parseInt(day as string, 10),
      );
    }

    // Try to parse Month DD, YYYY format (e.g., "April 14, 2025")
    const monthNameMatch = dateStr.match(/([a-zA-Z\u4e00-\u9fa5]+)\s+(\d{1,2})(?:[,\s]+)?(\d{4})/i);
    if (monthNameMatch) {
      const [, monthName, day, year] = monthNameMatch;
      const monthLower = monthName?.toLowerCase();

      // Try to find the month in different languages
      let monthIndex = -1;
      for (const lang in MONTH_NAMES) {
        if (Object.prototype.hasOwnProperty.call(MONTH_NAMES, lang)) {
          const index = MONTH_NAMES[lang as keyof typeof MONTH_NAMES].findIndex((m: string) =>
            monthLower?.includes(m.toLowerCase()),
          );
          if (index !== -1) {
            monthIndex = index;
            break;
          }
        }
      }

      if (monthIndex !== -1) {
        return new Date(
          Number.parseInt(year as string, 10),
          monthIndex,
          Number.parseInt(day as string, 10),
        );
      }
    }

    // Try to parse DD Month YYYY format (e.g., "14 April 2025")
    const dayMonthYearMatch = dateStr.match(
      /(\d{1,2})\s+([a-zA-Z\u4e00-\u9fa5]+)(?:[,\s]+)?(\d{4})/i,
    );
    if (dayMonthYearMatch) {
      const [, day, monthName, year] = dayMonthYearMatch;
      const monthLower = monthName?.toLowerCase();

      // Try to find the month in different languages
      let monthIndex = -1;
      for (const lang in MONTH_NAMES) {
        if (Object.prototype.hasOwnProperty.call(MONTH_NAMES, lang)) {
          const index = MONTH_NAMES[lang as keyof typeof MONTH_NAMES].findIndex((m: string) =>
            monthLower?.includes(m.toLowerCase()),
          );
          if (index !== -1) {
            monthIndex = index;
            break;
          }
        }
      }

      if (monthIndex !== -1) {
        return new Date(
          Number.parseInt(year as string, 10),
          monthIndex,
          Number.parseInt(day as string, 10),
        );
      }
    }
  } catch (e) {
    console.warn(`Failed to parse date: ${dateStr}`, (e as Error).message);
  }

  return null;
}

/**
 * Extract links from text
 * @param {string} text - Text to extract links from
 * @return {Array} Array of extracted links
 */
export function extractLinks(text: string): string[] {
  if (!text) return [];

  const links: string[] = [];

  // Regular URL links
  const urlRegex = /https?:\/\/[^\s)"\]]+/g;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
  while ((match = urlRegex.exec(text)) !== null) {
    // Clean up the URL - remove trailing punctuation that might have been caught
    let url = match[0];
    // Remove trailing punctuation if it's not part of the URL
    url = url.replace(/[.,;:!?]$/, "");

    // Don't add duplicates
    if (!links.includes(url)) {
      links.push(url);
    }
  }

  // Markdown links - [text](url)
  const markdownRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  // eslint-disable-next-line no-cond-assign
  // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
  while ((match = markdownRegex.exec(text)) !== null) {
    const url = match[2];
    // Don't add duplicates
    if (url && !links.includes(url)) {
      links.push(url);
    }
  }

  // HTML links - <a href="url">text</a>
  const htmlRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
  // eslint-disable-next-line no-cond-assign
  // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
  while ((match = htmlRegex.exec(text)) !== null) {
    const url = match[1];
    // Don't add duplicates
    if (url && !links.includes(url)) {
      links.push(url);
    }
  }

  return links;
}
