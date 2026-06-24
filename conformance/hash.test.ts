// §17.2: hashing + manifestHash (strip/reinsert provenance.manifestHash, §4.3).
import { describe, it, expect } from "vitest";
import { computeManifestHash, hashCanonical, isValidHash } from "@aim/core";
import { crypto, loadInvoiceExample } from "./helpers.js";

describe("hashing (§4)", () => {
  it("produces sha256:<64 hex>", async () => {
    const h = await hashCanonical(crypto, { hello: "world" });
    expect(isValidHash(h)).toBe(true);
    expect(h.startsWith("sha256:")).toBe(true);
  });

  it("manifestHash ignores the manifestHash field itself", async () => {
    const m = loadInvoiceExample();
    const h1 = await computeManifestHash(crypto, m);
    const m2 = structuredClone(m);
    m2.provenance.manifestHash = "sha256:" + "9".repeat(64);
    const h2 = await computeManifestHash(crypto, m2);
    expect(h1).toBe(h2); // changing only manifestHash does not change the hash
  });

  it("changes when a meaningful field changes", async () => {
    const m = loadInvoiceExample();
    const h1 = await computeManifestHash(crypto, m);
    const m2 = structuredClone(m);
    m2.intent.text = "different";
    const h2 = await computeManifestHash(crypto, m2);
    expect(h1).not.toBe(h2);
  });

  it("is deterministic", async () => {
    const m = loadInvoiceExample();
    expect(await computeManifestHash(crypto, m)).toBe(await computeManifestHash(crypto, m));
  });
});
