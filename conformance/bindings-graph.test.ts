// §17.3 + §17.4: binding parsing/static analysis (AIM-E-1003) and the DAG /
// cycle detection (AIM-E-1002).
import { describe, it, expect } from "vitest";
import {
  parseBinding,
  stepDependencies,
  buildGraph,
  topologicalSort,
  isAimError,
  type Manifest
} from "@aim/core";
import { loadInvoiceExample, executableManifest } from "./helpers.js";

describe("bindings (§8)", () => {
  it("parses inputs / steps.output / transform forms", () => {
    expect(parseBinding("${inputs.targetTable}")).toEqual({ kind: "inputs", path: [{ kind: "key", name: "targetTable" }] });
    const steps = parseBinding("${steps.extract.output.fields.invoiceNo}");
    expect(stepDependencies(steps)).toEqual(["extract"]);
    const tf = parseBinding("${transform.non-empty(steps.extract.output.fields)}");
    expect(stepDependencies(tf)).toEqual(["extract"]);
  });

  it("rejects malformed bindings", () => {
    expect(() => parseBinding("${steps.extract}")).toThrow(); // missing .output
  });
});

describe("graph (§8.3, §9.2)", () => {
  it("derives edges from bindings + dependsOn and orders the §16 plan", () => {
    const m = loadInvoiceExample();
    const order = topologicalSort(buildGraph(m.plan)).map((s) => s.id);
    expect(order).toEqual(["extract", "store"]);
  });

  it("detects a cycle → AIM-E-1002", () => {
    const m: Manifest = executableManifest([
      { id: "a", type: "transform", uses: "t", input: { x: "${steps.b.output}" } },
      { id: "b", type: "transform", uses: "t", input: { x: "${steps.a.output}" } }
    ]);
    try {
      topologicalSort(buildGraph(m.plan));
      throw new Error("expected cycle");
    } catch (e) {
      expect(isAimError(e) && e.code).toBe("AIM-E-1002");
    }
  });

  it("rejects a binding to an unknown step → AIM-E-1003", () => {
    const m = executableManifest([
      { id: "a", type: "transform", uses: "t", input: { x: "${steps.missing.output}" } }
    ]);
    try {
      buildGraph(m.plan);
      throw new Error("expected unresolved");
    } catch (e) {
      expect(isAimError(e) && e.code).toBe("AIM-E-1003");
    }
  });
});
