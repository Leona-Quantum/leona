"use client";

// Deliberately NOT per-account (see DEVICE_STORAGE_KEYS in lib/user-storage.ts).
// These are bookmarks over the PUBLIC corpus, on pages that render while signed
// out and sit outside the authenticated layout where the account scope is
// established. Scoping them would make the same star appear or vanish depending
// on whether the visitor arrived by client navigation or a fresh page load.
const STORAGE_KEY = "majorana.public-repository-stars.v1";
const CHANGE_EVENT = "majorana:repository-stars";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadIds(): Set<string> {
  if (!canUseStorage()) return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function emitChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function loadStarredRepositorySlugs(): Set<string> {
  return loadIds();
}

export function isRepositoryStarred(slug: string): boolean {
  return loadIds().has(slug);
}

export function toggleRepositoryStar(slug: string): boolean {
  const starred = loadIds();
  if (starred.has(slug)) starred.delete(slug);
  else starred.add(slug);
  if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...starred]));
  emitChange();
  return starred.has(slug);
}
