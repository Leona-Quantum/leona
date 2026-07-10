"use client";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <h1>Dashboard</h1>
      <p>Something went wrong loading your session.</p>
      <button onClick={() => reset()}>Try again</button>
    </main>
  );
}
