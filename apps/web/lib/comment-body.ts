import { createElement, Fragment, type ReactElement } from "react";
import { commentSegments } from "./comment-text.ts";

/**
 * A comment body as React elements: text nodes, `<br>`, mention `<span>`s and
 * http(s) `<a>`s, built from `commentSegments` and nothing else.
 *
 * Written with `createElement` rather than JSX so `node --test` can render it
 * with `react-dom/server` and assert on the real markup
 * (`comment-body.test.ts`). That test is the XSS guard for comments: a body
 * carrying `<script>` or a `javascript:` link has to come out as inert text,
 * and the only way to know it does is to render it.
 *
 * Every link opens in a new tab with `noopener noreferrer`, so the page it
 * opens cannot reach back into this one, and `nofollow ugc`, because the link
 * is one a user wrote.
 */
export function CommentBody({
  body,
  mentionHandles = [],
}: {
  body: string;
  mentionHandles?: readonly string[];
}): ReactElement {
  const children = commentSegments(body, mentionHandles).map((segment, index) => {
    if (segment.kind === "break") return createElement("br", { key: index });
    if (segment.kind === "link") {
      return createElement(
        "a",
        {
          key: index,
          href: segment.href,
          target: "_blank",
          rel: "noopener noreferrer nofollow ugc",
          className: "mj-comment-link",
        },
        segment.text,
      );
    }
    if (segment.kind === "mention") {
      return createElement("span", { key: index, className: "mj-comment-mention" }, segment.text);
    }
    return createElement(Fragment, { key: index }, segment.text);
  });
  return createElement("p", { className: "mj-comment-body" }, ...children);
}
