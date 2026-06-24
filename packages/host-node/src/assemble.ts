// Runtime assembly for Node: wire the reference adapter + ports into a callable
// runtime, and provide a couple of demo capability implementations so the §16
// example can actually run end-to-end.

import {
  execute,
  type ExecutionDeps,
  type ExecutionResult,
  type Json,
  type Manifest,
  type ModelProvider,
  type ResolvedSkill,
  type SchemaRegistry,
  type Step
} from "@aim/core";
import {
  ReferenceNodeAdapter,
  builtinTransforms,
  combineTransforms,
  type CapabilityInvoker,
  type TransformRegistry
} from "@aim/adapter-reference";
import {
  autoApprovalGate,
  autoReviewGate,
  InMemoryIdempotencyStore
} from "./ports.js";
import type { ApprovalGate, AuditSink, IdempotencyStore } from "@aim/core";

/** Build the ref → ResolvedSkill map the engine needs from a locked manifest. */
export function resolvedSkillsFromManifest(manifest: Manifest): Map<string, ResolvedSkill> {
  const map = new Map<string, ResolvedSkill>();
  for (const s of manifest.skills ?? []) {
    map.set(s.ref, {
      ref: s.ref,
      trust: s.trust,
      resolved: s.resolved ?? "0.0.0",
      hash: s.hash ?? ""
    });
  }
  return map;
}

/** A capability invoker backed by a ref → handler registry. */
export function createCapabilityRegistry(
  handlers: Record<string, (input: Json, step: Step) => Json | Promise<Json>>
): CapabilityInvoker {
  return {
    async invoke(skill, step, input) {
      const fn = handlers[skill.ref] ?? handlers[step.uses];
      if (!fn) throw new Error(`no capability handler registered for '${skill.ref}'`);
      return fn(input, step);
    }
  };
}

/**
 * Demo in-memory record store implementing store.upsert / store.delete, so the
 * invoice example runs without external systems. Returns the registry of
 * handlers plus the underlying map for assertions.
 */
export function inMemoryStoreCapabilities(): {
  handlers: Record<string, (input: Json) => Json>;
  records: Map<string, Json>;
} {
  const records = new Map<string, Json>();
  const handlers: Record<string, (input: Json) => Json> = {
    "capability.store.upsert": (input) => {
      const obj = (input ?? {}) as Record<string, Json>;
      const rec = obj.record as Record<string, Json> | undefined;
      const key = String((rec?.invoiceNo as Json) ?? JSON.stringify(rec ?? null));
      records.set(key, rec ?? null);
      return { id: key, stored: true };
    },
    "capability.store.delete": (input) => {
      const obj = (input ?? {}) as Record<string, Json>;
      const key = String((obj.invoiceNo as Json) ?? (obj.id as Json) ?? "");
      const existed = records.delete(key);
      return { id: key, deleted: existed };
    }
  };
  return { handlers, records };
}

/** Context provider: resolves `input:<name>` to JSON text; skills to "". */
export function inputContextProvider(inputs: Record<string, Json>): (sel: string) => Promise<string> {
  return async (sel: string) => {
    if (sel.startsWith("input:")) {
      const name = sel.slice("input:".length);
      return JSON.stringify(inputs[name] ?? null);
    }
    return "";
  };
}

export interface RunOptions {
  model: ModelProvider;
  capability: CapabilityInvoker;
  transforms?: TransformRegistry;
  idempotency?: IdempotencyStore;
  approval?: ApprovalGate;
  audit?: AuditSink;
  schemaRegistry?: SchemaRegistry;
}

/** Assemble a reference-node runtime and execute an executable manifest. */
export async function runManifest(
  manifest: Manifest,
  inputs: Record<string, Json>,
  opts: RunOptions
): Promise<ExecutionResult> {
  const adapter = new ReferenceNodeAdapter({
    model: opts.model,
    capability: opts.capability,
    transforms: combineTransforms(opts.transforms ?? { get: () => undefined }, builtinTransforms()),
    ...(manifest.plan.runtime?.model ? { modelRef: manifest.plan.runtime.model } : {})
  });

  const deps: ExecutionDeps = {
    adapter,
    resolvedSkills: resolvedSkillsFromManifest(manifest),
    idempotency: opts.idempotency ?? new InMemoryIdempotencyStore(),
    approval: opts.approval ?? autoApprovalGate,
    contextProvider: inputContextProvider(inputs),
    ...(opts.audit ? { audit: opts.audit } : {}),
    ...(opts.schemaRegistry ? { schemaRegistry: opts.schemaRegistry } : {})
  };
  return execute(manifest, inputs, deps);
}

export { autoApprovalGate, autoReviewGate };
