import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommentBody } from "./comment-body.ts";
import { commentSegments, linkTarget } from "./comment-text.ts";

/**
 * The XSS guard for comments, asserted on RENDERED markup.
 *
 * A comment is text any member of a workspace can put in front of every other
 * member, so it is where someone would try to run script in a colleague's
 * session. These render the real component with `react-dom/server` and look at
 * the HTML that comes out, because a segmenter that looks right proves nothing
 * about what the browser is finally handed.
 */

function render(body: string, mentionHandles: string[] = []): string {
  return renderToStaticMarkup(createElement(CommentBody, { body, mentionHandles }));
}

test("positive control: an https link and a line break render as markup", () => {
  const html = render("see https://leonaqt.com/studio\nthanks");
  assert.match(html, /<a href="https:\/\/leonaqt\.com\/studio" target="_blank" rel="noopener noreferrer nofollow ugc"/);
  assert.match(html, /<br\/>thanks/);
});

test("a <script> in a body renders as inert text", () => {
  const html = render('<script>alert("x")</script> and <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("a javascript: link, in any spelling, is never a link", () => {
  for (const body of [
    "javascript:alert(1)",
    "JavaScript:alert(document.cookie)",
    "[click](javascript:alert(1))",
    '<a href="javascript:alert(1)">click</a>',
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ]) {
    const html = render(body);
    assert.doesNotMatch(html, /<a\b/i, `linked: ${body}`);
    // A real attribute, not the escaped text of one: `&quot;` never closes a tag.
    assert.doesNotMatch(html, /href="/i, `href emitted for: ${body}`);
  }
});

test("a link cannot break out of its attribute", () => {
  const html = render('https://example.org/"onmouseover="alert(1)');
  assert.match(html, /<a href="https:\/\/example\.org\/"/);
  assert.doesNotMatch(html, /onmouseover="/);
  assert.match(html, /&quot;onmouseover=&quot;alert\(1\)/);
});

test("only http and https parse as link targets", () => {
  assert.equal(linkTarget("javascript:alert(1)"), null);
  assert.equal(linkTarget("ftp://example.org"), null);
  assert.deepEqual(linkTarget("https://example.org/a."), { text: "https://example.org/a", href: "https://example.org/a" });
  assert.equal(linkTarget("https://"), null);
});

test("sentence punctuation and an unbalanced bracket stay outside the link", () => {
  assert.deepEqual(commentSegments("(see https://example.org/x)."), [
    { kind: "text", text: "(see " },
    { kind: "link", text: "https://example.org/x", href: "https://example.org/x" },
    { kind: "text", text: ")." },
  ]);
  const wiki = "https://en.wikipedia.org/wiki/Qubit_(physics)";
  assert.deepEqual(commentSegments(`read ${wiki}`)[1], { kind: "link", text: wiki, href: wiki });
});

test("only mentions the server resolved are highlighted", () => {
  const html = render("@sam and @stranger, thanks @sam.", ["sam"]);
  assert.equal(html.match(/mj-comment-mention/g)?.length, 2);
  assert.match(html, /@stranger/);
  assert.match(html, /<span class="mj-comment-mention">@sam<\/span>\./);
  assert.doesNotMatch(render("me@lab.example", ["lab.example"]), /mj-comment-mention/);
});

test("a mention is plain text, never a link, and markup inside one stays text", () => {
  const html = render("@sam<b>bold</b>", ["sam"]);
  assert.match(html, /<span class="mj-comment-mention">@sam<\/span>&lt;b&gt;bold&lt;\/b&gt;/);
});

test("line breaks, including Windows ones, become <br>, and nothing else does", () => {
  assert.deepEqual(commentSegments("a\r\nb\n\nc"), [
    { kind: "text", text: "a" },
    { kind: "break" },
    { kind: "text", text: "b" },
    { kind: "break" },
    { kind: "break" },
    { kind: "text", text: "c" },
  ]);
});

test("every kind of handle the server hands out is highlighted: short, full address, fallback", () => {
  // The three forms in services/api/src/majorana_api/mentions.py. The patterns
  // are mirrored by hand, so this pins that the web reads each one as the
  // server does.
  const html = render("@jose, @alex@two.example and @member-1a2b3c4d.", ["jose", "alex@two.example", "member-1a2b3c4d"]);
  assert.equal(html.match(/mj-comment-mention/g)?.length, 3);
  assert.match(html, /<span class="mj-comment-mention">@alex@two\.example<\/span>/);
  assert.match(html, /<span class="mj-comment-mention">@member-1a2b3c4d<\/span>\./);
});
