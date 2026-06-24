// Skill normalization (§7.4) and trust-anchor checking (§7.5). The normalized
// body is the exact object that gets canonicalized and hashed (§4.4).

import { AimError, AIM_ERROR_CODES } from "./errors.js";
import { computeSkillHash } from "./hash.js";
import type { Anchor, Json, SkillBody, Trust } from "./model.js";
import type { CryptoPort } from "./ports.js";

/**
 * Normalize an arbitrary loaded skill into the §7.4 canonical body. Only the
 * normative fields survive; everything else is dropped so the hash is stable
 * regardless of source-specific extras.
 */
export function normalizeSkill(raw: Record<string, Json>): SkillBody {
  const name = raw.name;
  const version = raw.version;
  const trust = raw.trust;
  if (typeof name !== "string" || typeof version !== "string" || typeof trust !== "string") {
    throw new AimError(AIM_ERROR_CODES.SKILL_BODY_INVALID, "skill body missing name/version/trust");
  }
  if (trust !== "knowledge" && trust !== "capability" && trust !== "transform") {
    throw new AimError(AIM_ERROR_CODES.SKILL_BODY_INVALID, `invalid trust '${trust}'`);
  }
  const body: SkillBody = {
    aim: "1.0",
    kind: "Skill",
    name,
    version,
    trust: trust as Trust
  };
  const iface = raw.interface;
  if (iface && typeof iface === "object" && !Array.isArray(iface)) {
    const i = iface as Record<string, Json>;
    body.interface = {};
    if (i.inputSchema !== undefined) body.interface.inputSchema = i.inputSchema;
    if (i.outputSchema !== undefined) body.interface.outputSchema = i.outputSchema;
  }
  if (Array.isArray(raw.scopes)) body.scopes = raw.scopes.filter((s): s is string => typeof s === "string");
  if (Array.isArray(raw.rules)) body.rules = raw.rules.filter((r): r is string => typeof r === "string");
  return body;
}

/** Validate a normalized skill body (§12.2 validateSkill) → AIM-E-2004 on failure. */
export function validateSkillBody(body: SkillBody): void {
  if (body.aim !== "1.0" || body.kind !== "Skill") {
    throw new AimError(AIM_ERROR_CODES.SKILL_BODY_INVALID, "skill body has wrong aim/kind");
  }
  if (!body.name || !body.version) {
    throw new AimError(AIM_ERROR_CODES.SKILL_BODY_INVALID, "skill body missing name/version");
  }
}

export interface TrustStore {
  // Verify a detached signature over the normalized body. Out of Core scope; a
  // host provides a real implementation. Returns true if the signature is valid.
  verifySignature(body: SkillBody, source?: string): Promise<boolean>;
}

/**
 * §7.5: verify a trust anchor for a freshly loaded skill. Without a valid anchor
 * the skill must stay in quarantine (AIM-E-2003).
 *  - pinned-hash: computed hash must equal `pinnedHash`.
 *  - signature:   a configured TrustStore must verify the body.
 */
export async function verifyAnchor(
  crypto: CryptoPort,
  body: SkillBody,
  anchor: Anchor | undefined,
  opts: { pinnedHash?: string; source?: string; trustStore?: TrustStore } = {}
): Promise<void> {
  if (!anchor) {
    throw new AimError(AIM_ERROR_CODES.ANCHOR_INVALID, "no trust anchor present (skill stays in quarantine)");
  }
  if (anchor === "pinned-hash") {
    if (!opts.pinnedHash) {
      throw new AimError(AIM_ERROR_CODES.ANCHOR_INVALID, "pinned-hash anchor requires a configured pinned hash");
    }
    const actual = await computeSkillHash(crypto, body);
    if (actual !== opts.pinnedHash) {
      throw new AimError(AIM_ERROR_CODES.ANCHOR_INVALID, `pinned-hash mismatch: ${actual} != ${opts.pinnedHash}`);
    }
    return;
  }
  // signature
  if (!opts.trustStore) {
    throw new AimError(AIM_ERROR_CODES.ANCHOR_INVALID, "signature anchor requires a configured trust store");
  }
  const ok = await opts.trustStore.verifySignature(body, opts.source);
  if (!ok) {
    throw new AimError(AIM_ERROR_CODES.ANCHOR_INVALID, "signature verification failed");
  }
}
