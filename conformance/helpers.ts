// Shared test helpers: a Web-Crypto port and manifest builders.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CryptoPort, Manifest } from "@aim/core";

const here = dirname(fileURLToPath(import.meta.url));

export const crypto: CryptoPort = {
  async digestSha256(data: Uint8Array): Promise<Uint8Array> {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
    return new Uint8Array(buf);
  }
};

export function loadInvoiceExample(): Manifest {
  const p = join(here, "..", "examples", "invoice", "invoice.aim.json");
  return JSON.parse(readFileSync(p, "utf8")) as Manifest;
}

/** A minimal, fully executable manifest with no skills (for engine tests). */
export function executableManifest(steps: Manifest["plan"]["steps"]): Manifest {
  return {
    aim: "1.0",
    kind: "Manifest",
    id: "mf_test",
    intent: { text: "test", source: "authored", authoredBy: "human" },
    plan: { steps },
    lifecycle: { mode: "executable" },
    provenance: {
      manifestHash: "sha256:" + "0".repeat(64),
      createdAt: "2026-01-01T00:00:00Z",
      lock: "aim.lock"
    }
  };
}
