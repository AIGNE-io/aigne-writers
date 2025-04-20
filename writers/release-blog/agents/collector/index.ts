import { FunctionAgent } from "@aigne/core";
import { z } from "zod";
import { getWeeklyUpdates } from "./repo.js";
import { getDateRange } from "./utils.js";

export const collector = FunctionAgent.from({
  name: "collector",
  description: "Collects the latest updates for a github repository",
  fn: async ({ repo, days, endDate, useCache }) => {
    const range = getDateRange(days, endDate);
    const result = await getWeeklyUpdates(range.startDate, range.endDate, repo, useCache);
    if (!result) {
      return {
        pulls: [],
        product: {
          name: "",
          title: "",
          description: "",
          link: "",
        },
        changes: [],
      } as const;
    }
    return result as unknown as Record<string, unknown>;
  },
  inputSchema: z.object({
    repo: z.string(),
    days: z.number(),
    endDate: z.string().optional(),
    useCache: z.boolean().optional(),
  }),
  outputSchema: z.object({
    cacheKey: z.string(),
    product: z.object({
      name: z.string(),
      title: z.string(),
      description: z.string(),
      link: z.string(),
      store: z.string().optional(),
      docs: z.string().optional(),
      website: z.string().optional(),
      intro: z.string().optional(),
      community: z.string().optional(),
      audience: z.string().optional(),
    }),
    changes: z.array(
      z.object({
        version: z.string(),
        date: z.string(),
        changes: z.string(),
      }),
    ),
    pulls: z.array(
      z.object({
        title: z.string(),
        number: z.number(),
        url: z.string(),
        mergedAt: z.string(),
        author: z.string(),
        description: z.string(),
        mediaFiles: z.array(z.any()),
        links: z.object({
          community: z.array(z.string()),
          github: z.array(z.string()),
          team: z.array(z.string()),
          other: z.array(z.string()),
        }),
      }),
    ),
  }),
});
