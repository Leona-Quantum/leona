import { cookies } from "next/headers";
import { parsePublicLocale, PUBLIC_LOCALE_COOKIE, type PublicLocale } from "./public-locale";

export async function getPublicLocale(): Promise<PublicLocale> {
  const cookieStore = await cookies();
  return parsePublicLocale(cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value);
}
