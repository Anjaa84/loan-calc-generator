"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/engine/format";
import { STEP_OPS, type StepOp, type Steps, type StepValue } from "@/lib/engine/steps";
import type { Field } from "@/lib/schema/types";
import { zonesOf } from "@/lib/schema/zones";
import { IconPlus, IconX } from "../icons";
import { Button, cx, Segmented } from "../ui";

const OP_LABEL: Record<StepOp, { sym: string; word: string }> = {
  "+": { sym: "+", word: "plus" },
  "-": { sym: "−", word: "minus" },
  "*": { sym: "×", word: "times" },
  "/": { sym: "÷", word: "divided by" },
};

type Props = {
  steps: Steps;
  onChange: (s: Steps) => void;
  /** Boxes that can be used (everything except the result being edited). */
  fields: Field[];
  labelOf: (id: string) => string;
  /** Live value of each field with the sample numbers, already formatted. */
  sampleOf: (id: string) => string;
  /** Formatted result of this formula, or null while incomplete. */
  result: string | null;
};

export function StepsFormula({ steps, onChange, fields, labelOf, sampleOf, result }: Props) {
  // -1 = the "start with" slot, otherwise the index in steps.rest
  const [open, setOpen] = useState<number | null>(steps.first ? null : -1);

  const setSlot = (slot: number, value: StepValue) => {
    if (slot === -1) onChange({ ...steps, first: value });
    else onChange({ ...steps, rest: steps.rest.map((s, i) => (i === slot ? { ...s, value } : s)) });
    setOpen(null);
  };

  const slotButton = (slot: number, value: StepValue | null) => (
    <button
      type="button"
      onClick={() => setOpen(open === slot ? null : slot)}
      aria-expanded={open === slot}
      className={cx(
        "flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border px-3 text-left text-[15px] transition-colors",
        open === slot ? "border-accent ring-2 ring-accent/20" : value ? "border-line bg-surface hover:border-accent" : "border-dashed border-accent/60 bg-accent-soft/50 text-accent",
      )}
    >
      {value ? (
        value.kind === "field" ? (
          <span className="min-w-0 truncate font-medium text-accent">{labelOf(value.field)}</span>
        ) : (
          <span className="tabular font-medium">{numText(value)}</span>
        )
      ) : (
        <span>Choose…</span>
      )}
      <span className="shrink-0 text-xs text-muted">change</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-3">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-sm text-muted">Start with</span>
          {slotButton(-1, steps.first)}
        </div>
        {open === -1 && <Picker fields={fields} sampleOf={sampleOf} current={steps.first} onPick={(v) => setSlot(-1, v)} />}

        {steps.rest.map((s, i) => (
          <div key={i} className="flex flex-col gap-2 border-t border-line pt-2">
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-sm text-muted">then</span>
              <div className="flex gap-1" role="radiogroup" aria-label={`Step ${i + 1} operation`}>
                {STEP_OPS.map((op) => (
                  <button
                    key={op}
                    type="button"
                    role="radio"
                    aria-checked={s.op === op}
                    title={OP_LABEL[op].word}
                    aria-label={OP_LABEL[op].word}
                    onClick={() => onChange({ ...steps, rest: steps.rest.map((x, j) => (j === i ? { ...x, op } : x)) })}
                    className={cx(
                      "h-11 w-10 rounded-lg border text-lg font-semibold",
                      s.op === op ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:bg-surface-2",
                    )}
                  >
                    {OP_LABEL[op].sym}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={`Remove step ${i + 1}`}
                onClick={() => {
                  onChange({ ...steps, rest: steps.rest.filter((_, j) => j !== i) });
                  setOpen(null);
                }}
                className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
              >
                <IconX size={16} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-sm text-muted">{OP_LABEL[s.op].word}</span>
              {slotButton(i, s.value)}
            </div>
            {open === i && <Picker fields={fields} sampleOf={sampleOf} current={s.value} onPick={(v) => setSlot(i, v)} />}
          </div>
        ))}

        <button
          type="button"
          disabled={!steps.first}
          onClick={() => {
            onChange({ ...steps, rest: [...steps.rest, { op: "+", value: null }] });
            setOpen(steps.rest.length);
          }}
          className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm font-medium text-accent hover:border-accent disabled:opacity-40"
        >
          <IconPlus size={16} /> Add a step (+ − × ÷)
        </button>
      </div>
      <div className="flex items-baseline justify-between gap-2 px-1 text-sm">
        <span className="text-muted">Result with the test numbers</span>
        <span className="tabular font-semibold">{result ?? "—"}</span>
      </div>
    </div>
  );
}

const numText = (v: Extract<StepValue, { kind: "num" }>) => `${formatNumber(v.v, decimalsOf(v.v))}${v.pct ? "%" : ""}`;
const decimalsOf = (v: number) => {
  const s = String(v);
  const i = s.indexOf(".");
  return i === -1 ? 0 : Math.min(10, s.length - i - 1);
};

function Picker({
  fields,
  sampleOf,
  current,
  onPick,
}: {
  fields: Field[];
  sampleOf: (id: string) => string;
  current: StepValue | null;
  onPick: (v: StepValue) => void;
}) {
  const z = zonesOf(fields);
  const cur = current?.kind === "num" ? current : null;
  const [text, setText] = useState(cur ? String(cur.v) : "");
  const [pct, setPct] = useState(cur?.pct ?? false);
  const n = Number(text.replace(/,/g, "").trim());
  const validNum = text.trim() !== "" && Number.isFinite(n);

  const group = (title: string, list: Field[]) =>
    list.length > 0 && (
      <div className="flex flex-col gap-1">
        <span className="px-1 text-xs font-medium tracking-wide text-muted uppercase">{title}</span>
        <div className="grid gap-1 sm:grid-cols-2">
          {list.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onPick({ kind: "field", field: f.id })}
              className={cx(
                "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm hover:border-accent",
                current?.kind === "field" && current.field === f.id ? "border-accent bg-accent-soft" : "border-line bg-surface",
              )}
            >
              <span className="min-w-0 font-medium">{f.label}</span>
              <span className="tabular shrink-0 text-xs text-muted">{sampleOf(f.id)}</span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-surface p-3">
      {group("Boxes the customer fills in", z.inputs)}
      {group("Results", z.results)}
      {group("Hidden numbers", z.hidden)}
      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-xs font-medium tracking-wide text-muted uppercase">Or type a number</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && validNum) {
                e.preventDefault();
                onPick({ kind: "num", v: n, pct });
              }
            }}
            inputMode="decimal"
            placeholder="e.g. 6"
            aria-label="Number"
            className="h-11 w-28 rounded-lg border border-line bg-surface px-3 focus:border-accent focus:outline-2 focus:outline-accent/30"
          />
          <Segmented<"n" | "p">
            label="Number or percent"
            value={pct ? "p" : "n"}
            options={[
              { value: "n", label: "number" },
              { value: "p", label: "%" },
            ]}
            onChange={(v) => setPct(v === "p")}
          />
          <Button variant="primary" disabled={!validNum} onClick={() => onPick({ kind: "num", v: n, pct })}>
            Use {validNum ? `${text.trim()}${pct ? "%" : ""}` : "number"}
          </Button>
        </div>
      </div>
    </div>
  );
}
