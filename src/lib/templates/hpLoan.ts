import { parseTokens } from "../engine/parse";
import type { Token } from "../engine/tokens";
import type { CalcSchema, Expr } from "../schema/types";

const ref = (field: string): Token => ({ k: "ref", field });
const num = (v: number): Token => ({ k: "num", v });
const op = (v: "+" | "-" | "*" | "/" | "%"): Token => ({ k: "op", v });
const f = (...t: Token[]): Expr => parseTokens(t);

/** The owner's hire-purchase formula set. */
export function hpLoanTemplate(): CalcSchema {
  return {
    version: 1,
    fields: [
      { id: "hp_price", label: "HP Price", kind: "input", inputType: "number", format: "currency", decimals: 2, defaultValue: null },
      {
        id: "min_down_payment",
        label: "Minimum Down Payment (15%)",
        kind: "output",
        format: "currency",
        decimals: 2,
        formula: f(ref("hp_price"), op("*"), num(15), op("%")),
      },
      {
        id: "down_payment",
        label: "Down Payment",
        kind: "input",
        inputType: "number",
        format: "currency",
        decimals: 2,
        defaultValue: null,
        min: { field: "min_down_payment" },
      },
      {
        id: "loan_amount",
        label: "Loan Amount",
        kind: "output",
        format: "currency",
        decimals: 2,
        formula: f(ref("hp_price"), op("-"), ref("down_payment")),
      },
      {
        id: "service_charge",
        label: "Service Charge (6%)",
        kind: "output",
        format: "currency",
        decimals: 2,
        formula: f(ref("loan_amount"), op("*"), num(6), op("%")),
      },
      {
        id: "agreed_amount",
        label: "Agreed Amount",
        kind: "output",
        format: "currency",
        decimals: 2,
        formula: f(ref("loan_amount"), op("+"), ref("service_charge")),
      },
      {
        id: "duration",
        label: "Duration (months)",
        kind: "input",
        inputType: "select",
        format: "integer",
        decimals: 0,
        options: [
          { label: "3 months", value: 3 },
          { label: "6 months", value: 6 },
          { label: "12 months", value: 12 },
        ],
        defaultValue: 3,
      },
      {
        id: "monthly_due",
        label: "Monthly Due",
        kind: "output",
        format: "currency",
        decimals: 2,
        highlight: true,
        formula: f(ref("agreed_amount"), op("/"), ref("duration")),
      },
    ],
  };
}
