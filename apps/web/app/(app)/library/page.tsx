import { redirect } from "next/navigation";

// The Vault is retired: a saved artifact's list, evidence and versions all live
// in Studio now, so a second surface over the same rows was one place too many
// to keep in step. Sessions that still land here — bookmarks, a cached sidebar
// link, a link in an old run summary — belong in Studio.
export default function LibraryList() {
  redirect("/studio");
}
