"use client";

import { useMemo, useState } from "react";
import { defaultInputs, evaluateSchema } from "@/lib/engine/evaluate";
import { formatValue } from "@/lib/engine/format";
import type { CalcSchema } from "@/lib/schema/types";
import { cx } from "../ui";
import { BigResult, InputRow, NumberBox, ResultRow, SelectBox, selectRaw, toRaw, valuesFromRaw } from "./parts";

type Props = {
  schema: CalcSchema;
  currency?: string;
  /** Smaller paddings for the builder preview. */
  compact?: boolean;
  /** Optional controlled values (the builder shares them between Edit and Try it). */
  raw?: Record<string, string>;
  onRawChange?: (raw: Record<string, string>) => void;
};

export function initialRaw(schema: CalcSchema): Record<string, string> {
  const d = defaultInputs(schema);
  const out: Record<string, string> = {};
  for (const f of schema.fields) if (f.kind === "input") out[f.id] = toRaw(f, d[f.id]);
  return out;
}

export function Calculator({ schema, currency = "", compact, raw: rawProp, onRawChange }: Props) {
  const [ownRaw, setOwnRaw] = useState<Record<string, string>>(() => initialRaw(schema));
  const raw = rawProp ?? ownRaw;
  const setRaw = (next: Record<string, string>) => (onRawChange ? onRawChange(next) : setOwnRaw(next));

  const result = useMemo(
    () => evaluateSchema(schema, valuesFromRaw(schema, raw), (v, f) => formatValue(v, f, currency)),
    [schema, raw, currency],
  );

  const byId = new Map(schema.fields.map((f) => [f.id, f]));
  const visibleInputs = schema.fields.filter((f) => f.kind === "input" && !f.hidden);
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
              const hint =
                f.helpText || (minField && minVal != null) ? (
                  <>
                    {f.helpText}
                    {f.helpText && minField && minVal != null ? " · " : ""}
                    {minField && minVal != null && <>Minimum: {formatValue(minVal, minField, currency)}</>}
                  </>
                ) : undefined;
              const set = (v: string) => setRaw({ ...raw, [f.id]: v });
              return (
                <InputRow key={f.id} id={id} label={f.label} error={err} hint={hint}>
                  {f.inputType === "select" ? (
                    <SelectBox id={id} field={f} value={selectRaw(f, raw[f.id])} onChange={set} />
                  ) : (
                    <NumberBox id={id} field={f} value={raw[f.id] ?? toRaw(f, f.defaultValue)} onChange={set} currency={currency} error={!!err} />
                  )}
                </InputRow>
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
            <BigResult key={f.id} label={f.label} value={formatValue(result.values[f.id], f, currency)} compact={compact} />
          ))}
          {rest.length > 0 && (
            <dl className={cx("rounded-2xl border border-line bg-surface", compact ? "px-4" : "px-5 sm:px-6")}>
              {rest.map((f) => (
                <ResultRow key={f.id} label={f.label} value={formatValue(result.values[f.id], f, currency)} className="border-b border-line last:border-b-0" />
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
