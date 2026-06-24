// Manifest diff (§11 G2-6). A readable, structural diff between two manifests
// (or their canonical JSON), used by the review gate when a prior version
// exists. Field-level, deterministic, dependency-free.

import type { Json } from "./model.js";

export interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: Json;
  after?: Json;
}

/** Compute a flat, ordered list of field-level differences between two values. */
export function diff(before: Json, after: Json): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk("", before, after, out);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

function isObj(v: Json): v is { [k: string]: Json } {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function walk(path: string, before: Json | undefined, after: Json | undefined, out: DiffEntry[]): void {
  if (before === undefined && after !== undefined) {
    out.push({ path, kind: "added", after });
    return;
  }
  if (before !== undefined && after === undefined) {
    out.push({ path, kind: "removed", before });
    return;
  }
  if (before === undefined || after === undefined) return;

  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) walk(path ? `${path}.${k}` : k, before[k], after[k], out);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) walk(`${path}[${i}]`, before[i], after[i], out);
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({ path, kind: "changed", before, after });
  }
}

/** Render a diff as human-readable text for the review gate. */
export function renderDiff(entries: DiffEntry[]): string {
  if (entries.length === 0) return "(no changes)";
  return entries
    .map((e) => {
      switch (e.kind) {
        case "added":
          return `+ ${e.path} = ${JSON.stringify(e.after)}`;
        case "removed":
          return `- ${e.path} (was ${JSON.stringify(e.before)})`;
        case "changed":
          return `~ ${e.path}: ${JSON.stringify(e.before)} -> ${JSON.stringify(e.after)}`;
      }
    })
    .join("\n");
}
