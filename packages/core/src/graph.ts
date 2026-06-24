// Plan graph (§8.3, §9.2). Edges come from two sources: explicit `dependsOn`
// and bindings found in a step's input / idempotencyKey / condition. The union
// must be acyclic (AIM-E-1002); execution order is a topological sort.

import { AimError, AIM_ERROR_CODES } from "./errors.js";
import { isBinding, parseBinding, stepDependencies } from "./bindings.js";
import type { Json, Plan, Step } from "./model.js";

export interface PlanGraph {
  steps: Map<string, Step>;
  // step id -> set of step ids it depends on (must run before it)
  deps: Map<string, Set<string>>;
}

/** Collect every binding string within a value (recursively through objects/arrays). */
function collectBindingStrings(value: Json | undefined, out: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string") {
    if (isBinding(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectBindingStrings(v, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) collectBindingStrings(v, out);
  }
}

/** All binding strings referenced by a step (input, idempotencyKey, condition). */
export function stepBindings(step: Step): string[] {
  const out: string[] = [];
  collectBindingStrings(step.input as Json | undefined, out);
  if (step.idempotencyKey && isBinding(step.idempotencyKey)) out.push(step.idempotencyKey);
  if (step.condition && isBinding(step.condition)) out.push(step.condition);
  return out;
}

/**
 * Build the dependency graph. Binding edges reference step outputs; together
 * with `dependsOn` they form the edge set. Throws AIM-E-1003 if a binding
 * references a step that does not exist.
 */
export function buildGraph(plan: Plan): PlanGraph {
  const steps = new Map<string, Step>();
  for (const step of plan.steps) {
    if (steps.has(step.id)) {
      throw new AimError(AIM_ERROR_CODES.SCHEMA_INVALID, `Duplicate step id '${step.id}'`);
    }
    steps.set(step.id, step);
  }

  const deps = new Map<string, Set<string>>();
  for (const step of plan.steps) {
    const set = new Set<string>();
    for (const dep of step.dependsOn ?? []) {
      if (!steps.has(dep)) {
        throw new AimError(
          AIM_ERROR_CODES.BINDING_UNRESOLVED,
          `Step '${step.id}' dependsOn unknown step '${dep}'`
        );
      }
      set.add(dep);
    }
    for (const b of stepBindings(step)) {
      const expr = parseBinding(b);
      for (const dep of stepDependencies(expr)) {
        if (!steps.has(dep)) {
          throw new AimError(
            AIM_ERROR_CODES.BINDING_UNRESOLVED,
            `Step '${step.id}' binding references unknown step '${dep}'`
          );
        }
        if (dep === step.id) {
          throw new AimError(AIM_ERROR_CODES.PLAN_CYCLE, `Step '${step.id}' depends on itself`);
        }
        set.add(dep);
      }
    }
    deps.set(step.id, set);
  }
  return { steps, deps };
}

/**
 * Deterministic topological sort (§9.2). Ties are broken by the step's original
 * declaration order, so execution order is reproducible. Throws AIM-E-1002 on a
 * cycle.
 */
export function topologicalSort(graph: PlanGraph): Step[] {
  const order: string[] = [...graph.steps.keys()];
  const indexOf = new Map(order.map((id, i) => [id, i] as const));

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const result: Step[] = [];

  const visit = (id: string, path: string[]): void => {
    if (visited.has(id)) return;
    if (onStack.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id].join(" -> ");
      throw new AimError(AIM_ERROR_CODES.PLAN_CYCLE, `Plan contains a cycle: ${cycle}`);
    }
    onStack.add(id);
    const depIds = [...(graph.deps.get(id) ?? new Set<string>())].sort(
      (a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0)
    );
    for (const dep of depIds) visit(dep, [...path, id]);
    onStack.delete(id);
    visited.add(id);
    result.push(graph.steps.get(id)!);
  };

  for (const id of order) visit(id, []);
  return result;
}

/** Convenience: build + sort, surfacing AIM-E-1002 / AIM-E-1003. */
export function planOrder(plan: Plan): Step[] {
  return topologicalSort(buildGraph(plan));
}
