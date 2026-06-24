// §17.5–7 + §9: topological execution, condition skipping, idempotency replay
// (AIM-E-1004), saga compensation in reverse order (AIM-E-3002), approval
// (AIM-E-1006), output-schema enforcement (AIM-E-3001).
import { describe, it, expect } from "vitest";
import {
  execute,
  type ExecutionDeps,
  type Manifest,
  type ResolvedSkill,
  type Step,
  type Trust
} from "@aim/core";
import {
  ReferenceNodeAdapter,
  builtinTransforms,
  createMockModelProvider,
  type CapabilityInvoker
} from "@aim/adapter-reference";
import { InMemoryIdempotencyStore, autoApprovalGate, predicateApprovalGate } from "@aim/host-node";
import { executableManifest } from "./helpers.js";

function skills(defs: Array<[string, Trust]>): Map<string, ResolvedSkill> {
  const m = new Map<string, ResolvedSkill>();
  for (const [ref, trust] of defs) m.set(ref, { ref, trust, resolved: "1.0.0", hash: "sha256:" + "0".repeat(64) });
  return m;
}

function depsWith(
  resolvedSkills: Map<string, ResolvedSkill>,
  capability: CapabilityInvoker,
  extra: Partial<ExecutionDeps> = {}
): ExecutionDeps {
  const adapter = new ReferenceNodeAdapter({
    model: createMockModelProvider(() => ({ ok: true })),
    capability,
    transforms: builtinTransforms()
  });
  return {
    adapter,
    resolvedSkills,
    idempotency: new InMemoryIdempotencyStore(),
    approval: autoApprovalGate,
    ...extra
  };
}

describe("execution engine (§9)", () => {
  it("runs steps in topological order and skips condition=false", async () => {
    const calls: string[] = [];
    const cap: CapabilityInvoker = {
      async invoke(_s, step) {
        calls.push(step.id);
        return { done: step.id };
      }
    };
    const steps: Step[] = [
      { id: "a", type: "capability", uses: "capability.a", effect: "read", input: {} },
      {
        id: "b",
        type: "capability",
        uses: "capability.b",
        effect: "read",
        input: { x: "${steps.a.output}" },
        condition: "${transform.non-empty(steps.a.output)}",
        dependsOn: ["a"]
      },
      {
        id: "c",
        type: "capability",
        uses: "capability.c",
        effect: "read",
        condition: "${transform.non-empty(inputs.nope)}",
        input: {}
      }
    ];
    const m = executableManifest(steps);
    const res = await execute(m, { nope: null }, depsWith(skills([["capability.a", "capability"], ["capability.b", "capability"], ["capability.c", "capability"], ["transform.non-empty", "transform"]]), cap));
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["a", "b"]); // c skipped (condition false)
    if (res.ok) expect(res.skipped).toEqual(["c"]);
  });

  it("replays a write step via the idempotency store", async () => {
    let writes = 0;
    const cap: CapabilityInvoker = {
      async invoke() {
        writes++;
        return { id: writes };
      }
    };
    const step: Step = {
      id: "w",
      type: "capability",
      uses: "capability.store",
      effect: "write",
      idempotencyKey: "${inputs.key}",
      input: {}
    };
    const m = executableManifest([step]);
    const idem = new InMemoryIdempotencyStore();
    const deps = depsWith(skills([["capability.store", "capability"]]), cap, { idempotency: idem });
    const r1 = await execute(m, { key: "k1" }, deps);
    const r2 = await execute(m, { key: "k1" }, deps);
    expect(r1.ok && r2.ok).toBe(true);
    expect(writes).toBe(1); // second run replayed, no new write
  });

  it("throws AIM-E-1004 for a write step without idempotencyKey", async () => {
    const cap: CapabilityInvoker = { async invoke() { return {}; } };
    const step: Step = { id: "w", type: "capability", uses: "capability.store", effect: "write", input: {} };
    const m = executableManifest([step]);
    await expect(execute(m, {}, depsWith(skills([["capability.store", "capability"]]), cap))).rejects.toMatchObject({ code: "AIM-E-1004" });
  });

  it("compensates completed steps in reverse order on failure", async () => {
    const compensations: string[] = [];
    const cap: CapabilityInvoker = {
      async invoke(skill, step) {
        if (step.uses.endsWith(".fail")) throw new Error("boom");
        if (step.id.startsWith("compensate:")) {
          compensations.push(step.id);
          return { undone: true };
        }
        return { id: step.id };
      }
    };
    const steps: Step[] = [
      { id: "s1", type: "capability", uses: "capability.w1", effect: "write", idempotencyKey: "${inputs.k}", compensation: "capability.undo1", input: {} },
      { id: "s2", type: "capability", uses: "capability.w2", effect: "write", idempotencyKey: "${inputs.k}", compensation: "capability.undo2", input: {}, dependsOn: ["s1"] },
      { id: "s3", type: "capability", uses: "capability.fail", effect: "write", idempotencyKey: "${inputs.k}", input: {}, dependsOn: ["s2"] }
    ];
    const m = executableManifest(steps);
    const res = await execute(m, { k: "x" }, depsWith(
      skills([["capability.w1", "capability"], ["capability.w2", "capability"], ["capability.fail", "capability"], ["capability.undo1", "capability"], ["capability.undo2", "capability"]]),
      cap
    ));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failedStep).toBe("s3");
      expect(res.compensated).toEqual(["s2", "s1"]); // reverse completion order
    }
    expect(compensations).toEqual(["compensate:s2", "compensate:s1"]);
  });

  it("denies execution when approval is refused → AIM-E-1006", async () => {
    const cap: CapabilityInvoker = { async invoke() { return {}; } };
    const step: Step = { id: "w", type: "capability", uses: "capability.store", effect: "write", idempotencyKey: "${inputs.k}", approval: "required", input: {} };
    const m = executableManifest([step]);
    const deps = depsWith(skills([["capability.store", "capability"]]), cap, { approval: predicateApprovalGate(() => false) });
    const res = await execute(m, { k: "1" }, deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("AIM-E-1006");
  });

  it("enforces the model output contract → AIM-E-3001", async () => {
    const cap: CapabilityInvoker = { async invoke() { return {}; } };
    const adapter = new ReferenceNodeAdapter({
      model: createMockModelProvider(() => ({ wrong: true })),
      capability: cap,
      transforms: builtinTransforms()
    });
    const step: Step = {
      id: "m",
      type: "model",
      uses: "knowledge.x",
      prompt: { role: "r", goal: "g", output: { format: "json", schema: "Foo" } },
      output: { schema: "Foo" },
      input: {}
    };
    const m = executableManifest([step]);
    const deps: ExecutionDeps = {
      adapter,
      resolvedSkills: skills([["knowledge.x", "knowledge"]]),
      idempotency: new InMemoryIdempotencyStore(),
      approval: autoApprovalGate,
      schemaRegistry: { get: (n) => (n === "Foo" ? (v) => typeof v === "object" && v !== null && "fields" in (v as object) : undefined) }
    };
    const res = await execute(m, {}, deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("AIM-E-3001");
  });
});
