import { FUNCTIONS, type BinOp, type Expr, type FnName } from "../schema/types";
import { FormulaError, tokenizeExcel, type Token } from "./tokens";

// Pratt parser following Excel precedence (low → high):
//   comparison < + - < * / < ^ < % (postfix) < unary minus
const INFIX_BP: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "+": 2,
  "-": 2,
  "*": 3,
  "/": 3,
  "^": 4,
};
const PCT_BP = 5;
const PREFIX_BP = 6;

export const FN_ARITY: Record<FnName, [min: number, max: number]> = {
  SUM: [1, 255],
  AVERAGE: [1, 255],
  MIN: [1, 255],
  MAX: [1, 255],
  ROUND: [2, 2],
  ROUNDUP: [2, 2],
  ROUNDDOWN: [2, 2],
  ABS: [1, 1],
  IF: [2, 3],
};

export function parseTokens(tokens: Token[]): Expr {
  let pos = 0;
  const peek = () => tokens[pos];
  const fail = (msg: string, at = pos): never => {
    throw new FormulaError(msg, at < tokens.length ? at : undefined);
  };

  function parseExpr(minBp: number): Expr {
    let left = parsePrefix();
    for (;;) {
      const t = peek();
      if (!t || t.k !== "op") break;
      if (t.v === "%") {
        if (PCT_BP < minBp) break;
        pos++;
        left = { t: "pct", e: left };
        continue;
      }
      const bp = INFIX_BP[t.v];
      if (bp === undefined || bp < minBp) break;
      pos++;
      // left-associative (Excel evaluates 2^3^2 as (2^3)^2)
      const right = parseExpr(bp + 1);
      left = { t: "bin", op: t.v as BinOp, l: left, r: right };
    }
    return left;
  }

  function parsePrefix(): Expr {
    const t = peek();
    if (!t) return fail("Formula is incomplete");
    pos++;
    switch (t.k) {
      case "num":
        return { t: "num", v: t.v };
      case "ref":
        return { t: "ref", field: t.field };
      case "cell":
        return { t: "cell", sheet: t.sheet, addr: t.addr };
      case "range":
        return { t: "range", sheet: t.sheet, from: t.from, to: t.to };
      case "op":
        if (t.v === "-") return { t: "neg", e: parseExpr(PREFIX_BP) };
        if (t.v === "+") return parseExpr(PREFIX_BP);
        return fail(`Unexpected "${t.v}"`, pos - 1);
      case "lp": {
        const e = parseExpr(0);
        if (peek()?.k !== "rp") fail("Missing closing bracket )");
        pos++;
        return e;
      }
      case "fn": {
        const fnAt = pos - 1;
        if (!(FUNCTIONS as readonly string[]).includes(t.name)) fail(`Unsupported function ${t.name}`, fnAt);
        const name = t.name as FnName;
        if (peek()?.k !== "lp") fail(`${name} needs an opening bracket (`);
        pos++;
        const args: Expr[] = [];
        if (peek()?.k !== "rp") {
          for (;;) {
            args.push(parseExpr(0));
            if (peek()?.k === "comma") {
              pos++;
              continue;
            }
            break;
          }
        }
        if (peek()?.k !== "rp") fail(`Missing closing bracket ) for ${name}`);
        pos++;
        const [min, max] = FN_ARITY[name];
        if (args.length < min || args.length > max) {
          fail(`${name} takes ${min === max ? min : `${min}–${max}`} value(s), got ${args.length}`, fnAt);
        }
        return { t: "fn", name, args };
      }
      case "rp":
        return fail("Unexpected closing bracket )", pos - 1);
      case "comma":
        return fail("Unexpected comma", pos - 1);
    }
  }

  if (tokens.length === 0) fail("Formula is empty");
  const expr = parseExpr(0);
  if (pos < tokens.length) fail("Unexpected item", pos);
  return expr;
}

export function parseExcelFormula(formula: string): Expr {
  return parseTokens(tokenizeExcel(formula));
}

/** Precedence of an expression node, used to decide where brackets are needed when printing. */
export function exprBp(e: Expr): number {
  switch (e.t) {
    case "bin":
      return INFIX_BP[e.op];
    case "pct":
      return PCT_BP;
    case "neg":
      return PREFIX_BP;
    default:
      return 99;
  }
}

/** Convert an expression back to tokens (for editing in the FormulaBuilder). */
export function exprToTokens(e: Expr): Token[] {
  const out: Token[] = [];
  const wrap = (child: Expr, needParens: boolean) => {
    if (needParens) out.push({ k: "lp" });
    walk(child);
    if (needParens) out.push({ k: "rp" });
  };
  function walk(n: Expr): void {
    switch (n.t) {
      case "num":
        out.push({ k: "num", v: n.v });
        return;
      case "ref":
        out.push({ k: "ref", field: n.field });
        return;
      case "cell":
        out.push({ k: "cell", sheet: n.sheet, addr: n.addr });
        return;
      case "range":
        out.push({ k: "range", sheet: n.sheet, from: n.from, to: n.to });
        return;
      case "neg":
        out.push({ k: "op", v: "-" });
        wrap(n.e, exprBp(n.e) < PREFIX_BP);
        return;
      case "pct":
        wrap(n.e, exprBp(n.e) < PCT_BP);
        out.push({ k: "op", v: "%" });
        return;
      case "bin": {
        const bp = INFIX_BP[n.op];
        wrap(n.l, exprBp(n.l) < bp);
        out.push({ k: "op", v: n.op });
        wrap(n.r, exprBp(n.r) <= bp); // left-assoc: equal precedence on the right needs brackets
        return;
      }
      case "fn":
        out.push({ k: "fn", name: n.name }, { k: "lp" });
        n.args.forEach((a, i) => {
          if (i > 0) out.push({ k: "comma" });
          walk(a);
        });
        out.push({ k: "rp" });
        return;
    }
  }
  walk(e);
  return out;
}

/** Field ids referenced (directly) by an expression. */
export function exprRefs(e: Expr, acc = new Set<string>()): Set<string> {
  switch (e.t) {
    case "ref":
      acc.add(e.field);
      break;
    case "bin":
      exprRefs(e.l, acc);
      exprRefs(e.r, acc);
      break;
    case "neg":
    case "pct":
      exprRefs(e.e, acc);
      break;
    case "fn":
      e.args.forEach((a) => exprRefs(a, acc));
      break;
  }
  return acc;
}
