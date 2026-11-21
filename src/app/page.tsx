import Link from "next/link";
import { cookies } from "next/headers";
import { buttonClass } from "@/components/ui";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [calculators, jar] = await Promise.all([db().list({ publishedOnly: true }), cookies()]);
  const isAdmin = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Loan calculators</h1>
          <p className="mt-1 text-muted">Pick a calculator to work out your payments.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Link href="/admin" className={buttonClass("secondary")}>
              Manage
            </Link>
          )}
          {/* Not signed in → password screen first, then straight to the upload page. */}
          <Link href="/admin/new" className={buttonClass("primary")}>
            + Generate calculator
          </Link>
        </div>
      </header>
      {calculators.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-muted">No calculators yet.</p>
          <Link href="/admin/new" className={buttonClass("primary", "mt-4")}>
            Upload an Excel sheet
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {calculators.map((c) => (
            <li key={c.id}>
              <Link
                href={`/c/${c.slug}`}
                className="block rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-accent"
              >
                <div className="font-medium">{c.title}</div>
                {c.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
