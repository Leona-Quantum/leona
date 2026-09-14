import type { Metadata } from "next";
import { canonicalMetadata } from "../../../lib/public-metadata";
import { eventText } from "./copy";
import { event } from "./event";
import EventPage from "./event-page";

// Every new visit starts in Japanese; language switching stays within this page.
export const metadata: Metadata = {
  title: event.title,
  description: eventText("ja", "2026年10月17日・18日、慶應義塾大学AICで開催。講演、Qiskitハンズオン、チームで取り組むミニハッカソン。初心者歓迎。"),
  ...canonicalMetadata("/events/qiskit-fall-fest-2026"),
  robots: { index: true, follow: true },
};

export default function FallFestPage() {
  return <EventPage />;
}
