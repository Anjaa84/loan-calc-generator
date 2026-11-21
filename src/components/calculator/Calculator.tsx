"use client";

import { useMemo, useState } from "react";
import { defaultInputs, evaluateSchema, type Values } from "@/lib/engine/evaluate";
import { formatValue, parseUserNumber } from "@/lib/engine/format";
import type { CalcSchema, Field } from "@/lib/schema/types";
import { cx } from "../ui";

type Props = {
  schema: CalcSchema;
  currency?: string;
  /** Smaller paddings for the builder preview. */
  compact?: boolean;
};

const toRaw = (f: Field, v: number | null | undefined) =>
  v === null || v === undefined ? "" : f.format === "percent" ? String(+(v * 100).toFixed(10)) : String(v);

function initialRaw(schema: CalcSchema): Record<string, string> {
  const d = defaultInputs(schema);
  const out: Record<string, string> = {};
  for (const f of schema.fields) if (f.kind === "input") out[f.id] = toRaw(f, d[f.id]);
  return out;
}

export function Calculator({ schema, currency = "", compact }: Props) {
  const [raw, setRaw] = useState<Record<string, string>>(() => initialRaw(schema));
  const inputs = schema.fields.filter((f) => f.kind === "input");

  const result = useMemo(() => {
    const vals: Values = {};
    for (const f of schema.fields) {
      if (f.kind !== "input") continue;
      const n = parseUserNumber(raw[f.id] ?? "");
      vals[f.id] = n === null ? null : f.format === "percent" ? n / 100 : n;
    }
    return evaluateSchema(schema, vals, (v, f) => formatValue(v, f, currency));
  }, [schema, raw, currency]);

  const byId = new Map(schema.fields.map((f) => [f.id, f]));
  const visibleInputs = inputs.filter((f) => !f.hidden);
  const outputs = schema.fields.filter((f) => f.kind !== "input" && !f.hidden);
  const highlighted = outputs.filter((f) => f.highlight);
  const rest = outputs.filter((f) => !f.highlight);
  const hasErrors = Object.keys(result.errors).length > 0;
  const pad = compact ? "p-4" : "p-5 sm:p-6";

  return (
    <div className="flex flex-col gap-4">
      {visibleInputs.length > 0 && (
        <section className={cx("rounded-2xl border border-line bg-surface", pad)} aria-label="Your details">
          <div className="flex flex-col gap-4">
            {visibleInputs.map((f) => {
              const err = result.errors[f.id];
              const minField = f.min?.field ? byId.get(f.min.field) : undefined;
              const minVal = minField ? result.values[minField.id] : null;
              const id = `in-${f.id}`;
              return (
                <div key={f.id} className="flex flex-col gap-1.5">
                  <label htmlFor={id} className="text-sm font-medium">
                    {f.label}
                  </label>
                  {f.inputType === "select" ? (
                    <select
                      id={id}
                      value={raw[f.id] ?? ""}
                      onChange={(e) => setRaw((r) => ({ ...r, [f.id]: e.target.value }))}
                      className="h-12 w-full rounded-xl border border-line bg-surface px-3 text-text focus:border-accent focus:outline-2 focus:outline-accent/30"
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={`${o.value}-${o.label}`} value={toRaw(f, o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div
                      className={cx(
                        "flex h-12 items-center rounded-xl border bg-surface focus-within:outline-2",
                        err ? "border-danger focus-within:outline-danger/30" : "border-line focus-within:border-accent focus-within:outline-accent/30",
                      )}
                    >
                      {f.format === "currency" && currency && <span className="pl-3 text-muted">{currency}</span>}
                      <input
                        id={id}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        value={raw[f.id] ?? ""}
                        aria-invalid={!!err}
                        aria-describedby={err ? `${id}-err` : undefined}
                        onChange={(e) => setRaw((r) => ({ ...r, [f.id]: e.target.value }))}
                        className="tabular h-full w-full min-w-0 bg-transparent px-3 text-[17px] outline-none"
                      />
                      {f.format === "percent" && <span className="pr-3 text-muted">%</span>}
                    </div>
                  )}
                  {err ? (
                    <p id={`${id}-err`} className="text-sm text-danger" role="alert">
                      {err}
                    </p>
                  ) : (
                    (f.helpText || (minField && minVal !== null && minVal !== undefined)) && (
                      <p className="text-xs text-muted">
                        {f.helpText}
                        {f.helpText && minField && minVal != null ? " · " : ""}
                        {minField && minVal != null && <>Minimum: {formatValue(minVal, minField, currency)}</>}
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {result.cycle ? (
        <p className="rounded-2xl border border-line bg-danger-soft p-4 text-sm text-danger">{result.cycle}</p>
      ) : hasErrors ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface p-5 text-center text-sm text-muted">
          Fix the highlighted field to see the results.
        </p>
      ) : (
        <section className="flex flex-col gap-3" aria-label="Results" aria-live="polite">
          {highlighted.map((f) => (
            <div key={f.id} className={cx("rounded-2xl bg-accent text-accent-fg", pad)}>
              <div className="text-sm opacity-90">{f.label}</div>
              <div className="tabular mt-1 text-3xl font-semibold tracking-tight break-words sm:text-4xl">
                {formatValue(result.values[f.id], f, currency)}
              </div>
            </div>
          ))}
          {rest.length > 0 && (
            <dl className={cx("rounded-2xl border border-line bg-surface", compact ? "px-4" : "px-5 sm:px-6")}>
              {rest.map((f) => (
                <div key={f.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
                  <dt className="text-sm text-muted">{f.label}</dt>
                  <dd className="tabular shrink-0 text-right font-medium whitespace-nowrap">{formatValue(result.values[f.id], f, currency)}</dd>
                </div>
              ))}
            </dl>
          )}
          {outputs.length === 0 && <p className="text-center text-sm text-muted">No results to show yet.</p>}
        </section>
      )}

      {visibleInputs.some((f) => f.inputType !== "select") && (
        <button
          type="button"
          onClick={() => setRaw(initialRaw(schema))}
          className="self-center rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-text"
        >
          Reset
        </button>
      )}
    </div>
  );
}
