import Link from "next/link";
import { buttonClass, Badge } from "@/components/ui";
import { db, usingSupabase } from "@/lib/db";
import { logout } from "./actions";
import { RowActions } from "./RowActions";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const calculators = await db().list();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your calculators</h1>
          <p className="text-sm text-muted">Create a calculator from an Excel sheet or build one by hand.</p>
        </div>
        <div className="flex gap-2">
          <form action={logout}>
            <button type="submit" className={buttonClass("ghost")}>
              Sign out
            </button>
          </form>
          <Link href="/admin/new" className={buttonClass("primary")}>
            + Generate calculator
          </Link>
        </div>
      </header>

      {!usingSupabase() && (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Saving to a local file (<code>.data/calculators.json</code>). Set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> to use Supabase. This is required on Vercel.
        </p>
      )}

      {calculators.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-muted">No calculators yet.</p>
          <Link href="/admin/new" className={buttonClass("primary", "mt-4")}>
            Generate your first calculator
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {calculators.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/${c.id}/edit`} className="truncate font-medium hover:underline">
                    {c.title}
                  </Link>
                  {!c.published && <Badge tone="warn">Draft</Badge>}
                </div>
                <div className="mt-0.5 truncate text-sm text-muted">
                  /c/{c.slug} · {c.schema.fields.length} fields · updated {new Date(c.updated_at).toLocaleDateString("en-GB")}
                </div>
              </div>
              <RowActions id={c.id} slug={c.slug} title={c.title} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
