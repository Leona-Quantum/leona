// S5 Library list — stub: designed empty state (copy per docs/ui/copy.md). The real
// list (server-side pagination, filters) lands with the S5 build.
import { EmptyState } from "@majorana/ui";

export const metadata = { title: "Library — Majorana" };

export default function LibraryList() {
  return (
    <section>
      <h1 style={{ fontSize: "var(--fs-20)", fontWeight: 600 }}>Library</h1>
      <EmptyState
        message="Nothing verified yet. Your first verified run will appear here."
        action={{ label: "Start a run", href: "/run" }}
      />
    </section>
  );
}
