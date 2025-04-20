import { AIAgent, PromptBuilder } from "@aigne/core";
import { z } from "zod";
import { join } from "node:path";

export const illustrator = AIAgent.from({
  name: "illustrator",
  description: "Illustrate a product release blog with media files from pull requests",
  inputSchema: z.object({
    blog: z.string(),
    data: z.string(),
  }),
  instructions: await PromptBuilder.from({ path: join(__dirname, "../prompts/illustrator.md") }),
  outputKey: "illustrated",
});
