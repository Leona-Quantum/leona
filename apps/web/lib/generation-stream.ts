/** Recover a displayable source prefix from a streaming generated-source JSON value.
 *
 * The LLM contract remains JSON ({"source": "..."}) for reliable server parsing;
 * this small, deterministic decoder exposes only the source string as it arrives.
 * It intentionally ignores everything before/after that field and stops cleanly at
 * an incomplete escape rather than inventing code.
 */
export function sourcePrefixFromGenerationJson(text: string): string | null {
  const match = /"source"\s*:\s*"/.exec(text);
  if (!match) return null;

  const encoded = text.slice((match.index ?? 0) + match[0].length);
  let source = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character === '"') break;
    if (character !== "\\") {
      source += character;
      continue;
    }

    const escaped = encoded[index + 1];
    if (!escaped) break;
    const replacements: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escaped === "u") {
      const hex = encoded.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      source += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    if (!(escaped in replacements)) break;
    source += replacements[escaped];
    index += 1;
  }
  return source;
}
