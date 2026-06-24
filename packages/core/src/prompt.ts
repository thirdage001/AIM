// Prompt Composer (§9.6 / §9.7). Turns a semantic Prompt object plus the
// selected context into the final prompt text, DETERMINISTICALLY and in the
// normative order. `rules` are copied verbatim — never reworded or summarized.

import type { ContextSpec, Prompt } from "./model.js";

export interface ComposedContext {
  system: string;
  prompt: string;
}

// Resolved context content keyed by its selector (a skill ref or `input:<name>`).
// The runtime produces this map; the composer only orders and renders it.
export type ContextTexts = Record<string, string>;

/**
 * Apply the §6.4 selection rule (include/exclude) to a step's `contextFrom`
 * selectors. The manifest `context` narrows what may be pulled; `contextFrom`
 * lists what this step pulls. Returns the selectors to include, in stable order.
 */
export function selectContext(
  contextFrom: string[] | undefined,
  spec: ContextSpec | undefined
): string[] {
  const from = contextFrom ?? [];
  if (!spec) return from;
  const includeSet = spec.include ? new Set(spec.include) : null;
  const excludeSet = spec.exclude ? new Set(spec.exclude) : new Set<string>();
  return from.filter((sel) => {
    if (excludeSet.has(sel)) return false;
    // `include` selectors use `skill:<ref>#<section>` / `input:<name>` forms;
    // when present they act as an allow-list scoped by prefix match on the ref.
    if (includeSet) {
      const allowed = [...includeSet].some(
        (inc) => inc === sel || inc.startsWith(`skill:${sel}`) || inc === `input:${sel}` || inc.startsWith(`${sel}#`)
      );
      return allowed || includeSet.has(sel);
    }
    return true;
  });
}

/**
 * Compose the final prompt text. Order (normative, §9.7):
 *   1. role            → system role
 *   2. goal            → task
 *   3. contextFrom     → selected context
 *   4. rules           → verbatim hard rules
 *   5. output          → output contract (format + schema)
 *   6. onMissingData   → error behavior
 *
 * Deterministic in its inputs: same prompt spec + same selected context ⇒ same
 * text. Only the model's *response* is non-deterministic.
 */
export function composePrompt(
  prompt: Prompt,
  selectedContext: string[],
  contextTexts: ContextTexts
): ComposedContext {
  // 1. role (+ style) → system
  const systemLines: string[] = [`Role: ${prompt.role}`];
  if (prompt.style) systemLines.push(`Style: ${prompt.style}`);
  const system = systemLines.join("\n");

  const body: string[] = [];
  // 2. goal
  body.push(`Goal:\n${prompt.goal}`);
  // 3. context (only selectors that survived §6.4 selection)
  if (selectedContext.length > 0) {
    const ctxBlocks = selectedContext.map((sel) => {
      const text = contextTexts[sel] ?? "";
      return `--- context: ${sel} ---\n${text}`;
    });
    body.push(`Context:\n${ctxBlocks.join("\n\n")}`);
  }
  // 4. rules — verbatim
  if (prompt.rules && prompt.rules.length > 0) {
    body.push(`Rules:\n${prompt.rules.map((r) => `- ${r}`).join("\n")}`);
  }
  // 5. output contract
  const outParts = [`format=${prompt.output.format}`];
  if (prompt.output.schema) outParts.push(`schema=${prompt.output.schema}`);
  body.push(`Output contract: ${outParts.join(", ")}`);
  // 6. onMissingData
  if (prompt.onMissingData) {
    body.push(`On missing data: ${prompt.onMissingData}`);
  }

  return { system, prompt: body.join("\n\n") };
}
