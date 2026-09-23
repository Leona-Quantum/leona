import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { NalaPlanCue, planHref } from "../../components/nala-plan-cue.tsx";

test("a Run prompt the planner recognises offers the Atlas plan, with the prompt in the fragment only", () => {
  const prompt = "Factor a 2048-bit RSA modulus with Shor's algorithm.";
  const view = render(<NalaPlanCue prompt={prompt} locale="en" />);
  const link = view.container.querySelector("a");
  assert.ok(link, "the cue renders a link");
  assert.equal(link.getAttribute("href"), planHref(prompt));
  const href = link.getAttribute("href") ?? "";
  assert.ok(href.startsWith("/repository/plan#q="), "the prompt rides in the fragment, never a query string");
  assert.equal(href.includes("?"), false);
  assert.match(view.container.textContent ?? "", /Factor an integer \(RSA\)/);
});

test("a prompt with nothing to plan shows no cue, and neither does a draft too short to judge", () => {
  assert.equal(render(<NalaPlanCue prompt="Build a Bell state and verify it." locale="en" />).container.textContent, "");
  assert.equal(render(<NalaPlanCue prompt="RSA" locale="en" />).container.textContent, "");
});

test("the Japanese cue reads the Japanese sentence", () => {
  const view = render(<NalaPlanCue prompt="2048 ビットの RSA 法を素因数分解したい。" locale="ja" />);
  assert.match(view.container.textContent ?? "", /整数の素因数分解（RSA）/);
  assert.match(view.container.textContent ?? "", /アトラスで計画する/);
});

test("the cue judges only the text the link will carry, so a keyword past the limit offers nothing", () => {
  const padding = "x".repeat(2100);
  const late = `${padding} Factor a 2048-bit RSA modulus.`;
  assert.equal(render(<NalaPlanCue prompt={late} locale="en" />).container.textContent, "", "RSA sits past what the planner would receive");
  const early = `Factor a 2048-bit RSA modulus. ${padding}`;
  const view = render(<NalaPlanCue prompt={early} locale="en" />);
  const href = view.container.querySelector("a")?.getAttribute("href") ?? "";
  assert.ok(decodeURIComponent(href.split("#q=")[1] ?? "").startsWith("Factor a 2048-bit RSA modulus."));
});
