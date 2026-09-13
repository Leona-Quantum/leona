/**
 * DOM helpers for the tour overlay. Client-only; everything here touches the page.
 */

/** Elements the tour itself made inert, so they are never mistaken for the page's own. */
const madeInertByTour = new WeakSet<Element>();

/** Inert because the page says so (a closed drawer), not because a tour step is running. */
export function inertByPage(node: Element): boolean {
  for (let element: Element | null = node; element; element = element.parentElement) {
    if (element.hasAttribute("inert") && !madeInertByTour.has(element)) return true;
  }
  return false;
}

/** The first visible, reachable element whose `data-tour` attribute is the given name. */
export function findTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`);
  for (const node of Array.from(nodes)) {
    if (node.closest("[hidden]") || inertByPage(node)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (getComputedStyle(node).visibility === "hidden") continue;
    return node;
  }
  return null;
}

/** The nearest `data-tour` name at or above an element, for "That's the framework picker". */
export function tourNameOf(element: Element | null): string | null {
  return element?.closest<HTMLElement>("[data-tour]")?.dataset.tour ?? null;
}

/**
 * Keyboard focus stays on the step: everything that is not on the path from the
 * body to the target (and not the tour's own layer) becomes `inert` for as long
 * as the step waits for an action. Elements the page had already made inert are
 * left alone, and only what this call changed is restored.
 */
export function inertOutside(target: Element, keep: Element | null): () => void {
  const changed: Element[] = [];
  let node: Element = target;
  while (node.parentElement && node !== document.body) {
    const parent: Element = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) continue;
      if (keep && (sibling === keep || sibling.contains(keep))) continue;
      if (sibling.hasAttribute("inert")) continue;
      if (sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE" || sibling.tagName === "LINK") continue;
      sibling.setAttribute("inert", "");
      madeInertByTour.add(sibling);
      changed.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const element of changed) {
      if (!madeInertByTour.has(element)) continue;
      element.removeAttribute("inert");
      madeInertByTour.delete(element);
    }
  };
}

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[role=\"tab\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(", ");

/** The control a step is really about: the target itself, or the first focusable thing in it. */
export function controlIn(target: HTMLElement): HTMLElement | null {
  if (target.matches(FOCUSABLE)) return target;
  return target.querySelector<HTMLElement>(FOCUSABLE);
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function fieldIn(target: HTMLElement): Field | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return target;
  return target.querySelector<Field>("textarea, select, input:not([type=\"hidden\"]):not([type=\"file\"])");
}

export function fieldValue(target: HTMLElement): string | null {
  return fieldIn(target)?.value ?? null;
}

/**
 * Set a value the way a person would, so React's controlled inputs see it: the
 * native setter (React overrides the instance one), then the event React listens
 * for — `input` for text, `change` for a select.
 */
export function setFieldValue(field: Field, value: string): void {
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Types visibly, a character at a time; under reduced motion it just sets the value. */
export async function typeInto(field: Field, text: string, reduced: boolean, cancelled: () => boolean): Promise<void> {
  field.focus({ preventScroll: true });
  if (field instanceof HTMLSelectElement || reduced) {
    setFieldValue(field, text);
    return;
  }
  const step = Math.max(1, Math.ceil(text.length / 60));
  for (let index = step; index < text.length + step; index += step) {
    if (cancelled()) return;
    setFieldValue(field, text.slice(0, index));
    await wait(22);
  }
}

export function pressTarget(target: HTMLElement): void {
  (controlIn(target) ?? target).click();
}

export function isEditable(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) return !["button", "submit", "checkbox", "radio", "reset"].includes(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

/** Adds an id to the control's `aria-describedby` and returns the undo. */
export function describeWith(control: Element, id: string): () => void {
  const before = control.getAttribute("aria-describedby");
  const ids = new Set((before ?? "").split(/\s+/).filter(Boolean));
  ids.add(id);
  control.setAttribute("aria-describedby", [...ids].join(" "));
  return () => {
    if (before === null) control.removeAttribute("aria-describedby");
    else control.setAttribute("aria-describedby", before);
  };
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
