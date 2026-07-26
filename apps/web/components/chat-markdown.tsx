"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { renderableMarkdown } from "../lib/chat-markdown-source";

export function MarkdownContent({ source, className }: { source: string; className: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        // remark-gfm is load-bearing, not a nicety: the chat model routinely
        // answers with a table (a production answer to "ベル状態とは何ですか？"
        // returned one comparing the four Bell states). Without it the table
        // renders as raw pipe-delimited text in the middle of the answer.
        // gfm also covers strikethrough, task lists and bare-URL autolinks.
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          ),
          // A comparison table can be wider than the chat column. Give it its
          // own scroll container so the table scrolls and the page never does.
          table: ({ children, ...props }) => (
            <div className="mj-md-table">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {renderableMarkdown(source)}
      </ReactMarkdown>
    </div>
  );
}

export function ChatMarkdown({ source }: { source: string }) {
  return <MarkdownContent source={source} className="mj-chat-markdown" />;
}
