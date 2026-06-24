// @aim/core — the portable AIM 1.0 kernel. Zero runtime dependencies,
// Web-Standard APIs only (runs on Node, Deno/Supabase Edge, Cloudflare Workers).

// model & errors
export * from "./model.js";
export * from "./errors.js";
export * from "./ports.js";

// §4 canonicalization & hashing
export { canonicalize, canonicalBytes, serializeNumber } from "./canonicalize.js";
export {
  sha256Hex,
  hashCanonical,
  computeManifestHash,
  verifyManifestHash,
  computeSkillHash,
  isValidHash
} from "./hash.js";

// §10 / §15 schema validation
export {
  validateManifestSchema,
  validateDraftSchema,
  assertValidManifest,
  assertValidDraft,
  type ValidationResult
} from "./validate/index.js";

// §8 bindings
export {
  isBinding,
  parseBinding,
  resolveExpr,
  stepDependencies,
  transformNames,
  skillRefs,
  type Expr,
  type PathSeg,
  type ResolveContext
} from "./bindings.js";

// §8.3 / §9.2 graph
export { buildGraph, topologicalSort, planOrder, stepBindings, type PlanGraph } from "./graph.js";

// §9.6 / §9.7 prompt composer
export { composePrompt, selectContext, type ComposedContext, type ContextTexts } from "./prompt.js";

// §9.2 execution engine
export { execute, type ExecutionDeps, type ExecutionResult, type SchemaRegistry } from "./plan.js";

// §11 lifecycle + §10.1 gates
export {
  preGates,
  gateG1,
  assertG1,
  gateG2,
  type GateResult,
  type G2Input
} from "./lifecycle.js";

// §12.4 lock
export { checkLock, assertLock, type LockCheckResult } from "./lock.js";

// §7 skills
export {
  normalizeSkill,
  validateSkillBody,
  verifyAnchor,
  type TrustStore
} from "./skill.js";

// §5.2 readable surface
export { compile, render, expandShortBinding, contractBinding } from "./surface.js";

// §11 G2-6 diff
export { diff, renderDiff, type DiffEntry } from "./diff.js";
