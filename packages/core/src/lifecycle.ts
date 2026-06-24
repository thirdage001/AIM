// Lifecycle state machine (§11) and pre-execution gates (§10.1).
//   draft ──[G1]──▶ reviewable ──[G2]──▶ executable

import { AimError, AIM_ERROR_CODES, type AimErrorDetail } from "./errors.js";
import { buildGraph, topologicalSort } from "./graph.js";
import { assertLock } from "./lock.js";
import { validateManifestSchema } from "./validate/index.js";
import type { AimLock, Manifest } from "./model.js";
import type { CryptoPort, ReviewGate } from "./ports.js";

const ID_RE = /^mf_[a-z0-9]+$/;

export interface GateResult {
  ok: boolean;
  errors: Array<AimErrorDetail & { code: string }>;
}

// — §10.1 pre-execution gates —

/** schema gate (§10.1.1) → AIM-E-1001 */
function schemaGate(manifest: unknown): GateResult {
  const r = validateManifestSchema(manifest);
  return {
    ok: r.valid,
    errors: r.errors.map((e) => ({ ...e, code: AIM_ERROR_CODES.SCHEMA_INVALID }))
  };
}

/** bindings gate (§10.1.2): all bindings parse + DAG acyclic → AIM-E-1003 / AIM-E-1002 */
function bindingsGate(manifest: Manifest): GateResult {
  try {
    topologicalSort(buildGraph(manifest.plan));
    return { ok: true, errors: [] };
  } catch (e) {
    if (e instanceof AimError) {
      return { ok: false, errors: [{ code: e.code, message: e.message }] };
    }
    throw e;
  }
}

/** idFormat gate (§10.1.3): id values match their format pattern → AIM-E-1001 */
function idFormatGate(manifest: Manifest): GateResult {
  const errors: GateResult["errors"] = [];
  if (!ID_RE.test(manifest.id)) {
    errors.push({ code: AIM_ERROR_CODES.SCHEMA_INVALID, path: "id", message: `id '${manifest.id}' does not match ^mf_[a-z0-9]+$` });
  }
  return { ok: errors.length === 0, errors };
}

/** Combined pre-gates (schema, bindings, idFormat). Locks gate is checked in G2. */
export function preGates(manifest: unknown): GateResult {
  const s = schemaGate(manifest);
  if (!s.ok) return s;
  const m = manifest as Manifest;
  const b = bindingsGate(m);
  const i = idFormatGate(m);
  const errors = [...b.errors, ...i.errors];
  return { ok: errors.length === 0, errors };
}

// — §11 G1: draft → reviewable —

/** G1: schema valid, bindings parse, DAG acyclic. */
export function gateG1(manifest: unknown): GateResult {
  const s = schemaGate(manifest);
  if (!s.ok) return s;
  return bindingsGate(manifest as Manifest);
}

export function assertG1(manifest: unknown): asserts manifest is Manifest {
  const r = gateG1(manifest);
  if (!r.ok) {
    const first = r.errors[0]!;
    throw new AimError(first.code as never, first.message, r.errors);
  }
}

// — §11 G2: reviewable → executable —

export interface G2Input {
  crypto: CryptoPort;
  lock: AimLock | null;
  liveHashes?: Record<string, string>;
  grantedApprovals?: Set<string>; // step ids whose approval:required is granted
  review: ReviewGate;
  rendered: string; // human-readable rendering of the manifest (§5.2)
  diff?: string; // diff against a prior version, if any
}

/**
 * Run G2 and, on success, return the manifest with `lifecycle.mode:"executable"`.
 * Checks (all must hold, §11):
 *   1. all pre-gates green
 *   2. all skills resolved/locked/hash-verified; trust anchor present (§7.5)
 *   3. no open question with blocksExecution:true     → AIM-E-1005
 *   4. every write step has idempotencyKey            → AIM-E-1004
 *   5. all approval:required steps granted            → AIM-E-1006
 *   6. human review confirmed                          (mandatory, §11)
 */
export async function gateG2(manifest: Manifest, input: G2Input): Promise<Manifest> {
  // 1. pre-gates
  const pre = preGates(manifest);
  if (!pre.ok) {
    const first = pre.errors[0]!;
    throw new AimError(first.code as never, first.message, pre.errors);
  }

  // 2. skills resolved, locked, hash-verified; anchors present
  for (const skill of manifest.skills ?? []) {
    if (!skill.anchor) {
      throw new AimError(AIM_ERROR_CODES.ANCHOR_INVALID, `skill '${skill.ref}' has no trust anchor (§7.5)`);
    }
  }
  assertLock(manifest, input.lock, input.liveHashes); // AIM-E-2005

  // 3. blocking open questions
  const blocking = (manifest.uncertainty?.openQuestions ?? []).filter((q) => q.blocksExecution);
  if (blocking.length > 0) {
    throw new AimError(
      AIM_ERROR_CODES.BLOCKING_OPEN_QUESTION,
      `manifest has ${blocking.length} blocking open question(s)`,
      blocking.map((q) => ({ message: q.q }))
    );
  }

  // 4. write steps need an idempotency key
  for (const step of manifest.plan.steps) {
    if (step.effect === "write" && !step.idempotencyKey) {
      throw new AimError(AIM_ERROR_CODES.WRITE_WITHOUT_IDEMPOTENCY, `write step '${step.id}' lacks idempotencyKey`);
    }
  }

  // 5. approvals granted
  const granted = input.grantedApprovals ?? new Set<string>();
  for (const step of manifest.plan.steps) {
    if (step.approval === "required" && !granted.has(step.id)) {
      throw new AimError(AIM_ERROR_CODES.APPROVAL_MISSING, `approval not granted for step '${step.id}'`);
    }
  }

  // 6. human review (mandatory)
  const confirmed = await input.review.confirm({ manifestId: manifest.id, rendered: input.rendered, diff: input.diff });
  if (!confirmed) {
    throw new AimError(AIM_ERROR_CODES.APPROVAL_MISSING, "human review not confirmed (§11 G2-6)");
  }

  return { ...manifest, lifecycle: { mode: "executable" } };
}
