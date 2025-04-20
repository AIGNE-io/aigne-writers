import { AIAgent, PromptBuilder } from "@aigne/core";
import { z } from "zod";
import { join } from "node:path";

export const writer = AIAgent.from({
  name: "writer",
  description: "Write a blog post about a product release",
  inputSchema: z.object({
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
    feedback: z.string().optional(),
    length: z.string().optional().default("800~1200"),
    language: z.string().optional().default("English"),
  }),
  instructions: await PromptBuilder.from({ path: join(__dirname, "../prompts/writer.md") }),
  outputKey: "blog",
});
