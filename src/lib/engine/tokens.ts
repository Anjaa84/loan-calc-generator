// Tokens are shared by the Excel formula tokenizer and the point-and-click
// FormulaBuilder (each chip is one token). Both feed the same parser.

export type OpToken = "+" | "-" | "*" | "/" | "^" | "%" | ">" | "<" | ">=" | "<=" | "=" | "<>";

export type Token =
  | { k: "num"; v: number }
  | { k: "ref"; field: string }
  | { k: "cell"; sheet?: string; addr: string }
  | { k: "range"; sheet?: string; from: string; to: string }
  | { k: "op"; v: OpToken }
  | { k: "lp" }
  | { k: "rp" }
  | { k: "comma" }
  | { k: "fn"; name: string }; // always followed by an "lp" token

export class FormulaError extends Error {
  constructor(
    message: string,
    /** Index of the offending token, when known (used to highlight chips). */
    public tokenIndex?: number,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d+)/;
const ERROR_LITERAL = /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!)/;

function stripDollar(a: string) {
  return a.replace(/\$/g, "").toUpperCase();
}

/** Tokenize an Excel formula string (with or without the leading "="). */
export function tokenizeExcel(input: string): Token[] {
  let s = input.trim();
  if (s.startsWith("=")) s = s.slice(1);
  const out: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = s.slice(i);

    if (ch === '"') throw new FormulaError("Text values are not supported");
    if (ERROR_LITERAL.test(rest)) throw new FormulaError("Formula contains an Excel error value");

    // number: 12, 1.5, .5, 1e3
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest);
    if (num) {
      out.push({ k: "num", v: parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }

    // optional sheet prefix: Sheet1!A1 or 'Sheet Name'!A1
    let sheet: string | undefined;
    let j = i;
    const quoted = /^'((?:[^']|'')+)'!/.exec(rest);
    const plain = /^([A-Za-z_][\w.]*)!/.exec(rest);
    if (quoted) {
      sheet = quoted[1].replace(/''/g, "'");
      j += quoted[0].length;
    } else if (plain) {
      sheet = plain[1];
      j += plain[0].length;
    }
    const afterSheet = s.slice(j);

    // cell or range
    const cell = CELL.exec(afterSheet);
    if (cell && !/^[A-Za-z_(]/.test(afterSheet.slice(cell[0].length))) {
      const from = stripDollar(cell[0]);
      const afterCell = afterSheet.slice(cell[0].length);
      const range = /^:(\$?[A-Za-z]{1,3}\$?\d+)/.exec(afterCell);
      if (range) {
        out.push({ k: "range", sheet, from, to: stripDollar(range[1]) });
        i = j + cell[0].length + range[0].length;
      } else {
        out.push({ k: "cell", sheet, addr: from });
        i = j + cell[0].length;
      }
      continue;
    }
    if (sheet) throw new FormulaError(`Unsupported reference after ${sheet}!`);

    // function name or boolean / named range
    const ident = /^[A-Za-z_][\w.]*/.exec(rest);
    if (ident) {
      const name = ident[0].toUpperCase();
      const after = s.slice(i + ident[0].length).trimStart();
      if (after.startsWith("(")) {
        out.push({ k: "fn", name });
        i += ident[0].length;
        continue;
      }
      if (name === "TRUE" || name === "FALSE") {
        out.push({ k: "num", v: name === "TRUE" ? 1 : 0 });
        i += ident[0].length;
        continue;
      }
      throw new FormulaError(`Named ranges are not supported (${ident[0]})`);
    }

    const two = rest.slice(0, 2);
    if (two === ">=" || two === "<=" || two === "<>") {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^%><=".includes(ch)) {
      out.push({ k: "op", v: ch as OpToken });
      i++;
      continue;
    }
    if (ch === "(") out.push({ k: "lp" });
    else if (ch === ")") out.push({ k: "rp" });
    else if (ch === "," || ch === ";") out.push({ k: "comma" });
    else throw new FormulaError(`Unsupported character "${ch}"`);
    i++;
  }
  return out;
}
