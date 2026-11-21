import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const calculators = await db().list({ publishedOnly: true });
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Loan calculators</h1>
        <p className="mt-1 text-muted">Pick a calculator to work out your payments.</p>
      </header>
      {calculators.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-muted">
          No calculators yet.
        </p>
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
