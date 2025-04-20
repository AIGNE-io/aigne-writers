import { FunctionAgent } from "@aigne/core";
import { z } from "zod";

import { JSDOM } from "jsdom";
import { marked } from "marked";
import { createHeadlessEditor } from "@lexical/headless";
import { $generateNodesFromDOM } from "@lexical/html";
import { $getRoot, $insertNodes, TextNode, LineBreakNode } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";

import { ImageNode } from "./ImageNode.js";

export async function markdownToLexical(markdown: string) {
  let title = "Untitled Blog Post";
  let content = markdown;
  const titleMatch = markdown.trim().match(/^#\s+(.+)$/m);
  if (titleMatch?.[1]) {
    title = titleMatch[1].trim();
    content = markdown.replace(/^#\s+.+$/m, '').trim();
  }

  const html = await marked(content);
  const editor = createHeadlessEditor({
    namespace: "editor",
    theme: {},
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      TableNode,
      TableRowNode,
      TableCellNode,
      LinkNode,
      ImageNode,
      TextNode,
      LineBreakNode,
    ],
  });

  editor.update(() => {
    const dom = new JSDOM(html);
    const htmlDocument = dom.window.document;
    const nodes = $generateNodesFromDOM(editor, htmlDocument);
    $getRoot().select();
    $insertNodes(nodes);
  }, { discrete: true });

  return new Promise((resolve) => {
    setTimeout(() => {
      editor.update(() => {
        const state = editor.getEditorState();
        const json = state.toJSON();
        resolve({ title, content: json });
      });
    }, Math.min(content.length, 500));
  });
}

export const converter = FunctionAgent.from({
  name: "markdown_to_lexical",
  description: "Converts markdown content to Lexical Editor JSON representation",
  inputSchema: z.object({
    markdown: z.string().describe("The markdown content to convert"),
  }),
  outputSchema: z.object({
    title: z.string().describe("The title of the blog post"),
    content: z.any().describe("The JSON representation of the post content"),
  }),
  fn: async (input) => {
    const result = await markdownToLexical(input.markdown) as { title: string; content: any };
    return {
      title: result.title,
      content: result.content
    };
  },
});

// const markdown = `
// # Heading 1
// This is a **bold** paragraph with *italic* text and a [link](https://example.com).

// ## Heading 2
// > This is a blockquote.

// - Unordered list item 1
// - Unordered list item 2

// 1. Ordered list item 1
// 2. Ordered list item 2

// \`\`\`javascript
// console.log('Code block');
// \`\`\`

// ---

// ![Test Image](https://example.com/image.jpg)
// `;

// const result = await markdownToLexical(markdown);
// console.log(JSON.stringify(result, null, 2));
