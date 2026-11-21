import * as XLSX from "xlsx";

export type CellInfo = {
  sheet: string;
  addr: string;
  r: number;
  c: number;
  /** number for numeric cells, string for text, null for blank */
  value: number | string | null;
  isText: boolean;
  isError: boolean;
  formula?: string;
  numFmt: string;
  /** Excel's formatted text, e.g. "58,990.00" */
  display: string;
};

export type SheetModel = {
  name: string;
  index: number;
  cells: Map<string, CellInfo>;
  merges: XLSX.Range[];
};

export type WorkbookModel = { sheets: SheetModel[] };

const ERROR_TEXT = /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!|GETTING_DATA)/;

/**
 * Read an .xlsx/.xls file into a plain cell model.
 * SheetJS expands shared formulas, so every formula cell has its own `formula`.
 */
export function readWorkbook(data: ArrayBuffer | Uint8Array): WorkbookModel {
  const wb = XLSX.read(data, { type: "array", cellFormula: true, cellNF: true, cellDates: false });
  const sheets: SheetModel[] = wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name];
    const cells = new Map<string, CellInfo>();
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith("!")) continue;
      const raw = ws[addr] as XLSX.CellObject;
      const { r, c } = XLSX.utils.decode_cell(addr);
      let value: number | string | null = null;
      let isText = false;
      let isError = false;
      if (raw.t === "n" && typeof raw.v === "number") value = raw.v;
      else if (raw.t === "b") value = raw.v ? 1 : 0;
      else if (raw.t === "e") isError = true;
      else if (raw.t === "s" && typeof raw.v === "string") {
        // SheetJS reports some cached formula errors as strings
        if (raw.f && ERROR_TEXT.test(raw.v)) isError = true;
        else if (raw.v.trim() !== "") {
          value = raw.v;
          isText = true;
        }
      } else if (raw.t === "d") value = raw.v instanceof Date ? raw.v.getTime() : null;
      const formula = typeof raw.f === "string" && raw.f.trim() !== "" ? raw.f : undefined;
      if (value === null && !formula && !isError) continue;
      cells.set(addr, {
        sheet: name,
        addr,
        r,
        c,
        value,
        isText,
        isError,
        formula,
        numFmt: typeof raw.z === "string" ? raw.z : "General",
        display: typeof raw.w === "string" ? raw.w : value === null ? "" : String(value),
      });
    }
    return { name, index, cells, merges: ws["!merges"] ?? [] };
  });
  return { sheets };
}
