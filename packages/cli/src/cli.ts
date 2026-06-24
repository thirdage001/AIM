// AIM command-line interface. Deterministic commands (compile/render/validate/
// diff) run fully offline; `run` uses the reference adapter with a mock model by
// default; `lock`/`resolve` use a local skills directory; `author` needs a model.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import process from "node:process";
import {
  canonicalize,
  compile,
  render,
  diff,
  renderDiff,
  assertValidManifest,
  gateG1,
  gateG2,
  computeManifestHash,
  isAimError,
  type Json,
  type Manifest
} from "@aim/core";
import {
  webCryptoPort,
  NodeLockStore,
  autoApprovalGate,
  autoReviewGate,
  runManifest,
  inMemoryStoreCapabilities,
  createCapabilityRegistry
} from "@aim/host-node";
import { createMockModelProvider } from "@aim/adapter-reference";

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}
async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readText(path));
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        flags[a.slice(2)] = args[i + 1] ?? "true";
        if (args[i + 1] && !args[i + 1]!.startsWith("--")) i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

async function loadManifest(path: string): Promise<Manifest> {
  if (path.endsWith(".aim")) {
    const draft = compile(await readText(path));
    return draft as unknown as Manifest;
  }
  return (await readJson(path)) as Manifest;
}

// Resolve the lock path relative to the manifest file's directory.
function lockPathFor(manifestFile: string, manifest: Manifest): string {
  const lock = manifest.provenance?.lock ?? "aim.lock";
  return isAbsolute(lock) ? lock : join(dirname(manifestFile), lock);
}

async function cmdCompile(file: string, flags: Record<string, string>): Promise<void> {
  const draft = compile(await readText(file));
  const json = canonicalize(draft as unknown as Json);
  if (flags.out) {
    await writeFile(flags.out, json + "\n", "utf8");
    console.error(`wrote ${flags.out}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

async function cmdRender(file: string): Promise<void> {
  const manifest = (await readJson(file)) as Manifest;
  process.stdout.write(render(manifest));
}

async function cmdValidate(file: string): Promise<void> {
  const manifest = await loadManifest(file);
  try {
    assertValidManifest(manifest);
    console.log("schema: OK");
  } catch (e) {
    if (isAimError(e)) {
      console.log(`schema: FAIL (${e.code})`);
      for (const d of e.details) console.log(`  - ${d.path ?? ""} ${d.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  const g1 = gateG1(manifest);
  console.log(`G1 (draft→reviewable): ${g1.ok ? "OK" : "FAIL"}`);
  if (!g1.ok) for (const d of g1.errors) console.log(`  - ${d.code} ${d.message}`);
  console.log(`lifecycle.mode: ${manifest.lifecycle.mode}`);

  // Try to drive G2 with auto gates and report what blocks executable.
  const lock = await new NodeLockStore(lockPathFor(file, manifest)).load();
  try {
    await gateG2(manifest, {
      crypto: webCryptoPort,
      lock,
      grantedApprovals: new Set(manifest.plan.steps.filter((s) => s.approval === "required").map((s) => s.id)),
      review: autoReviewGate,
      rendered: render(manifest)
    });
    console.log("G2 (reviewable→executable): OK (would be executable)");
  } catch (e) {
    if (isAimError(e)) console.log(`G2 (reviewable→executable): BLOCKED (${e.code}) ${e.message}`);
    else throw e;
  }
}

async function cmdDiff(a: string, b: string): Promise<void> {
  const ma = (await readJson(a)) as Json;
  const mb = (await readJson(b)) as Json;
  process.stdout.write(renderDiff(diff(ma, mb)) + "\n");
}

async function cmdRun(file: string, flags: Record<string, string>): Promise<void> {
  let manifest = await loadManifest(file);
  const inputs: Record<string, Json> = flags.inputs ? (JSON.parse(flags.inputs) as Record<string, Json>) : {};

  // drive to executable via auto gates (fails loudly on blocking questions etc.)
  if (manifest.lifecycle.mode !== "executable") {
    const lock = await new NodeLockStore(lockPathFor(file, manifest)).load();
    manifest = await gateG2(manifest, {
      crypto: webCryptoPort,
      lock,
      grantedApprovals: new Set(manifest.plan.steps.filter((s) => s.approval === "required").map((s) => s.id)),
      review: autoReviewGate,
      rendered: render(manifest)
    });
  }

  const model = createMockModelProvider();
  if (flags["model-output"]) model.push(JSON.parse(flags["model-output"]) as Json);

  const store = inMemoryStoreCapabilities();
  const result = await runManifest(manifest, inputs, {
    model,
    capability: createCapabilityRegistry(store.handlers),
    approval: autoApprovalGate
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) process.exitCode = 1;
}

async function cmdHash(file: string): Promise<void> {
  const manifest = await loadManifest(file);
  console.log(await computeManifestHash(webCryptoPort, manifest));
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  switch (cmd) {
    case "compile":
      return cmdCompile(positional[0]!, flags);
    case "render":
      return cmdRender(positional[0]!);
    case "validate":
      return cmdValidate(positional[0]!);
    case "diff":
      return cmdDiff(positional[0]!, positional[1]!);
    case "run":
      return cmdRun(positional[0]!, flags);
    case "hash":
      return cmdHash(positional[0]!);
    default:
      console.log("usage: aim <compile|render|validate|diff|run|hash> <file> [--flags]");
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  if (isAimError(e)) {
    console.error(`[${e.code}] ${e.message}`);
    for (const d of e.details) console.error(`  - ${d.path ?? ""} ${d.message}`);
  } else {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  }
  process.exitCode = 1;
});
