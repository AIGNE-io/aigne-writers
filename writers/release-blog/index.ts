#!/usr/bin/env npx -y bun

import assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExecutionEngine } from "@aigne/core";
import { OpenAIChatModel } from "@aigne/core/models/openai-chat-model.js";
import { collector } from "./agents/collector/index.js";
import type { Product } from "./agents/collector/types.js";
import { reviewer } from "./agents/reviewer.js";
import { publisher } from "./agents/publisher.js";
import { converter } from "./agents/converter.js";
import { writer } from "./agents/writer.js";
import { downloader } from "./agents/downloader/index.js";
import { uploader } from "./agents/uploader/index.js";
import { authenticator } from "./agents/authenticator/index.js";
import { existsSync } from "node:fs";

const { OPENAI_API_KEY, GITHUB_TOKEN, BLOCKLET_APP_URL } = process.env;
assert(OPENAI_API_KEY, "Please set the OPENAI_API_KEY environment variable");
assert(GITHUB_TOKEN, "Please set the GITHUB_TOKEN environment variable");
assert(BLOCKLET_APP_URL, "Please set the BLOCKLET_APP_URL environment variable");

const appUrl = BLOCKLET_APP_URL;

const claude = new OpenAIChatModel({
  apiKey: OPENAI_API_KEY,
  model: "gpt-4o-mini",
  modelOptions: {
    temperature: 0.8,
  },
});

const engine = new ExecutionEngine({ model: claude });

const repos = [
  // "blocklet/payment-kit",
  // "blocklet/discuss-kit",
  // "blocklet/pages-kit",
  // "blocklet/launcher",
  // "blocklet/blocklet-store",
  // "blocklet/did-services",
  "arcblock/did-spaces",
  // "arcblock/blocklet-server",
];

// We just need to authenticate once
const { accessToken } = await engine.call(authenticator, { appUrl });

const processMediaFiles = async (data: any, repo: string, dataFile: string) => {
  const mediaFiles = data.pulls?.flatMap((pull: any) =>
    pull.mediaFiles.filter((x: any) => typeof x === "string"),
  );
  console.log("media files", mediaFiles);

  // Download media files
  const downloaded = await engine.call(downloader, {
    urls: mediaFiles,
    repoName: repo,
    concurrency,
  });
  console.log("media files downloaded", downloaded);

  // Upload media files
  const uploaded = await engine.call(uploader, {
    appUrl,
    mediaFolder: join(process.cwd(), "output/downloads", repo.toLowerCase()),
    mediaFiles: mediaFiles,
    concurrency,
    accessToken: accessToken as string,
  });
  console.log("media files uploaded", uploaded);

  // Update the pull requests with the uploaded media files
  if (uploaded.results.length > 0) {
    const json = await readFile(dataFile, "utf-8");
    const parsed = JSON.parse(json);
    for (const pull of parsed.pulls) {
      pull.mediaFiles = pull.mediaFiles.filter(Boolean);
      pull.mediaFiles.forEach((file: any, index: number) => {
        const uploadedFileIndex = uploaded.results.findIndex((x: any) => x.originalUrl === file);
        if (uploadedFileIndex !== -1) {
          pull.mediaFiles[index] = uploaded.results[uploadedFileIndex];
          pull.mediaFiles[index].diskUrl = undefined;
        }
      });
    }
    await writeFile(dataFile, JSON.stringify(parsed, null, 2));
    console.log(`Pull requests updated: ${dataFile}`);
  }
};

const processPost = async (data: any, repo: string, markdownFile: string, useCache = true) => {
  if (useCache && existsSync(markdownFile)) {
    const markdown = await readFile(markdownFile, "utf-8");
    console.log(`Use cached blog: ${markdownFile}`);
    return markdown;
  }

  // Generate initial blog post
  const draft = await engine.call(writer, {
    product: data.product as Product,
    changes: JSON.stringify(data.changes),
    pulls: JSON.stringify(data.pulls),
    length,
    language,
  });
  console.log("draft", draft.blog);

  // const polishedBlog = await engine.call(polisher, {
  //   blog: draft.blog as string,
  //   product: JSON.stringify(data.product),
  //   language: "English",
  // });
  // console.log("polishedBlog", polishedBlog.polished);

  // Review the blog post
  const reviewed = await engine.call(reviewer, {
    blog: draft.blog as string,
    product: data.product,
    changes: JSON.stringify(data.changes),
    pulls: JSON.stringify(data.pulls),
  });
  console.log("reviewed", reviewed);

  // If the review suggests revision, generate a new blog post with the feedback
  let finalized = draft.blog as string;
  if (!reviewed.approval) {
    console.log(
      `Blog for ${repo} needs revision. Feedback: ${reviewed.feedback.suggested_changes}`,
    );

    // Generate revised blog post with feedback
    const revised = await engine.call(writer, {
      product: data.product as Product,
      changes: JSON.stringify(data.changes),
      pulls: JSON.stringify(data.pulls),
      feedback: reviewed.feedback.suggested_changes,
      length,
      language,
    });

    finalized = revised.blog as string;
  }

  // Save the final blog post
  await writeFile(markdownFile, finalized);
  console.log(`Blog saved to ${markdownFile}`);

  return finalized;
};

const language = "English";
const length = "1200";
const concurrency = 5;
const shouldPublish = false;
const useCache = true;

for (const repo of repos) {
  const data = await engine.call(collector, {
    repo,
    days: repo === "arcblock/blocklet-server" ? 20 : 30,
    endDate: "2025-04-18",
    useCache,
  });
  // console.log('collector', data);

  const dataFile = join(__dirname, "output", `${data.cacheKey}.json`);
  const markdownFile = join(__dirname, "output", `${data.cacheKey}.md`);

  const [markdown] = await Promise.all([
    processPost(data, repo, markdownFile, useCache),
    processMediaFiles(data, repo, dataFile),
  ]);

  if (shouldPublish) {
    // Convert the blog post to Lexical Editor JSON representation
    const converted = await engine.call(converter, { markdown });

    // Publish the blog post to the Discuss Kit
    const published = await publisher.call({
      appUrl,
      accessToken: accessToken as string,
      post: {
        title: converted.title,
        content: JSON.stringify(converted.content),
        locale: language === "English" ? "en" : "zh",
      },
    });
    console.log("published", published);
  }
}
