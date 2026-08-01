"use client";

import { type FormEvent, useState } from "react";
import { MAX_PROFILE_NAME_LENGTH, isValidProfileName } from "../../lib/account-profile";
import type { PublicLocale } from "../../lib/public-locale";

const COPY: Record<PublicLocale, {
  firstName: string;
  lastName: string;
  submit: string;
  submitting: string;
  invalid: string;
  signInAgain: string;
  error: string;
}> = {
  en: {
    firstName: "First name",
    lastName: "Last name",
    submit: "Continue",
    submitting: "Saving…",
    invalid: "Enter your first and last name.",
    signInAgain: "Saved. Sign in again to continue.",
    error: "Something went wrong. Please try again.",
  },
  ja: {
    firstName: "名",
    lastName: "姓",
    submit: "続ける",
    submitting: "保存中…",
    invalid: "名と姓を入力してください。",
    signInAgain: "保存しました。続けるにはもう一度サインインしてください。",
    error: "問題が発生しました。もう一度お試しください。",
  },
};

export function WelcomeNameForm({
  locale,
  returnTo,
  initialFirstName,
  initialLastName,
}: {
  locale: PublicLocale;
  returnTo: string;
  initialFirstName: string;
  initialLastName: string;
}) {
  const copy = COPY[locale];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get("firstName") ?? "");
    const lastName = String(form.get("lastName") ?? "");
    // Same predicate the route and the layout gate use, so the browser never
    // submits something the server is certain to reject.
    if (!isValidProfileName(firstName) || !isValidProfileName(lastName)) {
      setError(copy.invalid);
      return;
    }

    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });
      const payload = (await response.json().catch(() => ({}))) as { refreshed?: boolean };
      if (response.ok) {
        if (payload.refreshed === false) {
          // The name is stored; only the sealed session cookie is stale. Sending
          // them onward would bounce them straight back to this page, so say what
          // actually happened.
          setError(copy.signInAgain);
          return;
        }
        // Full navigation so the refreshed session cookie rides the request that
        // renders the workspace.
        window.location.assign(returnTo);
        return;
      }
      setError(response.status === 400 ? copy.invalid : copy.error);
    } catch {
      setError(copy.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mj-auth-form" onSubmit={submit}>
      {(locale === "ja"
        ? [
            { name: "lastName", label: copy.lastName, autoComplete: "family-name", value: initialLastName },
            { name: "firstName", label: copy.firstName, autoComplete: "given-name", value: initialFirstName },
          ]
        : [
            { name: "firstName", label: copy.firstName, autoComplete: "given-name", value: initialFirstName },
            { name: "lastName", label: copy.lastName, autoComplete: "family-name", value: initialLastName },
          ]
      ).map((field, index) => (
        <label key={field.name}>
          <span>{field.label}</span>
          <input
            name={field.name}
            required
            autoFocus={index === 0}
            autoComplete={field.autoComplete}
            defaultValue={field.value}
            maxLength={MAX_PROFILE_NAME_LENGTH}
          />
        </label>
      ))}
      {error ? <p className="mj-auth-form-error" role="alert">{error}</p> : null}
      <button className="mj-primary-button" type="submit" disabled={pending}>
        {pending ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
