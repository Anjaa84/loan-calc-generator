// Visual pieces of a calculator, shared by the public page and the builder
// canvas so both look exactly the same.

import type { ReactNode } from "react";
import { selectDefault, type Values } from "@/lib/engine/evaluate";
import { parseUserNumber } from "@/lib/engine/format";
import type { CalcSchema, Field } from "@/lib/schema/types";
import { cx } from "../ui";

export const toRaw = (f: Field, v: number | null | undefined) =>
  v === null || v === undefined ? "" : f.format === "percent" ? String(+(v * 100).toFixed(10)) : String(v);

/** What a dropdown should show: the typed value if it is still one of the options, else its default. */
export function selectRaw(f: Field, raw: string | undefined): string {
  const opts = f.options ?? [];
  if (raw !== undefined && opts.some((o) => toRaw(f, o.value) === raw)) return raw;
  return toRaw(f, selectDefault(f));
}

/** Raw text per input → engine values (percent inputs become fractions). Missing entries use defaults. */
export function valuesFromRaw(schema: CalcSchema, raw: Record<string, string>): Values {
  const vals: Values = {};
  for (const f of schema.fields) {
    if (f.kind !== "input") continue;
    const text = f.inputType === "select" ? selectRaw(f, raw[f.id]) : (raw[f.id] ?? toRaw(f, f.defaultValue));
    const n = parseUserNumber(text);
    vals[f.id] = n === null ? null : f.format === "percent" ? n / 100 : n;
  }
  return vals;
}

export function InputRow({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

const selectClass =
  "h-12 w-full rounded-xl border border-line bg-surface px-3 text-text focus:border-accent focus:outline-2 focus:outline-accent/30";

export function SelectBox({
  id,
  field: f,
  value,
  onChange,
  inert,
}: {
  id: string;
  field: Field;
  value: string;
  onChange?: (v: string) => void;
  /** Shown but not usable (builder edit mode). */
  inert?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      tabIndex={inert ? -1 : undefined}
      onChange={(e) => onChange?.(e.target.value)}
      className={cx(selectClass, inert && "pointer-events-none")}
    >
      {(f.options ?? []).map((o, i) => (
        <option key={`${i}-${o.value}`} value={toRaw(f, o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberBox({
  id,
  field: f,
  value,
  onChange,
  currency,
  error,
  inert,
}: {
  id: string;
  field: Field;
  value: string;
  onChange?: (v: string) => void;
  currency: string;
  error?: boolean;
  inert?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex h-12 items-center rounded-xl border bg-surface focus-within:outline-2",
        error ? "border-danger focus-within:outline-danger/30" : "border-line focus-within:border-accent focus-within:outline-accent/30",
        inert && "pointer-events-none",
      )}
    >
      {f.format === "currency" && currency && <span className="pl-3 text-muted">{currency}</span>}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        readOnly={inert}
        tabIndex={inert ? -1 : undefined}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange?.(e.target.value)}
        className="tabular h-full w-full min-w-0 bg-transparent px-3 text-[17px] outline-none"
      />
      {f.format === "percent" && <span className="pr-3 text-muted">%</span>}
    </div>
  );
}

export function BigResult({ label, value, compact, className }: { label: ReactNode; value: string; compact?: boolean; className?: string }) {
  return (
    <div className={cx("rounded-2xl bg-accent text-accent-fg", compact ? "p-4" : "p-5 sm:p-6", className)}>
      <div className="text-sm opacity-90">{label}</div>
      <div className="tabular mt-1 text-3xl font-semibold tracking-tight break-words sm:text-4xl">{value}</div>
    </div>
  );
}

export function ResultRow({ label, value, className }: { label: ReactNode; value: string; className?: string }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 py-3", className)}>
      <dt className="min-w-0 flex-1 text-sm text-muted">{label}</dt>
      <dd className="tabular shrink-0 text-right font-medium whitespace-nowrap">{value}</dd>
    </div>
  );
}
