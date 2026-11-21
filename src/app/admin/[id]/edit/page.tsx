import { notFound } from "next/navigation";
import { Builder } from "@/components/builder/Builder";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const calc = await db().getById(id);
  if (!calc) notFound();
  const { created_at: _c, updated_at: _u, ...draft } = calc;
  void _c;
  void _u;
  return <Builder initial={draft} />;
}
