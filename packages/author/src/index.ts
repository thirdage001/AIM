// @aim/author — the Author conformance level (§3.3–3.5). Turns natural language
// into a DRAFT manifest using a language model guided by the aim.authoring
// skill, then enforces the hard authoring guards. This is the only
// non-deterministic stage of the upper half; it never crosses the trust
// boundary — its output is always lifecycle.mode = "draft".

import {
  AimError,
  AIM_ERROR_CODES,
  assertValidDraft,
  buildGraph,
  topologicalSort,
  type DraftManifest,
  type Json,
  type ModelProvider,
  type OpenQuestion
} from "@aim/core";

export interface AuthorRequest {
  text: string; // the (possibly transcribed) natural-language intent
  // prior conversation turns from the clarification loop, oldest first
  clarifications?: Array<{ q: string; a: string }>;
}

export interface AuthorOptions {
  model: ModelProvider;
  // the aim.authoring skill content, used as the system prompt (§3.5)
  authoringSystemPrompt: string;
  // generate the manifest id (tool-side; the author must not invent provenance)
  idGen?: () => string;
}

function buildUserPrompt(req: AuthorRequest): string {
  const parts = [`Intent (natural language):\n${req.text}`];
  if (req.clarifications && req.clarifications.length > 0) {
    parts.push(
      "Answers to earlier open questions:\n" +
        req.clarifications.map((c) => `- Q: ${c.q}\n  A: ${c.a}`).join("\n")
    );
  }
  parts.push("Produce ONLY the draft manifest JSON, nothing else.");
  return parts.join("\n\n");
}

/**
 * Hard authoring guards (§3.3, §3.5):
 *   - lifecycle.mode MUST be "draft"            → AIM-E-4001
 *   - skill refs MUST NOT carry resolver fields → AIM-E-4002
 *     (resolved / hash / scopes / anchor)
 *   - tool-generated fields (provenance) MUST be absent.
 */
export function enforceAuthoringGuards(value: unknown): asserts value is DraftManifest {
  if (!value || typeof value !== "object") {
    throw new AimError(AIM_ERROR_CODES.SCHEMA_INVALID, "authoring output is not an object");
  }
  const m = value as Record<string, unknown>;

  const lifecycle = m.lifecycle as { mode?: string } | undefined;
  if (lifecycle?.mode && lifecycle.mode !== "draft") {
    throw new AimError(
      AIM_ERROR_CODES.AUTHOR_LIFECYCLE_TOO_HIGH,
      `authoring set lifecycle.mode='${lifecycle.mode}' (only 'draft' is allowed)`
    );
  }

  const skills = (m.skills as Array<Record<string, unknown>>) ?? [];
  for (const s of skills) {
    for (const forbidden of ["resolved", "hash", "scopes", "anchor"] as const) {
      if (s[forbidden] !== undefined) {
        throw new AimError(
          AIM_ERROR_CODES.AUTHOR_SET_RESOLVER_FIELDS,
          `authoring set resolver-owned field '${forbidden}' on skill '${String(s.ref)}'`
        );
      }
    }
  }

  if (m.provenance !== undefined) {
    throw new AimError(
      AIM_ERROR_CODES.AUTHOR_SET_RESOLVER_FIELDS,
      "authoring set tool-generated field 'provenance'"
    );
  }
}

function parseModelJson(value: Json): unknown {
  if (typeof value === "string") {
    // tolerate a fenced or bare JSON string
    const trimmed = value.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    return JSON.parse(trimmed);
  }
  return value;
}

/** Generate a draft manifest from natural language (§3.3). */
export async function author(req: AuthorRequest, opts: AuthorOptions): Promise<DraftManifest> {
  const { value } = await opts.model.generate({
    system: opts.authoringSystemPrompt,
    prompt: buildUserPrompt(req),
    output: { format: "json" },
    model: { provider: "authoring", name: "authoring" }
  });

  const parsed = parseModelJson(value);
  enforceAuthoringGuards(parsed);

  const draft = parsed as DraftManifest;
  // ensure mode is draft even if the model omitted it
  draft.lifecycle = { mode: "draft" };
  if (opts.idGen && (!draft.id || draft.id === "")) {
    draft.id = opts.idGen();
  }

  // The draft must be schema-valid (against the authoring profile, which allows
  // provisional ids) and its data-flow graph must parse and be acyclic so it can
  // enter the clarification loop. We check the DAG directly rather than via the
  // full manifest gate, since drafts predate the tool-generated id/provenance.
  assertValidDraft(draft);
  topologicalSort(buildGraph(draft.plan)); // throws AIM-E-1002/1003 on a bad graph
  return draft;
}

/** Open questions that currently block execution (§3.4, §11 G2-3). */
export function blockingQuestions(draft: DraftManifest): OpenQuestion[] {
  return (draft.uncertainty?.openQuestions ?? []).filter((q) => q.blocksExecution);
}

/** True when the draft has no blocking question and can leave the loop (§3.4). */
export function isClarified(draft: DraftManifest): boolean {
  return blockingQuestions(draft).length === 0;
}

/**
 * Clarification loop step (§3.4): given the previous draft and the human's
 * answers, regenerate an updated draft. Each call yields a new manifest version
 * (the host hashes/diffs it).
 */
export async function reviseDraft(
  originalText: string,
  answers: Array<{ q: string; a: string }>,
  opts: AuthorOptions
): Promise<DraftManifest> {
  return author({ text: originalText, clarifications: answers }, opts);
}
