// Readable authoring surface `*.aim` ↔ canonical `*.aim.json` (§5.2).
// compile (.aim → manifest) is deterministic; render (manifest → .aim) is the
// human-readable projection used by the review gate (§11). render(compile(x))
// is semantically equivalent to x.
//
// This is a self-consistent, well-defined projection of the object model. The
// §0 prose example is illustrative; this grammar is the normative one for this
// implementation and round-trips by construction.

import { AimError, AIM_ERROR_CODES } from "./errors.js";
import { parseBinding } from "./bindings.js";
import type {
  ContextSpec,
  DraftManifest,
  Effect,
  InputType,
  Json,
  JsonObject,
  Prompt,
  SkillRef,
  Step,
  Trust
} from "./model.js";

// — short-binding expansion (readable → canonical ${…}) —

const FUNC_RE = /^([A-Za-z][\w-]*)\((.*)\)$/;

/** Expand a readable reference into a canonical binding string `${…}`. */
export function expandShortBinding(text: string): string {
  return "${" + expandExpr(text.trim()) + "}";
}

function expandExpr(t: string): string {
  const fn = FUNC_RE.exec(t);
  if (fn) {
    const name = fn[1]!;
    const argsRaw = fn[2]!.trim();
    const args = argsRaw === "" ? [] : splitArgs(argsRaw).map((a) => expandArg(a.trim()));
    return `transform.${name}(${args.join(",")})`;
  }
  if (t.startsWith("inputs.")) return t; // inputs.<path> stays
  if (t === "inputs") return t;
  // skills.<ref>.resolved passthrough
  if (t.startsWith("skills.") && t.endsWith(".resolved")) return t;
  // otherwise: <stepId>[.<path>] → steps.<stepId>.output[.<path>]
  const dot = t.indexOf(".");
  if (dot === -1) return `steps.${t}.output`;
  const stepId = t.slice(0, dot);
  const rest = t.slice(dot + 1);
  return `steps.${stepId}.output.${rest}`;
}

function expandArg(a: string): string {
  // literal?
  if (/^(true|false|null)$/.test(a)) return a;
  if (/^-?\d/.test(a)) return a;
  if (a.startsWith('"')) return a;
  return expandExpr(a);
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** Contract a canonical binding string `${…}` into its readable short form. */
export function contractBinding(canonical: string): string {
  parseBinding(canonical); // validate
  const inner = canonical.trim().slice(2, -1).trim();
  return contractExpr(inner);
}

function contractExpr(e: string): string {
  const fn = FUNC_RE.exec(e);
  if (fn && fn[1] === "transform") {
    // transform.NAME(...) — but FUNC_RE matched "transform" as name only if no dot;
    // handle the dotted transform form explicitly below.
  }
  const tfn = /^transform\.([A-Za-z][\w-]*)\((.*)\)$/.exec(e);
  if (tfn) {
    const args = tfn[2]!.trim() === "" ? [] : splitArgs(tfn[2]!).map((a) => contractArg(a.trim()));
    return `${tfn[1]}(${args.join(", ")})`;
  }
  if (e.startsWith("inputs.") || e === "inputs") return e;
  if (e.startsWith("skills.")) return e;
  const m = /^steps\.([A-Za-z][\w-]*)\.output(?:\.(.*))?$/.exec(e);
  if (m) return m[2] ? `${m[1]}.${m[2]}` : m[1]!;
  return e;
}

function contractArg(a: string): string {
  if (/^(true|false|null)$/.test(a) || /^-?\d/.test(a) || a.startsWith('"')) return a;
  return contractExpr(a);
}

// — render (manifest → .aim) —

const TRUST_ORDER: Trust[] = ["knowledge", "capability", "transform"];

function shortRef(ref: string, trust: Trust): string {
  const prefix = `${trust}.`;
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

export function render(manifest: DraftManifest): string {
  const L: string[] = [];
  L.push(`manifest ${JSON.stringify(manifest.intent.text)}`);
  L.push(`  intent: ${manifest.intent.text}`);
  L.push(`  source: ${manifest.intent.source}`);
  L.push(`  authoredBy: ${manifest.intent.authoredBy}`);
  L.push(`  id: ${manifest.id}`);
  L.push("");

  if (manifest.inputs && Object.keys(manifest.inputs).length > 0) {
    L.push("inputs:");
    for (const [name, decl] of Object.entries(manifest.inputs)) {
      let line = `  ${name} ${decl.type}${decl.required ? " required" : ""}`;
      if (decl.description) line += ` ${JSON.stringify(decl.description)}`;
      L.push(line);
    }
    L.push("");
  }

  if (manifest.skills && manifest.skills.length > 0) {
    L.push("uses:");
    for (const s of manifest.skills) {
      let line = `  ${s.trust} ${shortRef(s.ref, s.trust)} ${s.constraint}`;
      if (s.approval === "required") line += " approval(required)";
      L.push(line);
      if (s.need) L.push(`    need: ${s.need}`);
    }
    L.push("");
  }

  if (manifest.context) {
    L.push(`context: ${manifest.context.strategy}`);
    if (manifest.context.include?.length) L.push(`  include: ${manifest.context.include.join(", ")}`);
    if (manifest.context.exclude?.length) L.push(`  exclude: ${manifest.context.exclude.join(", ")}`);
    L.push("");
  }

  for (const step of manifest.plan.steps) {
    renderStep(L, step);
    L.push("");
  }

  const u = manifest.uncertainty;
  if (u && ((u.assumptions?.length ?? 0) > 0 || (u.openQuestions?.length ?? 0) > 0)) {
    L.push("uncertainty:");
    for (const a of u.assumptions ?? []) L.push(`  annahme: ${JSON.stringify(a.text)} (${a.confidence})`);
    for (const q of u.openQuestions ?? []) L.push(`  frage: ${JSON.stringify(q.q)}${q.blocksExecution ? " blockt" : ""}`);
    L.push("");
  }

  L.push(`lifecycle: ${manifest.lifecycle.mode}`);
  return L.join("\n") + "\n";
}

function renderStep(L: string[], step: Step): void {
  const head: string[] = [step.type];
  if (step.effect) head.push(step.effect);
  const skillShort = step.uses;
  L.push(`step ${step.id} (${head.join(" ")}, skill: ${skillShort})`);
  if (step.condition) L.push(`  when: ${contractBinding(step.condition)}`);
  if (step.dependsOn?.length) L.push(`  dependsOn: ${step.dependsOn.join(", ")}`);
  if (step.prompt) renderPrompt(L, step.prompt);
  if (step.input && Object.keys(step.input).length > 0) {
    L.push("  input:");
    for (const [k, v] of Object.entries(step.input)) {
      const rhs = typeof v === "string" && v.trim().startsWith("${") ? contractBinding(v) : JSON.stringify(v);
      L.push(`    ${k} = ${rhs}`);
    }
  }
  if (step.output?.schema) L.push(`  output: ${step.output.schema}`);
  if (step.idempotencyKey) L.push(`  idempotency: ${contractBinding(step.idempotencyKey)}`);
  if (step.approval) L.push(`  approval: ${step.approval}`);
  if (step.compensation) L.push(`  compensation: ${shortRefAny(step.compensation)}`);
}

function shortRefAny(ref: string): string {
  for (const t of TRUST_ORDER) {
    if (ref.startsWith(`${t}.`)) return ref.slice(t.length + 1);
  }
  return ref;
}

function renderPrompt(L: string[], p: Prompt): void {
  L.push("  prompt:");
  L.push(`    rolle: ${p.role}`);
  L.push(`    ziel: ${p.goal}`);
  if (p.style) L.push(`    stil: ${p.style}`);
  if (p.rules?.length) {
    L.push("    regeln:");
    for (const r of p.rules) L.push(`      - ${r}`);
  }
  if (p.contextFrom?.length) L.push(`    kontext: ${p.contextFrom.join(", ")}`);
  L.push(`    ausgabe: ${p.output.format}${p.output.schema ? " " + p.output.schema : ""}`);
  if (p.onMissingData) L.push(`    fehlt: ${p.onMissingData}`);
}

// — compile (.aim → manifest) —

interface Line {
  indent: number;
  text: string;
  raw: string;
}

function lex(src: string): Line[] {
  return src
    .split("\n")
    .map((raw) => {
      const noComment = raw.replace(/\s+#.*$/, "");
      const trimmed = noComment.replace(/\s+$/, "");
      const indent = trimmed.length - trimmed.trimStart().length;
      return { indent, text: trimmed.trim(), raw };
    })
    .filter((l) => l.text.length > 0);
}

/** Compile readable `.aim` text to a draft manifest (canonical model, no tool fields). */
export function compile(src: string): DraftManifest {
  const lines = lex(src);
  let i = 0;

  const manifest: DraftManifest = {
    aim: "1.0",
    kind: "Manifest",
    id: "mf_0",
    intent: { text: "", source: "authored", authoredBy: "human" },
    plan: { steps: [] },
    lifecycle: { mode: "draft" }
  };
  // map of readable ref -> trust, to resolve `skill:` and build canonical refs
  const refTrust = new Map<string, Trust>();

  const childrenOf = (parentIdx: number): Line[] => {
    const base = lines[parentIdx]!.indent;
    const out: Line[] = [];
    for (let j = parentIdx + 1; j < lines.length; j++) {
      if (lines[j]!.indent <= base) break;
      out.push(lines[j]!);
    }
    return out;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const text = line.text;

    if (text.startsWith("manifest ")) {
      // children: intent/source/authoredBy/id
      for (const c of childrenOf(i)) {
        const [key, ...rest] = c.text.split(":");
        const val = rest.join(":").trim();
        if (key === "intent") manifest.intent.text = val;
        else if (key === "source") manifest.intent.source = val as never;
        else if (key === "authoredBy") manifest.intent.authoredBy = val as never;
        else if (key === "id") manifest.id = val;
      }
      i += 1 + childrenOf(i).length;
      continue;
    }

    if (text === "inputs:") {
      manifest.inputs = {};
      for (const c of childrenOf(i)) {
        const parts = tokenize(c.text);
        const name = parts[0]!;
        const type = parts[1] as InputType;
        const required = parts.includes("required");
        const descTok = parts.find((p) => p.startsWith('"'));
        manifest.inputs[name] = {
          type,
          required,
          ...(descTok ? { description: JSON.parse(descTok) as string } : {})
        };
      }
      i += 1 + childrenOf(i).length;
      continue;
    }

    if (text === "uses:") {
      manifest.skills = [];
      const kids = childrenOf(i);
      for (let k = 0; k < kids.length; k++) {
        const c = kids[k]!;
        if (c.text.startsWith("need:")) continue; // attached below
        const parts = tokenize(c.text);
        const trust = parts[0] as Trust;
        const readable = parts[1]!;
        const constraint = parts[2] ?? "*";
        const approval = c.text.includes("approval(required)") ? ("required" as const) : undefined;
        refTrust.set(readable, trust);
        const ref = `${trust}.${readable}`;
        const entry: SkillRef = { ref, trust, constraint, ...(approval ? { approval } : {}) };
        // attach a following need: line
        const next = kids[k + 1];
        if (next && next.text.startsWith("need:")) {
          entry.need = next.text.slice("need:".length).trim();
        }
        manifest.skills!.push(entry);
      }
      i += 1 + kids.length;
      continue;
    }

    if (text.startsWith("context:")) {
      const strategy = text.slice("context:".length).trim() as ContextSpec["strategy"];
      const ctx: ContextSpec = { strategy };
      for (const c of childrenOf(i)) {
        if (c.text.startsWith("include:")) ctx.include = splitList(c.text.slice("include:".length));
        else if (c.text.startsWith("exclude:")) ctx.exclude = splitList(c.text.slice("exclude:".length));
      }
      manifest.context = ctx;
      i += 1 + childrenOf(i).length;
      continue;
    }

    if (text.startsWith("step ")) {
      const step = parseStep(line, childrenOf(i), refTrust);
      manifest.plan.steps.push(step);
      i += 1 + childrenOf(i).length;
      continue;
    }

    if (text === "uncertainty:") {
      const u: NonNullable<DraftManifest["uncertainty"]> = { assumptions: [], openQuestions: [] };
      for (const c of childrenOf(i)) {
        if (c.text.startsWith("annahme:")) {
          const m = /annahme:\s*("(?:[^"\\]|\\.)*")\s*\(([\d.]+)\)/.exec(c.text);
          if (m) u.assumptions!.push({ text: JSON.parse(m[1]!) as string, confidence: Number(m[2]) });
        } else if (c.text.startsWith("frage:")) {
          const blocks = / blockt$/.test(c.text);
          const qm = /frage:\s*("(?:[^"\\]|\\.)*")/.exec(c.text);
          if (qm) u.openQuestions!.push({ q: JSON.parse(qm[1]!) as string, blocksExecution: blocks });
        }
      }
      manifest.uncertainty = u;
      i += 1 + childrenOf(i).length;
      continue;
    }

    if (text.startsWith("lifecycle:")) {
      manifest.lifecycle = { mode: text.slice("lifecycle:".length).trim() as never };
      i += 1;
      continue;
    }

    throw new AimError(AIM_ERROR_CODES.SCHEMA_INVALID, `unrecognized .aim line: "${line.raw}"`);
  }

  return manifest;
}

function parseStep(head: Line, kids: Line[], refTrust: Map<string, Trust>): Step {
  const m = /^step\s+([A-Za-z][\w-]*)\s*\((.*)\)$/.exec(head.text);
  if (!m) throw new AimError(AIM_ERROR_CODES.SCHEMA_INVALID, `invalid step header: "${head.raw}"`);
  const id = m[1]!;
  const inside = m[2]!.split(",").map((s) => s.trim());
  const typeTokens = inside[0]!.split(/\s+/);
  const type = typeTokens[0] as Step["type"];
  const effect = (typeTokens[1] as Effect | undefined) ?? undefined;
  let usesReadable = "";
  for (const tok of inside.slice(1)) {
    if (tok.startsWith("skill:")) usesReadable = tok.slice("skill:".length).trim();
  }
  const trust = refTrust.get(usesReadable);
  const uses = trust ? `${trust}.${usesReadable}` : usesReadable;

  const step: Step = { id, type, uses };
  if (effect) step.effect = effect;

  let k = 0;
  while (k < kids.length) {
    const c = kids[k]!;
    if (c.indent !== kids[0]!.indent) {
      k++;
      continue; // grandchild, handled by its parent block
    }
    const t = c.text;
    if (t.startsWith("when:")) step.condition = expandShortBinding(t.slice("when:".length).trim());
    else if (t.startsWith("dependsOn:")) step.dependsOn = splitList(t.slice("dependsOn:".length));
    else if (t === "prompt:") step.prompt = parsePrompt(grandchildren(kids, k));
    else if (t === "input:") step.input = parseInput(grandchildren(kids, k));
    else if (t.startsWith("output:")) step.output = { schema: t.slice("output:".length).trim() };
    else if (t.startsWith("idempotency:")) step.idempotencyKey = expandShortBinding(t.slice("idempotency:".length).trim());
    else if (t.startsWith("approval:")) step.approval = t.slice("approval:".length).trim() as never;
    else if (t.startsWith("compensation:")) {
      const r = t.slice("compensation:".length).trim();
      // A compensation is always a capability skill (§9.5); default that prefix.
      const ct = refTrust.get(r) ?? "capability";
      step.compensation = `${ct}.${r}`;
    }
    k++;
  }
  return step;
}

function grandchildren(kids: Line[], parentK: number): Line[] {
  const base = kids[parentK]!.indent;
  const out: Line[] = [];
  for (let j = parentK + 1; j < kids.length; j++) {
    if (kids[j]!.indent <= base) break;
    out.push(kids[j]!);
  }
  return out;
}

function parsePrompt(kids: Line[]): Prompt {
  const p: Prompt = { role: "", goal: "", output: { format: "text" } };
  let k = 0;
  while (k < kids.length) {
    const c = kids[k]!;
    if (c.indent !== kids[0]!.indent) {
      k++;
      continue;
    }
    const t = c.text;
    if (t.startsWith("rolle:")) p.role = t.slice("rolle:".length).trim();
    else if (t.startsWith("ziel:")) p.goal = t.slice("ziel:".length).trim();
    else if (t.startsWith("stil:")) p.style = t.slice("stil:".length).trim() as never;
    else if (t === "regeln:") p.rules = grandchildren(kids, k).map((g) => g.text.replace(/^-\s*/, ""));
    else if (t.startsWith("kontext:")) p.contextFrom = splitList(t.slice("kontext:".length));
    else if (t.startsWith("ausgabe:")) {
      const parts = tokenize(t.slice("ausgabe:".length));
      p.output = { format: parts[0] as never, ...(parts[1] ? { schema: parts[1] } : {}) };
    } else if (t.startsWith("fehlt:")) p.onMissingData = t.slice("fehlt:".length).trim() as never;
    k++;
  }
  return p;
}

function parseInput(kids: Line[]): JsonObject {
  const obj: JsonObject = {};
  for (const c of kids) {
    const eq = c.text.indexOf("=");
    if (eq === -1) continue;
    const key = c.text.slice(0, eq).trim();
    const rhs = c.text.slice(eq + 1).trim();
    // literal JSON or a short binding
    if (/^(".*"|-?\d|\{|\[|true|false|null)/.test(rhs)) {
      try {
        obj[key] = JSON.parse(rhs) as Json;
        continue;
      } catch {
        /* fall through to binding */
      }
    }
    obj[key] = expandShortBinding(rhs);
  }
  return obj;
}

function tokenize(s: string): string[] {
  // splits on whitespace but keeps "quoted strings" together
  const out: string[] = [];
  const re = /"(?:[^"\\]|\\.)*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s.trim())) !== null) out.push(m[0]);
  return out;
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}
