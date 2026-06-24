// Lock verification (§12.4). Before execution the runtime checks, for every
// skill: manifest.hash == lock.hash (== live source hash, when available).
// Any divergence is AIM-E-2005.

import { AimError, AIM_ERROR_CODES, type AimErrorDetail } from "./errors.js";
import type { AimLock, Manifest } from "./model.js";

export interface LockCheckResult {
  ok: boolean;
  errors: AimErrorDetail[];
}

/**
 * Verify the manifest's skills against the lock. `liveHashes` (optional, ref ->
 * `sha256:…`) lets the caller also assert the live source still matches the lock
 * (drift detection). Missing live hashes skip only the live comparison.
 */
export function checkLock(
  manifest: Manifest,
  lock: AimLock | null,
  liveHashes?: Record<string, string>
): LockCheckResult {
  const errors: AimErrorDetail[] = [];
  const skills = manifest.skills ?? [];

  if (skills.length > 0 && !lock) {
    errors.push({ message: "no aim.lock present but manifest declares skills" });
    return { ok: false, errors };
  }

  for (const skill of skills) {
    if (!skill.hash || !skill.resolved) {
      errors.push({ path: skill.ref, message: `skill '${skill.ref}' is not resolved/locked` });
      continue;
    }
    const entry = lock?.skills[skill.ref];
    if (!entry) {
      errors.push({ path: skill.ref, message: `skill '${skill.ref}' missing from lock` });
      continue;
    }
    if (entry.hash !== skill.hash) {
      errors.push({ path: skill.ref, message: `manifest hash != lock hash for '${skill.ref}'` });
    }
    const live = liveHashes?.[skill.ref];
    if (live !== undefined && live !== entry.hash) {
      errors.push({ path: skill.ref, message: `live source hash != lock hash for '${skill.ref}' (drift)` });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Assert lock integrity, throwing AIM-E-2005 on any mismatch. */
export function assertLock(
  manifest: Manifest,
  lock: AimLock | null,
  liveHashes?: Record<string, string>
): void {
  const r = checkLock(manifest, lock, liveHashes);
  if (!r.ok) {
    throw new AimError(AIM_ERROR_CODES.HASH_MISMATCH, "lock verification failed", r.errors);
  }
}
