import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { defaultInputs, evaluateSchema } from "@/lib/engine/evaluate";
import { importWorkbook } from "@/lib/excel/extract";
import { mergeReupload } from "@/lib/excel/mergeReupload";
import { validateSchema } from "@/lib/schema/validate";

const fixture = readFileSync(path.join(__dirname, "fixtures/cal.xlsx"));

describe("import CAL LOAN CALCULATOR.xlsx", () => {
  const { schema, notes } = importWorkbook(fixture);
  const byId = new Map(schema.fields.map((f) => [f.id, f]));
  const ofKind = (k: string) => schema.fields.filter((f) => f.kind === k).map((f) => f.id);

  it("detects inputs with labels and help text", () => {
    expect(ofKind("input")).toEqual(["hp_price", "down_payment"]);
    expect(byId.get("hp_price")).toMatchObject({
      label: "HP Price",
      helpText: "Give HP Price",
      defaultValue: 58990,
      format: "currency",
      decimals: 2,
      source: { sheet: "CAL", cell: "B4" },
    });
  });

  it("detects outputs, including the shared formulas in C11:C12", () => {
    expect(ofKind("output")).toEqual([
      "finance_amt",
      "loan_amt_3",
      "monthly_due_3",
      "loan_amt_6",
      "monthly_due_6",
      "loan_amt_12",
      "monthly_due_12",
    ]);
    expect(byId.get("loan_amt_3")!.label).toBe("Loan Amt · 3");
    expect(schema.fields.filter((f) => f.kind === "output").every((f) => f.verified)).toBe(true);
  });

  it("treats the months column and in-formula rates as editable constants", () => {
    expect(ofKind("constant")).toEqual([
      "months_3",
      "loan_amt_3_rate",
      "months_6",
      "loan_amt_6_rate",
      "months_12",
      "loan_amt_12_rate",
    ]);
    expect(byId.get("loan_amt_12_rate")).toMatchObject({ value: 1.55, format: "percent", hidden: true });
    expect(byId.get("months_3")!.importNote).toMatch(/fixed table value/);
  });

  it("ignores the price list and the stray #DIV/0! cell", () => {
    expect(schema.fields.some((f) => f.source?.sheet === "Price List")).toBe(false);
    expect(schema.fields.some((f) => f.source?.cell === "A40")).toBe(false);
    expect(notes.join(" ")).toMatch(/Price List/);
  });

  it("evaluates to Excel's values and is saveable", () => {
    expect(validateSchema(schema)).toEqual([]);
    const { values } = evaluateSchema(schema, defaultInputs(schema));
    expect(values.finance_amt).toBe(38990);
    expect(values.monthly_due_6).toBeCloseTo(7798);
    expect(values.monthly_due_12).toBeCloseTo(5036.208333, 5);
  });
});

/** Build an in-memory workbook (array of rows) for edge cases. */
function book(rows: (string | number | { f: string } | null)[][], sheet = "S") {
  const ws: XLSX.WorkSheet = {};
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === null) return;
      const addr = XLSX.utils.encode_cell({ r, c });
      ws[addr] = typeof v === "object" ? { t: "n", f: v.f, v: 0 } : typeof v === "number" ? { t: "n", v } : { t: "s", v };
    }),
  );
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 10 } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("import edge cases", () => {
  it("treats blank referenced cells as inputs and supports SUM ranges", () => {
    const { schema } = importWorkbook(
      book([
        ["Price", null],
        ["Fee", 100],
        ["Tax", 5],
        [null, null], // blank inside the range: ignored, like Excel's SUM
        ["Total", { f: "B1+SUM(B2:B4)" }],
      ]),
    );
    expect(schema.fields.map((f) => [f.id, f.kind])).toEqual([
      ["price", "input"],
      ["fee", "input"],
      ["tax", "input"],
      ["total", "output"],
    ]);
    const { values } = evaluateSchema(schema, { price: 50, fee: 100, tax: 5 });
    expect(values.total).toBe(155);
  });

  it("flags unsupported functions for manual rebuild", () => {
    const { schema } = importWorkbook(book([["Price", 10], ["Lookup", { f: "VLOOKUP(B1,D1:E5,2,0)" }]]));
    const f = schema.fields.find((x) => x.label === "Lookup")!;
    expect(f.formula).toBeUndefined();
    expect(f.importNote).toMatch(/Unsupported function VLOOKUP/);
    expect(validateSchema(schema).join()).toMatch(/needs a formula/);
  });
});

describe("re-upload merge", () => {
  const original = importWorkbook(fixture).schema;

  it("keeps the admin's edits and ids, takes new formulas/values from the sheet", () => {
    const edited = structuredClone(original);
    const hp = edited.fields.find((f) => f.id === "hp_price")!;
    hp.label = "Item price";
    edited.fields.find((f) => f.id === "loan_amt_3")!.hidden = true;
    edited.fields.push({
      id: "my_extra",
      label: "Extra",
      kind: "output",
      format: "number",
      decimals: 2,
      formula: { t: "ref", field: "finance_amt" },
    });

    // Simulate the owner changing 110% → 115% in Excel.
    const incoming = structuredClone(original);
    incoming.fields.find((f) => f.id === "loan_amt_3_rate")!.value = 1.15;

    const { schema, diff } = mergeReupload(edited, incoming);
    const byId = new Map(schema.fields.map((f) => [f.id, f]));
    expect(byId.get("hp_price")!.label).toBe("Item price");
    expect(byId.get("loan_amt_3")!.hidden).toBe(true);
    expect(byId.get("loan_amt_3_rate")!.value).toBe(1.15);
    expect(byId.get("my_extra")).toBeDefined();
    expect(diff.changed).toEqual([{ label: "Loan Amt · 3 rate", what: "value 1.1 → 1.15" }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(validateSchema(schema)).toEqual([]);
  });
});
