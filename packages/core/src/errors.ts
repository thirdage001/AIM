// AIM error taxonomy (§14). A single error type carries a stable code so that
// adapters and hosts can map framework failures onto it (§13.4 rule 6).

export const AIM_ERROR_CODES = {
  // §10 / §11 pre-gates and lifecycle
  SCHEMA_INVALID: "AIM-E-1001", // manifest not valid against the JSON Schema
  PLAN_CYCLE: "AIM-E-1002", // plan contains a cycle
  BINDING_UNRESOLVED: "AIM-E-1003", // binding references an unknown target
  WRITE_WITHOUT_IDEMPOTENCY: "AIM-E-1004", // write step lacks idempotencyKey
  BLOCKING_OPEN_QUESTION: "AIM-E-1005", // blocking open question prevents executable
  APPROVAL_MISSING: "AIM-E-1006", // required approval missing
  // §12 resolve / lock
  NO_MATCHING_VERSION: "AIM-E-2001",
  VERSION_CONFLICT: "AIM-E-2002",
  ANCHOR_INVALID: "AIM-E-2003",
  SKILL_BODY_INVALID: "AIM-E-2004",
  HASH_MISMATCH: "AIM-E-2005", // lock vs source/manifest hash mismatch
  MCP_DRIFT: "AIM-E-2006", // MCP definition drifted since lock
  MCP_TOOL_GONE: "AIM-E-2007", // locked MCP tool no longer on server
  // §9 execution
  OUTPUT_SCHEMA_VIOLATION: "AIM-E-3001", // step output violates output.schema
  COMPENSATION_FAILED: "AIM-E-3002",
  // §3 authoring
  AUTHOR_LIFECYCLE_TOO_HIGH: "AIM-E-4001", // authoring set a mode above draft
  AUTHOR_SET_RESOLVER_FIELDS: "AIM-E-4002" // authoring set resolved/hash/scopes/anchor
} as const;

export type AimErrorCode = (typeof AIM_ERROR_CODES)[keyof typeof AIM_ERROR_CODES];

export interface AimErrorDetail {
  path?: string;
  message: string;
}

export class AimError extends Error {
  readonly code: AimErrorCode;
  readonly details: AimErrorDetail[];

  constructor(code: AimErrorCode, message: string, details: AimErrorDetail[] = []) {
    super(`[${code}] ${message}`);
    this.name = "AimError";
    this.code = code;
    this.details = details;
    // Restore prototype chain for transpiled targets.
    Object.setPrototypeOf(this, AimError.prototype);
  }

  /** Shape suitable for a StepResult.error (§13.2). */
  toStepError(): { code: string; message: string } {
    return { code: this.code, message: this.message };
  }
}

export function isAimError(e: unknown): e is AimError {
  return e instanceof AimError;
}
