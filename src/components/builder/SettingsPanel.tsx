"use client";

import type { Steps } from "@/lib/engine/steps";
import type { Token } from "@/lib/engine/tokens";
import type { Field, FieldFormat } from "@/lib/schema/types";
import { IconEquals, IconHash, IconList, IconLock, IconTrash, IconX } from "../icons";
import { Button, cx, Segmented, TextInput, Toggle } from "../ui";
import { ChoicesEditor, LimitEditor, NumberField } from "./fieldControls";
import { FormulaBuilder } from "./FormulaBuilder";
import { StepsFormula } from "./StepsFormula";

export type BlockType = "number" | "dropdown" | "result" | "fixed";

export const blockTypeOf = (f: Field): BlockType =>
  f.kind === "input" ? (f.inputType === "select" ? "dropdown" : "number") : f.kind === "output" ? "result" : "fixed";

export const BLOCK_INFO: Record<BlockType, { name: string; hint: string; Icon: typeof IconHash }> = {
  number: { name: "Number box", hint: "Customer types an amount, e.g. price", Icon: IconHash },
  dropdown: { name: "Dropdown", hint: "Customer picks one choice, e.g. months", Icon: IconList },
  result: { name: "Result", hint: "Calculated for the customer, e.g. monthly due", Icon: IconEquals },
  fixed: { name: "Fixed number", hint: "A number you set, e.g. a 6% rate", Icon: IconLock },
};

const FORMATS: { value: FieldFormat; label: string }[] = [
  { value: "currency", label: "Money" },
  { value: "number", label: "Number" },
  { value: "integer", label: "Whole number" },
  { value: "percent", label: "Percent" },
];

/** Change how a field is shown. Percent values are stored as fractions, so convert stored numbers too. */
export function withFormat(f: Field, format: FieldFormat): Field {
  const from = f.format === "percent" ? 1 : 0;
  const to = format === "percent" ? 1 : 0;
  const scale = from === to ? 1 : to ? 0.01 : 100;
  const conv = (v: number | null | undefined) => (v == null ? v : +(v * scale).toFixed(10));
  const autoText = (v: number) => (f.format === "percent" ? `${+(v * 100).toFixed(6)}%` : String(v));
  const next: Field = {
    ...f,
    format,
    decimals: format === "integer" ? 0 : f.format === "integer" && format === "currency" ? 2 : f.decimals,
  };
  if (scale !== 1 && f.kind === "input") {
    next.defaultValue = conv(f.defaultValue);
    next.options = f.options?.map((o) => {
      const value = conv(o.value)!;
      return { value, label: o.label === autoText(o.value) ? (to ? `${+(value * 100).toFixed(6)}%` : String(value)) : o.label };
    });
    if (f.min?.value !== undefined) next.min = { ...f.min, value: conv(f.min.value)! };
    if (f.max?.value !== undefined) next.max = { ...f.max, value: conv(f.max.value)! };
  }
  if (scale !== 1 && f.kind === "constant") next.value = conv(f.value)!;
  return next;
}

type Props = {
  field: Field;
  /** key groups quick edits (typing) into one undo step */
  onChange: (f: Field, key?: string) => void;
  onConvert: (to: BlockType) => void;
  onDelete: () => void;
  onClose: () => void;
  allFields: Field[];
  labelOf: (id: string) => string;
  sampleOf: (id: string) => string;
  /** Formatted live value of this field. */
  liveValue: string | null;
  problem?: string;
  // formula editing (results only)
  steps: Steps | null;
  advanced: boolean;
  onSteps: (s: Steps) => void;
  onAdvanced: (on: boolean) => void;
  tokens: Token[];
  onTokens: (t: Token[]) => void;
};

export function SettingsPanel(p: Props) {
  const { field: f } = p;
  const type = blockTypeOf(f);
  const info = BLOCK_INFO[type];
  const set = (patch: Partial<Field>, key?: string) => p.onChange({ ...f, ...patch }, key);
  const others = p.allFields.filter((x) => x.id !== f.id);
  const stepsPossible = p.steps !== null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <info.Icon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">{info.name}</div>
          <div className="truncate font-semibold">{f.label || "Untitled"}</div>
        </div>
        <button type="button" onClick={p.onClose} aria-label="Close settings" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
          <IconX />
        </button>
      </div>

      {f.importNote && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{f.importNote}</p>}
      {p.problem && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{p.problem}</p>}

      <Section title="Name">
        <TextInput aria-label="Name" value={f.label} placeholder="e.g. HP Price" onChange={(e) => set({ label: e.target.value }, `${f.id}.label`)} />
      </Section>

      {type === "result" && (
        <Section title="How it's calculated">
          {stepsPossible && !p.advanced ? (
            <StepsFormula steps={p.steps!} onChange={p.onSteps} fields={others} labelOf={p.labelOf} sampleOf={p.sampleOf} result={p.liveValue} />
          ) : (
            <>
              <FormulaBuilder tokens={p.tokens} onChange={p.onTokens} fields={others} labelOf={p.labelOf} preview={p.liveValue} />
              {stepsPossible ? (
                <button type="button" className="self-start text-sm text-accent hover:underline" onClick={() => p.onAdvanced(false)}>
                  Back to simple steps
                </button>
              ) : (
                <p className="text-xs text-muted">This calculation uses brackets or functions, so it is shown in the advanced editor.</p>
              )}
            </>
          )}
        </Section>
      )}

      {type === "dropdown" && (
        <Section title="Choices">
          <ChoicesEditor field={f} onChange={(next) => p.onChange(next, `${f.id}.choices`)} />
        </Section>
      )}

      {type === "fixed" && (
        <Section title="Value">
          <NumberField aria-label="Value" value={f.value ?? null} percent={f.format === "percent"} onChange={(v) => set({ value: v ?? 0 }, `${f.id}.value`)} />
        </Section>
      )}

      <Section title={type === "dropdown" ? "The choices are" : type === "number" ? "Customer types" : "Show it as"}>
        <Segmented<FieldFormat>
          label="Format"
          value={f.format}
          options={FORMATS}
          onChange={(format) => p.onChange(withFormat(f, format))}
        />
      </Section>

      {type === "number" && (
        <>
          <Section title="Starts with" hint="Leave empty so the box starts blank.">
            <NumberField
              aria-label="Starts with"
              placeholder="Empty"
              value={f.defaultValue ?? null}
              percent={f.format === "percent"}
              onChange={(v) => set({ defaultValue: v }, `${f.id}.default`)}
            />
          </Section>
          <LimitEditor kind="min" bound={f.min} self={f} fields={p.allFields} onChange={(b) => set({ min: b })} />
        </>
      )}

      {type === "result" && (
        <Toggle checked={!!f.highlight} onChange={(v) => set({ highlight: v || undefined })} label="Show big at the top of the results" />
      )}

      <Toggle
        checked={!f.hidden}
        onChange={(v) => set({ hidden: !v || undefined })}
        label={
          type === "number" || type === "dropdown"
            ? "Customers can see and change this"
            : type === "fixed"
              ? "Show this number to customers"
              : "Show this result to customers"
        }
      />

      <details className="group rounded-xl border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-sm font-medium">
          More options
          <span className="text-muted transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="flex flex-col gap-5 border-t border-line p-3">
          {f.format !== "integer" && (
            <Section title="Decimal places">
              <Segmented<number>
                label="Decimal places"
                value={f.decimals}
                options={[0, 1, 2, 3].map((d) => ({ value: d, label: String(d) }))}
                onChange={(decimals) => set({ decimals })}
              />
            </Section>
          )}

          {(type === "number" || type === "dropdown") && (
            <Section title="Help text under the box">
              <TextInput value={f.helpText ?? ""} placeholder="e.g. Give the HP price" onChange={(e) => set({ helpText: e.target.value || undefined }, `${f.id}.help`)} />
            </Section>
          )}

          {type === "number" && (
            <>
              {f.min && (
                <Section title="Message when it's too low" hint="Leave empty for an automatic message.">
                  <TextInput value={f.min.message ?? ""} onChange={(e) => set({ min: { ...f.min, message: e.target.value || undefined } }, `${f.id}.minmsg`)} />
                </Section>
              )}
              <LimitEditor kind="max" bound={f.max} self={f} fields={p.allFields} onChange={(b) => set({ max: b })} />
              {f.max && (
                <Section title="Message when it's too high">
                  <TextInput value={f.max.message ?? ""} onChange={(e) => set({ max: { ...f.max, message: e.target.value || undefined } }, `${f.id}.maxmsg`)} />
                </Section>
              )}
            </>
          )}

          {type === "result" && stepsPossible && !p.advanced && (
            <button type="button" className="self-start text-sm text-accent hover:underline" onClick={() => p.onAdvanced(true)}>
              Use the advanced formula editor (brackets, ROUND, IF…)
            </button>
          )}

          <Section title="Change this into">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(BLOCK_INFO) as BlockType[])
                .filter((t) => t !== type)
                .map((t) => {
                  const I = BLOCK_INFO[t].Icon;
                  return (
                    <Button key={t} className="justify-start" onClick={() => p.onConvert(t)}>
                      <I size={16} /> {BLOCK_INFO[t].name}
                    </Button>
                  );
                })}
            </div>
          </Section>
        </div>
      </details>

      <div className="flex items-center justify-between gap-2">
        <Button variant="danger" onClick={p.onDelete}>
          <IconTrash size={16} /> Remove
        </Button>
        <Button variant="primary" onClick={p.onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-1.5")}>
      <span className="text-sm font-medium">{title}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}
