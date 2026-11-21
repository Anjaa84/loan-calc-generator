"use client";

import { useState } from "react";
import { selectDefault } from "@/lib/engine/evaluate";
import { exprToText, formatValue } from "@/lib/engine/format";
import type { Token } from "@/lib/engine/tokens";
import type { Bound, Field, FieldFormat, FieldKind, SelectOption } from "@/lib/schema/types";
import { Badge, Button, cx, Field as FormField, Select, TextInput, Toggle } from "../ui";
import { FormulaBuilder } from "./FormulaBuilder";

const KIND_LABEL: Record<FieldKind, string> = { input: "Input", output: "Result", constant: "Fixed value" };
const KIND_TONE = { input: "accent", output: "ok", constant: "neutral" } as const;

type Props = {
  field: Field;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onChange: (f: Field) => void;
  onKindChange: (k: FieldKind) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  allFields: Field[];
  labelOf: (id: string) => string;
  tokens: Token[];
  onTokens: (t: Token[]) => void;
  formulaError?: string;
  previewValue: number | null;
  currency: string;
};

export function FieldCard(p: Props) {
  const { field: f } = p;
  const summary =
    f.kind === "output"
      ? p.formulaError
        ? p.formulaError
        : f.formula
          ? `= ${exprToText(f.formula, p.labelOf)}`
          : "No formula yet"
      : f.kind === "constant"
        ? formatValue(f.value ?? null, f, p.currency)
        : f.inputType === "select"
          ? `Dropdown: ${(f.options ?? []).map((o) => o.label).join(", ") || "no options"}`
          : `Number${f.defaultValue != null ? ` · default ${formatValue(f.defaultValue, f, p.currency)}` : ""}`;

  return (
    <li className={cx("rounded-2xl border bg-surface", p.open ? "border-accent" : "border-line")}>
      <div className="flex items-start gap-2 p-3 sm:p-4">
        <button type="button" onClick={p.onToggle} className="min-w-0 flex-1 text-left" aria-expanded={p.open}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{f.label || "Untitled"}</span>
            <Badge tone={KIND_TONE[f.kind]}>{KIND_LABEL[f.kind]}</Badge>
            {f.hidden && <Badge>Hidden</Badge>}
            {f.highlight && <Badge tone="accent">Big</Badge>}
            {f.verified && <Badge tone="ok">✓ matches Excel</Badge>}
            {f.importNote && !f.verified &&
              (f.importNote.startsWith("Taken from the formula") ? <Badge>From formula</Badge> : <Badge tone="warn">Check</Badge>)}
          </div>
          <div className={cx("mt-1 line-clamp-2 text-sm", p.formulaError || (f.kind === "output" && !f.formula) ? "text-danger" : "text-muted")}>
            {summary}
          </div>
        </button>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" aria-label="Move up" disabled={p.index === 0} onClick={() => p.onMove(-1)}>
            ↑
          </Button>
          <Button size="sm" variant="ghost" aria-label="Move down" disabled={p.index === p.count - 1} onClick={() => p.onMove(1)}>
            ↓
          </Button>
        </div>
      </div>

      {p.open && (
        <div className="flex flex-col gap-4 border-t border-line p-3 sm:p-4">
          {f.importNote && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{f.importNote}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Label" htmlFor={`label-${f.id}`}>
              <TextInput id={`label-${f.id}`} value={f.label} onChange={(e) => p.onChange({ ...f, label: e.target.value })} />
            </FormField>
            <FormField label="Type" htmlFor={`kind-${f.id}`}>
              <Select id={`kind-${f.id}`} value={f.kind} onChange={(e) => p.onKindChange(e.target.value as FieldKind)}>
                <option value="input">Input (customer types or picks)</option>
                <option value="output">Result (calculated by a formula)</option>
                <option value="constant">Fixed value (a setting)</option>
              </Select>
            </FormField>
          </div>

          {f.kind === "output" && (
            <FormField label="Formula">
              <FormulaBuilder
                tokens={p.tokens}
                onChange={p.onTokens}
                fields={p.allFields.filter((x) => x.id !== f.id)}
                labelOf={p.labelOf}
                preview={p.previewValue === null ? null : formatValue(p.previewValue, f, p.currency)}
              />
            </FormField>
          )}

          {f.kind === "input" && <InputSettings {...p} />}

          {f.kind === "constant" && (
            <FormField label="Value" htmlFor={`value-${f.id}`} hint={f.format === "percent" ? "Enter 6 for 6%" : undefined}>
              <NumberBox
                id={`value-${f.id}`}
                value={f.value ?? null}
                percent={f.format === "percent"}
                onChange={(v) => p.onChange({ ...f, value: v ?? 0 })}
              />
            </FormField>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Show as" htmlFor={`fmt-${f.id}`}>
              <Select
                id={`fmt-${f.id}`}
                value={f.format}
                onChange={(e) => {
                  const format = e.target.value as FieldFormat;
                  p.onChange({ ...f, format, decimals: format === "integer" ? 0 : f.decimals || (format === "currency" ? 2 : f.decimals) });
                }}
              >
                <option value="currency">Money</option>
                <option value="number">Number</option>
                <option value="integer">Whole number</option>
                <option value="percent">Percentage</option>
              </Select>
            </FormField>
            {f.format !== "integer" && (
              <FormField label="Decimal places" htmlFor={`dec-${f.id}`}>
                <Select id={`dec-${f.id}`} value={f.decimals} onChange={(e) => p.onChange({ ...f, decimals: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
          </div>

          <FormField label="Help text (optional)" htmlFor={`help-${f.id}`}>
            <TextInput id={`help-${f.id}`} value={f.helpText ?? ""} onChange={(e) => p.onChange({ ...f, helpText: e.target.value || undefined })} />
          </FormField>

          <div className="flex flex-col gap-1">
            <Toggle
              checked={!f.hidden}
              onChange={(v) => p.onChange({ ...f, hidden: !v || undefined })}
              label={f.kind === "input" ? "Show to customers (if off, the default value is used)" : "Show to customers"}
            />
            {f.kind === "output" && (
              <Toggle checked={!!f.highlight} onChange={(v) => p.onChange({ ...f, highlight: v || undefined })} label="Show big at the top of the results" />
            )}
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="danger" size="sm" onClick={p.onDelete}>
              Delete field
            </Button>
            <Button size="sm" onClick={p.onToggle}>
              Done
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function InputSettings(p: Props) {
  const { field: f } = p;
  const isSelect = f.inputType === "select";
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Customer enters" htmlFor={`itype-${f.id}`}>
        <Select
          id={`itype-${f.id}`}
          value={isSelect ? "select" : "number"}
          onChange={(e) => {
            const select = e.target.value === "select";
            p.onChange({
              ...f,
              inputType: select ? "select" : "number",
              options: select ? (f.options?.length ? f.options : defaultOptions(f)) : f.options,
              defaultValue: select ? (f.options?.[0]?.value ?? f.defaultValue ?? null) : f.defaultValue,
            });
          }}
        >
          <option value="number">Any number</option>
          <option value="select">A choice from a dropdown</option>
        </Select>
      </FormField>

      {isSelect ? (
        <OptionsEditor field={f} onChange={p.onChange} />
      ) : (
        <>
          <FormField label="Default value (optional)" htmlFor={`def-${f.id}`} hint="Leave empty so customers start with a blank box.">
            <NumberBox
              id={`def-${f.id}`}
              value={f.defaultValue ?? null}
              percent={f.format === "percent"}
              onChange={(v) => p.onChange({ ...f, defaultValue: v })}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <BoundEditor title="Minimum" bound={f.min} self={f} fields={p.allFields} onChange={(b) => p.onChange({ ...f, min: b })} />
            <BoundEditor title="Maximum" bound={f.max} self={f} fields={p.allFields} onChange={(b) => p.onChange({ ...f, max: b })} />
          </div>
        </>
      )}
    </div>
  );
}

function defaultOptions(f: Field): SelectOption[] {
  if (f.defaultValue != null) return [{ label: String(f.defaultValue), value: f.defaultValue }];
  return [
    { label: "3 months", value: 3 },
    { label: "6 months", value: 6 },
    { label: "12 months", value: 12 },
  ];
}

function OptionsEditor({ field: f, onChange }: { field: Field; onChange: (f: Field) => void }) {
  const opts = f.options ?? [];
  const set = (next: SelectOption[]) => onChange({ ...f, options: next });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">Dropdown options</div>
      <div className="grid grid-cols-[1fr_7rem_auto] gap-2 text-xs text-muted">
        <span>Shown as</span>
        <span>Value</span>
        <span />
      </div>
      {opts.map((o, i) => (
        <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-2">
          <TextInput aria-label="Option label" value={o.label} onChange={(e) => set(opts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <NumberBox
            aria-label="Option value"
            value={o.value}
            percent={f.format === "percent"}
            onChange={(v) => set(opts.map((x, j) => (j === i ? { ...x, value: v ?? 0 } : x)))}
          />
          <Button size="sm" variant="ghost" aria-label="Remove option" className="h-11" onClick={() => set(opts.filter((_, j) => j !== i))}>
            ✕
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        className="self-start"
        onClick={() => {
          const last = opts[opts.length - 1]?.value ?? 0;
          set([...opts, { label: String(last + 1), value: last + 1 }]);
        }}
      >
        + Add option
      </Button>
      {opts.length > 0 && (
        <FormField label="Selected by default" htmlFor={`seldef-${f.id}`}>
          <Select
            id={`seldef-${f.id}`}
            value={String(selectDefault(f))}
            onChange={(e) => onChange({ ...f, defaultValue: Number(e.target.value) })}
          >
            {opts.map((o, i) => (
              <option key={i} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
      )}
    </div>
  );
}

function BoundEditor({
  title,
  bound,
  self,
  fields,
  onChange,
}: {
  title: string;
  bound?: Bound;
  self: Field;
  fields: Field[];
  onChange: (b: Bound | undefined) => void;
}) {
  const mode = !bound ? "none" : bound.field !== undefined ? "field" : "value";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
      <FormField label={title} htmlFor={`${title}-${self.id}`}>
        <Select
          id={`${title}-${self.id}`}
          value={mode}
          onChange={(e) => {
            const m = e.target.value;
            if (m === "none") onChange(undefined);
            else if (m === "value") onChange({ value: bound?.value ?? 0, message: bound?.message });
            else onChange({ field: fields.find((x) => x.id !== self.id)?.id ?? "", message: bound?.message });
          }}
        >
          <option value="none">No limit</option>
          <option value="value">A fixed number</option>
          <option value="field">Another field&apos;s value</option>
        </Select>
      </FormField>
      {mode === "value" && (
        <NumberBox aria-label={`${title} value`} value={bound?.value ?? null} percent={self.format === "percent"} onChange={(v) => onChange({ ...bound, value: v ?? 0 })} />
      )}
      {mode === "field" && (
        <Select aria-label={`${title} field`} value={bound?.field ?? ""} onChange={(e) => onChange({ ...bound, field: e.target.value })}>
          {fields
            .filter((x) => x.id !== self.id)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
        </Select>
      )}
      {mode !== "none" && (
        <TextInput
          aria-label="Error message"
          placeholder="Error message (optional)"
          value={bound?.message ?? ""}
          onChange={(e) => onChange({ ...bound, message: e.target.value || undefined })}
        />
      )}
    </div>
  );
}

/** Number box that keeps what the person typed while editing; percent mode shows 6 for 0.06. */
function NumberBox({
  value,
  onChange,
  percent,
  ...rest
}: { value: number | null; onChange: (v: number | null) => void; percent?: boolean } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  const shown = value === null ? "" : String(+(percent ? value * 100 : value).toFixed(10));
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
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
