"use client";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mj-loading-screen">
      <h1>Workspace unavailable</h1>
      <p>Something went wrong loading your workspace. You can try again.</p>
      <button className="mj-primary-button" type="button" onClick={() => reset()}>Try again</button>
    </main>
  );
}
