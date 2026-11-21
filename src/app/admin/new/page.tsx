"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Builder, importExcelFile } from "@/components/builder/Builder";
import { cleanLabel, toUrlSlug } from "@/lib/excel/labels";
import { emptySchema, type CalculatorDraft } from "@/lib/schema/types";
import { hpLoanTemplate } from "@/lib/templates/hpLoan";

const draft = (title: string, schema = emptySchema(), source_filename: string | null = null): CalculatorDraft => ({
  title,
  slug: toUrlSlug(title),
  description: "",
  currency: "",
  published: true,
  source_filename,
  schema,
});

export default function NewCalculatorPage() {
  const [start, setStart] = useState<{ draft: CalculatorDraft; notes?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (start) return <Builder initial={start.draft} importNotes={start.notes} />;

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { schema, notes } = await importExcelFile(file);
      const title = cleanLabel(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")) || "New calculator";
      setStart({ draft: draft(title, schema, file.name), notes });
    } catch (e) {
      setError(`Couldn't read that file. Is it an Excel workbook? (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
      <Link href="/admin" className="text-sm text-muted hover:text-text">
        ← All calculators
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Generate a calculator</h1>
        <p className="mt-1 text-muted">Start from an Excel sheet, a template, or a blank page. You can edit everything afterwards.</p>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void onFile(f);
          }}
          className="flex flex-col items-start gap-1 rounded-2xl border-2 border-dashed border-accent/50 bg-accent-soft p-6 text-left transition-colors hover:border-accent disabled:opacity-60"
        >
          <span className="text-lg font-semibold text-accent">{busy ? "Reading your sheet…" : "Upload an Excel sheet"}</span>
          <span className="text-sm text-muted">
            We find the input cells, the formulas and the results, then you review them. The file is read on this device and isn&apos;t uploaded.
          </span>
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="button"
          onClick={() => setStart({ draft: { ...draft("HP Loan Calculator", hpLoanTemplate()), currency: "Rs." } })}
          className="flex flex-col items-start gap-1 rounded-2xl border border-line bg-surface p-5 text-left transition-colors hover:border-accent"
        >
          <span className="font-semibold">Use the HP loan template</span>
          <span className="text-sm text-muted">
            HP price → minimum 15% down payment → loan → 6% service charge → agreed amount → monthly due over 3, 6 or 12 months.
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStart({ draft: draft("New calculator") })}
          className="flex flex-col items-start gap-1 rounded-2xl border border-line bg-surface p-5 text-left transition-colors hover:border-accent"
        >
          <span className="font-semibold">Start blank</span>
          <span className="text-sm text-muted">Add inputs and results yourself with the point-and-click builder.</span>
        </button>
      </div>
    </main>
  );
}
