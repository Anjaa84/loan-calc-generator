// The builder canvas groups fields the same way the public page shows them:
//   inputs  – what the customer fills in
//   results – what the customer sees (big/highlighted results first)
//   hidden  – fixed numbers kept behind the scenes (e.g. a rate)
// Field array order only affects display (evaluation is topological).

import type { Field } from "./types";

export type Zone = "inputs" | "results" | "hidden";

export function zoneOf(f: Field): Zone {
  if (f.kind === "input") return "inputs";
  if (f.kind === "constant" && f.hidden) return "hidden";
  return "results";
}

/** Fields per zone, in display order (results: highlighted first, like the public page). */
export function zonesOf(fields: Field[]): Record<Zone, Field[]> {
  const z: Record<Zone, Field[]> = { inputs: [], results: [], hidden: [] };
  for (const f of fields) z[zoneOf(f)].push(f);
  z.results = [...z.results.filter((f) => f.highlight), ...z.results.filter((f) => !f.highlight)];
  return z;
}

/** Replace one zone's order and rebuild the field array as inputs, results, hidden. */
export function withZoneOrder(fields: Field[], zone: Zone, ordered: Field[]): Field[] {
  const z = zonesOf(fields);
  z[zone] = ordered;
  return [...z.inputs, ...z.results, ...z.hidden];
}

/** Move a field within its zone from one display index to another. */
export function reorderZone(fields: Field[], zone: Zone, from: number, to: number): Field[] {
  const list = [...zonesOf(fields)[zone]];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return fields;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return withZoneOrder(fields, zone, list);
}

/** Insert a new field into a zone at a display index (end when index is omitted). */
export function insertIntoZone(fields: Field[], field: Field, index?: number): Field[] {
  const zone = zoneOf(field);
  const list = [...zonesOf(fields)[zone]];
  list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, field);
  return withZoneOrder(fields, zone, list);
}
