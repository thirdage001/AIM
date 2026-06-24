// Author level (§3.3–3.5): NL → draft via a mock model, plus the hard guards
// (AIM-E-4001, AIM-E-4002).
import { describe, it, expect } from "vitest";
import { author, enforceAuthoringGuards, blockingQuestions } from "@aim/author";
import { createMockModelProvider } from "@aim/adapter-reference";
import { isAimError } from "@aim/core";

const SYSTEM = "You are aim.authoring. Produce only a draft manifest.";

const validDraft = {
  aim: "1.0",
  kind: "Manifest",
  id: "mf_draft_a1",
  intent: { text: "Lieferschein auslesen und Wareneingang anlegen.", source: "natural-language", authoredBy: "ai" },
  inputs: { deliveryNote: { type: "file", required: true } },
  skills: [
    { ref: "knowledge.delivery-note-fields", trust: "knowledge", constraint: "^1", need: "Felddefinitionen" },
    { ref: "capability.warehouse.goods-receipt.create", trust: "capability", constraint: "^1", need: "Wareneingang anlegen" }
  ],
  plan: {
    steps: [
      {
        id: "extract",
        type: "model",
        uses: "knowledge.delivery-note-fields",
        prompt: { role: "Extraktor", goal: "Positionen als JSON.", output: { format: "json", schema: "Pos" } },
        output: { schema: "Pos" }
      },
      {
        id: "createReceipt",
        type: "capability",
        uses: "capability.warehouse.goods-receipt.create",
        effect: "write",
        input: { positions: "${steps.extract.output.positions}" },
        idempotencyKey: "${steps.extract.output.deliveryNoteNo}",
        approval: "required",
        dependsOn: ["extract"]
      }
    ]
  },
  uncertainty: { openQuestions: [{ q: "In welches Lagersystem?", blocksExecution: true }] },
  lifecycle: { mode: "draft" }
};

describe("authoring (§3.3)", () => {
  it("produces a draft and surfaces blocking questions", async () => {
    const model = createMockModelProvider(() => structuredClone(validDraft) as never);
    const draft = await author({ text: "Lies den Lieferschein und buche den Wareneingang." }, { model, authoringSystemPrompt: SYSTEM });
    expect(draft.lifecycle.mode).toBe("draft");
    expect(blockingQuestions(draft).length).toBe(1);
  });

  it("rejects a non-draft lifecycle → AIM-E-4001", () => {
    const bad = { ...structuredClone(validDraft), lifecycle: { mode: "executable" } };
    try {
      enforceAuthoringGuards(bad);
      throw new Error("expected guard");
    } catch (e) {
      expect(isAimError(e) && e.code).toBe("AIM-E-4001");
    }
  });

  it("rejects resolver-owned fields → AIM-E-4002", () => {
    const bad = structuredClone(validDraft) as Record<string, unknown>;
    (bad.skills as Array<Record<string, unknown>>)[0].hash = "sha256:" + "0".repeat(64);
    try {
      enforceAuthoringGuards(bad);
      throw new Error("expected guard");
    } catch (e) {
      expect(isAimError(e) && e.code).toBe("AIM-E-4002");
    }
  });
});
