import { AIAgent, PromptBuilder } from "@aigne/core";
import { z } from "zod";
import { join } from "node:path";

export const reviewer = AIAgent.from({
  inputSchema: z.object({
    blog: z.string(),
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
    changes: z.string(),
    pulls: z.string(),
  }),
  instructions: await PromptBuilder.from({ path: join(__dirname, "../prompts/reviewer.md") }),
  outputSchema: z.object({
    approval: z.boolean().describe("APPROVE or REVISE"),
    feedback: z.object({
      accuracy: z.string().describe("Feedback on accuracy and factual correctness"),
      engagement: z.string().describe("Feedback on engagement and readability"),
      structure: z.string().describe("Feedback on structure and formatting"),
      hallucination: z.string().describe("Feedback on potential hallucination"),
      suggested_changes: z
        .string()
        .describe("Specific suggestions for improvement if revision is needed"),
    }),
  }),
  outputKey: "review",
});
