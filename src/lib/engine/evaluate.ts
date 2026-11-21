import type { Bound, CalcSchema, Expr, Field } from "../schema/types";
import { exprRefs } from "./parse";

export type Values = Record<string, number | null>;

/** null means "no value yet" (empty input, division by zero, …) and propagates. */
export function evalExpr(e: Expr, values: Values): number | null {
  switch (e.t) {
    case "num":
      return e.v;
    case "ref":
      return values[e.field] ?? null;
    case "neg": {
      const v = evalExpr(e.e, values);
      return v === null ? null : -v;
    }
    case "pct": {
      const v = evalExpr(e.e, values);
      return v === null ? null : v / 100;
    }
    case "bin": {
      const l = evalExpr(e.l, values);
      const r = evalExpr(e.r, values);
      if (l === null || r === null) return null;
      switch (e.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? null : l / r;
        case "^": {
          const v = Math.pow(l, r);
          return Number.isFinite(v) ? v : null;
        }
        case ">":
          return l > r ? 1 : 0;
        case "<":
          return l < r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case "=":
          return Math.abs(l - r) < 1e-9 ? 1 : 0;
        case "<>":
          return Math.abs(l - r) < 1e-9 ? 0 : 1;
      }
      return null;
    }
    case "fn": {
      if (e.name === "IF") {
        const c = evalExpr(e.args[0], values);
        if (c === null) return null;
        return c !== 0 ? evalExpr(e.args[1], values) : e.args[2] ? evalExpr(e.args[2], values) : 0;
      }
      const args = e.args.map((a) => evalExpr(a, values));
      const present = args.filter((v): v is number => v !== null);
      switch (e.name) {
        case "SUM":
          return present.length ? present.reduce((a, b) => a + b, 0) : null;
        case "AVERAGE":
          return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
        case "MIN":
          return present.length ? Math.min(...present) : null;
        case "MAX":
          return present.length ? Math.max(...present) : null;
        case "ABS":
          return args[0] === null ? null : Math.abs(args[0]);
        case "ROUND":
        case "ROUNDUP":
        case "ROUNDDOWN": {
          const [x, d] = args;
          if (x === null || d === null) return null;
          return roundExcel(x, Math.trunc(d), e.name);
        }
      }
      return null;
    }
    // Import-only nodes should have been resolved before evaluation.
    case "cell":
    case "range":
      return null;
  }
}

function roundExcel(x: number, digits: number, mode: "ROUND" | "ROUNDUP" | "ROUNDDOWN"): number {
  const f = Math.pow(10, digits);
  const sign = x < 0 ? -1 : 1;
  // Nudge by a relative epsilon so 1.005 rounds like Excel does (to 1.01).
  const scaled = Math.abs(x) * f * (1 + Number.EPSILON * 4);
  const r = mode === "ROUND" ? Math.round(scaled) : mode === "ROUNDUP" ? Math.ceil(scaled - 1e-9) : Math.floor(scaled);
  return (sign * r) / f;
}

/** Topological order of output fields. Throws with the cycle path if there is one. */
export function evaluationOrder(fields: Field[]): string[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();

  function visit(id: string, path: string[]) {
    const f = byId.get(id);
    if (!f || f.kind !== "output" || !f.formula) return;
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") {
      const cycle = [...path.slice(path.indexOf(id)), id].map((x) => byId.get(x)?.label ?? x);
      throw new CycleError(`Formulas refer to each other in a loop: ${cycle.join(" → ")}`);
    }
    state.set(id, "visiting");
    for (const dep of exprRefs(f.formula)) visit(dep, [...path, id]);
    state.set(id, "done");
    order.push(id);
  }

  for (const f of fields) visit(f.id, []);
  return order;
}

export class CycleError extends Error {}

export type EvalResult = {
  values: Values;
  /** Validation errors keyed by input field id. */
  errors: Record<string, string>;
  cycle?: string;
};

/**
 * Evaluate a calculator.
 * @param inputs values for input fields (already converted: percent inputs as fractions)
 * @param fmt formatter used to build validation messages
 */
export function evaluateSchema(
  schema: CalcSchema,
  inputs: Values,
  fmt: (v: number, f: Field) => string = (v) => String(v),
): EvalResult {
  const values: Values = {};
  for (const f of schema.fields) {
    if (f.kind === "input") values[f.id] = inputs[f.id] ?? null;
    else if (f.kind === "constant") values[f.id] = f.value ?? null;
  }

  let order: string[] = [];
  let cycle: string | undefined;
  try {
    order = evaluationOrder(schema.fields);
  } catch (err) {
    if (err instanceof CycleError) cycle = err.message;
    else throw err;
  }
  const byId = new Map(schema.fields.map((f) => [f.id, f]));
  for (const id of order) {
    const f = byId.get(id)!;
    const v = evalExpr(f.formula!, values);
    values[id] = v === null || !Number.isFinite(v) ? null : v;
  }

  const errors: Record<string, string> = {};
  for (const f of schema.fields) {
    if (f.kind !== "input") continue;
    const v = values[f.id];
    if (v === null) continue;
    const check = (b: Bound | undefined, kind: "min" | "max") => {
      if (!b) return;
      const limitField = b.field ? byId.get(b.field) : undefined;
      const limit = b.field ? values[b.field] : (b.value ?? null);
      if (limit === null || limit === undefined) return;
      const bad = kind === "min" ? v < limit - 1e-9 : v > limit + 1e-9;
      if (!bad || errors[f.id]) return;
      const shown = fmt(limit, limitField ?? f);
      errors[f.id] =
        b.message?.trim() ||
        `${f.label} must be ${kind === "min" ? "at least" : "at most"} ${shown}` +
          (limitField ? ` (${limitField.label})` : "");
    };
    check(f.min, "min");
    check(f.max, "max");
  }

  return { values, errors, cycle };
}

/** Default input values for a schema (select → first option). */
export function defaultInputs(schema: CalcSchema): Values {
  const out: Values = {};
  for (const f of schema.fields) {
    if (f.kind !== "input") continue;
    if (f.inputType === "select") out[f.id] = f.defaultValue ?? f.options?.[0]?.value ?? null;
    else out[f.id] = f.defaultValue ?? null;
  }
  return out;
}
