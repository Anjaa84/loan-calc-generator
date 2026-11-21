"use client";

import { useState } from "react";
import { parseTokens } from "@/lib/engine/parse";
import { tokenText } from "@/lib/engine/format";
import { FormulaError, type OpToken, type Token } from "@/lib/engine/tokens";
import { FUNCTIONS, type Field } from "@/lib/schema/types";
import { cx, Select } from "../ui";

const FN_HELP: Record<string, string> = {
  ROUND: "ROUND(value , decimals)",
  ROUNDUP: "ROUNDUP(value , decimals)",
  ROUNDDOWN: "ROUNDDOWN(value , decimals)",
  MIN: "MIN(a , b , …) smallest",
  MAX: "MAX(a , b , …) largest",
  SUM: "SUM(a , b , …)",
  AVERAGE: "AVERAGE(a , b , …)",
  ABS: "ABS(value) removes the minus sign",
  IF: "IF(condition , value if yes , value if no)",
};

const OPS: { v: OpToken; label: string; title: string }[] = [
  { v: "+", label: "+", title: "Add" },
  { v: "-", label: "−", title: "Subtract" },
  { v: "*", label: "×", title: "Multiply" },
  { v: "/", label: "÷", title: "Divide" },
  { v: "%", label: "%", title: "Percent (6 % = 0.06)" },
  { v: "^", label: "xʸ", title: "Power" },
];
const COMPARE: OpToken[] = [">", "<", ">=", "<=", "=", "<>"];

export function tryParse(tokens: Token[]): { ok: true } | { ok: false; message: string; at?: number } {
  try {
    parseTokens(tokens);
    return { ok: true };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, message: e.message, at: e.tokenIndex };
    return { ok: false, message: String(e) };
  }
}

type Props = {
  tokens: Token[];
  onChange: (t: Token[]) => void;
  /** Fields that may be used (everything except the field being edited). */
  fields: Field[];
  labelOf: (id: string) => string;
  preview: string | null;
};

export function FormulaBuilder({ tokens, onChange, fields, labelOf, preview }: Props) {
  const [cursor, setCursor] = useState(tokens.length);
  const [num, setNum] = useState("");
  const [showMore, setShowMore] = useState(false);
  const at = Math.min(cursor, tokens.length);
  const status = tryParse(tokens);

  const insert = (...t: Token[]) => {
    const next = [...tokens.slice(0, at), ...t, ...tokens.slice(at)];
    onChange(next);
    setCursor(at + t.length);
  };
  const backspace = () => {
    if (at === 0) return;
    // Remove a function name together with its "(".
    const prev = tokens[at - 1];
    const from = prev.k === "lp" && tokens[at - 2]?.k === "fn" ? at - 2 : at - 1;
    onChange([...tokens.slice(0, from), ...tokens.slice(at)]);
    setCursor(from);
  };
  const addNumber = (pct: boolean) => {
    const v = Number(num.replace(/,/g, ""));
    if (num.trim() === "" || !Number.isFinite(v)) return;
    insert({ k: "num", v }, ...(pct ? [{ k: "op", v: "%" } as Token] : []));
    setNum("");
  };

  const chip = (t: Token, i: number) => {
    const isBad = !status.ok && status.at === i;
    const base = "h-9 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap border";
    const tone =
      t.k === "ref"
        ? "bg-accent-soft text-accent border-transparent"
        : t.k === "num"
          ? "bg-surface text-text border-line tabular"
          : t.k === "fn"
            ? "bg-surface-2 text-text border-transparent font-mono"
            : "bg-transparent text-muted border-transparent text-base";
    return (
      <button
        key={i}
        type="button"
        onClick={() => setCursor(i + 1)}
        className={cx(base, tone, isBad && "!border-danger ring-2 ring-danger/30")}
        title="Tap to place the cursor after this"
      >
        {t.k === "lp" && tokens[i - 1]?.k === "fn" ? "(" : tokenText(t, labelOf)}
      </button>
    );
  };
  const caret = <span key="caret" aria-hidden className="mx-0.5 h-7 w-0.5 animate-pulse self-center rounded bg-accent" />;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cx(
          "flex min-h-14 flex-wrap items-center gap-1 rounded-xl border bg-surface-2 p-2",
          status.ok ? "border-line" : "border-danger/60",
        )}
        aria-label="Formula"
      >
        <button type="button" onClick={() => setCursor(0)} className="h-9 w-2" aria-label="Move cursor to start" />
        {at === 0 && caret}
        {tokens.length === 0 && <span className="px-1 text-sm text-muted">Tap the buttons below to build the formula</span>}
        {tokens.map((t, i) => [chip(t, i), i + 1 === at ? caret : null])}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        {status.ok ? (
          <span className="text-muted">
            = <span className="tabular font-medium text-text">{preview ?? "—"}</span>
            <span className="text-xs"> (with the preview values)</span>
          </span>
        ) : (
          <span className="text-danger">{status.message}</span>
        )}
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={backspace} className="h-9 rounded-lg border border-line px-3 hover:bg-surface-2" aria-label="Delete before cursor">
            ⌫
          </button>
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setCursor(0);
            }}
            className="h-9 rounded-lg border border-line px-3 text-muted hover:bg-surface-2"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value=""
          aria-label="Insert a field"
          onChange={(e) => {
            if (e.target.value) insert({ k: "ref", field: e.target.value });
          }}
        >
          <option value="">+ Field…</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
        <div className="flex gap-1">
          <input
            value={num}
            onChange={(e) => setNum(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNumber(false);
              }
            }}
            inputMode="decimal"
            placeholder="Number"
            aria-label="Number to insert"
            className="h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 focus:border-accent focus:outline-2 focus:outline-accent/30"
          />
          <button type="button" onClick={() => addNumber(false)} className="h-11 rounded-lg border border-line px-3 text-sm font-medium hover:bg-surface-2">
            Add
          </button>
          <button type="button" onClick={() => addNumber(true)} className="h-11 rounded-lg border border-line px-3 text-sm font-medium whitespace-nowrap hover:bg-surface-2" title="Add as a percentage">
            Add %
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {OPS.map((o) => (
          <OpButton key={o.v} title={o.title} onClick={() => insert({ k: "op", v: o.v })}>
            {o.label}
          </OpButton>
        ))}
        <OpButton title="Open bracket" onClick={() => insert({ k: "lp" })}>
          (
        </OpButton>
        <OpButton title="Close bracket" onClick={() => insert({ k: "rp" })}>
          )
        </OpButton>
      </div>

      <button type="button" onClick={() => setShowMore((s) => !s)} className="self-start text-sm text-accent hover:underline">
        {showMore ? "Hide functions" : "More: functions & comparisons"}
      </button>
      {showMore && (
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <div className="flex flex-wrap gap-1.5">
            {FUNCTIONS.map((fn) => (
              <button
                key={fn}
                type="button"
                title={FN_HELP[fn]}
                onClick={() => insert({ k: "fn", name: fn }, { k: "lp" })}
                className="h-9 rounded-lg bg-surface-2 px-2.5 font-mono text-sm hover:bg-line"
              >
                {fn}
              </button>
            ))}
            <OpButton title="Separate values inside a function" onClick={() => insert({ k: "comma" })}>
              ,
            </OpButton>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMPARE.map((c) => (
              <OpButton key={c} title="Compare (for IF)" onClick={() => insert({ k: "op", v: c })}>
                {tokenText({ k: "op", v: c }, labelOf)}
              </OpButton>
            ))}
          </div>
          <p className="text-xs text-muted">
            Example: <span className="font-mono">ROUND( Monthly Due , 0 )</span> or{" "}
            <span className="font-mono">IF( Duration &gt; 6 , 8% , 6% )</span>
          </p>
        </div>
      )}
    </div>
  );
}

function OpButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="h-11 min-w-11 rounded-lg border border-line bg-surface text-lg font-medium hover:bg-surface-2 active:bg-line"
    >
      {children}
    </button>
  );
}
