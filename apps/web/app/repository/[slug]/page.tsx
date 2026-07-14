import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSite } from "../../../components/public-site";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../../lib/auth";
import { getPublicRepositoryEntry, PUBLIC_REPOSITORY_ENTRIES } from "../../../lib/public-repository";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { RepositoryEntryView } from "./repository-entry-view";

export async function generateStaticParams() {
  return PUBLIC_REPOSITORY_ENTRIES.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = getPublicRepositoryEntry(slug);
  return entry
    ? { title: entry.title, description: entry.description }
    : { title: "Repository entry" };
}

export default async function RepositoryEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getPublicRepositoryEntry(slug);
  if (!entry) notFound();
  const locale = await getPublicLocale();
  const { user } = await getMajoranaAuth();
  const signInHref = !user && isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;

  return (
    <PublicSite activePath="/repository" className="mj-repository-site mj-repository-detail-site" locale={locale} showLanguageToggle>
      <RepositoryEntryView entry={entry} locale={locale} isSignedIn={Boolean(user)} signInHref={signInHref} />
    </PublicSite>
  );
}
