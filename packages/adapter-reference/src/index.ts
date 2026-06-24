// reference-node adapter (§13.2/13.4). It performs exactly ONE call per step
// and maps failures onto the AIM error taxonomy. All orchestration (DAG order,
// idempotency, saga, approval) stays in the AIM-Runtime (§13.3) — this adapter
// only translates a single model / capability / transform call.

import {
  AimError,
  AIM_ERROR_CODES,
  isAimError,
  type ComposedContext,
  type Json,
  type Manifest,
  type ModelProvider,
  type ResolvedSkill,
  type RuntimeAdapter,
  type Step,
  type StepResult
} from "@aim/core";

/** Pure transform implementations keyed by skill ref (e.g. "transform.non-empty"). */
export interface TransformRegistry {
  get(ref: string): ((args: Json[]) => Json | Promise<Json>) | undefined;
}

/** Performs a single external capability call (§13.4 rule 4). */
export interface CapabilityInvoker {
  invoke(skill: ResolvedSkill, step: Step, input: Json): Promise<Json>;
}

export interface ReferenceAdapterOptions {
  model: ModelProvider;
  capability: CapabilityInvoker;
  transforms: TransformRegistry;
  // resolved model coordinates (from plan.runtime.model, §13.1)
  modelRef?: { provider: string; name: string };
}

export class ReferenceNodeAdapter implements RuntimeAdapter {
  readonly name = "reference-node";
  private readonly opts: ReferenceAdapterOptions;

  constructor(opts: ReferenceAdapterOptions) {
    this.opts = opts;
  }

  supports(manifest: Manifest): boolean {
    const adapter = manifest.plan.runtime?.adapter;
    return adapter === undefined || adapter === this.name;
  }

  async runModelStep(step: Step, context: ComposedContext, _input: Json): Promise<StepResult> {
    const prompt = step.prompt!;
    try {
      const { value } = await this.opts.model.generate({
        system: context.system,
        prompt: context.prompt,
        output: { format: prompt.output.format, ...(prompt.output.schema ? { schema: prompt.output.schema } : {}) },
        model: this.opts.modelRef ?? { provider: "mock", name: "mock" }
      });
      return { output: value, error: null };
    } catch (e) {
      return mapError(e);
    }
  }

  async runCapabilityStep(step: Step, skill: ResolvedSkill, input: Json): Promise<StepResult> {
    try {
      const output = await this.opts.capability.invoke(skill, step, input);
      return { output, error: null };
    } catch (e) {
      return mapError(e);
    }
  }

  async runTransformStep(step: Step, skill: ResolvedSkill, args: Json[]): Promise<StepResult> {
    const fn = this.opts.transforms.get(skill.ref) ?? this.opts.transforms.get(step.uses);
    if (!fn) {
      return { output: null, error: { code: AIM_ERROR_CODES.BINDING_UNRESOLVED, message: `no transform implementation for '${skill.ref}'` } };
    }
    try {
      const output = await fn(args);
      return { output, error: null };
    } catch (e) {
      return mapError(e);
    }
  }
}

function mapError(e: unknown): StepResult {
  if (isAimError(e)) return { output: null, error: e.toStepError() };
  const message = e instanceof Error ? e.message : String(e);
  return { output: null, error: { code: AIM_ERROR_CODES.OUTPUT_SCHEMA_VIOLATION, message } };
}

// — built-in pure transforms (deterministic, side-effect-free, §7.1) —

export function builtinTransforms(): TransformRegistry {
  const map = new Map<string, (args: Json[]) => Json>([
    [
      "transform.non-empty",
      (args) => {
        const v = args[0];
        if (v === null || v === undefined) return false;
        if (typeof v === "string") return v.length > 0;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === "object") return Object.keys(v).length > 0;
        return true;
      }
    ],
    [
      "transform.normalize-date",
      (args) => {
        const v = args[0];
        if (typeof v !== "string") return v ?? null;
        // ISO date passthrough; normalize common dd.mm.yyyy → yyyy-mm-dd
        const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v.trim());
        return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
      }
    ]
  ]);
  return { get: (ref) => map.get(ref) };
}

export function combineTransforms(...regs: TransformRegistry[]): TransformRegistry {
  return {
    get(ref) {
      for (const r of regs) {
        const fn = r.get(ref);
        if (fn) return fn;
      }
      return undefined;
    }
  };
}

// — deterministic mock model provider (for tests & offline runs) —

export interface MockModelProvider extends ModelProvider {
  /** Queue a response to be returned by the next generate() call. */
  push(value: Json): void;
}

/**
 * A deterministic ModelProvider. Either pre-seed responses with push(), or pass
 * a responder function that maps the request to a value. No network, no SDK.
 */
export function createMockModelProvider(
  responder?: (req: { system: string; prompt: string }) => Json
): MockModelProvider {
  const queue: Json[] = [];
  return {
    push(value: Json) {
      queue.push(value);
    },
    async generate(req) {
      if (queue.length > 0) return { value: queue.shift()! };
      if (responder) return { value: responder(req) };
      throw new AimError(AIM_ERROR_CODES.OUTPUT_SCHEMA_VIOLATION, "mock model has no queued response");
    }
  };
}
