"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { saveCalculator, suggestSlug } from "@/app/admin/actions";
import { defaultInputs, evaluateSchema } from "@/lib/engine/evaluate";
import { exprToTokens, parseTokens } from "@/lib/engine/parse";
import type { Token } from "@/lib/engine/tokens";
import type { ReuploadDiff } from "@/lib/excel/mergeReupload";
import { toUrlSlug, uniqueId } from "@/lib/excel/labels";
import type { CalcSchema, CalculatorDraft, Field, FieldKind } from "@/lib/schema/types";
import { validateSchema } from "@/lib/schema/validate";
import { Calculator } from "../calculator/Calculator";
import { Button, Card, cx, Field as FormField, TextArea, TextInput, Toggle } from "../ui";
import { FieldCard } from "./FieldCard";
import { tryParse } from "./FormulaBuilder";

type Props = {
  initial: CalculatorDraft;
  importNotes?: string[];
};

const tokensOf = (schema: CalcSchema) =>
  Object.fromEntries(schema.fields.filter((f) => f.formula).map((f) => [f.id, exprToTokens(f.formula!)])) as Record<string, Token[]>;

/** Read an Excel file in the browser (the file never leaves the device). */
export async function importExcelFile(file: File) {
  const { importWorkbook } = await import("@/lib/excel/extract");
  return importWorkbook(await file.arrayBuffer());
}

export function Builder({ initial, importNotes }: Props) {
  const router = useRouter();
  const isNew = !initial.id;
  const [meta, setMeta] = useState({
    title: initial.title,
    slug: initial.slug,
    description: initial.description,
    currency: initial.currency,
    published: initial.published,
    source_filename: initial.source_filename,
  });
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [schema, setSchema] = useState<CalcSchema>(initial.schema);
  const [drafts, setDrafts] = useState<Record<string, Token[]>>(() => tokensOf(initial.schema));
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"build" | "preview">("build");
  const [notes, setNotes] = useState<string[] | undefined>(importNotes);
  const [pending, setPending] = useState<{ schema: CalcSchema; diff: ReuploadDiff; notes: string[]; file: string } | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(isNew);
  const [saving, startSave] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const labelOf = useMemo(() => {
    const m = new Map(schema.fields.map((f) => [f.id, f.label]));
    return (id: string) => m.get(id) ?? "⚠ missing field";
  }, [schema]);

  const formulaErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of schema.fields) {
      if (f.kind !== "output") continue;
      const t = drafts[f.id] ?? [];
      const r = tryParse(t);
      if (!r.ok) out[f.id] = t.length ? `Formula: ${r.message}` : "Formula is empty";
    }
    return out;
  }, [schema, drafts]);

  const problems = useMemo(() => {
    const p = validateSchema(schema).filter((x) => !/needs a formula/.test(x));
    for (const [id, msg] of Object.entries(formulaErrors)) p.unshift(`"${labelOf(id)}": ${msg}`);
    return p;
  }, [schema, formulaErrors, labelOf]);

  const preview = useMemo(() => evaluateSchema(schema, defaultInputs(schema)).values, [schema]);

  const update = (fn: (s: CalcSchema) => CalcSchema) => {
    setSchema((s) => fn(s));
    setDirty(true);
  };
  const setField = (id: string, next: Field) => update((s) => ({ ...s, fields: s.fields.map((f) => (f.id === id ? next : f)) }));

  const setTokens = (id: string, tokens: Token[]) => {
    setDrafts((d) => ({ ...d, [id]: tokens }));
    let formula: Field["formula"];
    try {
      formula = tokens.length ? parseTokens(tokens) : undefined;
    } catch {
      formula = undefined;
    }
    update((s) => ({ ...s, fields: s.fields.map((f) => (f.id === id ? { ...f, formula, verified: undefined } : f)) }));
  };

  const changeKind = (f: Field, kind: FieldKind) => {
    const base: Field = { id: f.id, label: f.label, kind, format: f.format, decimals: f.decimals, helpText: f.helpText, hidden: f.hidden, source: f.source };
    const next: Field =
      kind === "input"
        ? { ...base, inputType: "number", defaultValue: f.kind === "constant" ? (f.value ?? null) : null, hidden: undefined }
        : kind === "constant"
          ? { ...base, value: f.kind === "input" ? (f.defaultValue ?? 0) : (preview[f.id] ?? 0) }
          : { ...base, hidden: undefined };
    setField(f.id, next);
  };

  const addField = (kind: FieldKind | "select") => {
    const used = new Set(schema.fields.map((f) => f.id));
    const label = { input: "New input", select: "New dropdown", output: "New result", constant: "New fixed value" }[kind];
    const id = uniqueId(label, used);
    const f: Field =
      kind === "select"
        ? {
            id,
            label,
            kind: "input",
            inputType: "select",
            format: "integer",
            decimals: 0,
            options: [
              { label: "3 months", value: 3 },
              { label: "6 months", value: 6 },
              { label: "12 months", value: 12 },
            ],
            defaultValue: 3,
          }
        : kind === "input"
          ? { id, label, kind, inputType: "number", format: "currency", decimals: 2, defaultValue: null }
          : kind === "constant"
            ? { id, label, kind, value: 0, format: "number", decimals: 2, hidden: true }
            : { id, label, kind, format: "currency", decimals: 2 };
    update((s) => ({ ...s, fields: [...s.fields, f] }));
    setOpenId(id);
  };

  const removeField = (f: Field) => {
    const users = schema.fields.filter(
      (x) => x.id !== f.id && ((drafts[x.id] ?? []).some((t) => t.k === "ref" && t.field === f.id) || x.min?.field === f.id || x.max?.field === f.id),
    );
    const msg = users.length
      ? `"${f.label}" is used by: ${users.map((u) => u.label).join(", ")}. Delete it anyway? Those formulas will need fixing.`
      : `Delete "${f.label}"?`;
    if (!confirm(msg)) return;
    update((s) => ({ ...s, fields: s.fields.filter((x) => x.id !== f.id) }));
    setDrafts((d) => {
      const { [f.id]: _removed, ...rest } = d;
      void _removed;
      return rest;
    });
  };

  const move = (i: number, dir: -1 | 1) =>
    update((s) => {
      const fields = [...s.fields];
      const j = i + dir;
      if (j < 0 || j >= fields.length) return s;
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...s, fields };
    });

  const onReupload = async (file: File) => {
    setUploadError(null);
    try {
      const { mergeReupload } = await import("@/lib/excel/mergeReupload");
      const imported = await importExcelFile(file);
      const merged = mergeReupload(schema, imported.schema);
      setPending({ ...merged, notes: imported.notes, file: file.name });
    } catch (e) {
      setUploadError(`Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const applyPending = () => {
    if (!pending) return;
    update(() => pending.schema);
    setDrafts(tokensOf(pending.schema));
    setNotes(pending.notes);
    setMeta((m) => ({ ...m, source_filename: pending.file }));
    setPending(null);
  };

  const save = () =>
    startSave(async () => {
      setSaveErrors([]);
      let slug = meta.slug || toUrlSlug(meta.title);
      if (!slugTouched) slug = await suggestSlug(slug, initial.id);
      const res = await saveCalculator({ ...meta, slug, id: initial.id, schema });
      if (!res.ok) {
        setSaveErrors(res.errors);
        return;
      }
      setDirty(false);
      setSavedAt(Date.now());
      setMeta((m) => ({ ...m, slug: res.slug }));
      if (isNew) router.replace(`/admin/${res.id}/edit?created=1`);
      else router.refresh();
    });

  const canSave = problems.length === 0 && meta.title.trim() !== "" && !saving;
  const publicPath = `/c/${meta.slug || toUrlSlug(meta.title)}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-28 lg:pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/admin" className="text-sm text-muted hover:text-text">
            ← All calculators
          </Link>
        </div>
        {!isNew && (
          <Link href={publicPath} target="_blank" className="text-sm text-accent hover:underline">
            Open public page ↗
          </Link>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 lg:hidden" role="tablist">
        {(["build", "preview"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("h-10 rounded-lg text-sm font-medium", tab === t ? "bg-surface shadow-sm" : "text-muted")}
          >
            {t === "build" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className={cx("flex flex-col gap-4", tab !== "build" && "hidden lg:flex")}>
          <Card className="flex flex-col gap-4 p-4 sm:p-5">
            <FormField label="Calculator name" htmlFor="title">
              <TextInput
                id="title"
                value={meta.title}
                placeholder="e.g. HP Loan Calculator"
                onChange={(e) => {
                  const title = e.target.value;
                  setMeta((m) => ({ ...m, title, slug: slugTouched ? m.slug : toUrlSlug(title) }));
                  setDirty(true);
                }}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Public link" htmlFor="slug" hint={`Customers open ${publicPath}`}>
                <div className="flex items-center rounded-lg border border-line bg-surface focus-within:border-accent">
                  <span className="pl-3 text-sm text-muted">/c/</span>
                  <input
                    id="slug"
                    value={meta.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setMeta((m) => ({ ...m, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }));
                      setDirty(true);
                    }}
                    className="h-11 w-full min-w-0 bg-transparent px-1 outline-none"
                  />
                </div>
              </FormField>
              <FormField label="Currency label" htmlFor="currency" hint="Shown before money values, e.g. Rs. or $">
                <TextInput
                  id="currency"
                  value={meta.currency}
                  maxLength={10}
                  placeholder="Rs."
                  onChange={(e) => {
                    setMeta((m) => ({ ...m, currency: e.target.value }));
                    setDirty(true);
                  }}
                />
              </FormField>
            </div>
            <FormField label="Description (optional)" htmlFor="desc">
              <TextArea
                id="desc"
                value={meta.description}
                onChange={(e) => {
                  setMeta((m) => ({ ...m, description: e.target.value }));
                  setDirty(true);
                }}
              />
            </FormField>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Toggle
                checked={meta.published}
                onChange={(v) => {
                  setMeta((m) => ({ ...m, published: v }));
                  setDirty(true);
                }}
                label={meta.published ? "Published: anyone with the link can use it" : "Draft: only you can see it"}
              />
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xlsm,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void onReupload(file);
                  }}
                />
                <Button size="sm" onClick={() => fileRef.current?.click()}>
                  {meta.source_filename ? "Re-upload Excel" : "Import from Excel"}
                </Button>
              </div>
            </div>
            {meta.source_filename && <p className="-mt-2 text-xs text-muted">Last imported from {meta.source_filename}</p>}
            {uploadError && <p className="text-sm text-danger">{uploadError}</p>}
          </Card>

          {pending && (
            <Card className="flex flex-col gap-3 border-accent p-4 sm:p-5">
              <h2 className="font-semibold">Update from {pending.file}?</h2>
              <DiffList diff={pending.diff} />
              <p className="text-sm text-muted">Your labels, help text, visibility and dropdown settings are kept. Nothing is saved until you press Save.</p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={applyPending}>
                  Apply changes
                </Button>
                <Button onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </Card>
          )}

          {notes && notes.length > 0 && (
            <div className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-text">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium">Imported from Excel. Review the fields below.</span>
                <button type="button" onClick={() => setNotes(undefined)} className="text-muted hover:text-text" aria-label="Dismiss">
                  ✕
                </button>
              </div>
              <ul className="list-disc pl-5 text-muted">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Fields</h2>
            <span className="text-sm text-muted">Tap a field to edit it</span>
          </div>

          {schema.fields.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
              No fields yet. Add an input (like a price), then a result with a formula.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {schema.fields.map((f, i) => (
                <FieldCard
                  key={f.id}
                  field={f}
                  index={i}
                  count={schema.fields.length}
                  open={openId === f.id}
                  onToggle={() => setOpenId((o) => (o === f.id ? null : f.id))}
                  onChange={(next) => setField(f.id, next)}
                  onKindChange={(k) => changeKind(f, k)}
                  onMove={(d) => move(i, d)}
                  onDelete={() => removeField(f)}
                  allFields={schema.fields}
                  labelOf={labelOf}
                  tokens={drafts[f.id] ?? []}
                  onTokens={(t) => setTokens(f.id, t)}
                  formulaError={formulaErrors[f.id]}
                  previewValue={preview[f.id] ?? null}
                  currency={meta.currency}
                />
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button onClick={() => addField("input")}>+ Input</Button>
            <Button onClick={() => addField("select")}>+ Dropdown</Button>
            <Button onClick={() => addField("output")}>+ Result</Button>
            <Button onClick={() => addField("constant")}>+ Fixed value</Button>
          </div>
        </div>

        <aside className={cx("flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start", tab !== "preview" && "hidden lg:flex")}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Live preview</h2>
            <span className="text-xs text-muted">What customers see</span>
          </div>
          <div className="rounded-3xl border border-line bg-bg p-3 sm:p-4">
            <div className="mb-3 px-1">
              <div className="text-lg font-semibold">{meta.title || "Untitled calculator"}</div>
              {meta.description && <p className="text-sm whitespace-pre-line text-muted">{meta.description}</p>}
            </div>
            <Calculator key={JSON.stringify(defaultInputs(schema))} schema={schema} currency={meta.currency} compact />
          </div>
        </aside>
      </div>

      {/* Save bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur lg:static lg:mt-6 lg:border-0 lg:bg-transparent">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 lg:px-0">
          {(saveErrors.length > 0 || problems.length > 0) && (
            <details className="text-sm text-danger" open={saveErrors.length > 0}>
              <summary className="cursor-pointer">
                {saveErrors.length > 0 ? "Couldn't save" : `${problems.length} thing(s) to fix before saving`}
              </summary>
              <ul className="mt-1 max-h-32 list-disc overflow-auto pl-5">
                {(saveErrors.length ? saveErrors : problems).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted" aria-live="polite">
              {saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? "Saved ✓" : ""}
            </span>
            <Button variant="primary" disabled={!canSave} onClick={save} className="min-w-28">
              {isNew ? "Create calculator" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffList({ diff }: { diff: ReuploadDiff }) {
  const none = !diff.added.length && !diff.removed.length && !diff.changed.length;
  if (none) return <p className="text-sm text-muted">No changes found. The sheet matches this calculator.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {diff.added.map((l) => (
        <li key={`a-${l}`} className="text-ok">
          + New: {l}
        </li>
      ))}
      {diff.changed.map((c) => (
        <li key={`c-${c.label}`} className="text-warn">
          ~ {c.label}: {c.what}
        </li>
      ))}
      {diff.removed.map((l) => (
        <li key={`r-${l}`} className="text-danger">
          − Removed: {l}
        </li>
      ))}
    </ul>
  );
}
