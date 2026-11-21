"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { saveCalculator, suggestSlug } from "@/app/admin/actions";
import { evaluateSchema } from "@/lib/engine/evaluate";
import { formatValue } from "@/lib/engine/format";
import { exprRefs, exprToTokens, parseTokens } from "@/lib/engine/parse";
import { emptySteps, exprToSteps, stepsToExpr, type Steps } from "@/lib/engine/steps";
import type { Token } from "@/lib/engine/tokens";
import type { ReuploadDiff } from "@/lib/excel/mergeReupload";
import { toUrlSlug, uniqueId } from "@/lib/excel/labels";
import { commit, initHistory, redo, undo, type History } from "@/lib/history";
import type { CalcSchema, CalculatorDraft, Field, SelectOption } from "@/lib/schema/types";
import { validateSchema } from "@/lib/schema/validate";
import { insertIntoZone, reorderZone, type Zone } from "@/lib/schema/zones";
import { Calculator, initialRaw } from "../calculator/Calculator";
import { valuesFromRaw } from "../calculator/parts";
import { IconPencil, IconPlay, IconPlus, IconRedo, IconShare, IconUndo, IconWarn } from "../icons";
import { Button, cx, Toast } from "../ui";
import { BuilderDnd, Canvas } from "./Canvas";
import { tryParse } from "./FormulaBuilder";
import { AddSheet, Palette } from "./Palette";
import { SettingsPanel, type BlockType } from "./SettingsPanel";
import { ShareSheet, type Meta } from "./ShareSheet";

type Props = {
  initial: CalculatorDraft;
  importNotes?: string[];
};

type Doc = { meta: Meta; schema: CalcSchema };
type Issue = { id?: string; text: string };

const tokensOf = (schema: CalcSchema) =>
  Object.fromEntries(schema.fields.filter((f) => f.formula).map((f) => [f.id, exprToTokens(f.formula!)])) as Record<string, Token[]>;

/** Read an Excel file in the browser (the file never leaves the device). */
export async function importExcelFile(file: File) {
  const { importWorkbook } = await import("@/lib/excel/extract");
  return importWorkbook(await file.arrayBuffer());
}

const TIP_KEY = "lcg.builderTipDismissed";

// Field-level problems that the builder shows on the block itself.
const FIELD_LEVEL = /needs a formula|no longer exists|needs at least one option|limited by itself|needs a value|needs a label/;

function newField(type: BlockType, used: Set<string>): Field {
  const label = { number: "New number box", dropdown: "New dropdown", result: "New result", fixed: "New fixed number" }[type];
  const id = uniqueId(label, used);
  switch (type) {
    case "number":
      return { id, label, kind: "input", inputType: "number", format: "currency", decimals: 2, defaultValue: null };
    case "dropdown":
      return {
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
      };
    case "result":
      return { id, label, kind: "output", format: "currency", decimals: 2 };
    case "fixed":
      return { id, label, kind: "constant", value: 0, format: "number", decimals: 2, hidden: true };
  }
}

function choicesFor(f: Field): SelectOption[] {
  if (f.format === "percent")
    return [0.1, 0.15, 0.2].map((value) => ({ value, label: `${Math.round(value * 100)}%` }));
  const v = f.kind === "constant" ? f.value : f.defaultValue;
  if (v != null) return [{ value: v, label: String(v) }];
  return [
    { label: "3 months", value: 3 },
    { label: "6 months", value: 6 },
    { label: "12 months", value: 12 },
  ];
}

export function Builder({ initial, importNotes }: Props) {
  const router = useRouter();
  const isNew = !initial.id;
  const [initialDoc] = useState<Doc>(() => ({
    meta: {
      title: initial.title,
      slug: initial.slug,
      description: initial.description,
      currency: initial.currency,
      published: initial.published,
      source_filename: initial.source_filename,
    },
    schema: initial.schema,
  }));
  const [hist, setHist] = useState<History<Doc>>(() => initHistory(initialDoc));
  const [savedDoc, setSavedDoc] = useState<Doc | null>(isNew ? null : initialDoc);
  const { meta, schema } = hist.present;
  const dirty = hist.present !== savedDoc;

  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [drafts, setDrafts] = useState<Record<string, Token[]>>(() => tokensOf(initial.schema));
  const [stepDrafts, setStepDrafts] = useState<Record<string, Steps>>({});
  const [advanced, setAdvanced] = useState<Record<string, boolean>>({});
  const [sampleRaw, setSampleRaw] = useState<Record<string, string>>(() => initialRaw(initial.schema));

  const [mode, setMode] = useState<"edit" | "try">("edit");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [notes, setNotes] = useState<string[] | undefined>(importNotes);
  const [pending, setPending] = useState<{ schema: CalcSchema; diff: ReuploadDiff; notes: string[]; file: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, startSave] = useTransition();
  const [toast, setToast] = useState<{ message: string; undo?: boolean } | null>(null);
  const [showTip, setShowTip] = useState(false);

  // ------------------------------------------------------------ edits

  const apply = useCallback((fn: (d: Doc) => Doc, key?: string) => setHist((h) => commit(h, fn(h.present), key)), []);
  const updateSchema = useCallback((fn: (s: CalcSchema) => CalcSchema, key?: string) => apply((d) => ({ ...d, schema: fn(d.schema) }), key), [apply]);
  const setField = useCallback(
    (next: Field, key?: string) => updateSchema((s) => ({ ...s, fields: s.fields.map((f) => (f.id === next.id ? next : f)) }), key),
    [updateSchema],
  );
  const setMeta = (patch: Partial<Meta>, key?: string) => apply((d) => ({ ...d, meta: { ...d.meta, ...patch } }), key);

  const resync = (s: CalcSchema) => {
    setDrafts(tokensOf(s));
    setStepDrafts({});
  };
  const doUndo = () => {
    const h = undo(hist);
    if (h === hist) return;
    setHist(h);
    resync(h.present.schema);
  };
  const doRedo = () => {
    const h = redo(hist);
    if (h === hist) return;
    setHist(h);
    resync(h.present.schema);
  };

  const byId = useMemo(() => new Map(schema.fields.map((f) => [f.id, f])), [schema]);
  const labelOf = useCallback((id: string) => byId.get(id)?.label ?? "⚠ removed box", [byId]);

  const result = useMemo(
    () => evaluateSchema(schema, valuesFromRaw(schema, sampleRaw), (v, f) => formatValue(v, f, meta.currency)),
    [schema, sampleRaw, meta.currency],
  );
  const sampleOf = useCallback((id: string) => {
    const f = byId.get(id);
    return f ? formatValue(result.values[id], f, meta.currency) : "";
  }, [byId, result, meta.currency]);

  const stepsFor = (f: Field): Steps | null =>
    stepDrafts[f.id] ?? (f.formula ? exprToSteps(f.formula) : drafts[f.id]?.length ? null : emptySteps());

  const onSteps = (id: string, s: Steps) => {
    setStepDrafts((d) => ({ ...d, [id]: s }));
    const formula = stepsToExpr(s);
    setDrafts((d) => ({ ...d, [id]: formula ? exprToTokens(formula) : [] }));
    updateSchema((sc) => ({ ...sc, fields: sc.fields.map((f) => (f.id === id ? { ...f, formula, verified: undefined } : f)) }));
  };
  const onTokens = (id: string, tokens: Token[]) => {
    setDrafts((d) => ({ ...d, [id]: tokens }));
    setStepDrafts(({ [id]: _drop, ...rest }) => (void _drop, rest));
    let formula: Field["formula"];
    try {
      formula = tokens.length ? parseTokens(tokens) : undefined;
    } catch {
      formula = undefined;
    }
    updateSchema((sc) => ({ ...sc, fields: sc.fields.map((f) => (f.id === id ? { ...f, formula, verified: undefined } : f)) }));
  };

  const addBlock = (type: BlockType, index?: number) => {
    const f = newField(type, new Set(schema.fields.map((x) => x.id)));
    updateSchema((s) => ({ ...s, fields: insertIntoZone(s.fields, f, index) }));
    setSelectedId(f.id);
    setMode("edit");
  };

  const convert = (f: Field, to: BlockType) => {
    const base = { id: f.id, label: f.label, format: f.format, decimals: f.decimals, helpText: f.helpText, source: f.source };
    let next: Field;
    if (to === "number")
      next = {
        ...base,
        kind: "input",
        inputType: "number",
        defaultValue: f.kind === "constant" ? (f.value ?? null) : f.kind === "input" ? (f.defaultValue ?? null) : null,
        min: f.min,
        max: f.max,
      };
    else if (to === "dropdown") {
      const options = f.options?.length ? f.options : choicesFor(f);
      next = { ...base, kind: "input", inputType: "select", options, defaultValue: options[0].value };
    } else if (to === "result") next = { ...base, kind: "output", formula: f.kind === "output" ? f.formula : undefined, highlight: f.highlight };
    else
      next = {
        ...base,
        kind: "constant",
        value: (f.kind === "input" ? f.defaultValue : f.kind === "output" ? result.values[f.id] : f.value) ?? 0,
        hidden: true,
      };
    setField(next);
    setDrafts((d) => ({ ...d, [f.id]: next.formula ? exprToTokens(next.formula) : [] }));
    setStepDrafts(({ [f.id]: _drop, ...rest }) => (void _drop, rest));
  };

  const remove = (f: Field) => {
    updateSchema((s) => ({ ...s, fields: s.fields.filter((x) => x.id !== f.id) }));
    setSelectedId(null);
    setToast({ message: `Removed "${f.label}"`, undo: true });
  };

  // ------------------------------------------------------------ problems

  const fieldProblems = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of schema.fields) {
      let p: string | undefined;
      if (!f.label.trim()) p = "Give this a name";
      else if (f.kind === "output") {
        if (!f.formula) {
          const t = drafts[f.id] ?? [];
          const sd = stepDrafts[f.id];
          const parsed = tryParse(t);
          p = sd?.first ? "Finish the calculation: a step is empty" : t.length && !parsed.ok ? `Calculation: ${parsed.message}` : "Needs a calculation";
        } else if ([...exprRefs(f.formula)].some((r) => !byId.has(r))) p = "Uses a box that was removed";
      } else if (f.kind === "input") {
        if (f.inputType === "select" && !f.options?.length) p = "Add at least one choice";
        for (const b of [f.min, f.max]) {
          if (b?.field === f.id) p = "Its limit can't be itself";
          else if (b?.field !== undefined && !byId.has(b.field)) p = "Its limit uses a box that was removed";
        }
      } else if (f.value === undefined) p = "Needs a value";
      if (p) out[f.id] = p;
    }
    return out;
  }, [schema, drafts, stepDrafts, byId]);

  const issues: Issue[] = useMemo(() => {
    const list: Issue[] = schema.fields.filter((f) => fieldProblems[f.id]).map((f) => ({ id: f.id, text: `${f.label || "Untitled"}: ${fieldProblems[f.id]}` }));
    for (const g of validateSchema(schema)) if (!FIELD_LEVEL.test(g)) list.push({ text: g });
    if (!meta.title.trim()) list.push({ text: "Give the calculator a name (at the top)" });
    return list;
  }, [schema, fieldProblems, meta.title]);

  const jumpToIssue = () => {
    const first = issues.find((i) => i.id);
    setMode("edit");
    if (first?.id) setSelectedId(first.id);
  };

  // ------------------------------------------------------------ excel + save

  const onExcel = async (file: File) => {
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
    apply((d) => ({ schema: pending.schema, meta: { ...d.meta, source_filename: pending.file } }));
    resync(pending.schema);
    setNotes(pending.notes);
    setPending(null);
    setShareOpen(false);
    setSelectedId(null);
  };

  const save = () => {
    if (issues.length) {
      jumpToIssue();
      setToast({ message: "Fix the item marked in red first, then save." });
      return;
    }
    const doc = hist.present;
    startSave(async () => {
      setSaveErrors([]);
      let slug = doc.meta.slug || toUrlSlug(doc.meta.title);
      if (!slugTouched) slug = await suggestSlug(slug, initial.id);
      const res = await saveCalculator({ ...doc.meta, slug, id: initial.id, schema: doc.schema });
      if (!res.ok) {
        setSaveErrors(res.errors);
        return;
      }
      if (res.slug === doc.meta.slug) setSavedDoc(doc);
      else {
        const next = { ...doc, meta: { ...doc.meta, slug: res.slug } };
        setHist((h) => (h.present === doc ? { ...h, present: next } : h));
        setSavedDoc(next);
      }
      setSavedAt(Date.now());
      if (isNew) router.replace(`/admin/${res.id}/edit?created=1`);
      else router.refresh();
    });
  };

  // ------------------------------------------------------------ effects

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable=true]") || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        doRedo();
      } else if (k === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    try {
      setShowTip(localStorage.getItem(TIP_KEY) !== "1");
    } catch {
      setShowTip(true);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    document.querySelector(`[data-field="${selectedId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const selected = selectedId ? byId.get(selectedId) : undefined;

  // ------------------------------------------------------------ render

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-1 px-3 sm:gap-2 sm:px-4">
          <Link href="/admin" className="flex h-10 items-center rounded-lg px-2 text-sm text-muted hover:bg-surface-2 hover:text-text">
            ←<span className="ml-1 hidden sm:inline">Calculators</span>
          </Link>

          <div className="mx-auto flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Mode">
            {(
              [
                ["edit", "Edit", IconPencil],
                ["try", "Try it", IconPlay],
              ] as const
            ).map(([m, label, I]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cx(
                  "flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-4",
                  mode === m ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
                )}
              >
                <I size={14} /> {label}
              </button>
            ))}
          </div>

          <Button size="sm" variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!hist.past.length} onClick={doUndo}>
            <IconUndo />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!hist.future.length} onClick={doRedo} className="hidden sm:inline-flex">
            <IconRedo />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)} aria-label="Share and settings">
            <IconShare /> <span className="hidden md:inline">Share</span>
          </Button>
          <span className="hidden w-24 text-right text-xs text-muted lg:inline" aria-live="polite">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? "Saved ✓" : "All saved"}
          </span>
          <Button size="sm" variant="primary" onClick={save} disabled={saving} className="min-w-16 sm:min-w-20">
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </Button>
        </div>
        {(issues.length > 0 || saveErrors.length > 0) && mode === "edit" && (
          <div className="border-t border-line bg-danger-soft/60">
            <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 text-sm text-danger">
              <IconWarn size={16} />
              <span className="min-w-0 flex-1 truncate">
                {saveErrors.length
                  ? `Couldn't save: ${saveErrors.join(" · ")}`
                  : issues.length === 1
                    ? issues[0].text
                    : `${issues.length} things to fix before saving · ${issues[0].text}`}
              </span>
              {issues.some((i) => i.id) && (
                <button type="button" onClick={jumpToIssue} className="shrink-0 font-medium underline underline-offset-2">
                  Show me
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {mode === "try" ? (
        <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-6">
          <p className="text-center text-sm text-muted">This is exactly what customers see. Type numbers to test it.</p>
          <div className="rounded-[2rem] border border-line bg-bg p-3 shadow-sm sm:p-4">
            <div className="mb-3 px-1">
              <div className="text-lg font-semibold">{meta.title || "Untitled calculator"}</div>
              {meta.description && <p className="text-sm whitespace-pre-line text-muted">{meta.description}</p>}
            </div>
            <Calculator schema={schema} currency={meta.currency} compact raw={sampleRaw} onRawChange={setSampleRaw} />
          </div>
          <Button className="self-center" onClick={() => setMode("edit")}>
            <IconPencil size={16} /> Back to editing
          </Button>
        </main>
      ) : (
        <BuilderDnd
          schema={schema}
          onReorder={(zone: Zone, from, to) => updateSchema((s) => ({ ...s, fields: reorderZone(s.fields, zone, from, to) }))}
          onInsert={addBlock}
        >
          <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pt-4 pb-32 lg:grid-cols-[220px_minmax(0,1fr)_380px] lg:pb-10">
            <aside className="hidden lg:block">
              <div className="sticky top-20">
                <Palette onAdd={(t) => addBlock(t)} />
              </div>
            </aside>

            <main className="mx-auto flex w-full max-w-xl min-w-0 flex-col gap-4">
              {showTip && (
                <div className="flex items-start gap-3 rounded-xl bg-accent-soft px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <b className="font-semibold">This is your calculator.</b> Drag the ⠿ handle to move things · Tap anything to change it · Press{" "}
                    <b className="font-semibold">Try it</b> to test.
                  </span>
                  <button
                    type="button"
                    aria-label="Dismiss tip"
                    className="text-muted hover:text-text"
                    onClick={() => {
                      setShowTip(false);
                      try {
                        localStorage.setItem(TIP_KEY, "1");
                      } catch {
                        /* storage unavailable: the tip just shows again next time */
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {notes && notes.length > 0 && (
                <div className="rounded-xl bg-warn-soft px-4 py-3 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">Imported from Excel. Please check these:</span>
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

              <Canvas
                schema={schema}
                currency={meta.currency}
                title={meta.title}
                description={meta.description}
                onTitle={(title) => setMeta({ title, ...(slugTouched ? {} : { slug: toUrlSlug(title) }) })}
                onDescription={(description) => setMeta({ description })}
                sampleRaw={sampleRaw}
                result={result}
                selectedId={selectedId}
                onSelect={setSelectedId}
                problems={fieldProblems}
                onRename={(id, label) => {
                  const f = byId.get(id);
                  if (f) setField({ ...f, label });
                }}
                onToggleHidden={(id) => {
                  const f = byId.get(id);
                  if (f) setField({ ...f, hidden: !f.hidden || undefined });
                }}
                onToggleHighlight={(id) => {
                  const f = byId.get(id);
                  if (f) setField({ ...f, highlight: !f.highlight || undefined });
                }}
                onAddTap={(t) => addBlock(t)}
              />
            </main>

            {selected ? (
              <>
                <button type="button" aria-label="Close settings" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSelectedId(null)} />
                <aside
                  aria-label={`Settings for ${selected.label}`}
                  className="fixed inset-x-0 bottom-0 z-30 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-bg p-4 pb-8 shadow-2xl lg:sticky lg:top-20 lg:z-auto lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:pb-4 lg:shadow-none"
                >
                  <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line lg:hidden" />
                  <SettingsPanel
                    key={selected.id}
                    field={selected}
                    onChange={setField}
                    onConvert={(t) => convert(selected, t)}
                    onDelete={() => remove(selected)}
                    onClose={() => setSelectedId(null)}
                    allFields={schema.fields}
                    labelOf={labelOf}
                    sampleOf={sampleOf}
                    liveValue={selected.formula && !fieldProblems[selected.id] ? sampleOf(selected.id) : null}
                    problem={fieldProblems[selected.id]}
                    steps={stepsFor(selected)}
                    advanced={!!advanced[selected.id]}
                    onSteps={(s) => onSteps(selected.id, s)}
                    onAdvanced={(on) => setAdvanced((a) => ({ ...a, [selected.id]: on }))}
                    tokens={drafts[selected.id] ?? []}
                    onTokens={(t) => onTokens(selected.id, t)}
                  />
                </aside>
              </>
            ) : (
              <aside className="hidden lg:block">
                <div className="sticky top-20 flex flex-col gap-3 rounded-2xl border border-dashed border-line p-5 text-sm text-muted">
                  <span className="font-semibold text-text">How to edit</span>
                  <span>
                    <b className="font-medium text-text">Click</b> any box or result on the calculator to change it.
                  </span>
                  <span>
                    <b className="font-medium text-text">Drag ⠿</b> to change the order.
                  </span>
                  <span>
                    <b className="font-medium text-text">Click a name</b> to rename it right there.
                  </span>
                  <span>
                    <b className="font-medium text-text">★</b> makes a result big. <b className="font-medium text-text">👁</b> hides it from customers.
                  </span>
                  <span>
                    <b className="font-medium text-text">Undo</b> (↶) takes back any change.
                  </span>
                </div>
              </aside>
            )}
          </div>
        </BuilderDnd>
      )}

      {mode === "edit" && !selected && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="fixed right-4 bottom-6 z-20 flex h-14 items-center gap-2 rounded-full bg-accent px-5 font-semibold text-accent-fg shadow-xl lg:hidden"
        >
          <IconPlus /> Add
        </button>
      )}
      {addOpen && <AddSheet onAdd={(t) => addBlock(t)} onClose={() => setAddOpen(false)} />}

      {shareOpen && (
        <ShareSheet
          meta={meta}
          onMeta={setMeta}
          onSlugTouched={() => setSlugTouched(true)}
          saved={!isNew && savedDoc?.meta.slug === meta.slug}
          onClose={() => setShareOpen(false)}
          onExcel={onExcel}
          uploadError={uploadError}
          pending={pending}
          onApply={applyPending}
          onCancelPending={() => setPending(null)}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          action={toast.undo ? "Undo" : undefined}
          onAction={() => {
            doUndo();
            setToast(null);
          }}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
