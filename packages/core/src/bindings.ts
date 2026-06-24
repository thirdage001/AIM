// Binding expressions (§8). A binding is a REFERENCE expression, never
// executable code, so the whole data-flow graph is determinable by parsing.
// This module provides: a recursive-descent parser for the §8.1 grammar, static
// dependency extraction (§8.2), and a runtime resolver (§8.2 semantics).

import { AimError, AIM_ERROR_CODES } from "./errors.js";
import type { Json } from "./model.js";

export type PathSeg = { kind: "key"; name: string } | { kind: "index"; index: number };

export type Expr =
  | { kind: "inputs"; path: PathSeg[] }
  | { kind: "steps"; stepId: string; path: PathSeg[] }
  | { kind: "skills"; skillRef: string }
  | { kind: "transform"; name: string; args: Expr[] }
  | { kind: "literal"; value: Json };

const BINDING_RE = /^\$\{[\s\S]*\}$/;

/** True if a value is a full binding string `${…}`. */
export function isBinding(value: unknown): value is string {
  return typeof value === "string" && BINDING_RE.test(value.trim());
}

// — Parser —

class Parser {
  private s: string;
  private i = 0;
  constructor(input: string) {
    this.s = input;
  }

  private err(msg: string): never {
    throw new AimError(
      AIM_ERROR_CODES.BINDING_UNRESOLVED,
      `Invalid binding at position ${this.i}: ${msg} in "${this.s}"`
    );
  }
  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
  private peek(): string {
    return this.s[this.i] ?? "";
  }
  private eat(ch: string) {
    if (this.s[this.i] !== ch) this.err(`expected '${ch}'`);
    this.i++;
  }
  private startsWith(token: string): boolean {
    return this.s.startsWith(token, this.i);
  }

  parseRoot(): Expr {
    this.ws();
    this.eat("$");
    this.eat("{");
    this.ws();
    const e = this.parseExpr();
    this.ws();
    this.eat("}");
    this.ws();
    if (this.i !== this.s.length) this.err("trailing characters after '}'");
    return e;
  }

  private parseExpr(): Expr {
    this.ws();
    if (this.startsWith("inputs.")) {
      this.i += "inputs.".length;
      return { kind: "inputs", path: this.parsePath() };
    }
    if (this.startsWith("steps.")) {
      this.i += "steps.".length;
      const stepId = this.parseIdent();
      if (!this.startsWith(".output")) this.err("expected '.output' after step id");
      this.i += ".output".length;
      let path: PathSeg[] = [];
      if (this.peek() === "." || this.peek() === "[") path = this.parsePath();
      return { kind: "steps", stepId, path };
    }
    if (this.startsWith("skills.")) {
      this.i += "skills.".length;
      const skillRef = this.parseSkillRef();
      if (!this.startsWith(".resolved")) this.err("expected '.resolved' after skill ref");
      this.i += ".resolved".length;
      return { kind: "skills", skillRef };
    }
    // Otherwise: a literal, or a transform call (skillref "(" ... ")").
    const lit = this.tryParseLiteral();
    if (lit !== undefined) return lit;
    return this.parseTransform();
  }

  private parseTransform(): Expr {
    const name = this.parseSkillRef();
    this.ws();
    this.eat("(");
    const args: Expr[] = [];
    this.ws();
    if (this.peek() !== ")") {
      args.push(this.parseArg());
      this.ws();
      while (this.peek() === ",") {
        this.i++;
        args.push(this.parseArg());
        this.ws();
      }
    }
    this.eat(")");
    return { kind: "transform", name, args };
  }

  private parseArg(): Expr {
    this.ws();
    const lit = this.tryParseLiteral();
    if (lit !== undefined) return lit;
    return this.parseExpr();
  }

  private tryParseLiteral(): Expr | undefined {
    this.ws();
    const c = this.peek();
    if (c === '"') return { kind: "literal", value: this.parseString() };
    if (c === "-" || (c >= "0" && c <= "9")) return { kind: "literal", value: this.parseNumber() };
    if (this.startsWith("true")) {
      this.i += 4;
      return { kind: "literal", value: true };
    }
    if (this.startsWith("false")) {
      this.i += 5;
      return { kind: "literal", value: false };
    }
    if (this.startsWith("null")) {
      this.i += 4;
      return { kind: "literal", value: null };
    }
    return undefined;
  }

  private parseString(): string {
    this.eat('"');
    let out = "";
    while (this.i < this.s.length && this.peek() !== '"') {
      const ch = this.s[this.i++]!;
      if (ch === "\\") {
        const e = this.s[this.i++]!;
        out += e === "n" ? "\n" : e === "t" ? "\t" : e;
      } else {
        out += ch;
      }
    }
    this.eat('"');
    return out;
  }

  private parseNumber(): number {
    const start = this.i;
    if (this.peek() === "-") this.i++;
    while (/[0-9.eE+-]/.test(this.peek())) this.i++;
    const n = Number(this.s.slice(start, this.i));
    if (Number.isNaN(n)) this.err("invalid number literal");
    return n;
  }

  private parseIdent(): string {
    const start = this.i;
    if (!/[A-Za-z]/.test(this.peek())) this.err("expected identifier (must start with a letter)");
    this.i++;
    while (/[A-Za-z0-9_-]/.test(this.peek())) this.i++;
    return this.s.slice(start, this.i);
  }

  private parseSkillRef(): string {
    let ref = this.parseIdent();
    while (this.peek() === ".") {
      // lookahead: a dotted ident continues the skillref only if followed by a letter
      const next = this.s[this.i + 1] ?? "";
      if (!/[A-Za-z]/.test(next)) break;
      this.i++; // consume '.'
      ref += "." + this.parseIdent();
    }
    return ref;
  }

  private parsePath(): PathSeg[] {
    const segs: PathSeg[] = [];
    // inputs.<path>: caller consumed "inputs." so we are at the first key.
    // steps.<id>.output<path>: caller leaves us before '.' or '['.
    if (this.peek() !== "." && this.peek() !== "[") {
      segs.push({ kind: "key", name: this.parseIdent() });
    }
    for (;;) {
      const c = this.peek();
      if (c === ".") {
        this.i++;
        segs.push({ kind: "key", name: this.parseIdent() });
      } else if (c === "[") {
        this.i++;
        const start = this.i;
        while (/[0-9]/.test(this.peek())) this.i++;
        if (start === this.i) this.err("expected integer index");
        segs.push({ kind: "index", index: Number(this.s.slice(start, this.i)) });
        this.eat("]");
      } else {
        break;
      }
    }
    return segs;
  }
}

/** Parse a full binding string `${…}` into an Expr AST. Throws AIM-E-1003. */
export function parseBinding(text: string): Expr {
  return new Parser(text.trim()).parseRoot();
}

// — Static analysis —

/** Step ids this expression depends on (used to build DAG edges, §8.2). */
export function stepDependencies(expr: Expr): string[] {
  const out = new Set<string>();
  walk(expr, (e) => {
    if (e.kind === "steps") out.add(e.stepId);
  });
  return [...out];
}

/** All transform skill names referenced (must be trust=transform, §8.1). */
export function transformNames(expr: Expr): string[] {
  const out = new Set<string>();
  walk(expr, (e) => {
    if (e.kind === "transform") out.add(e.name);
  });
  return [...out];
}

/** All skill refs referenced via `skills.<ref>.resolved`. */
export function skillRefs(expr: Expr): string[] {
  const out = new Set<string>();
  walk(expr, (e) => {
    if (e.kind === "skills") out.add(e.skillRef);
  });
  return [...out];
}

function walk(expr: Expr, fn: (e: Expr) => void): void {
  fn(expr);
  if (expr.kind === "transform") for (const a of expr.args) walk(a, fn);
}

// — Runtime resolution (§8.2) —

export interface ResolveContext {
  inputs: Record<string, Json>;
  stepOutputs: Record<string, Json>;
  skillVersions: Record<string, string>; // ref -> resolved version
  invokeTransform: (name: string, args: Json[]) => Promise<Json>;
}

export async function resolveExpr(expr: Expr, ctx: ResolveContext): Promise<Json> {
  switch (expr.kind) {
    case "literal":
      return expr.value;
    case "inputs":
      return pickPath(ctx.inputs as Json, expr.path, `inputs`);
    case "steps": {
      if (!(expr.stepId in ctx.stepOutputs)) {
        throw new AimError(
          AIM_ERROR_CODES.BINDING_UNRESOLVED,
          `Step '${expr.stepId}' has no recorded output yet`
        );
      }
      return pickPath(ctx.stepOutputs[expr.stepId] as Json, expr.path, `steps.${expr.stepId}.output`);
    }
    case "skills": {
      const v = ctx.skillVersions[expr.skillRef];
      if (v === undefined) {
        throw new AimError(
          AIM_ERROR_CODES.BINDING_UNRESOLVED,
          `Skill '${expr.skillRef}' is not resolved`
        );
      }
      return v;
    }
    case "transform": {
      const args = await Promise.all(expr.args.map((a) => resolveExpr(a, ctx)));
      return ctx.invokeTransform(expr.name, args);
    }
  }
}

function pickPath(root: Json, path: PathSeg[], label: string): Json {
  let cur: Json = root;
  let trail = label;
  for (const seg of path) {
    if (seg.kind === "key") {
      trail += "." + seg.name;
      if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
        throw new AimError(AIM_ERROR_CODES.BINDING_UNRESOLVED, `Cannot read '${trail}' (parent is not an object)`);
      }
      cur = (cur as { [k: string]: Json })[seg.name] ?? null;
    } else {
      trail += `[${seg.index}]`;
      if (!Array.isArray(cur)) {
        throw new AimError(AIM_ERROR_CODES.BINDING_UNRESOLVED, `Cannot index '${trail}' (parent is not an array)`);
      }
      cur = cur[seg.index] ?? null;
    }
  }
  return cur;
}
