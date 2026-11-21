"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/auth";
import { db, SlugTakenError } from "@/lib/db";
import { CalculatorInputZ, validateSchema } from "@/lib/schema/validate";
import type { CalcSchema } from "@/lib/schema/types";

async function requireAdmin() {
  const jar = await cookies();
  if (!(await verifySessionToken(jar.get(SESSION_COOKIE)?.value))) throw new Error("Not signed in");
}

export async function login(_: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const password = String(form.get("password") ?? "");
  if (!(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return { error: "Wrong password" };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  // Only allow redirects back into the admin area (no open redirects).
  const next = String(form.get("next") ?? "");
  redirect(/^\/admin(\/[\w/-]*)?$/.test(next) ? next : "/admin");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/admin/login");
}

export type SaveResult = { ok: true; id: string; slug: string } | { ok: false; errors: string[] };

export async function saveCalculator(input: unknown): Promise<SaveResult> {
  await requireAdmin();
  const parsed = CalculatorInputZ.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const problems = validateSchema(parsed.data.schema);
  if (problems.length) return { ok: false, errors: problems };

  const store = db();
  const previous = parsed.data.id ? await store.getById(parsed.data.id) : null;
  if (parsed.data.id && !previous) return { ok: false, errors: ["This calculator no longer exists"] };
  try {
    const rec = await store.save({ ...parsed.data, schema: parsed.data.schema as CalcSchema });
    revalidatePath("/");
    revalidatePath(`/c/${rec.slug}`);
    if (previous && previous.slug !== rec.slug) revalidatePath(`/c/${previous.slug}`);
    return { ok: true, id: rec.id, slug: rec.slug };
  } catch (err) {
    if (err instanceof SlugTakenError) return { ok: false, errors: [err.message] };
    throw err;
  }
}

export async function deleteCalculator(id: string) {
  await requireAdmin();
  const rec = await db().getById(id);
  await db().remove(id);
  revalidatePath("/");
  revalidatePath("/admin");
  if (rec) revalidatePath(`/c/${rec.slug}`);
}

/** Suggest a free link name for a title, e.g. "hp-loan-2". */
export async function suggestSlug(base: string, exceptId?: string): Promise<string> {
  await requireAdmin();
  const store = db();
  let slug = base;
  for (let i = 2; await store.slugExists(slug, exceptId); i++) slug = `${base}-${i}`;
  return slug;
}
