// Schema validation (§10.1 schema gate, §15). Wraps the generated eval-free
// validators and reports AIM-E-1001 on failure with structured details.

import { AimError, AIM_ERROR_CODES, type AimErrorDetail } from "../errors.js";
import type { Manifest, DraftManifest } from "../model.js";
import { validateManifest, validateDraft } from "./generated/validate-manifest.mjs";

export interface ValidationResult {
  valid: boolean;
  errors: AimErrorDetail[];
}

function collect(
  fn: { (data: unknown): boolean; errors?: unknown }
): AimErrorDetail[] {
  const raw = (fn.errors ?? []) as Array<{ instancePath: string; message?: string }>;
  return raw.map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? "schema violation"
  }));
}

/** Validate a full manifest against the §15 schema. */
export function validateManifestSchema(data: unknown): ValidationResult {
  const valid = validateManifest(data);
  return { valid, errors: valid ? [] : collect(validateManifest) };
}

/** Validate a draft manifest against the authoring profile (§3.3). */
export function validateDraftSchema(data: unknown): ValidationResult {
  const valid = validateDraft(data);
  return { valid, errors: valid ? [] : collect(validateDraft) };
}

/** Assert manifest validity, throwing AIM-E-1001 on failure. */
export function assertValidManifest(data: unknown): asserts data is Manifest {
  const r = validateManifestSchema(data);
  if (!r.valid) {
    throw new AimError(
      AIM_ERROR_CODES.SCHEMA_INVALID,
      "Manifest is not valid against the AIM 1.0 schema",
      r.errors
    );
  }
}

/** Assert draft validity, throwing AIM-E-1001 on failure. */
export function assertValidDraft(data: unknown): asserts data is DraftManifest {
  const r = validateDraftSchema(data);
  if (!r.valid) {
    throw new AimError(
      AIM_ERROR_CODES.SCHEMA_INVALID,
      "Draft manifest is not valid against the AIM 1.0 draft profile",
      r.errors
    );
  }
}
