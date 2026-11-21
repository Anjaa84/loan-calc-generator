import type { CalcSchema, Expr, Field } from "../schema/types";

export type ReuploadDiff = {
  added: string[];
  removed: string[];
  changed: { label: string; what: string }[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function renameRefs(e: Expr | undefined, map: Map<string, string>): Expr | undefined {
  if (!e) return e;
  switch (e.t) {
    case "ref":
      return { t: "ref", field: map.get(e.field) ?? e.field };
    case "bin":
      return { ...e, l: renameRefs(e.l, map)!, r: renameRefs(e.r, map)! };
    case "neg":
    case "pct":
      return { ...e, e: renameRefs(e.e, map)! };
    case "fn":
      return { ...e, args: e.args.map((a) => renameRefs(a, map)!) };
    default:
      return e;
  }
}

/**
 * Update an existing calculator with a freshly imported sheet.
 * - Fields are matched by source cell, then by label. Matched fields keep their id
 *   (so the admin's other formulas still work) and the admin's edits: label, help,
 *   format, visibility, dropdown options and limits.
 * - Formulas and fixed values come from the new sheet.
 * - Sheet fields that disappeared are removed; fields the admin added by hand are kept.
 */
export function mergeReupload(existing: CalcSchema, incoming: CalcSchema): { schema: CalcSchema; diff: ReuploadDiff } {
  const diff: ReuploadDiff = { added: [], removed: [], changed: [] };
  const srcKey = (f: Field) => (f.source ? `${f.source.sheet}!${f.source.cell}` : undefined);
  const fromSheet = existing.fields.filter((f) => f.source);
  const bySource = new Map(fromSheet.map((f) => [srcKey(f)!, f]));
  const incomingKeys = new Set(incoming.fields.map(srcKey));
  // Fallback for rows that moved in the sheet: same label, and the old cell is gone from the new upload.
  const byLabel = new Map(fromSheet.filter((f) => !incomingKeys.has(srcKey(f))).map((f) => [norm(f.label), f]));
  const claimed = new Set<string>();
  const idMap = new Map<string, string>(); // incoming id → final id
  const matchOf = new Map<string, Field>(); // incoming id → existing field

  for (const f of incoming.fields) {
    const key = srcKey(f);
    let m = key ? bySource.get(key) : undefined;
    if (!m || claimed.has(m.id)) m = byLabel.get(norm(f.label));
    if (m && !claimed.has(m.id)) {
      claimed.add(m.id);
      idMap.set(f.id, m.id);
      matchOf.set(f.id, m);
    }
  }

  // Ids for brand-new fields must not collide with existing ones.
  const used = new Set(existing.fields.map((f) => f.id));
  for (const f of incoming.fields) {
    if (idMap.has(f.id)) continue;
    let id = f.id;
    for (let i = 2; used.has(id); i++) id = `${f.id}_${i}`;
    used.add(id);
    idMap.set(f.id, id);
  }

  const merged = new Map<string, Field>();
  for (const f of incoming.fields) {
    const id = idMap.get(f.id)!;
    const formula = renameRefs(f.formula, idMap);
    const old = matchOf.get(f.id);
    if (!old) {
      merged.set(id, { ...f, id, formula });
      diff.added.push(f.label);
      continue;
    }
    const next: Field = { ...old, source: f.source ?? old.source, importNote: f.importNote, verified: f.verified };
    if (f.kind === "output" || old.kind === "output") {
      // Results always follow the sheet.
      next.kind = f.kind;
      next.formula = formula;
      if (f.kind !== "output") {
        delete next.formula;
        Object.assign(next, { inputType: f.inputType, defaultValue: f.defaultValue, value: f.value });
      }
      if (JSON.stringify(old.formula) !== JSON.stringify(formula) || old.kind !== f.kind) {
        diff.changed.push({ label: old.label, what: old.kind !== f.kind ? `now ${f.kind}` : "formula changed" });
      }
    } else if (old.kind === "constant" && f.value !== undefined) {
      if (old.value !== f.value) diff.changed.push({ label: old.label, what: `value ${old.value} → ${f.value}` });
      next.value = f.value;
    } else if (old.kind === "input" && old.inputType !== "select" && f.kind === "input") {
      if ((old.defaultValue ?? null) !== (f.defaultValue ?? null)) {
        diff.changed.push({ label: old.label, what: `default ${old.defaultValue ?? "—"} → ${f.defaultValue ?? "—"}` });
      }
      next.defaultValue = f.defaultValue;
    }
    // An input the admin turned into a constant (or vice-versa) keeps the admin's choice.
    merged.set(id, next);
  }

  // Keep existing order; hand-made fields stay; sheet fields not in the new upload are removed.
  const out: Field[] = [];
  for (const old of existing.fields) {
    if (merged.has(old.id)) {
      out.push(merged.get(old.id)!);
      merged.delete(old.id);
    } else if (!old.source) {
      out.push(old);
    } else {
      diff.removed.push(old.label);
    }
  }
  // New fields are inserted right after the field that precedes them in the incoming sheet.
  for (const f of incoming.fields) {
    const id = idMap.get(f.id)!;
    const nf = merged.get(id);
    if (!nf) continue;
    const idx = incoming.fields.indexOf(f);
    let at = out.length;
    for (let i = idx - 1; i >= 0; i--) {
      const prevId = idMap.get(incoming.fields[i].id)!;
      const pos = out.findIndex((x) => x.id === prevId);
      if (pos !== -1) {
        at = pos + 1;
        break;
      }
    }
    out.splice(at, 0, nf);
    merged.delete(id);
  }

  return { schema: { version: 1, fields: out }, diff };
}
