import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render } from "@testing-library/react";
import { RepositoryExportAction } from "../../app/repository/repository-export.tsx";

// Asserts on where the sign-in link GOES, decoded. The defect this guards was a
// real, working sign-in link to the wrong place: the page-wide `signInHref`
// whose returnTo is /run, so a signed-out reader who clicked "Add to Studio"
// signed in and landed on the run page with nothing added.
test("a signed-out 'Add to Studio' signs in and returns to the import, not to /run", () => {
  const view = render(
    <RepositoryExportAction slug="grover-unstructured-search" title="Grover search" isSignedIn={false} signInHref="/auth/sign-in?returnTo=%2Frun" />,
  );
  fireEvent.click(view.getByRole("button", { name: "Add to Studio" }));
  const link = view.getByRole("link", { name: "Sign in to continue" });
  const url = new URL(link.getAttribute("href") ?? "", "https://leonaqt.test");
  assert.equal(url.pathname, "/auth/sign-in");
  const returnTo = url.searchParams.get("returnTo");
  assert.notEqual(returnTo, "/run", "returnTo fell back to the page default");
  assert.equal(returnTo, "/studio?atlas=grover-unstructured-search");
});

test("without sign-in configured the dialog says so instead of rendering a dead link", () => {
  const view = render(<RepositoryExportAction slug="grover-unstructured-search" title="Grover search" isSignedIn={false} signInHref={null} />);
  fireEvent.click(view.getByRole("button", { name: "Add to Studio" }));
  assert.equal(view.queryByRole("link", { name: "Sign in to continue" }), null);
  assert.ok(view.getByText(/Authentication is not configured/));
});
