import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Calculator } from "@/components/calculator/Calculator";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const load = cache(async (slug: string) => {
  const calc = await db().getBySlug(slug);
  return calc && calc.published ? calc : null;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const calc = await load((await params).slug);
  return calc ? { title: calc.title, description: calc.description || undefined } : { title: "Not found" };
}

export default async function CalculatorPage({ params }: { params: Promise<{ slug: string }> }) {
  const calc = await load((await params).slug);
  if (!calc) notFound();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{calc.title}</h1>
        {calc.description && <p className="mt-1 whitespace-pre-line text-muted">{calc.description}</p>}
      </header>
      <Calculator schema={calc.schema} currency={calc.currency} />
    </main>
  );
}
