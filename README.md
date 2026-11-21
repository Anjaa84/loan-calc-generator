# Loan Calculator Generator

Turn an Excel loan sheet into a mobile-friendly web calculator, or build one with a point-and-click editor.

- **Admin** (one password) uploads a sheet. The app detects inputs, results and formulas, the admin reviews and edits them, then saves. Each calculator gets a public link.
- **Customers** open `/c/<link>` on their phone and get live results.
- **Edit** a calculator any time, or **re-upload** a newer version of the sheet. Your labels and settings are kept and the link doesn't change.

Stack: Next.js (App Router) on Vercel, Supabase Postgres (free tier), SheetJS for reading Excel in the browser, and a small built-in formula engine. No separate backend.

## How Excel import works

1. The workbook is read **in the browser**, so the file is never uploaded.
2. Every formula is parsed. Shared formulas are expanded, ranges are resolved, and references across sheets are followed.
3. A dependency graph decides what each cell is:
   - **Result**: any formula cell.
   - **Input**: a number (or blank cell) that a formula uses.
   - **Fixed value**: a column of numbers next to formula rows (e.g. 3/6/12 months), or a %-formatted cell.
   - **Rates inside formulas** (`=B7*110%`) are pulled out into editable fixed values.
   - **Ignored**: anything no formula uses (e.g. a price list sheet), and stray cells that show an Excel error.
4. Labels come from the text to the left, or from the column header plus the row header in tables. A `* note` to the right becomes help text.
5. Every result is recomputed and compared with the value Excel saved (shown as **✓ matches Excel**).

Supported in formulas: `+ − × ÷ ^ %`, brackets, comparisons, `SUM AVERAGE MIN MAX ROUND ROUNDUP ROUNDDOWN ABS IF`. Anything else (e.g. `VLOOKUP`) is flagged for you to rebuild in the editor.

## Run locally

```bash
npm install
cp .env.example .env.local      # set ADMIN_PASSWORD and ADMIN_SESSION_SECRET
npm run dev                     # http://localhost:3000, admin at /admin
```

Without Supabase settings, data is saved to `.data/calculators.json`, which is fine for trying it out.

```bash
npm test          # unit tests (engine, Excel import against tests/fixtures/cal.xlsx, re-upload merge)
npm run build
```

## Set up Supabase (free)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run [`supabase/migrations/0001_calculators.sql`](supabase/migrations/0001_calculators.sql).
3. In **Project Settings → API**, copy the Project URL and the `service_role` key into `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

The table has Row Level Security on with no policies, so only the server (using the service-role key) can read or write it. Never put that key in a `NEXT_PUBLIC_` variable.

## Deploy to Vercel (free)

1. Push this repo to GitHub and import it in Vercel.
2. Add the environment variables: `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (`openssl rand -base64 48`), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Deploy. Supabase is required on Vercel because its filesystem is read-only.

**Free-tier notes**
- Vercel's Hobby plan is for non-commercial use. If a business uses this commercially, move to Vercel Pro, or host on Cloudflare (free, commercial use allowed).
- Supabase pauses free projects after about a week with no activity. Restore it from the dashboard, or keep it active with occasional traffic.

## Project layout

```
src/lib/engine/      tokenizer, parser (Excel precedence), evaluator, formatting
src/lib/excel/       readWorkbook → extract (classify/label/hoist/verify) → mergeReupload
src/lib/schema/      calculator JSON types + zod validation
src/lib/templates/   HP loan template (15% min down payment, 6% service charge)
src/components/      Calculator (public page), visual builder (drag-and-drop canvas, step formulas, settings panel)
src/app/             / (list), /c/[slug] (public), /admin/* (login, list, new, edit)
```
