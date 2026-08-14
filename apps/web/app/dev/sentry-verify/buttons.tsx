"use client";

import { useState } from "react";

export function SentryVerifyButtons() {
  const [apiResult, setApiResult] = useState<string | null>(null);

  return (
    <>
      <p>
        <button
          type="button"
          onClick={() => {
            throw new Error("MAJORANA_SENTRY_VERIFY: deliberate client-side error");
          }}
        >
          Throw a client error
        </button>
      </p>
      <p>
        <button
          type="button"
          onClick={async () => {
            setApiResult("requesting…");
            try {
              const res = await fetch("/api/sentry-verify");
              setApiResult(`server responded ${res.status} (the point is the 500, not the body)`);
            } catch (error) {
              setApiResult(`fetch failed: ${String(error)}`);
            }
          }}
        >
          Throw a server error
        </button>
        {apiResult ? <span style={{ marginLeft: "1rem" }}>{apiResult}</span> : null}
      </p>
    </>
  );
}
