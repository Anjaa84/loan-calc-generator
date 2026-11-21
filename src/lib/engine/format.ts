import type { Expr, Field } from "../schema/types";
import { exprToTokens } from "./parse";
import type { Token } from "./tokens";

// Fixed locale so server and client render identically (no hydration mismatch).
const nf = (decimals: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function formatNumber(v: number, decimals: number): string {
  return nf(Math.max(0, Math.min(10, decimals))).format(v);
}

export function formatValue(v: number | null | undefined, field: Pick<Field, "format" | "decimals">, currency = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (field.format) {
    case "percent":
      return `${formatNumber(v * 100, field.decimals)}%`;
    case "integer":
      return formatNumber(v, 0);
    case "currency":
      return currency ? `${currency} ${formatNumber(v, field.decimals)}` : formatNumber(v, field.decimals);
    default:
      return formatNumber(v, field.decimals);
  }
}

/** Parse what a person typed ("58,990.50") into a number, or null if empty/invalid. */
export function parseUserNumber(raw: string): number | null {
  const s = raw.replace(/[,\s]/g, "").replace(/%$/, "");
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const OP_TEXT: Record<string, string> = {
  "*": "×",
  "/": "÷",
  "-": "−",
  "<>": "≠",
  ">=": "≥",
  "<=": "≤",
};

export function tokenText(t: Token, labelOf: (id: string) => string): string {
  switch (t.k) {
    case "num":
      return formatNumber(t.v, decimalsOf(t.v));
    case "ref":
      return labelOf(t.field);
    case "cell":
      return t.sheet ? `${t.sheet}!${t.addr}` : t.addr;
    case "range":
      return `${t.sheet ? `${t.sheet}!` : ""}${t.from}:${t.to}`;
    case "op":
      return OP_TEXT[t.v] ?? t.v;
    case "lp":
      return "(";
    case "rp":
      return ")";
    case "comma":
      return ",";
    case "fn":
      return t.name;
  }
}

function decimalsOf(v: number) {
  const s = String(v);
  const i = s.indexOf(".");
  return i === -1 ? 0 : Math.min(10, s.length - i - 1);
}

/** Human-readable formula, e.g. "Loan Amount × 6%". */
export function exprToText(e: Expr, labelOf: (id: string) => string): string {
  const tokens = exprToTokens(e);
  let out = "";
  tokens.forEach((t, i) => {
    const txt = tokenText(t, labelOf);
    const prev = tokens[i - 1];
    if (t.k === "lp" && prev?.k === "fn") out += "(";
    else if (t.k === "rp" || t.k === "comma" || (t.k === "op" && t.v === "%")) out += txt;
    else if (prev?.k === "lp" || i === 0) out += txt;
    else if (prev?.k === "op" && prev.v === "-" && (i === 1 || tokens[i - 2]?.k === "op" || tokens[i - 2]?.k === "lp" || tokens[i - 2]?.k === "comma"))
      out += txt; // unary minus
    else out += ` ${txt}`;
  });
  return out;
}
