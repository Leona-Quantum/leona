import type { ReactNode } from "react";
import { TourGate } from "../../../components/tour/tour-gate";

/**
 * The Atlas browse, map and claims pages live under `[locale]`; the entry and
 * paper pages under `app/repository/`. Both mount the tour gate so the Read tour
 * carries on across them. The gate renders nothing unless a tour is running, and
 * it takes the locale from the document rather than the segment, because the
 * Atlas reads its language from the cookie.
 */
export default function RepositoryTourLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <TourGate surface="atlas" />
    </>
  );
}
