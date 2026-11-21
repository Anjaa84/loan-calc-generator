import * as XLSX from "xlsx";
import { defaultInputs, evaluateSchema } from "../engine/evaluate";
import { parseExcelFormula } from "../engine/parse";
import { FormulaError } from "../engine/tokens";
import type { CalcSchema, Expr, Field, FieldFormat } from "../schema/types";
import { readWorkbook, type CellInfo, type SheetModel, type WorkbookModel } from "./readWorkbook";
import { cleanLabel, uniqueId } from "./labels";

export type ImportResult = {
  schema: CalcSchema;
  /** Summary lines for the review screen. */
  notes: string[];
};

type Key = string; // "Sheet!A1"
const keyOf = (sheet: string, addr: string): Key => `${sheet}!${addr}`;

type Node = {
  cell: CellInfo | null; // null = referenced but blank
  sheet: string;
  addr: string;
  r: number;
  c: number;
  kind: Field["kind"];
  expr?: Expr; // with absolute `cell` nodes
  problem?: string;
  lowConfidence?: string;
};

export function importWorkbook(data: ArrayBuffer | Uint8Array): ImportResult {
  return extractSchema(readWorkbook(data));
}

export function extractSchema(wb: WorkbookModel): ImportResult {
  const sheetByName = new Map(wb.sheets.map((s) => [s.name.toLowerCase(), s]));
  const nodes = new Map<Key, Node>();
  const referenced = new Set<Key>();
  const notes: string[] = [];

  // 1. Parse every formula cell and resolve its references to absolute cells.
  const formulaNodes: Node[] = [];
  for (const sheet of wb.sheets) {
    for (const cell of sheet.cells.values()) {
      if (!cell.formula) continue;
      const node: Node = { cell, sheet: sheet.name, addr: cell.addr, r: cell.r, c: cell.c, kind: "output" };
      try {
        node.expr = resolveRefs(parseExcelFormula(cell.formula), sheet, sheetByName, referenced);
      } catch (err) {
        node.problem =
          err instanceof FormulaError || err instanceof Error
            ? `Couldn't convert =${cell.formula} (${err.message}). Rebuild this formula with the builder.`
            : `Couldn't convert =${cell.formula}`;
      }
      if (!node.problem && typeof cell.value === "string") {
        node.problem = `=${cell.formula} produces text, which calculators don't support.`;
      }
      formulaNodes.push(node);
    }
  }

  // 2. Keep formulas unless they show an Excel error and nothing depends on them (stray cells).
  for (const n of formulaNodes) {
    const k = keyOf(n.sheet, n.addr);
    if (n.cell?.isError && !referenced.has(k)) {
      notes.push(`Skipped ${n.sheet}!${n.addr} (=${n.cell.formula}) because it shows an error in Excel.`);
      continue;
    }
    if (n.cell?.isError) n.problem ??= `Excel shows an error for =${n.cell.formula}. Check this formula.`;
    nodes.set(k, n);
  }

  // 3. Referenced non-formula cells become inputs or constants.
  for (const k of referenced) {
    if (nodes.has(k)) continue;
    const [sheetName, addr] = splitKey(k);
    const sheet = sheetByName.get(sheetName.toLowerCase())!;
    const cell = sheet.cells.get(addr) ?? null;
    const { r, c } = XLSX.utils.decode_cell(addr);
    if (cell?.formula) continue; // dropped error formula (handled above)
    const node: Node = { cell, sheet: sheet.name, addr, r, c, kind: "input" };
    if (cell?.isText) node.problem = `A formula uses ${addr}, which contains text ("${cell.value}").`;
    nodes.set(k, node);
  }

  // 4. Classify constants: a run of fixed numbers in a column next to formula rows (e.g. 3/6/12 months),
  //    or percentage cells (rates) are settings rather than customer inputs.
  const rowHasFormulaRight = (sheet: string, r: number, c: number) =>
    [...nodes.values()].some((n) => n.sheet === sheet && n.r === r && n.c > c && n.kind === "output");
  const isTableConst = (n: Node) =>
    n.kind === "input" && typeof n.cell?.value === "number" && rowHasFormulaRight(n.sheet, n.r, n.c);
  const tableConsts = new Set<Node>();
  for (const n of nodes.values()) {
    if (!isTableConst(n)) continue;
    const neighbours = [-1, 1].map((d) => nodes.get(keyOf(n.sheet, XLSX.utils.encode_cell({ r: n.r + d, c: n.c }))));
    if (neighbours.some((m) => m && isTableConst(m))) tableConsts.add(n);
  }
  for (const n of nodes.values()) {
    if (tableConsts.has(n)) {
      n.kind = "constant";
      n.lowConfidence = "Looks like a fixed table value. Switch it to an Input or Dropdown if customers should choose it.";
    } else if (n.kind === "input" && n.cell && /%/.test(n.cell.numFmt) && typeof n.cell.value === "number") {
      n.kind = "constant";
      n.lowConfidence = "Looks like a rate setting. Switch it to an Input if customers should change it.";
    }
  }

  // 5. Labels, formats, ids.
  const ordered = [...nodes.values()].sort(
    (a, b) => sheetIndex(wb, a.sheet) - sheetIndex(wb, b.sheet) || a.r - b.r || a.c - b.c,
  );
  const multiSheet = new Set(ordered.map((n) => n.sheet)).size > 1;
  const labels = new Map<Node, string>();
  for (const n of ordered) {
    const sheet = sheetByName.get(n.sheet.toLowerCase())!;
    labels.set(n, labelFor(sheet, n));
  }
  dedupeLabels(ordered, labels, multiSheet);

  const usedIds = new Set<string>();
  const idOf = new Map<Key, string>();
  for (const n of ordered) idOf.set(keyOf(n.sheet, n.addr), uniqueId(labels.get(n)!, usedIds));

  // 6. Build fields; rewrite cell refs to field refs and hoist rates written inside formulas.
  const fields: Field[] = [];
  for (const n of ordered) {
    const sheet = sheetByName.get(n.sheet.toLowerCase())!;
    const id = idOf.get(keyOf(n.sheet, n.addr))!;
    const label = labels.get(n)!;
    const help = helpTextFor(sheet, n);
    const { format, decimals } = formatFor(n);
    const base: Field = {
      id,
      label,
      kind: n.kind,
      format,
      decimals,
      source: { sheet: n.sheet, cell: n.addr },
      ...(help ? { helpText: help } : {}),
    };
    const notesFor = [n.problem, n.lowConfidence].filter(Boolean);
    if (notesFor.length) base.importNote = notesFor.join(" ");

    if (n.kind === "input") {
      base.inputType = "number";
      base.defaultValue = typeof n.cell?.value === "number" ? n.cell.value : null;
      fields.push(base);
    } else if (n.kind === "constant") {
      base.value = typeof n.cell?.value === "number" ? n.cell.value : 0;
      base.hidden = true;
      fields.push(base);
    } else {
      if (typeof n.cell?.value === "number") base.source!.excelValue = n.cell.value;
      const hoisted: Field[] = [];
      if (n.expr && !n.problem) {
        const withRefs = toFieldRefs(n.expr, idOf);
        base.formula = hoistLiterals(withRefs, base, hoisted, usedIds);
      }
      fields.push(base, ...hoisted);
    }
  }

  // 7. Verify: with the sheet's own values as inputs, every output should match Excel's cached value.
  const schema: CalcSchema = { version: 1, fields };
  const { values } = evaluateSchema(schema, defaultInputs(schema));
  let verified = 0;
  for (const f of fields) {
    const expected = f.source?.excelValue;
    if (f.kind !== "output" || expected === undefined || !f.formula) continue;
    const got = values[f.id];
    if (got !== null && Math.abs(got - expected) <= 1e-6 * Math.max(1, Math.abs(expected))) {
      f.verified = true;
      verified++;
    } else {
      f.importNote = [f.importNote, `Excel shows ${expected} but this computes ${got ?? "nothing"}. Check the formula.`]
        .filter(Boolean)
        .join(" ");
    }
  }

  const count = (k: Field["kind"]) => fields.filter((f) => f.kind === k).length;
  notes.unshift(
    `Found ${count("input")} input(s), ${count("output")} result(s) and ${count("constant")} fixed value(s). ${verified} result(s) match Excel exactly.`,
  );
  const unused = wb.sheets.filter((s) => !ordered.some((n) => n.sheet === s.name)).map((s) => s.name);
  if (unused.length) notes.push(`Ignored sheet(s) not used by any formula: ${unused.join(", ")}.`);

  return { schema, notes };
}

// ---------- helpers ----------

function splitKey(k: Key): [string, string] {
  const i = k.lastIndexOf("!");
  return [k.slice(0, i), k.slice(i + 1)];
}

function sheetIndex(wb: WorkbookModel, name: string) {
  return wb.sheets.findIndex((s) => s.name === name);
}

/** Make every cell reference absolute (sheet + addr) and flatten ranges inside function arguments. */
function resolveRefs(
  e: Expr,
  current: SheetModel,
  sheets: Map<string, SheetModel>,
  referenced: Set<Key>,
): Expr {
  const sheetFor = (name?: string) => {
    if (!name) return current;
    const s = sheets.get(name.toLowerCase());
    if (!s) throw new FormulaError(`refers to missing sheet "${name}"`);
    return s;
  };
  switch (e.t) {
    case "cell": {
      const s = sheetFor(e.sheet);
      referenced.add(keyOf(s.name, e.addr));
      return { t: "cell", sheet: s.name, addr: e.addr };
    }
    case "range":
      throw new FormulaError("ranges are only supported directly inside functions like SUM(A1:A5)");
    case "bin":
      return {
        ...e,
        l: resolveRefs(e.l, current, sheets, referenced),
        r: resolveRefs(e.r, current, sheets, referenced),
      };
    case "neg":
    case "pct":
      return { ...e, e: resolveRefs(e.e, current, sheets, referenced) };
    case "fn": {
      const args: Expr[] = [];
      for (const a of e.args) {
        if (a.t === "range") {
          const s = sheetFor(a.sheet);
          const rg = XLSX.utils.decode_range(`${a.from}:${a.to}`);
          const inside = [...s.cells.values()]
            .filter((c) => c.r >= rg.s.r && c.r <= rg.e.r && c.c >= rg.s.c && c.c <= rg.e.c)
            .filter((c) => !c.isText && (c.value !== null || c.formula))
            .sort((x, y) => x.r - y.r || x.c - y.c);
          if (!inside.length) args.push({ t: "num", v: 0 });
          for (const c of inside) {
            referenced.add(keyOf(s.name, c.addr));
            args.push({ t: "cell", sheet: s.name, addr: c.addr });
          }
        } else args.push(resolveRefs(a, current, sheets, referenced));
      }
      return { ...e, args };
    }
    default:
      return e;
  }
}

function toFieldRefs(e: Expr, idOf: Map<Key, string>): Expr {
  switch (e.t) {
    case "cell": {
      const id = idOf.get(keyOf(e.sheet!, e.addr));
      if (!id) throw new Error(`Unresolved reference ${e.sheet}!${e.addr}`);
      return { t: "ref", field: id };
    }
    case "bin":
      return { ...e, l: toFieldRefs(e.l, idOf), r: toFieldRefs(e.r, idOf) };
    case "neg":
    case "pct":
      return { ...e, e: toFieldRefs(e.e, idOf) };
    case "fn":
      return { ...e, args: e.args.map((a) => toFieldRefs(a, idOf)) };
    default:
      return e;
  }
}

/** Pull "110%" or "0.06" out of a formula into an editable, hidden constant field. */
function hoistLiterals(e: Expr, owner: Field, out: Field[], usedIds: Set<string>): Expr {
  const make = (value: number, format: FieldFormat, decimals: number, original: string): Expr => {
    const n = out.length + 1;
    const suffix = format === "percent" ? "rate" : "factor";
    const id = uniqueId(`${owner.id}_${suffix}${n > 1 ? `_${n}` : ""}`, usedIds);
    out.push({
      id,
      label: `${owner.label} ${suffix}${n > 1 ? ` ${n}` : ""}`,
      kind: "constant",
      value,
      format,
      decimals,
      hidden: true,
      // Stable key so a re-upload matches this rate to the same formula slot.
      source: owner.source ? { sheet: owner.source.sheet, cell: `${owner.source.cell}#${n}` } : undefined,
      importNote: `Taken from the formula of "${owner.label}" (${original}). Change it here to update the result.`,
    });
    return { t: "ref", field: id };
  };
  const walk = (n: Expr, protect = false): Expr => {
    switch (n.t) {
      case "pct":
        if (n.e.t === "num") return make(n.e.v / 100, "percent", decimalsOf(n.e.v), `${n.e.v}%`);
        return { ...n, e: walk(n.e) };
      case "num":
        if (!protect && !Number.isInteger(n.v)) return make(n.v, "number", Math.min(6, decimalsOf(n.v)), String(n.v));
        return n;
      case "bin":
        return { ...n, l: walk(n.l), r: walk(n.r) };
      case "neg":
        return { ...n, e: walk(n.e) };
      case "fn": {
        const isRound = n.name === "ROUND" || n.name === "ROUNDUP" || n.name === "ROUNDDOWN";
        return { ...n, args: n.args.map((a, i) => walk(a, isRound && i === 1)) };
      }
      default:
        return n;
    }
  };
  return walk(e);
}

function decimalsOf(v: number) {
  const s = String(v);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

function cellAt(sheet: SheetModel, r: number, c: number): CellInfo | undefined {
  for (const m of sheet.merges) {
    if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
      return sheet.cells.get(XLSX.utils.encode_cell(m.s));
    }
  }
  return sheet.cells.get(XLSX.utils.encode_cell({ r, c }));
}

function isLabelText(c: CellInfo | undefined): c is CellInfo & { value: string } {
  return !!c && c.isText && typeof c.value === "string" && !c.value.trim().startsWith("*") && cleanLabel(c.value) !== "";
}

function labelFor(sheet: SheetModel, n: Node): string {
  // a) nearest text to the left on the same row
  for (let c = n.c - 1; c >= 0; c--) {
    const cell = cellAt(sheet, n.r, c);
    if (!cell || (cell.r === n.r && cell.c === n.c)) continue;
    if (cell.value === null && !cell.formula) continue;
    if (isLabelText(cell)) return cleanLabel(cell.value);
    break;
  }
  // b) column header above + row header on the left (tables)
  let header: string | undefined;
  for (let r = n.r - 1; r >= Math.max(0, n.r - 30); r--) {
    const cell = cellAt(sheet, r, n.c);
    if (isLabelText(cell)) {
      header = cleanLabel(cell.value);
      break;
    }
  }
  let rowHeader: string | undefined;
  for (let c = 0; c < n.c; c++) {
    const cell = cellAt(sheet, n.r, c);
    if (cell && (cell.value !== null || cell.formula) && !(cell.r === n.r && cell.c === n.c)) {
      rowHeader = cell.isText ? cleanLabel(String(cell.value)) : cell.display.trim();
      break;
    }
  }
  if (header && rowHeader) return `${header} · ${rowHeader}`;
  if (header) return header;
  return `Cell ${n.addr}`;
}

function dedupeLabels(nodes: Node[], labels: Map<Node, string>, multiSheet: boolean) {
  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    const l = labels.get(n)!.toLowerCase();
    groups.set(l, [...(groups.get(l) ?? []), n]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const n of group) {
      const base = labels.get(n)!;
      const v = n.kind !== "output" && n.cell && typeof n.cell.value === "number" ? n.cell.display.trim() : "";
      labels.set(n, v ? `${base} · ${v}` : `${base} (${multiSheet ? `${n.sheet}!` : ""}${n.addr})`);
    }
  }
  // Anything still clashing gets its address appended.
  const seen = new Map<string, number>();
  for (const n of nodes) seen.set(labels.get(n)!.toLowerCase(), (seen.get(labels.get(n)!.toLowerCase()) ?? 0) + 1);
  for (const n of nodes) {
    if ((seen.get(labels.get(n)!.toLowerCase()) ?? 0) > 1) labels.set(n, `${labels.get(n)} (${n.addr})`);
  }
}

function helpTextFor(sheet: SheetModel, n: Node): string | undefined {
  for (let c = n.c + 1; c <= n.c + 3; c++) {
    const cell = cellAt(sheet, n.r, c);
    if (!cell || (cell.r === n.r && cell.c === n.c) || (cell.value === null && !cell.formula)) continue;
    if (cell.isText && typeof cell.value === "string" && cell.value.trim().startsWith("*")) {
      return cell.value.trim().replace(/^\*+\s*/, "");
    }
    return undefined;
  }
  return undefined;
}

function formatFor(n: Node): { format: FieldFormat; decimals: number } {
  const z = n.cell?.numFmt ?? "General";
  const dec = /\.(0+)/.exec(z)?.[1].length;
  if (z.includes("%")) return { format: "percent", decimals: dec ?? 0 };
  if (/\[\$|[$€£¥₹]|Rs|LKR|"[^"]*"/.test(z)) return { format: "currency", decimals: dec ?? 2 };
  if (dec === 2 && /[#,]/.test(z)) return { format: "currency", decimals: 2 };
  if (dec !== undefined) return { format: "number", decimals: dec };
  if (/#,##0/.test(z)) return { format: "number", decimals: 0 };
  if (n.kind === "output") return { format: "number", decimals: 2 };
  const v = n.cell?.value;
  return typeof v === "number" && !Number.isInteger(v) ? { format: "number", decimals: 2 } : { format: "integer", decimals: 0 };
}
