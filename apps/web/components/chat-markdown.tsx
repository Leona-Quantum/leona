"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

export function ChatMarkdown({ source }: { source: string }) {
  return (
    <div className="mj-chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          ),
        }}
      >
        {normalizeMathDelimiters(source)}
      </ReactMarkdown>
    </div>
  );
}

function normalizeMathDelimiters(source: string): string {
  // Providers commonly emit TeX delimiters as \(...\) and \[...\]. This is
  // presentation-only; the stored response remains unchanged.
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match: string, content: string) => `$$${content}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match: string, content: string) => `$${content}$`);
}
