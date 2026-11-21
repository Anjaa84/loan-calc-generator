import { describe, expect, it } from "vitest";
import { evaluateSchema, evalExpr } from "@/lib/engine/evaluate";
import { exprToTokens, parseExcelFormula, parseTokens } from "@/lib/engine/parse";
import { exprToText, formatValue } from "@/lib/engine/format";
import { validateSchema } from "@/lib/schema/validate";
import { hpLoanTemplate } from "@/lib/templates/hpLoan";
import type { CalcSchema } from "@/lib/schema/types";

const calc = (f: string, cells: Record<string, number> = {}) => {
  const e = parseExcelFormula(f);
  const toRef = (x: typeof e): typeof e =>
    x.t === "cell" ? { t: "ref", field: x.addr } : x.t === "bin" ? { ...x, l: toRef(x.l), r: toRef(x.r) } : x.t === "neg" || x.t === "pct" ? { ...x, e: toRef(x.e) } : x.t === "fn" ? { ...x, args: x.args.map(toRef) } : x;
  return evalExpr(toRef(e), cells);
};

describe("parser + evaluator", () => {
  it("follows Excel precedence", () => {
    expect(calc("=1+2*3")).toBe(7);
    expect(calc("=(1+2)*3")).toBe(9);
    expect(calc("=-2^2")).toBe(4); // Excel: negation binds tighter than ^
    expect(calc("=2^3^2")).toBe(64); // left-assoc
    expect(calc("=200*10%")).toBeCloseTo(20);
    expect(calc("=B7*110%", { B7: 38990 })).toBeCloseTo(42889);
    expect(calc("=$B$4-B5", { B4: 10, B5: 3 })).toBe(7);
  });
  it("supports functions", () => {
    expect(calc("=ROUND(2.345,2)")).toBe(2.35);
    expect(calc("=ROUND(1.005,2)")).toBe(1.01);
    expect(calc("=ROUNDUP(2.341,2)")).toBe(2.35);
    expect(calc("=ROUNDDOWN(2.349,2)")).toBe(2.34);
    expect(calc("=IF(A1>=5,1,2)", { A1: 5 })).toBe(1);
    expect(calc("=MAX(1,7,3)")).toBe(7);
    expect(calc("=SUM(1,2,3)")).toBe(6);
  });
  it("returns null instead of crashing", () => {
    expect(calc("=1/0")).toBeNull();
    expect(calc("=A1+1")).toBeNull();
  });
  it("rejects unsupported formulas", () => {
    expect(() => parseExcelFormula("=VLOOKUP(A1,B:C,2,0)")).toThrow(/Unsupported|Named/);
    expect(() => parseExcelFormula('="a"&"b"')).toThrow(/Text/);
    expect(() => parseExcelFormula("=1+")).toThrow(/incomplete/);
    expect(() => parseExcelFormula("=(1+2")).toThrow(/bracket/);
  });
  it("round-trips through tokens (builder chips)", () => {
    for (const f of ["=A1-(B1-C1)", "=-(A1+B1)", "=(A1+B1)*C1%", "=IF(A1>B1,A1,B1)/2", "=A1/(B1*C1)", "=2^(1+1)"]) {
      const e = parseExcelFormula(f);
      expect(parseTokens(exprToTokens(e))).toEqual(e);
    }
  });
});

describe("HP loan template (owner's formulas)", () => {
  const schema = hpLoanTemplate();
  const fmt = (v: number) => formatValue(v, { format: "currency", decimals: 2 }, "Rs.");

  it("is a valid schema", () => {
    expect(validateSchema(schema)).toEqual([]);
  });
  it("matches the agreed check values", () => {
    const { values, errors } = evaluateSchema(schema, { hp_price: 58990, down_payment: 20000, duration: 6 }, fmt);
    expect(errors).toEqual({});
    expect(values.min_down_payment).toBeCloseTo(8848.5);
    expect(values.loan_amount).toBeCloseTo(38990);
    expect(values.service_charge).toBeCloseTo(2339.4);
    expect(values.agreed_amount).toBeCloseTo(41329.4);
    expect(formatValue(values.monthly_due, { format: "currency", decimals: 2 })).toBe("6,888.23");
  });
  it("blocks a down payment under 15%", () => {
    const { errors } = evaluateSchema(schema, { hp_price: 58990, down_payment: 8000, duration: 6 }, fmt);
    expect(errors.down_payment).toBe("Down Payment must be at least Rs. 8,848.50 (Minimum Down Payment (15%))");
  });
  it("renders formulas as text", () => {
    const labels = new Map(schema.fields.map((f) => [f.id, f.label]));
    const sc = schema.fields.find((f) => f.id === "service_charge")!;
    expect(exprToText(sc.formula!, (id) => labels.get(id)!)).toBe("Loan Amount × 6%");
  });
});

describe("validation", () => {
  it("detects cycles and dangling refs", () => {
    const s: CalcSchema = {
      version: 1,
      fields: [
        { id: "a", label: "A", kind: "output", format: "number", decimals: 0, formula: { t: "ref", field: "b" } },
        { id: "b", label: "B", kind: "output", format: "number", decimals: 0, formula: { t: "ref", field: "a" } },
        { id: "c", label: "C", kind: "output", format: "number", decimals: 0, formula: { t: "ref", field: "zzz" } },
      ],
    };
    const problems = validateSchema(s);
    expect(problems.some((p) => p.includes("loop"))).toBe(true);
    expect(problems.some((p) => p.includes("no longer exists"))).toBe(true);
  });
});
