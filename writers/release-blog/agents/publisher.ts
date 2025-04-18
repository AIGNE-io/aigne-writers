import { FunctionAgent } from "@aigne/core";
import { z } from "zod";

interface BlockletConfig {
  componentMountPoints: Array<{
    mountPoint: string;
    title: string;
    did: string;
  }>;
}

interface PublishResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

export async function getComponentMountPoint(appUrl: string, did: string): Promise<string> {
  // Step 1: Fetch the blocklet configuration to find the Discuss Kit mount point
  const url = new URL(appUrl);
  const blockletJsUrl = `${url.origin}/__blocklet__.js?type=json`;
  console.log(`Fetching blocklet configuration from ${blockletJsUrl}`);

  const blockletJs = await fetch(blockletJsUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!blockletJs.ok) {
    throw new Error(
      `Failed to fetch blocklet configuration: ${blockletJs.status} ${blockletJs.statusText}`,
    );
  }

  const config: BlockletConfig = await blockletJs.json();
  const component = config.componentMountPoints.find((component) => component.did === did);
  if (!component) {
    throw new Error("Discuss Kit component not found in blocklet configuration");
  }

  return component.mountPoint;
}

export const publisher = FunctionAgent.from({
  name: "publisher",
  description: "Publishes a blog post to Discuss Kit",
  inputSchema: z.object({
    post: z.object({
      title: z.string(),
      content: z.string(),
      locale: z.string().optional().default("en"),
    }),
    publishAs: z.enum(["blog", "discuss", "doc"]).default("blog"),
    appUrl: z.string(),
    accessToken: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    postId: z.string().optional(),
    error: z.string().optional(),
  }),
  fn: async (input: {
    post: { title: string; content: string; locale?: string };
    appUrl: string;
    accessToken: string;
  }): Promise<PublishResult> => {
    try {
      const { post, appUrl, accessToken } = input;

      const url = new URL(appUrl);
      const mountPoint = await getComponentMountPoint(appUrl, "z8ia1WEiBZ7hxURf6LwH21Wpg99vophFwSJdu");
      console.log(`Found Discuss Kit mount point: ${mountPoint}`);

      // Step 2: Make a POST request to publish the blog post
      // TODO: add support for other publishAs types
      const publishUrl = `${url.origin}${mountPoint}/api/blogs`;
      console.log(`Publishing blog post to ${publishUrl}`);

      const publishResponse = await fetch(publishUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: post.title,
          content: post.content,
          locale: post.locale || "en",
          boardId: "blog-default",
        }),
      });

      if (!publishResponse.ok) {
        const errorText = await publishResponse.text();
        throw new Error(
          `Failed to publish blog post: ${publishResponse.status} ${publishResponse.statusText} - ${errorText}`,
        );
      }

      const publishResult = await publishResponse.json();

      return {
        success: true,
        postId: publishResult.id,
        postUrl: `${url.origin}${mountPoint}/blog/${publishResult.id}`,
      };
    } catch (error) {
      console.error("Error publishing blog post:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
