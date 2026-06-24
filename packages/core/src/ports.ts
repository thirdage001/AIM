// Injected ports. Everything that touches the outside world (files, locks,
// crypto, time, randomness, idempotency, approval, model/capability calls) is
// an interface the host supplies. The kernel stays pure and runtime-neutral, so
// the same code runs on Node, Deno (Supabase Edge) and Cloudflare Workers.

import type { AimLock, Json, ResolvedSkill, Step } from "./model.js";
import type { ComposedContext } from "./prompt.js";

// — runtime adapter (§13.2) —

export type StepResult =
  | { output: Json; error: null }
  | { output: null; error: { code: string; message: string } };

export interface RuntimeAdapter {
  name: string;
  // true if this adapter can execute the manifest
  supports(manifest: import("./model.js").Manifest): boolean;
  // a model step: calls the language model with composed context (exactly ONE call)
  runModelStep(step: Step, context: ComposedContext, input: Json): Promise<StepResult>;
  // a capability step: performs the external action
  runCapabilityStep(step: Step, skill: ResolvedSkill, input: Json): Promise<StepResult>;
  // a transform step: pure, deterministic function
  runTransformStep(step: Step, skill: ResolvedSkill, args: Json[]): Promise<StepResult>;
}

// — infrastructure —

export interface FileStore {
  read(path: string): Promise<Uint8Array | null>;
  write?(path: string, data: Uint8Array): Promise<void>;
  list?(prefix: string): Promise<string[]>;
}

export interface LockStore {
  load(): Promise<AimLock | null>;
  save?(lock: AimLock): Promise<void>; // used by the Resolve level (§12)
}

export interface CryptoPort {
  // SHA-256 over raw bytes. Backed by Web Crypto on every target runtime.
  digestSha256(data: Uint8Array): Promise<Uint8Array>;
}

export interface Clock {
  now(): string; // RFC 3339 timestamp
}

export interface IdGen {
  manifestId(): string; // matches ^mf_[a-z0-9]+$
}

// — idempotency (§9.4) —

export interface IdempotencyKey {
  manifestId: string;
  stepId: string;
  value: string;
}

export interface IdempotencyStore {
  get(key: IdempotencyKey): Promise<{ output: Json } | null>;
  // Atomic claim: records the output for the key. Implementations should make
  // the (manifestId, stepId, value) triple unique.
  putIfAbsent(key: IdempotencyKey, output: Json): Promise<void>;
}

// — approval (§9.2, §11 G2-5) —

export interface ApprovalRequest {
  manifestId: string;
  stepId: string;
  skillRef: string;
  effect?: "read" | "write";
  renderedStep: string;
}
export type ApprovalDecision = { approved: true } | { approved: false; reason: string };

export interface ApprovalGate {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

// — human review gate (§11 G2-6) —

export interface ReviewRequest {
  manifestId: string;
  rendered: string; // human-readable rendering (§5.2)
  diff?: string; // manifest diff against a prior version, if any
}
export interface ReviewGate {
  confirm(req: ReviewRequest): Promise<boolean>;
}

// — model & capability execution (used by the reference adapter) —

// Keeps the Vercel AI SDK (or any framework) out of core/adapter. An
// implementation MUST perform exactly ONE model call — no tool loop (§13.3).
export interface ModelProvider {
  generate(req: {
    system: string;
    prompt: string;
    output: { format: "json" | "text"; schema?: Json };
    model: { provider: string; name: string };
  }): Promise<{ value: Json }>;
}

export interface CapabilityInvoker {
  invoke(skill: ResolvedSkill, step: Step, input: Json): Promise<Json>;
}

// — audit (§6.6) —
export interface AuditSink {
  log(event: { type: string; manifestId: string; stepId?: string; data?: Json }): void;
}
