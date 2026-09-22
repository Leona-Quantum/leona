import type { PublicLocale } from "./public-locale.ts";

/**
 * A read-only description of one field in a Qapp's `input_schema` or
 * `output_schema` — for `/embed/q/[slug]` (ai-ops 355), which shows what a
 * Qapp takes and returns without rendering the interactive form that reads and
 * submits them (`components/qapp-runtime.tsx`; the embed page never mounts it).
 *
 * Nothing renders these schemas anywhere else in the app today — the private
 * workspace and the public page both hand `input_schema`/`output_schema`
 * straight to the generated `ui_document` iframe and never look inside them —
 * so this is new, not a reuse of an existing renderer.
 */
export type QappFieldSummary = {
  /** The schema's own property key, e.g. "shots". */
  name: string;
  /** A human label: the schema's own `title`, or `name` split into words. */
  label: string;
  /** A short, human description of the shape — "number", "list of text", … */
  type: string;
  /** The schema's own `description`, if the generation supplied one. */
  description?: string;
};

const SCALAR_LABEL: Record<PublicLocale, Record<string, string>> = {
  en: { string: "text", number: "number", integer: "whole number", boolean: "yes/no" },
  ja: { string: "テキスト", number: "数値", integer: "整数", boolean: "はい/いいえ" },
};

const FALLBACK_SCALAR_LABEL: Record<PublicLocale, string> = { en: "value", ja: "値" };

function scalarLabel(type: string, locale: PublicLocale): string {
  return SCALAR_LABEL[locale][type] ?? FALLBACK_SCALAR_LABEL[locale];
}

const COMPOSITE_LABEL: Record<PublicLocale, {
  list: (item: string) => string;
  map: (item: string) => string;
  records: string;
  record: string;
  value: string;
}> = {
  en: {
    list: (item) => `list of ${item}`,
    map: (item) => `map of ${item}`,
    records: "list of records",
    record: "record",
    value: "value",
  },
  ja: {
    list: (item) => `${item}のリスト`,
    map: (item) => `${item}のマップ`,
    records: "レコードのリスト",
    record: "レコード",
    value: "値",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Describes one JSON Schema property in the four shapes the generation prompt
 * promises (`packages/py/llm/src/majorana_llm/prompts.py`: a scalar; an array
 * of one scalar type; a map of scalars via `type=object` +
 * `additionalProperties`; or an array of flat records). Anything that does not
 * match one of those — a hand-edited or future schema shape — falls back to a
 * generic label rather than throwing, since this renders a Qapp somebody else
 * published and a malformed field must not 500 the embed.
 */
function describeSchemaType(field: Record<string, unknown>, locale: PublicLocale): string {
  const type = typeof field.type === "string" ? field.type : undefined;
  const words = COMPOSITE_LABEL[locale];
  if (type === "array") {
    const items = asRecord(field.items);
    const itemType = items && typeof items.type === "string" ? items.type : undefined;
    if (itemType === "object") return words.records;
    return itemType ? words.list(scalarLabel(itemType, locale)) : words.value;
  }
  if (type === "object") {
    const additional = asRecord(field.additionalProperties);
    const additionalType = additional && typeof additional.type === "string" ? additional.type : undefined;
    return additionalType ? words.map(scalarLabel(additionalType, locale)) : words.record;
  }
  return type ? scalarLabel(type, locale) : words.value;
}

/** "n_qubits" / "nQubits" -> "N qubits" — a property name with no schema title. */
function humanizeFieldName(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  if (spaced.length === 0) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Every declared field in a Qapp's `input_schema` or `output_schema`, in the
 * order the schema declares them (object key order is insertion order for
 * string keys, which is what the generation and the API both preserve).
 *
 * Defensive by construction: a schema is data from a third party's generated
 * Qapp, not this codebase's own shape, so every read here tolerates the field
 * being absent, non-object, or missing `properties` rather than throwing —
 * the embed route showing "no declared fields" is a far better failure than a
 * 500 on someone else's published app.
 */
export function summarizeQappSchema(
  schema: Record<string, unknown> | null | undefined,
  locale: PublicLocale,
): QappFieldSummary[] {
  const properties = asRecord(schema)?.properties;
  const propertyRecord = asRecord(properties);
  if (!propertyRecord) return [];
  return Object.entries(propertyRecord).map(([name, value]) => {
    const field = asRecord(value) ?? {};
    const title = typeof field.title === "string" && field.title.trim().length > 0 ? field.title : humanizeFieldName(name);
    const description = typeof field.description === "string" && field.description.trim().length > 0
      ? field.description
      : undefined;
    // `description` is omitted rather than set to `undefined` — an optional
    // field's absence should be invisible to a deepEqual/JSON.stringify
    // caller, not merely `undefined`-valued.
    return description === undefined
      ? { name, label: title, type: describeSchemaType(field, locale) }
      : { name, label: title, type: describeSchemaType(field, locale), description };
  });
}
