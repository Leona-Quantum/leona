import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSite } from "../../../components/public-site";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../../lib/auth";
import { getPublicLocale } from "../../../lib/public-locale-server";
import {
  getRepositoryEntry,
  getRepositoryEstimate,
  getRepositoryListEntries,
  getRepositoryProfile,
} from "../../../lib/repository-source";
import { RepositoryEstimatePanel, hasVisibleEstimate } from "../../../components/repository-estimate";
import { RepositoryProfilePanel, hasVisibleProfile } from "../../../components/repository-profile";
import { RepositoryInterfacePanel } from "../../../components/repository-interface";
import { deriveInterface, neighboursOf, type EntryInterface } from "../../../lib/repository/interface";
import { RepositoryEntryView } from "./repository-entry-view";

export async function generateStaticParams() {
  const entries = await getRepositoryListEntries();
  return entries.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = await getRepositoryEntry(slug);
  const locale = await getPublicLocale();
  return entry
    ? { title: locale === "ja" ? entry.titleJa : entry.title, description: locale === "ja" ? entry.descriptionJa : entry.description }
    : { title: locale === "ja" ? "Atlasエントリ" : "Atlas entry" };
}

export default async function RepositoryEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // The full record for this one slug, then the slim list for the related-links
  // strip. Previously this pulled the ENTIRE corpus with full records (~2.37 MB)
  // just to find one entry and read a few sibling titles; the list projection is
  // ~0.91 MB and, unlike the full payload, is small enough for Next to cache.
  const entry = await getRepositoryEntry(slug);
  if (!entry) notFound();
  // Both derived on read from this entry's own circuit, so neither can disagree
  // with the circuit rendered above them. Null when the catalog API is off —
  // there is deliberately no second, TypeScript implementation of either
  // arithmetic to fall back to (see getRepositoryEstimate).
  //
  // Concurrently, and the list with them: these three share no inputs, so
  // awaiting them in sequence would put three round trips end to end on every
  // entry render. R1 is what made that worth doing — it added the third.
  const [entries, estimate, profile] = await Promise.all([
    getRepositoryListEntries(),
    getRepositoryEstimate(slug),
    getRepositoryProfile(slug),
  ]);
  const locale = await getPublicLocale();
  const { user } = await getMajoranaAuth();
  const signInHref = !user && isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  // What this entry takes and returns, and what meets it at either end.
  //
  // Derived here from the listing that is already on the page for the related
  // strip — no extra round trip, no API change, and nothing stored. Every input
  // the derivation reads (`category`, `topics`, `visualization.wires`,
  // `portableCircuit`) is already in the browse-list projection, which is what
  // makes this a one-part deploy: session 78's topic vocabulary shipped inert
  // because a new field on a record only reaches a visitor after the corpus is
  // re-imported, and a value read off fields that are already there has no such
  // second half.
  //
  // The corpus walk is 283 derivations and 566 comparisons per render. It is
  // cheaper than the fetch that already happened above it.
  const corpusInterfaces = new Map<string, EntryInterface>(
    entries.map((candidate) => [
      candidate.slug,
      deriveInterface({
        slug: candidate.slug,
        topics: candidate.topics ?? [],
        category: candidate.category,
        wireCount: candidate.visualization?.wires?.length ?? 0,
        portableCircuit: candidate.portableCircuit,
      }),
    ]),
  );
  // The subject is derived from its OWN full record rather than looked up in the
  // map: the listing is a projection, and an entry served by the detail route
  // that the list has not got — a slug filtered out of the browse payload, or a
  // corpus mid-import — would otherwise silently render as `undeclared`, which
  // looks exactly like a literature record.
  const entryInterface = deriveInterface({
    slug: entry.slug,
    topics: entry.topics ?? [],
    category: entry.category,
    wireCount: entry.visualization?.wires?.length ?? 0,
    portableCircuit: entry.portableCircuit,
  });
  const neighbours = neighboursOf(entry.slug, entryInterface, corpusInterfaces);
  // Counted here rather than inside the panel: the caller already holds every
  // interface, and a component that counted for itself would be a second place
  // this number is produced. The subject is counted with the corpus even when
  // the listing does not carry it, so the link never promises one fewer row
  // than the filter it opens.
  const stanceCount =
    [...corpusInterfaces.values()].filter((other) => other.stance === entryInterface.stance).length +
    (corpusInterfaces.has(entry.slug) ? 0 : 1);
  const titleBySlug = new Map(
    entries.map((candidate) => [candidate.slug, locale === "ja" ? candidate.titleJa : candidate.title]),
  );

  const related = entry.relatedSlugs
    .map((relatedSlug) => entries.find((candidate) => candidate.slug === relatedSlug))
    .filter((relatedEntry): relatedEntry is NonNullable<typeof relatedEntry> => Boolean(relatedEntry))
    .map((relatedEntry) => ({
      slug: relatedEntry.slug,
      title: relatedEntry.title,
      titleJa: relatedEntry.titleJa,
      categoryLabel: relatedEntry.categoryLabel,
      categoryLabelJa: relatedEntry.categoryLabelJa,
    }));

  return (
    <PublicSite activePath="/repository" className="mj-repository-site mj-repository-detail-site" locale={locale} showLanguageToggle>
      <RepositoryEntryView
        entry={entry}
        locale={locale}
        isSignedIn={Boolean(user)}
        signInHref={signInHref}
        related={related}
        estimate={
          // Decided here, not by testing the element: a React element is truthy
          // whatever it renders, so passing one unconditionally gives an empty
          // "Fault-tolerant cost" section on the 163 entries with no circuit.
          hasVisibleEstimate(estimate) ? <RepositoryEstimatePanel estimate={estimate} locale={locale} /> : null
        }
        profile={
          // Decided here for the same reason, and the reason bit once already:
          // a truthy element would give an empty "Circuit structure" section on
          // the 163 entries that carry no circuit.
          hasVisibleProfile(profile) ? <RepositoryProfilePanel profile={profile} locale={locale} /> : null
        }
        connections={
          // Unconditional, unlike its two neighbours. An entry with no ports
          // renders a sentence saying it is not a pipeline stage, because that
          // is the answer to the question the section asks — and it is the
          // answer for 121 of the 283 records.
          <RepositoryInterfacePanel
            entry={entryInterface}
            neighbours={neighbours}
            titleOf={(slug) => titleBySlug.get(slug) ?? slug}
            stanceCount={stanceCount}
            locale={locale}
          />
        }
      />
    </PublicSite>
  );
}
