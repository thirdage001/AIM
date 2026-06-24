// Skill resolver (§12.2) and lock generation (§12.4). Implements the single
// permitted strategy "highest-compatible". Quarantine → anchor → normalize →
// hash → validate, exactly as §12.2 prescribes.

import {
  AimError,
  AIM_ERROR_CODES,
  computeSkillHash,
  normalizeSkill,
  validateSkillBody,
  verifyAnchor,
  type AimLock,
  type Anchor,
  type CryptoPort,
  type Json,
  type LockEntry,
  type Manifest,
  type SkillBody,
  type SkillRef,
  type TrustStore
} from "@aim/core";
import { highestCompatible } from "./semver.js";

/** A source the resolver can list/fetch skills from (registry, local, mcp). */
export interface SkillSource {
  name: string;
  // versions available for a ref, newest-or-any order (resolver sorts)
  listVersions(ref: string): Promise<string[]>;
  // raw (un-normalized) skill body for a specific version
  fetch(ref: string, version: string): Promise<Record<string, Json>>;
}

export interface ResolveOptions {
  crypto: CryptoPort;
  sources: SkillSource[];
  now: () => string; // RFC 3339
  // pinned hashes for `pinned-hash` anchors, keyed by ref
  pinnedHashes?: Record<string, string>;
  trustStore?: TrustStore;
}

export interface SkillResolution {
  ref: string;
  resolved: string;
  hash: string;
  source: string;
  body: SkillBody;
}

/** Resolve a single skill ref against a constraint (§12.2). */
export async function resolveSkill(
  ref: string,
  constraint: string,
  anchor: Anchor | undefined,
  opts: ResolveOptions
): Promise<SkillResolution> {
  // gather candidates across all allowed sources
  let best: { version: string; source: SkillSource } | null = null;
  for (const src of opts.sources) {
    let versions: string[];
    try {
      versions = await src.listVersions(ref);
    } catch {
      continue;
    }
    const pick = highestCompatible(versions, constraint);
    if (pick) {
      if (!best || compareGreater(pick, best.version)) best = { version: pick, source: src };
    }
  }
  if (!best) {
    throw new AimError(AIM_ERROR_CODES.NO_MATCHING_VERSION, `no version of '${ref}' matches '${constraint}'`);
  }

  // quarantineFetch → verifyAnchor → normalize → hash → validate
  const raw = await best.source.fetch(ref, best.version);
  const body = normalizeSkill(raw);
  await verifyAnchor(opts.crypto, body, anchor, {
    ...(opts.pinnedHashes?.[ref] ? { pinnedHash: opts.pinnedHashes[ref] } : {}),
    source: best.source.name,
    ...(opts.trustStore ? { trustStore: opts.trustStore } : {})
  });
  validateSkillBody(body);
  const hash = await computeSkillHash(opts.crypto, body);

  return { ref, resolved: best.version, hash, source: best.source.name, body };
}

function compareGreater(a: string, b: string): boolean {
  // both already satisfy their constraint; prefer the lexically-higher SemVer
  return highestCompatible([a, b], "*") === a && a !== b;
}

export interface ResolveManifestResult {
  manifest: Manifest;
  lock: AimLock;
}

/**
 * Resolve every skill in a (draft) manifest, detect version conflicts
 * (AIM-E-2002), fill the resolver-owned fields, and produce a lock (§12.4).
 */
export async function resolveManifest(
  draft: Manifest,
  opts: ResolveOptions
): Promise<ResolveManifestResult> {
  // conflict detection: same ref requested with differing constraints
  const byRef = new Map<string, string>();
  for (const s of draft.skills ?? []) {
    const prev = byRef.get(s.ref);
    if (prev !== undefined && prev !== s.constraint) {
      throw new AimError(
        AIM_ERROR_CODES.VERSION_CONFLICT,
        `conflicting constraints for '${s.ref}': '${prev}' vs '${s.constraint}'`
      );
    }
    byRef.set(s.ref, s.constraint);
  }

  const lockSkills: Record<string, LockEntry> = {};
  const resolvedSkills: SkillRef[] = [];
  const installedAt = opts.now();

  for (const skill of draft.skills ?? []) {
    const res = await resolveSkill(skill.ref, skill.constraint, skill.anchor, opts);
    const anchor: Anchor = skill.anchor ?? (opts.pinnedHashes?.[skill.ref] ? "pinned-hash" : "signature");
    resolvedSkills.push({
      ...skill,
      resolved: res.resolved,
      hash: res.hash,
      anchor
    });
    lockSkills[skill.ref] = {
      resolved: res.resolved,
      hash: res.hash,
      source: res.source,
      anchor,
      installedAt
    };
  }

  const lock: AimLock = {
    aimLock: "1.0",
    resolverStrategy: "highest-compatible",
    skills: lockSkills
  };
  const manifest: Manifest = { ...draft, skills: resolvedSkills };
  return { manifest, lock };
}
