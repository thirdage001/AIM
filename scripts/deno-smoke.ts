// Cross-runtime smoke test for Deno (Supabase Edge target). Runs the portable
// kernel's canonicalization + hashing under Deno to guard against node:* imports
// and to confirm Web Crypto behaves identically. Run with:
//   deno run --allow-read scripts/deno-smoke.ts
// (CI runs this in the Deno job; it is not part of the vitest suite.)

import { canonicalize, hashCanonical, computeManifestHash } from "../packages/core/dist/index.js";

const cryptoPort = {
  async digestSha256(data: Uint8Array): Promise<Uint8Array> {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(buf);
  }
};

const canon = canonicalize({ b: 1, a: [3, 2], n: 1.0 });
if (canon !== '{"a":[3,2],"b":1,"n":1}') throw new Error(`JCS mismatch under Deno: ${canon}`);

const h = await hashCanonical(cryptoPort, { hello: "world" });
if (!/^sha256:[a-f0-9]{64}$/.test(h)) throw new Error(`hash shape wrong: ${h}`);

const manifest = {
  aim: "1.0",
  kind: "Manifest",
  id: "mf_x",
  intent: { text: "t", source: "authored", authoredBy: "human" },
  plan: { steps: [] },
  lifecycle: { mode: "draft" },
  provenance: { manifestHash: "sha256:" + "0".repeat(64), createdAt: "2026-01-01T00:00:00Z", lock: "aim.lock" }
} as const;
await computeManifestHash(cryptoPort, manifest as never);

console.log("deno smoke OK:", canon, h);
