// AIM 1.0 object model (§6–§9) and lock model (§12.4).
// Pure type declarations — no runtime code, no dependencies.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const AIM_VERSION = "1.0" as const;

// — §6.1 intent —
export type IntentSource = "natural-language" | "authored" | "imported";
export type AuthoredBy = "ai" | "human";
export interface Intent {
  text: string;
  source: IntentSource;
  authoredBy: AuthoredBy;
}

// — §6.2 inputs —
export type InputType = "string" | "number" | "boolean" | "object" | "array" | "file";
export interface InputDecl {
  type: InputType;
  required: boolean;
  description?: string;
}

// — §7 skill reference —
export type Trust = "knowledge" | "capability" | "transform";
export type Anchor = "pinned-hash" | "signature";
export type Approval = "none" | "required";
export interface SkillRef {
  ref: string;
  trust: Trust;
  constraint: string;
  need?: string;
  // resolver-owned (set from §12, never by the author §3.3):
  resolved?: string;
  hash?: string;
  scopes?: string[];
  approval?: Approval;
  anchor?: Anchor;
}

// — §7.4 normalized skill body (the thing that gets hashed) —
export interface SkillBody {
  aim: "1.0";
  kind: "Skill";
  name: string;
  version: string;
  trust: Trust;
  interface?: { inputSchema?: Json; outputSchema?: Json };
  scopes?: string[];
  rules?: string[];
}

// A skill resolved for execution (passed to the adapter, §13.2).
export interface ResolvedSkill {
  ref: string;
  trust: Trust;
  resolved: string;
  hash: string;
  body?: SkillBody;
  source?: string;
  server?: McpServerRef;
}

// — §6.4 context —
export type ContextStrategy = "full" | "minimal-relevant";
export interface ContextSpec {
  strategy: ContextStrategy;
  include?: string[];
  exclude?: string[];
}

// — §9.6 prompt object model —
export type PromptStyle = "strict" | "concise" | "explanatory";
export type OutputFormat = "json" | "text";
export type OnMissingData = "return_validation_error" | "proceed_with_nulls";
export interface PromptOutput {
  format: OutputFormat;
  schema?: string;
}
export interface Prompt {
  role: string;
  goal: string;
  style?: PromptStyle;
  rules?: string[];
  contextFrom?: string[];
  output: PromptOutput;
  onMissingData?: OnMissingData;
}

// — §9.1 step —
export type StepType = "model" | "capability" | "transform";
export type Effect = "read" | "write";
export interface Step {
  id: string;
  type: StepType;
  uses: string;
  prompt?: Prompt;
  input?: JsonObject;
  output?: { schema?: string };
  effect?: Effect;
  idempotencyKey?: string;
  approval?: Approval;
  compensation?: string;
  condition?: string;
  dependsOn?: string[];
}

// — §6.5 / §13.1 plan & runtime —
export interface ModelRef {
  provider: string;
  name: string;
}
export interface RuntimeRef {
  adapter?: string;
  model?: ModelRef;
  streaming?: boolean;
}
export interface Plan {
  runtime?: RuntimeRef;
  steps: Step[];
}

// — §6.6 policy —
export interface Policy {
  knowledge?: { requireIntegrity?: boolean; autoLoad?: boolean };
  capability?: { requireIntegrity?: boolean; requireAuthorization?: boolean };
  write?: { requireApproval?: boolean; requireIdempotency?: boolean };
  audit?: { logEveryCapabilityCall?: boolean };
}

// Restrictive defaults per §6.6 (used when `policy` is absent).
export const DEFAULT_POLICY: Required<{
  knowledge: { requireIntegrity: boolean; autoLoad: boolean };
  capability: { requireIntegrity: boolean; requireAuthorization: boolean };
  write: { requireApproval: boolean; requireIdempotency: boolean };
  audit: { logEveryCapabilityCall: boolean };
}> = {
  knowledge: { requireIntegrity: true, autoLoad: false },
  capability: { requireIntegrity: true, requireAuthorization: true },
  write: { requireApproval: true, requireIdempotency: true },
  audit: { logEveryCapabilityCall: true }
};

// — §6.7 evaluation —
export type OnFailure = "compensate" | "halt" | "return_error";
export interface Evaluation {
  pre?: { schema?: boolean; bindings?: boolean; idFormat?: boolean; locks?: boolean };
  post?: { idExistence?: boolean; onFailure?: OnFailure };
}

// — §6.8 lifecycle —
export type LifecycleMode = "draft" | "reviewable" | "executable";
export interface Lifecycle {
  mode: LifecycleMode;
}

// — §6.9 uncertainty —
export interface Assumption {
  text: string;
  confidence: number;
}
export interface OpenQuestion {
  q: string;
  blocksExecution: boolean;
}
export interface Uncertainty {
  assumptions?: Assumption[];
  openQuestions?: OpenQuestion[];
}

// — §6.10 provenance —
export interface Provenance {
  manifestHash: string;
  createdAt: string;
  lock: string;
}

// — §6 top-level manifest —
export interface Manifest {
  aim: "1.0";
  kind: "Manifest";
  id: string;
  intent: Intent;
  inputs?: Record<string, InputDecl>;
  skills?: SkillRef[];
  context?: ContextSpec;
  plan: Plan;
  policy?: Policy;
  evaluation?: Evaluation;
  lifecycle: Lifecycle;
  uncertainty?: Uncertainty;
  provenance: Provenance;
}

// A draft manifest (§3.3): the tool-generated `provenance` is not yet present.
// Modeled as optional (rather than forbidden) so a full Manifest is also a
// valid DraftManifest for shared functions like render() and gateG1().
export type DraftManifest = Omit<Manifest, "provenance"> & {
  provenance?: Provenance;
};

// — §12.4 lock file —
export interface McpServerRef {
  transport: "stdio" | "http" | "sse";
  id: string;
}
export interface LockEntry {
  resolved: string;
  hash: string;
  source: string;
  anchor: Anchor;
  installedAt: string;
  server?: McpServerRef;
}
export interface AimLock {
  aimLock: "1.0";
  resolverStrategy: "highest-compatible";
  skills: Record<string, LockEntry>;
}
