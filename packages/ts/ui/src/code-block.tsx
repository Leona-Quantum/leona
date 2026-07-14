import type { ReactNode } from "react";

type TokenKind = "comment" | "string" | "keyword" | "number" | "function" | "operator";

const TOKEN_PATTERN = /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|(\b[A-Za-z_$][\w$]*)(?=\s*\()|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b|===|!==|==|!=|=>|<=|>=|&&|\|\||[+*/%=<>!-]/g;

const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "class",
  "const",
  "def",
  "from",
  "function",
  "import",
  "in",
  "let",
  "measure",
  "new",
  "return",
  "qreg",
  "creg",
  "OPENQASM",
  "include",
  "if",
  "else",
  "for",
  "while",
  "with",
  "yield",
]);

function tokenKind(token: string, isFunction: boolean): TokenKind | null {
  if (token.startsWith("//") || token.startsWith("#") || token.startsWith("/*")) return "comment";
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) return "string";
  if (/^\d/.test(token)) return "number";
  if (KEYWORDS.has(token)) return "keyword";
  if (isFunction) return "function";
  if (/^(===|!==|==|!=|=>|<=|>=|&&|\|\||[+*/%=<>!-])$/.test(token)) return "operator";
  return null;
}

export function SyntaxHighlightedCode({ code, language }: { code: string; language: string }): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of code.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? cursor;
    if (start > cursor) nodes.push(code.slice(cursor, start));
    const token = match[0];
    const kind = tokenKind(token, Boolean(match[1]));
    nodes.push(
      kind ? <span className={`mj-code-token mj-code-token--${kind}`} key={`${start}-${index}`}>{token}</span> : token,
    );
    cursor = start + token.length;
    index += 1;
  }

  if (cursor < code.length) nodes.push(code.slice(cursor));

  return <code data-language={language}>{nodes}</code>;
}
