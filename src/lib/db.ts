import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CalculatorDraft, CalculatorRecord } from "./schema/types";

// Storage: Supabase when SUPABASE_URL is set, otherwise a local JSON file
// (handy for development; Vercel's filesystem is read-only, so production needs Supabase).

export class SlugTakenError extends Error {}

type Store = {
  list(opts?: { publishedOnly?: boolean }): Promise<CalculatorRecord[]>;
  getBySlug(slug: string): Promise<CalculatorRecord | null>;
  getById(id: string): Promise<CalculatorRecord | null>;
  slugExists(slug: string, exceptId?: string): Promise<boolean>;
  save(draft: CalculatorDraft): Promise<CalculatorRecord>;
  remove(id: string): Promise<void>;
};

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set");
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

const COLS = "id, slug, title, description, currency, schema, source_filename, published, created_at, updated_at";

const supabaseStore: Store = {
  async list({ publishedOnly } = {}) {
    let q = supabase().from("calculators").select(COLS).order("updated_at", { ascending: false });
    if (publishedOnly) q = q.eq("published", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as CalculatorRecord[];
  },
  async getBySlug(slug) {
    const { data, error } = await supabase().from("calculators").select(COLS).eq("slug", slug).maybeSingle();
    if (error) throw new Error(error.message);
    return data as CalculatorRecord | null;
  },
  async getById(id) {
    const { data, error } = await supabase().from("calculators").select(COLS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as CalculatorRecord | null;
  },
  async slugExists(slug, exceptId) {
    let q = supabase().from("calculators").select("id").eq("slug", slug);
    if (exceptId) q = q.neq("id", exceptId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  },
  async save(draft) {
    const { id, ...row } = draft;
    const q = id
      ? supabase().from("calculators").update(row).eq("id", id).select(COLS).single()
      : supabase().from("calculators").insert(row).select(COLS).single();
    const { data, error } = await q;
    if (error) {
      if (error.code === "23505") throw new SlugTakenError("That link name is already used by another calculator");
      throw new Error(error.message);
    }
    return data as CalculatorRecord;
  },
  async remove(id) {
    const { error } = await supabase().from("calculators").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

// ---- local file store (dev only) ----
const FILE = path.join(process.cwd(), ".data", "calculators.json");
async function readAll(): Promise<CalculatorRecord[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return [];
  }
}
async function writeAll(rows: CalculatorRecord[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows, null, 2));
}
const fileStore: Store = {
  async list({ publishedOnly } = {}) {
    const rows = await readAll();
    return rows
      .filter((r) => !publishedOnly || r.published)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async getBySlug(slug) {
    return (await readAll()).find((r) => r.slug === slug) ?? null;
  },
  async getById(id) {
    return (await readAll()).find((r) => r.id === id) ?? null;
  },
  async slugExists(slug, exceptId) {
    return (await readAll()).some((r) => r.slug === slug && r.id !== exceptId);
  },
  async save(draft) {
    const rows = await readAll();
    if (rows.some((r) => r.slug === draft.slug && r.id !== draft.id)) {
      throw new SlugTakenError("That link name is already used by another calculator");
    }
    const now = new Date().toISOString();
    const i = draft.id ? rows.findIndex((r) => r.id === draft.id) : -1;
    if (draft.id && i === -1) throw new Error("Calculator not found");
    const rec: CalculatorRecord =
      i >= 0
        ? { ...rows[i], ...draft, id: rows[i].id, updated_at: now }
        : { ...draft, id: crypto.randomUUID(), created_at: now, updated_at: now };
    if (i >= 0) rows[i] = rec;
    else rows.push(rec);
    await writeAll(rows);
    return rec;
  },
  async remove(id) {
    await writeAll((await readAll()).filter((r) => r.id !== id));
  },
};

export const usingSupabase = () => !!process.env.SUPABASE_URL;
export const db = (): Store => (usingSupabase() ? supabaseStore : fileStore);
