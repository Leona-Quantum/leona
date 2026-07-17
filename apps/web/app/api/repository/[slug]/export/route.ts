import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import {
  getPublicRepositoryEntry,
  getPublicRepositoryLibraryVariant,
  getPublicRepositoryVariant,
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryEntry,
} from "../../../../../lib/public-repository";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const entry = getPublicRepositoryEntry(slug);
  if (!entry) return NextResponse.json({ error: "public entry not found" }, { status: 404 });

  const libraryVariant = getPublicRepositoryLibraryVariant(entry);
  if (!libraryVariant) {
    return NextResponse.json(
      { error: "This entry does not have a supported native Library export yet." },
      { status: 422 },
    );
  }

  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetch(`${API_URL}/v1/artifacts/import-public`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(publicImportPayload(entry, libraryVariant)),
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}

function publicImportPayload(
  entry: PublicRepositoryEntry,
  libraryVariant: NonNullable<ReturnType<typeof getPublicRepositoryLibraryVariant>>,
) {
  const qasmVariant = getPublicRepositoryVariant(entry, "OpenQASM 3.0");
  const frameworkVariants = Object.fromEntries(
    PUBLIC_REPOSITORY_FRAMEWORKS
      .map((framework) => getPublicRepositoryVariant(entry, framework))
      .filter((variant) => variant.status !== "unsupported" && Boolean(variant.code))
      .map((variant) => [variant.framework, variant.code]),
  );

  return {
    source_slug: entry.slug,
    title: entry.title,
    family: entry.algorithmFamily,
    framework: libraryVariant.framework.toLowerCase(),
    code: libraryVariant.code,
    code_lang: libraryVariant.language,
    qasm: qasmVariant.status !== "unsupported" && qasmVariant.code.startsWith("OPENQASM 3") ? qasmVariant.code : null,
    framework_variants: Object.keys(frameworkVariants).length ? frameworkVariants : null,
    resource_estimates: Object.fromEntries(entry.resources.map((resource) => [resource.label, resource.value])),
    export_status: exportStatus(entry.exportStatus),
    source_url: entry.source.url,
    source_title: entry.source.title,
    source_license: entry.source.license,
    introduction: entry.introduction,
    explanation: entry.explanation,
    verification: entry.verification,
  };
}

function exportStatus(value: string): "lossless" | "download_only" {
  return value.toLowerCase().includes("lossless") ? "lossless" : "download_only";
}
