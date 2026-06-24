// §17.1: schema validation → AIM-E-1001 on violation.
import { describe, it, expect } from "vitest";
import { validateManifestSchema, assertValidManifest, isAimError } from "@aim/core";
import { loadInvoiceExample } from "./helpers.js";

describe("schema validation (§10.1, §15)", () => {
  it("accepts the §16 example", () => {
    expect(validateManifestSchema(loadInvoiceExample()).valid).toBe(true);
  });

  it("rejects a manifest missing intent.text → AIM-E-1001", () => {
    const m = loadInvoiceExample() as Record<string, unknown>;
    delete (m.intent as Record<string, unknown>).text;
    try {
      assertValidManifest(m);
      throw new Error("expected failure");
    } catch (e) {
      expect(isAimError(e) && e.code).toBe("AIM-E-1001");
    }
  });

  it("rejects a bad id pattern → AIM-E-1001", () => {
    const m = loadInvoiceExample();
    (m as { id: string }).id = "bad-id";
    expect(validateManifestSchema(m).valid).toBe(false);
  });

  it("requires idempotencyKey on write steps (schema allOf)", () => {
    const m = loadInvoiceExample();
    const store = m.plan.steps.find((s) => s.id === "store")!;
    delete (store as Record<string, unknown>).idempotencyKey;
    expect(validateManifestSchema(m).valid).toBe(false);
  });

  it("requires prompt on model steps (schema allOf)", () => {
    const m = loadInvoiceExample();
    const extract = m.plan.steps.find((s) => s.id === "extract")!;
    delete (extract as Record<string, unknown>).prompt;
    expect(validateManifestSchema(m).valid).toBe(false);
  });
});
