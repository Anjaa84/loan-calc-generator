// "Steps" are the beginner-friendly way to write a formula:
//   start with [HP Price], then [−] [Down Payment], then [×] [6 %] …
// Steps apply left to right, so they map to a left-deep chain of binary
// operations. Anything that doesn't fit (functions, mixed precedence like
// A + B × C, comparisons) returns null and is edited in the advanced editor.

import type { Expr } from "../schema/types";

export type StepOp = "+" | "-" | "*" | "/";
export const STEP_OPS: StepOp[] = ["+", "-", "*", "/"];

export type StepValue = { kind: "field"; field: string } | { kind: "num"; v: number; pct: boolean };

/** A slot may be empty while the person is still building the formula. */
export type Steps = { first: StepValue | null; rest: { op: StepOp; value: StepValue | null }[] };

export const emptySteps = (): Steps => ({ first: null, rest: [] });

function leaf(e: Expr): StepValue | null {
  switch (e.t) {
    case "ref":
      return { kind: "field", field: e.field };
    case "num":
      return { kind: "num", v: e.v, pct: false };
    case "neg":
      return e.e.t === "num" ? { kind: "num", v: -e.e.v, pct: false } : null;
    case "pct":
      if (e.e.t === "num") return { kind: "num", v: e.e.v, pct: true };
      if (e.e.t === "neg" && e.e.e.t === "num") return { kind: "num", v: -e.e.e.v, pct: true };
      return null;
    default:
      return null;
  }
}

/** Steps for a formula, or null when it needs the advanced editor. Undefined formula → empty steps. */
export function exprToSteps(e: Expr | undefined): Steps | null {
  if (!e) return emptySteps();
  const rest: Steps["rest"] = [];
  let cur: Expr = e;
  while (cur.t === "bin") {
    if (!(STEP_OPS as string[]).includes(cur.op)) return null;
    const r = leaf(cur.r);
    if (!r) return null;
    rest.unshift({ op: cur.op as StepOp, value: r });
    cur = cur.l;
  }
  const first = leaf(cur);
  return first ? { first, rest } : null;
}

function leafExpr(v: StepValue): Expr {
  if (v.kind === "field") return { t: "ref", field: v.field };
  const n: Expr = v.v < 0 ? { t: "neg", e: { t: "num", v: -v.v } } : { t: "num", v: v.v };
  return v.pct ? { t: "pct", e: n } : n;
}

/** The formula for complete steps; undefined while any slot is still empty. */
export function stepsToExpr(s: Steps): Expr | undefined {
  if (!s.first) return undefined;
  let e = leafExpr(s.first);
  for (const step of s.rest) {
    if (!step.value) return undefined;
    e = { t: "bin", op: step.op, l: e, r: leafExpr(step.value) };
  }
  return e;
}

export const stepsComplete = (s: Steps) => !!s.first && s.rest.every((x) => x.value);
