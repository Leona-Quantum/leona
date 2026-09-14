import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { RepositoryBrowser } from "../../app/repository/repository-browser.tsx";
import { buildRepositoryBrowseView } from "../../lib/repository/browse-view.ts";
import { resolveBrowseParams } from "../../lib/repository/browse-params.ts";
import { stubFetch } from "./dom-env.ts";

function browser(query = "") {
  const params = resolveBrowseParams({ q: query });
  return <RepositoryBrowser locale="en" params={params} view={buildRepositoryBrowseView([], null, null, params, "en")} />;
}

test("Atlas keeps filters open while typing and preserves the query in category links", async () => {
  const fetch = stubFetch(() => ({ status: 200, body: { signedIn: false, signInHref: null } }));
  const calls: string[] = [];
  const globals = globalThis as typeof globalThis & { __formTestRouterReplace?: (href: string) => void };
  globals.__formTestRouterReplace = (href) => calls.push(href);
  try {
    const view = render(browser());
    // The filter menus are native <details>; opening one is not state the
    // browser knows about, so a re-render from typing must not fold it.
    const details = view.container.querySelector<HTMLDetailsElement>(".mj-facet-menu")!;
    fireEvent.click(details.querySelector("summary")!);
    assert.equal(details.open, true);
    const input = view.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "grover" } });
    assert.equal(view.container.querySelector<HTMLDetailsElement>(".mj-facet-menu")?.open, true);
    const gateLink = view.container.querySelector<HTMLAnchorElement>('[aria-label="Categories"] a[href*="category=gates"]')!;
    assert.equal(new URL(gateLink.href).searchParams.get("q"), "grover");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => assert.deepEqual(calls, ["/repository?q=grover"]));
  } finally {
    fetch.restore();
    delete globals.__formTestRouterReplace;
  }
});

test("Atlas ignores an older search response after a newer search has been submitted", async () => {
  const fetch = stubFetch(() => ({ status: 200, body: { signedIn: false, signInHref: null } }));
  const globals = globalThis as typeof globalThis & { __formTestRouterReplace?: (href: string) => void };
  globals.__formTestRouterReplace = () => {};
  try {
    const view = render(browser());
    const input = view.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "gro" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "grover" } });
    fireEvent.keyDown(input, { key: "Enter" });
    view.rerender(browser("gro"));
    assert.equal(input.value, "grover");
    view.rerender(browser("grover"));
    await waitFor(() => assert.equal(input.value, "grover"));
  } finally {
    fetch.restore();
    delete globals.__formTestRouterReplace;
  }
});
