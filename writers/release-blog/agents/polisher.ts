import { AIAgent, PromptBuilder } from "@aigne/core";
import { z } from "zod";
import { join } from "node:path";

export const polisher = AIAgent.from({
  name: "polisher",
  description: "Polish a blog post about a product release",
  inputSchema: z.object({
    blog: z.string(),
    product: z.string(),
    language: z.string().optional().default("English"),
  }),
  instructions: await PromptBuilder.from({ path: join(__dirname, "../prompts/polisher.md") }),
  outputSchema: z.object({
    analysis: z.string().describe("Analysis of AI features in the original text"),
    strategy: z.string().describe("Core optimization strategy"),
    highlights: z.string().optional().describe("Explanation of key modifications"),
    polished: z.string().describe("The polished, humanized version of the blog post"),
  }),
  outputKey: "polished",
});
