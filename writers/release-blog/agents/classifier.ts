import { AIAgent } from "@aigne/core";
import { z } from "zod";

export const classifier = AIAgent.from({
  inputSchema: z.object({
    pulls: z.string(),
  }),
  instructions: `## Context
As a data analyst, you are tasked with extracting links from the pull requests json.

## Data Input
I'll provide you with structured data containing:

1. Pull request details <<<{{pulls}}>>>

## Output Requirements
Generate a list of links from the pull requests json.

1. Extract all links from the pull requests json.
2. Group the links into categories:
  - Media files
  - Community links
  - Pull request links
  - Team links

## Style Guidelines
- Output in valid markdown format
- Each link should be a separate line
- Do not include any other text
- Each category should be a separate section
`,
  outputKey: "links",
});
