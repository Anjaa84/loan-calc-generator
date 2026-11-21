/** "HP PRICE:" → "HP Price", "  down   payment " → "down payment". */
export function cleanLabel(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim().replace(/[:*]+$/, "").trim();
  if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) {
    // ALL CAPS → Title Case, but keep short acronyms like "HP" or "D/P".
    const keep = (w: string) => /^[A-Z]{1,2}$/.test(w) || /^[A-Z]+[/&.][A-Z/&.]*$/.test(w);
    s = s
      .split(" ")
      .map((w) => (keep(w) ? w : w[0] + w.slice(1).toLowerCase()))
      .join(" ");
  }
  return s;
}

export function slugify(s: string, max = 40): string {
  const slug = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/, "");
  return /^[a-z]/.test(slug) ? slug : `f_${slug || "field"}`.slice(0, max);
}

/** A field id derived from a label, unique within `used` (which is updated). */
export function uniqueId(label: string, used: Set<string>): string {
  const base = slugify(label);
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
  used.add(id);
  return id;
}

/** URL slug for a calculator: "CAL Loan Calculator" → "cal-loan-calculator". */
export function toUrlSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, " ")
      .trim()
      .replace(/[\s-]+/g, "-")
      .slice(0, 60)
      .replace(/-+$/, "") || "calculator"
  );
}
