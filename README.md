# AIM 1.0 — Reference Implementation

A reference implementation of the [AIM (Authored Intent Manifest)](./AIM-Specification-1.0.md)
1.0 specification: a declarative, JSON-based manifest format that describes an
AI-driven, multi-step workflow completely and verifiably.

It implements all three conformance levels:

- **Core** (mandatory) — object model, RFC 8785 canonicalization + SHA-256 hashing,
  the `.aim ↔ .aim.json` compiler, binding resolution, plan execution + prompt
  composer, validation, the lifecycle state machine, lock verification, and the
  `reference-node` adapter.
- **Resolve** — SemVer skill resolution, trust anchors, conflict detection, lock
  generation, and MCP as a skill source (§12, §13.6).
- **Author** — natural language → draft manifest with the clarification loop and the
  hard authoring guards (§3).

## Portability

The kernel (`@aim/core`) has **zero runtime dependencies** and uses **Web-Standard
APIs only** (Web Crypto, `TextEncoder`, `structuredClone`). It runs unchanged on
**Node 18+**, **Deno / Supabase Edge Functions**, and **Cloudflare Workers**:

- Hashing goes through `crypto.subtle.digest` (async on all three runtimes).
- JSON-Schema validation uses an **Ajv standalone** validator compiled at build time
  to plain ESM and committed — **no runtime `eval`/`new Function`**, so it is
  Workers-safe.
- All I/O (files, locks, idempotency, approval, review, model/capability calls) is
  behind **injected ports**. Each runtime supplies its own host package; only
  `@aim/host-node` exists today, but `host-deno` / `host-workers` drop in beside it
  with no kernel change.

An ESLint guard forbids `node:*` / `Buffer` / `process` in the kernel and the adapter.

## Packages

| Package | Purpose |
|---|---|
| `@aim/core` | Portable kernel (§4–§13). Zero deps. |
| `@aim/adapter-reference` | `reference-node` adapter + built-in transforms + mock model. |
| `@aim/provider-vercel` | `ModelProvider` over the Vercel AI SDK (one call per step, no tool loop). |
| `@aim/resolve` | Resolve level: SemVer, anchors, conflicts, lock, MCP. |
| `@aim/author` | Author level: NL → draft, clarification loop, guards. |
| `@aim/host-node` | Node ports + runtime assembly. |
| `@aim/cli` | `aim` CLI: compile / render / validate / diff / run / hash. |

## Quick start

```bash
pnpm install
pnpm gen:schema          # regenerate the eval-free validator (idempotent)
pnpm -r build
pnpm test                # 44 conformance tests across the §17 checklist

# CLI against the §16 example
node packages/cli/dist/cli.js validate examples/invoice/invoice.aim.json
node packages/cli/dist/cli.js render   examples/invoice/invoice.aim.json
node packages/cli/dist/cli.js run      examples/invoice/invoice.runnable.aim.json \
  --inputs '{"targetTable":"invoices"}' \
  --model-output '{"fields":{"invoiceNo":"R-1","date":"01.02.2026","total":99}}'
```

The §16 example is intentionally `reviewable`, not `executable` — it has a blocking
open question, so `validate` reports the G2 gate blocked with `AIM-E-1005`.

## Cross-runtime checks

```bash
deno run --allow-read scripts/deno-smoke.ts     # Supabase Edge target
# Cloudflare Workers: run the canonicalize/hash/composer subset under
# @cloudflare/vitest-pool-workers (miniflare) in CI.
```

## Conformance to §17

All 13 Core checklist items are covered by tests in `conformance/`, mapping each
item (and its `AIM-E-*` negative cases) to concrete assertions. See the test files
for the item-by-item mapping.
