import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSite } from "../../../components/public-site";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../../lib/auth";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getRepositoryEntries, getRepositoryEntry } from "../../../lib/repository-source";
import { RepositoryEntryView } from "./repository-entry-view";

export async function generateStaticParams() {
  const entries = await getRepositoryEntries();
  return entries.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = await getRepositoryEntry(slug);
  const locale = await getPublicLocale();
  return entry
    ? { title: locale === "ja" ? entry.titleJa : entry.title, description: locale === "ja" ? entry.descriptionJa : entry.description }
    : { title: locale === "ja" ? "リポジトリエントリ" : "Repository entry" };
}

export default async function RepositoryEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // One fetch for both the entry and its related records — resolving each
  // relatedSlug through getRepositoryEntry() would re-await the whole corpus
  // per link.
  const entries = await getRepositoryEntries();
  const entry = entries.find((candidate) => candidate.slug === slug);
  if (!entry) notFound();
  const locale = await getPublicLocale();
  const { user } = await getMajoranaAuth();
  const signInHref = !user && isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
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
      <RepositoryEntryView entry={entry} locale={locale} isSignedIn={Boolean(user)} signInHref={signInHref} related={related} />
    </PublicSite>
  );
}
