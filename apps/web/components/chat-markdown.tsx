"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

export function MarkdownContent({ source, className }: { source: string; className: string }) {
  return (
    <div className={className}>
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

export function ChatMarkdown({ source }: { source: string }) {
  return <MarkdownContent source={source} className="mj-chat-markdown" />;
}

function normalizeMathDelimiters(source: string): string {
  // Providers commonly emit TeX delimiters as \(...\) and \[...\]. This is
  // presentation-only; the stored response remains unchanged.
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match: string, content: string) => `$$${content}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match: string, content: string) => `$${content}$`);
}
