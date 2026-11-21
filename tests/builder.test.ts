import { describe, expect, it } from "vitest";
import { evalExpr } from "@/lib/engine/evaluate";
import { parseExcelFormula } from "@/lib/engine/parse";
import { exprToSteps, stepsToExpr, type Steps } from "@/lib/engine/steps";
import { commit, initHistory, redo, undo } from "@/lib/history";
import type { Expr, Field } from "@/lib/schema/types";
import { insertIntoZone, reorderZone, zonesOf } from "@/lib/schema/zones";
import { hpLoanTemplate } from "@/lib/templates/hpLoan";

const refs = (formula: string): Expr => {
  const toRef = (x: Expr): Expr =>
    x.t === "cell"
      ? { t: "ref", field: x.addr }
      : x.t === "bin"
        ? { ...x, l: toRef(x.l), r: toRef(x.r) }
        : x.t === "neg" || x.t === "pct"
          ? { ...x, e: toRef(x.e) }
          : x.t === "fn"
            ? { ...x, args: x.args.map(toRef) }
            : x;
  return toRef(parseExcelFormula(formula));
};

describe("formula steps", () => {
  it("round-trips every HP template formula", () => {
    for (const f of hpLoanTemplate().fields.filter((x) => x.formula)) {
      const steps = exprToSteps(f.formula);
      expect(steps, f.label).not.toBeNull();
      expect(stepsToExpr(steps!)).toEqual(f.formula);
    }
  });
  it("round-trips Excel-style formulas and keeps their values", () => {
    const cells = { B7: 38990, B10: 42889, A10: 3, A1: 5, B1: 2 };
    for (const src of ["=B7*110%", "=B10/A10", "=A1-B1-3", "=A1*-2", "=A1", "=A1+B1*1"]) {
      const e = refs(src);
      const steps = exprToSteps(e);
      if (src === "=A1+B1*1") {
        expect(steps).toBeNull(); // mixed precedence → advanced editor
        continue;
      }
      expect(steps, src).not.toBeNull();
      expect(evalExpr(stepsToExpr(steps!)!, cells)).toBeCloseTo(evalExpr(e, cells)!);
    }
  });
  it("sends functions and comparisons to the advanced editor", () => {
    expect(exprToSteps(refs("=ROUND(A1,2)"))).toBeNull();
    expect(exprToSteps(refs("=IF(A1>B1,1,2)"))).toBeNull();
    expect(exprToSteps(refs("=A1^2"))).toBeNull();
  });
  it("applies steps left to right", () => {
    const s: Steps = {
      first: { kind: "field", field: "a" },
      rest: [
        { op: "+", value: { kind: "field", field: "b" } },
        { op: "*", value: { kind: "num", v: 10, pct: true } },
      ],
    };
    expect(evalExpr(stepsToExpr(s)!, { a: 100, b: 100 })).toBeCloseTo(20);
  });
  it("is incomplete while a slot is empty", () => {
    expect(stepsToExpr({ first: null, rest: [] })).toBeUndefined();
    expect(stepsToExpr({ first: { kind: "field", field: "a" }, rest: [{ op: "+", value: null }] })).toBeUndefined();
    expect(exprToSteps(undefined)).toEqual({ first: null, rest: [] });
  });
});

describe("zones", () => {
  const ids = (fs: Field[]) => fs.map((f) => f.id);
  it("groups like the public page, big results first", () => {
    const z = zonesOf(hpLoanTemplate().fields);
    expect(ids(z.inputs)).toEqual(["hp_price", "down_payment", "duration"]);
    expect(ids(z.results)).toEqual(["monthly_due", "min_down_payment", "loan_amount", "service_charge", "agreed_amount"]);
    expect(z.hidden).toEqual([]);
  });
  it("reorders inside a zone only", () => {
    const fields = reorderZone(hpLoanTemplate().fields, "inputs", 2, 0);
    const z = zonesOf(fields);
    expect(ids(z.inputs)).toEqual(["duration", "hp_price", "down_payment"]);
    expect(ids(z.results)).toEqual(["monthly_due", "min_down_payment", "loan_amount", "service_charge", "agreed_amount"]);
  });
  it("inserts new fields into the right zone", () => {
    const rate: Field = { id: "rate", label: "Rate", kind: "constant", value: 0.06, format: "percent", decimals: 0, hidden: true };
    const box: Field = { id: "x", label: "X", kind: "input", inputType: "number", format: "number", decimals: 0 };
    let fields = insertIntoZone(hpLoanTemplate().fields, rate);
    fields = insertIntoZone(fields, box, 1);
    const z = zonesOf(fields);
    expect(ids(z.hidden)).toEqual(["rate"]);
    expect(ids(z.inputs)).toEqual(["hp_price", "x", "down_payment", "duration"]);
  });
});

describe("undo history", () => {
  it("merges quick edits with the same key", () => {
    let h = initHistory("a");
    h = commit(h, "ab", "label", 0);
    h = commit(h, "abc", "label", 100);
    h = commit(h, "abcd", "other", 200);
    expect(h.past).toEqual(["a", "abc"]);
    h = undo(h);
    expect(h.present).toBe("abc");
    h = undo(h);
    expect(h.present).toBe("a");
    h = redo(h);
    expect(h.present).toBe("abc");
  });
  it("does not merge after a pause", () => {
    let h = initHistory(1);
    h = commit(h, 2, "k", 0);
    h = commit(h, 3, "k", 5000);
    expect(h.past).toEqual([1, 2]);
  });
});
