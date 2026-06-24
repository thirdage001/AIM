// Plan execution engine (§9.2 scheduling, §9.4 idempotency, §9.5 saga).
// This is the AIM-Runtime: it owns DAG order, conditions, approval gates,
// idempotency and compensation — the adapter only performs single calls (§13.3).

import { AimError, AIM_ERROR_CODES, isAimError } from "./errors.js";
import {
  isBinding,
  parseBinding,
  resolveExpr,
  type Expr,
  type ResolveContext
} from "./bindings.js";
import { buildGraph, topologicalSort } from "./graph.js";
import { composePrompt, selectContext } from "./prompt.js";
import { DEFAULT_POLICY } from "./model.js";
import type {
  Json,
  JsonObject,
  Manifest,
  Policy,
  ResolvedSkill,
  Step
} from "./model.js";
import type {
  ApprovalGate,
  AuditSink,
  IdempotencyStore,
  RuntimeAdapter
} from "./ports.js";

/** Named output-schema validators (e.g. "InvoiceFields"). */
export interface SchemaRegistry {
  get(name: string): ((value: unknown) => boolean) | undefined;
}

export interface ExecutionDeps {
  adapter: RuntimeAdapter;
  resolvedSkills: Map<string, ResolvedSkill>;
  idempotency: IdempotencyStore;
  approval: ApprovalGate;
  audit?: AuditSink;
  schemaRegistry?: SchemaRegistry;
  // Resolves a context selector (skill ref or `input:<name>`) to text (§9.7 step 3).
  contextProvider?: (selector: string) => Promise<string>;
}

export type ExecutionResult =
  | { ok: true; outputs: Record<string, Json>; skipped: string[] }
  | {
      ok: false;
      error: { code: string; message: string };
      failedStep: string;
      compensated: string[];
      compensationErrors: Array<{ stepId: string; error: { code: string; message: string } }>;
    };

function effectivePolicy(manifest: Manifest): Required<Policy> {
  const p = manifest.policy ?? {};
  return {
    knowledge: { ...DEFAULT_POLICY.knowledge, ...p.knowledge },
    capability: { ...DEFAULT_POLICY.capability, ...p.capability },
    write: { ...DEFAULT_POLICY.write, ...p.write },
    audit: { ...DEFAULT_POLICY.audit, ...p.audit }
  };
}

function needsApproval(step: Step, policy: Required<Policy>): boolean {
  if (step.approval === "required") return true;
  if (step.effect === "write" && policy.write.requireApproval) return true;
  return false;
}

export async function execute(
  manifest: Manifest,
  inputs: Record<string, Json>,
  deps: ExecutionDeps
): Promise<ExecutionResult> {
  // §9.2: assertExecutable. The host must have driven the lifecycle to
  // `executable` (G2, §11) before calling execute.
  if (manifest.lifecycle.mode !== "executable") {
    throw new AimError(
      AIM_ERROR_CODES.BLOCKING_OPEN_QUESTION,
      `Manifest is '${manifest.lifecycle.mode}', not 'executable' — drive it through the G2 gate first`
    );
  }

  const policy = effectivePolicy(manifest);
  const order = topologicalSort(buildGraph(manifest.plan));
  const stepOutputs: Record<string, Json> = {};
  const skillVersions: Record<string, string> = {};
  for (const [ref, s] of deps.resolvedSkills) skillVersions[ref] = s.resolved;

  const completed: Array<{ step: Step; output: Json }> = []; // for compensation, in completion order
  const skipped: string[] = [];

  const invokeTransform = async (name: string, args: Json[]): Promise<Json> => {
    const skill = requireSkill(deps, name);
    const result = await deps.adapter.runTransformStep({ id: `inline:${name}`, type: "transform", uses: name }, skill, args);
    if (result.error) throw new AimError(result.error.code as never, result.error.message);
    return result.output;
  };

  const resolveCtx = (): ResolveContext => ({
    inputs,
    stepOutputs,
    skillVersions,
    invokeTransform
  });

  const resolveValue = async (raw: Json): Promise<Json> => {
    if (isBinding(raw)) return resolveExpr(parseBinding(raw), resolveCtx());
    if (Array.isArray(raw)) return Promise.all(raw.map(resolveValue));
    if (raw && typeof raw === "object") {
      const out: JsonObject = {};
      for (const [k, v] of Object.entries(raw)) out[k] = await resolveValue(v);
      return out;
    }
    return raw;
  };

  for (const step of order) {
    // — condition (§9.2): skip when false —
    if (step.condition) {
      const cond = await resolveExpr(parseBinding(step.condition), resolveCtx());
      if (cond === false) {
        skipped.push(step.id);
        continue;
      }
      if (cond !== true) {
        return fail(
          { code: AIM_ERROR_CODES.OUTPUT_SCHEMA_VIOLATION, message: `condition of '${step.id}' did not resolve to a boolean` },
          step.id,
          completed,
          deps
        );
      }
    }

    // — approval gate (§9.2, §11 G2-5) —
    if (needsApproval(step, policy)) {
      const decision = await deps.approval.request({
        manifestId: manifest.id,
        stepId: step.id,
        skillRef: step.uses,
        effect: step.effect,
        renderedStep: renderStepForApproval(step)
      });
      if (!decision.approved) {
        return fail(
          { code: AIM_ERROR_CODES.APPROVAL_MISSING, message: `approval denied for '${step.id}': ${decision.reason}` },
          step.id,
          completed,
          deps
        );
      }
    }

    // — idempotency (§9.4): replay a previously-succeeded write —
    let idemValue: string | undefined;
    if (step.effect === "write") {
      if (!step.idempotencyKey) {
        throw new AimError(AIM_ERROR_CODES.WRITE_WITHOUT_IDEMPOTENCY, `write step '${step.id}' lacks idempotencyKey`);
      }
      const v = await resolveExpr(parseBinding(step.idempotencyKey), resolveCtx());
      idemValue = String(v);
      const prior = await deps.idempotency.get({ manifestId: manifest.id, stepId: step.id, value: idemValue });
      if (prior) {
        stepOutputs[step.id] = prior.output;
        if (step.compensation) completed.push({ step, output: prior.output });
        deps.audit?.log({ type: "idempotent-replay", manifestId: manifest.id, stepId: step.id });
        continue;
      }
    }

    // — resolve input bindings —
    const boundInput = (await resolveValue((step.input ?? {}) as Json)) as JsonObject;

    // — run the step via the adapter —
    let result;
    try {
      result = await runStep(step, boundInput, manifest, deps);
    } catch (e) {
      const err = isAimError(e)
        ? e.toStepError()
        : { code: AIM_ERROR_CODES.OUTPUT_SCHEMA_VIOLATION, message: String((e as Error)?.message ?? e) };
      return fail(err, step.id, completed, deps);
    }
    if (result.error) {
      return fail(result.error, step.id, completed, deps);
    }

    // — commit —
    if (step.effect === "write" && idemValue !== undefined) {
      await deps.idempotency.putIfAbsent({ manifestId: manifest.id, stepId: step.id, value: idemValue }, result.output);
    }
    stepOutputs[step.id] = result.output;
    if (step.compensation) completed.push({ step, output: result.output });
  }

  return { ok: true, outputs: stepOutputs, skipped };
}

function requireSkill(deps: ExecutionDeps, ref: string): ResolvedSkill {
  const skill = deps.resolvedSkills.get(ref);
  if (!skill) {
    throw new AimError(AIM_ERROR_CODES.BINDING_UNRESOLVED, `skill '${ref}' is not resolved`);
  }
  return skill;
}

async function runStep(
  step: Step,
  boundInput: JsonObject,
  manifest: Manifest,
  deps: ExecutionDeps
): Promise<{ output: Json; error: null } | { output: null; error: { code: string; message: string } }> {
  switch (step.type) {
    case "model": {
      const prompt = step.prompt!;
      const selectors = selectContext(prompt.contextFrom, manifest.context);
      const contextTexts: Record<string, string> = {};
      if (deps.contextProvider) {
        for (const sel of selectors) contextTexts[sel] = await deps.contextProvider(sel);
      }
      const composed = composePrompt(prompt, selectors, contextTexts);
      const result = await deps.adapter.runModelStep(step, composed, boundInput);
      if (result.error) return result;
      // §9.7 / §13.4.3: enforce the output contract.
      const schemaName = prompt.output.schema ?? step.output?.schema;
      if (prompt.output.format === "json" && schemaName) {
        const validate = deps.schemaRegistry?.get(schemaName);
        if (validate && !validate(result.output)) {
          return { output: null, error: { code: AIM_ERROR_CODES.OUTPUT_SCHEMA_VIOLATION, message: `model output violates schema '${schemaName}'` } };
        }
      }
      deps.audit?.log({ type: "model-step", manifestId: manifest.id, stepId: step.id });
      return result;
    }
    case "capability": {
      const skill = requireSkill(deps, step.uses);
      deps.audit?.log({ type: "capability-call", manifestId: manifest.id, stepId: step.id, data: { effect: step.effect ?? "read" } });
      return deps.adapter.runCapabilityStep(step, skill, boundInput);
    }
    case "transform": {
      const skill = requireSkill(deps, step.uses);
      const args = Object.values(boundInput);
      return deps.adapter.runTransformStep(step, skill, args);
    }
  }
}

// §9.5 saga: compensate completed steps with a declared compensation in REVERSE
// completion order. Compensations are capability skills, receive the original
// step output, and must themselves be idempotent.
async function fail(
  error: { code: string; message: string },
  failedStep: string,
  completed: Array<{ step: Step; output: Json }>,
  deps: ExecutionDeps
): Promise<ExecutionResult> {
  const compensated: string[] = [];
  const compensationErrors: Array<{ stepId: string; error: { code: string; message: string } }> = [];

  for (let i = completed.length - 1; i >= 0; i--) {
    const { step, output } = completed[i]!;
    if (!step.compensation) continue;
    const skill = deps.resolvedSkills.get(step.compensation);
    if (!skill) {
      compensationErrors.push({ stepId: step.id, error: { code: AIM_ERROR_CODES.COMPENSATION_FAILED, message: `compensation skill '${step.compensation}' not resolved` } });
      continue;
    }
    try {
      const compStep: Step = { id: `compensate:${step.id}`, type: "capability", uses: step.compensation, effect: "write" };
      const r = await deps.adapter.runCapabilityStep(compStep, skill, output);
      if (r.error) {
        compensationErrors.push({ stepId: step.id, error: { code: AIM_ERROR_CODES.COMPENSATION_FAILED, message: r.error.message } });
      } else {
        compensated.push(step.id);
      }
    } catch (e) {
      compensationErrors.push({ stepId: step.id, error: { code: AIM_ERROR_CODES.COMPENSATION_FAILED, message: String((e as Error)?.message ?? e) } });
    }
  }

  return { ok: false, error, failedStep, compensated, compensationErrors };
}

function renderStepForApproval(step: Step): string {
  const lines = [`step ${step.id} (${step.type}, uses: ${step.uses})`];
  if (step.effect) lines.push(`  effect: ${step.effect}`);
  if (step.idempotencyKey) lines.push(`  idempotency: ${step.idempotencyKey}`);
  if (step.compensation) lines.push(`  compensation: ${step.compensation}`);
  return lines.join("\n");
}

// re-export for callers that build their own resolution context
export type { Expr };
