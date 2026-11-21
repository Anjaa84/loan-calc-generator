"use client";

import { useState } from "react";
import { selectDefault } from "@/lib/engine/evaluate";
import { formatNumber } from "@/lib/engine/format";
import type { Bound, Field, SelectOption } from "@/lib/schema/types";
import { IconPlus, IconX } from "../icons";
import { cx, Segmented, Select, TextInput } from "../ui";

/** Number box that keeps what the person typed while editing; percent mode shows 6 for 0.06. */
export function NumberField({
  value,
  onChange,
  percent,
  className,
  ...rest
}: { value: number | null; onChange: (v: number | null) => void; percent?: boolean } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  const shown = value === null ? "" : String(+(percent ? value * 100 : value).toFixed(10));
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  return (
    <div className={cx("relative", className)}>
      <TextInput
        {...rest}
        inputMode="decimal"
        value={focused ? text : shown}
        onFocus={() => {
          setText(shown);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const s = e.target.value.replace(/,/g, "").trim();
          if (s === "") return onChange(null);
          const n = Number(s);
          if (Number.isFinite(n)) onChange(percent ? n / 100 : n);
        }}
        className={percent ? "pr-8" : undefined}
      />
      {percent && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted">%</span>}
    </div>
  );
}

// ---------------------------------------------------------------- dropdown choices

const valueText = (f: Field, v: number) => (f.format === "percent" ? `${+(v * 100).toFixed(6)}%` : formatNumber(v, f.format === "integer" ? 0 : Math.min(f.decimals, 6)).replace(/\.0+$/, ""));

/** When the value changes, keep a label like "6 months" in step ("12 months"). */
function relabel(f: Field, label: string, oldValue: number, newValue: number) {
  const oldText = valueText(f, oldValue);
  const plain = String(+(f.format === "percent" ? oldValue * 100 : oldValue).toFixed(6));
  for (const prefix of [oldText, plain]) if (label.startsWith(prefix)) return valueText(f, newValue) + label.slice(prefix.length);
  return label.trim() === "" ? valueText(f, newValue) : label;
}

export function ChoicesEditor({ field: f, onChange }: { field: Field; onChange: (f: Field) => void }) {
  const opts = f.options ?? [];
  const set = (options: SelectOption[], extra?: Partial<Field>) => onChange({ ...f, options, ...extra });
  const def = selectDefault(f);
  const pct = f.format === "percent";

  const addChoice = () => {
    const last = opts[opts.length - 1];
    const prev = opts[opts.length - 2];
    const stepBy = last && prev ? last.value - prev.value : pct ? 0.05 : 1;
    const value = last ? +(last.value + (stepBy || 1)).toFixed(10) : pct ? 0.1 : 1;
    const label = last ? relabel(f, last.label, last.value, value) : valueText(f, value);
    set([...opts, { label, value }]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[6.5rem_1fr_2.75rem] gap-2 text-xs text-muted">
          <span>{pct ? "Percent" : "Number"}</span>
          <span>Customer sees</span>
          <span />
        </div>
        {opts.map((o, i) => (
          <div key={i} className="grid grid-cols-[6.5rem_1fr_2.75rem] gap-2">
            <NumberField
              aria-label={`Choice ${i + 1} value`}
              value={o.value}
              percent={pct}
              onChange={(v) => {
                const value = v ?? 0;
                set(
                  opts.map((x, j) => (j === i ? { value, label: relabel(f, x.label, x.value, value) } : x)),
                  def === o.value ? { defaultValue: value } : undefined,
                );
              }}
            />
            <TextInput aria-label={`Choice ${i + 1} text`} value={o.label} onChange={(e) => set(opts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <button
              type="button"
              aria-label={`Remove choice ${o.label}`}
              onClick={() => set(opts.filter((_, j) => j !== i))}
              className="flex h-11 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
            >
              <IconX size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addChoice}
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm font-medium text-accent hover:border-accent"
        >
          <IconPlus size={16} /> Add a choice
        </button>
      </div>

      {opts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Starts on</span>
          <Segmented
            label="Starts on"
            value={String(def)}
            options={opts.map((o) => ({ value: String(o.value), label: o.label || valueText(f, o.value) }))}
            onChange={(v) => onChange({ ...f, defaultValue: Number(v) })}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- min / max

type Mode = "none" | "value" | "field";

export function LimitEditor({
  kind,
  bound,
  self,
  fields,
  onChange,
}: {
  kind: "min" | "max";
  bound?: Bound;
  self: Field;
  fields: Field[];
  onChange: (b: Bound | undefined) => void;
}) {
  const mode: Mode = !bound ? "none" : bound.field !== undefined ? "field" : "value";
  const others = fields.filter((x) => x.id !== self.id);
  const word = kind === "min" ? "at least" : "at most";
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{kind === "min" ? "Lowest amount allowed" : "Highest amount allowed"}</span>
      <Segmented<Mode>
        label={kind === "min" ? "Lowest amount allowed" : "Highest amount allowed"}
        value={mode}
        options={[
          { value: "none", label: "No limit" },
          { value: "value", label: "A number" },
          { value: "field", label: "Another box's value" },
        ]}
        onChange={(m) => {
          if (m === "none") onChange(undefined);
          else if (m === "value") onChange({ value: bound?.value ?? 0, message: bound?.message });
          else onChange({ field: bound?.field ?? others.find((x) => x.kind === "output")?.id ?? others[0]?.id ?? "", message: bound?.message });
        }}
      />
      {mode !== "none" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <span>
            <b className="font-medium">{self.label || "This box"}</b> must be {word}
          </span>
          {mode === "value" ? (
            <NumberField
              aria-label={`${kind === "min" ? "Lowest" : "Highest"} number`}
              className="w-36"
              value={bound?.value ?? null}
              percent={self.format === "percent"}
              onChange={(v) => onChange({ ...bound, value: v ?? 0 })}
            />
          ) : (
            <Select aria-label="Compared with" className="w-auto min-w-40 flex-1" value={bound?.field ?? ""} onChange={(e) => onChange({ ...bound, field: e.target.value })}>
              {others.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
