// Calculator schema — the single source of truth stored in the DB (as JSON),
// produced by Excel import or the point-and-click builder, and evaluated by
// the engine in src/lib/engine.

export const BIN_OPS = ["+", "-", "*", "/", "^", ">", "<", ">=", "<=", "=", "<>"] as const;
export type BinOp = (typeof BIN_OPS)[number];

export const FUNCTIONS = [
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "ABS",
  "IF",
] as const;
export type FnName = (typeof FUNCTIONS)[number];

export type Expr =
  | { t: "num"; v: number }
  | { t: "ref"; field: string }
  | { t: "bin"; op: BinOp; l: Expr; r: Expr }
  | { t: "neg"; e: Expr }
  | { t: "pct"; e: Expr } // postfix %, e.g. 6% === 0.06
  | { t: "fn"; name: FnName; args: Expr[] }
  // Import-only nodes. Never present in a saved schema (validation rejects them).
  | { t: "cell"; sheet?: string; addr: string }
  | { t: "range"; sheet?: string; from: string; to: string };

export type FieldKind = "input" | "output" | "constant";
export type FieldFormat = "currency" | "number" | "percent" | "integer";

/** A min/max rule for an input: compare against another field or a fixed number. */
export type Bound = { field?: string; value?: number; message?: string };

export type SelectOption = { label: string; value: number };

export type Field = {
  id: string;
  label: string;
  kind: FieldKind;
  helpText?: string;
  /** Hidden fields are still computed but not shown on the public page. */
  hidden?: boolean;
  /** Shown large at the top of the results (e.g. "Monthly Due"). */
  highlight?: boolean;
  format: FieldFormat;
  decimals: number;

  // input
  inputType?: "number" | "select";
  defaultValue?: number | null;
  options?: SelectOption[];
  min?: Bound;
  max?: Bound;

  // constant
  value?: number;

  // output
  formula?: Expr;

  // Excel import metadata
  source?: { sheet: string; cell: string; excelValue?: number };
  /** Import hints shown in the builder (low-confidence guess, unsupported formula…). */
  importNote?: string;
  verified?: boolean;
};

export type CalcSchema = { version: 1; fields: Field[] };

export type CalculatorRecord = {
  id: string;
  slug: string;
  title: string;
  description: string;
  currency: string;
  schema: CalcSchema;
  source_filename: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
};

export type CalculatorDraft = Omit<CalculatorRecord, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export const emptySchema = (): CalcSchema => ({ version: 1, fields: [] });
