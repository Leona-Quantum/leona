"use client";

import { type FormEvent, useState } from "react";
import type { PublicLocale } from "../../lib/public-locale";

const COPY: Record<PublicLocale, {
  username: string;
  password: string;
  submit: string;
  submitting: string;
  invalid: string;
  error: string;
}> = {
  en: {
    username: "Username",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    invalid: "Incorrect username or password.",
    error: "Something went wrong. Please try again.",
  },
  ja: {
    username: "ユーザー名",
    password: "パスワード",
    submit: "サインイン",
    submitting: "サインイン中…",
    invalid: "ユーザー名またはパスワードが正しくありません。",
    error: "問題が発生しました。もう一度お試しください。",
  },
};

export function LockSignInForm({ locale, returnTo }: { locale: PublicLocale; returnTo: string }) {
  const copy = COPY[locale];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/lock/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      if (response.ok) {
        // Full navigation so the just-set session cookie rides the request that
        // loads the gated page.
        window.location.assign(returnTo);
        return;
      }
      setError(response.status === 401 ? copy.invalid : copy.error);
    } catch {
      setError(copy.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mj-lock-form" onSubmit={submit}>
      <label>
        <span>{copy.username}</span>
        <input name="username" required autoComplete="username" autoFocus />
      </label>
      <label>
        <span>{copy.password}</span>
        <input name="password" required type="password" autoComplete="current-password" />
      </label>
      {error ? <p className="mj-lock-form-error" role="alert">{error}</p> : null}
      <button className="mj-primary-button" type="submit" disabled={pending}>
        {pending ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
