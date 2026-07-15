import { cookies } from "next/headers";
import { LEGACY_PUBLIC_LOCALE_COOKIE, parsePublicLocale, PUBLIC_LOCALE_COOKIE, type PublicLocale } from "./public-locale";

export async function getPublicLocale(): Promise<PublicLocale> {
  const cookieStore = await cookies();
  return parsePublicLocale(
    cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value ?? cookieStore.get(LEGACY_PUBLIC_LOCALE_COOKIE)?.value,
  );
}
