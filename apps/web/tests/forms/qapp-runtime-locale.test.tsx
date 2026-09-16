import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { QappRuntime } from "../../components/qapp-runtime.tsx";

// The gallery was bilingual and the runtime under it was not, so a Japanese
// reader met an English status line and an English sign-in link on every app.
test("the runtime's status line and sign-in link follow the reader's language", () => {
  const ja = render(<QappRuntime slug="s" uiDocument="<p>x</p>" canExecute={false} signInPath="/auth/sign-in" locale="ja" />);
  assert.ok(ja.getByText("このQappを実行するにはサインインしてください。"));
  assert.ok(ja.getByRole("link", { name: "サインインして実行" }));
  ja.unmount();
  const en = render(<QappRuntime slug="s" uiDocument="<p>x</p>" canExecute signInPath="/auth/sign-in" />);
  assert.ok(en.getByText("Choose inputs in the Qapp to run it."));
});
