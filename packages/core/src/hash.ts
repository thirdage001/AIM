// Hashing (§4). Every hash is `sha256:` + 64 lowercase hex chars. Hashing is
// async because it goes through the CryptoPort (Web Crypto subtle.digest),
// which is async on every target runtime.

import { canonicalBytes } from "./canonicalize.js";
import type { CryptoPort } from "./ports.js";
import type { Json, Manifest, SkillBody } from "./model.js";

const HEX = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += HEX[(b >> 4) & 0xf]! + HEX[b & 0xf]!;
  }
  return out;
}

/** `sha256:<hex>` over arbitrary bytes. */
export async function sha256Hex(crypto: CryptoPort, data: Uint8Array): Promise<string> {
  const digest = await crypto.digestSha256(data);
  return "sha256:" + toHex(digest);
}

/** Hash over the canonicalized JSON value (§4.1 + §4.2). */
export async function hashCanonical(crypto: CryptoPort, value: Json): Promise<string> {
  return sha256Hex(crypto, canonicalBytes(value));
}

/**
 * §4.3 manifestHash: hash over the canonical manifest WITHOUT the
 * `provenance.manifestHash` field. The field is removed before the computation
 * and inserted afterwards.
 */
export async function computeManifestHash(
  crypto: CryptoPort,
  manifest: Manifest
): Promise<string> {
  const clone = structuredClone(manifest) as unknown as {
    provenance?: Record<string, unknown>;
  };
  if (clone.provenance) {
    // The spec strips exactly this one field before hashing (§4.3).
    delete clone.provenance.manifestHash;
  }
  return hashCanonical(crypto, clone as unknown as Json);
}

/** Verify a manifest's stored hash matches a freshly computed one. */
export async function verifyManifestHash(
  crypto: CryptoPort,
  manifest: Manifest
): Promise<boolean> {
  const expected = manifest.provenance?.manifestHash;
  if (!expected) return false;
  const actual = await computeManifestHash(crypto, manifest);
  return actual === expected;
}

/** §7.4 / §4.4 skill hash: hash over the normalized skill body. */
export async function computeSkillHash(
  crypto: CryptoPort,
  body: SkillBody
): Promise<string> {
  return hashCanonical(crypto, body as unknown as Json);
}

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
export function isValidHash(h: string): boolean {
  return HASH_PATTERN.test(h);
}
