// §17.8 + §17.9: lifecycle gates (G1/G2) incl. the blocking-question case
// (AIM-E-1005) and lock verification (AIM-E-2005).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gateG1, gateG2, assertLock, render, isAimError, type AimLock } from "@aim/core";
import { crypto, loadInvoiceExample } from "./helpers.js";

const lock = JSON.parse(
  readFileSync(new URL("../examples/invoice/aim.lock", import.meta.url), "utf8")
) as AimLock;

const autoReview = { async confirm() { return true; } };

describe("lifecycle (§11)", () => {
  it("passes G1 for the §16 example", () => {
    expect(gateG1(loadInvoiceExample()).ok).toBe(true);
  });

  it("blocks G2 on a blocking open question → AIM-E-1005", async () => {
    const m = loadInvoiceExample();
    try {
      await gateG2(m, {
        crypto,
        lock,
        grantedApprovals: new Set(["store"]),
        review: autoReview,
        rendered: render(m)
      });
      throw new Error("expected block");
    } catch (e) {
      expect(isAimError(e) && e.code).toBe("AIM-E-1005");
    }
  });

  it("reaches executable once the blocking question is resolved", async () => {
    const m = loadInvoiceExample();
    m.uncertainty!.openQuestions = [];
    const exec = await gateG2(m, {
      crypto,
      lock,
      grantedApprovals: new Set(["store"]),
      review: autoReview,
      rendered: render(m)
    });
    expect(exec.lifecycle.mode).toBe("executable");
  });

  it("fails G2 when approval is not granted → AIM-E-1006", async () => {
    const m = loadInvoiceExample();
    m.uncertainty!.openQuestions = [];
    try {
      await gateG2(m, { crypto, lock, grantedApprovals: new Set(), review: autoReview, rendered: render(m) });
      throw new Error("expected block");
    } catch (e) {
      expect(isAimError(e) && e.code).toBe("AIM-E-1006");
    }
  });
});

describe("lock verification (§12.4)", () => {
  it("passes when manifest hashes match the lock", () => {
    expect(() => assertLock(loadInvoiceExample(), lock)).not.toThrow();
  });

  it("detects drift between live source and lock → AIM-E-2005", () => {
    const m = loadInvoiceExample();
    const live = { "capability.store.upsert": "sha256:" + "a".repeat(64) };
    try {
      assertLock(m, lock, live);
      throw new Error("expected mismatch");
    } catch (e) {
      expect(isAimError(e) && e.code).toBe("AIM-E-2005");
    }
  });
});
