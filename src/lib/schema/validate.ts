import { z } from "zod";
import { CycleError, evaluationOrder } from "../engine/evaluate";
import { exprRefs } from "../engine/parse";
import { BIN_OPS, FUNCTIONS, type CalcSchema, type Expr } from "./types";

const ExprZ: z.ZodType<Expr> = z.lazy(() =>
  z.discriminatedUnion("t", [
    z.object({ t: z.literal("num"), v: z.number().finite() }),
    z.object({ t: z.literal("ref"), field: z.string().min(1) }),
    z.object({ t: z.literal("bin"), op: z.enum(BIN_OPS), l: ExprZ, r: ExprZ }),
    z.object({ t: z.literal("neg"), e: ExprZ }),
    z.object({ t: z.literal("pct"), e: ExprZ }),
    z.object({ t: z.literal("fn"), name: z.enum(FUNCTIONS), args: z.array(ExprZ).max(255) }),
  ]),
) as z.ZodType<Expr>;

const BoundZ = z.object({
  field: z.string().optional(),
  value: z.number().finite().optional(),
  message: z.string().max(300).optional(),
});

const FieldZ = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "Field id must be lowercase letters, digits or _"),
  label: z.string().trim().min(1, "Every field needs a label").max(120),
  kind: z.enum(["input", "output", "constant"]),
  helpText: z.string().max(300).optional(),
  hidden: z.boolean().optional(),
  highlight: z.boolean().optional(),
  format: z.enum(["currency", "number", "percent", "integer"]),
  decimals: z.number().int().min(0).max(10),
  inputType: z.enum(["number", "select"]).optional(),
  defaultValue: z.number().finite().nullable().optional(),
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(80), value: z.number().finite() }))
    .max(100)
    .optional(),
  min: BoundZ.optional(),
  max: BoundZ.optional(),
  value: z.number().finite().optional(),
  formula: ExprZ.optional(),
  source: z
    .object({ sheet: z.string(), cell: z.string(), excelValue: z.number().optional() })
    .optional(),
  importNote: z.string().max(500).optional(),
  verified: z.boolean().optional(),
});

export const CalcSchemaZ = z.object({
  version: z.literal(1),
  fields: z.array(FieldZ).max(200),
});

export const CalculatorInputZ = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Title is required").max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Link name can only use lowercase letters, numbers and dashes")
    .max(80),
  description: z.string().max(1000).default(""),
  currency: z.string().max(10).default(""),
  published: z.boolean().default(true),
  source_filename: z.string().max(255).nullable().default(null),
  schema: CalcSchemaZ,
});

/** Returns a list of human-readable problems; empty means the schema can be saved. */
export function validateSchema(input: unknown): string[] {
  const parsed = CalcSchemaZ.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => {
      const [, idx, ...rest] = i.path;
      return typeof idx === "number" ? `Field ${idx + 1}${rest.length ? ` (${rest.join(".")})` : ""}: ${i.message}` : i.message;
    });
  }
  const schema = parsed.data as CalcSchema;
  const problems: string[] = [];
  const ids = new Map<string, string>();
  for (const f of schema.fields) {
    if (ids.has(f.id)) problems.push(`Two fields share the id "${f.id}"`);
    ids.set(f.id, f.label);
  }
  for (const f of schema.fields) {
    const name = `"${f.label}"`;
    if (f.kind === "output") {
      if (!f.formula) problems.push(`${name} needs a formula`);
      else
        for (const r of exprRefs(f.formula))
          if (!ids.has(r)) problems.push(`${name} uses a field that no longer exists`);
    }
    if (f.kind === "constant" && f.value === undefined) problems.push(`${name} needs a value`);
    if (f.kind === "input") {
      if (f.inputType === "select" && !f.options?.length) problems.push(`${name} dropdown needs at least one option`);
      for (const b of [f.min, f.max]) {
        if (b?.field && !ids.has(b.field)) problems.push(`${name} has a limit based on a field that no longer exists`);
        if (b?.field === f.id) problems.push(`${name} cannot be limited by itself`);
      }
    }
  }
  try {
    evaluationOrder(schema.fields);
  } catch (err) {
    if (err instanceof CycleError) problems.push(err.message);
    else throw err;
  }
  if (!schema.fields.some((f) => f.kind === "output")) problems.push("Add at least one calculated result");
  return problems;
}
