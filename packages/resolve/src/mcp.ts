// MCP as a skill source and execution target (§13.6). MCP is dynamic, so AIM
// snapshots it at resolve time, normalizes, hashes and locks it; execution
// refuses if the server has drifted since (AIM-E-2006 / AIM-E-2007).
//
// The transport is abstracted behind McpClient so this stays runtime-neutral
// and testable without a live server.

import {
  AimError,
  AIM_ERROR_CODES,
  computeSkillHash,
  normalizeSkill,
  type CryptoPort,
  type Json,
  type McpServerRef,
  type SkillBody
} from "@aim/core";
import type { SkillSource } from "./resolver.js";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Json;
}
export interface McpResource {
  uri: string;
  name?: string;
  text?: string;
}
export interface McpPrompt {
  name: string;
  description?: string;
}

export interface McpClient {
  server: McpServerRef;
  listTools(): Promise<McpTool[]>;
  listResources(): Promise<McpResource[]>;
  listPrompts(): Promise<McpPrompt[]>;
  getTool(name: string): Promise<McpTool | null>;
  callTool(name: string, input: Json): Promise<Json>;
}

// §13.6.1 mapping. Scopes are NOT inferred (§13.6.3 rule 1) and effect is
// write-by-default unless the operator confirmed read-only (§13.6.3 rule 2).
export interface McpClassification {
  // tool name -> operator-confirmed read-only? (default: treat as write)
  readOnlyTools?: Set<string>;
  // tool name -> explicit scopes assigned by the operator/author
  toolScopes?: Record<string, string[]>;
}

function toolToSkill(server: McpServerRef, tool: McpTool, cls: McpClassification): SkillBody {
  const raw: Record<string, Json> = {
    aim: "1.0",
    kind: "Skill",
    name: `capability.mcp.${tool.name}`,
    version: server.id, // opaque sourceRevision (§12.1)
    trust: "capability",
    interface: { inputSchema: tool.inputSchema ?? {} },
    scopes: cls.toolScopes?.[tool.name] ?? []
  };
  return normalizeSkill(raw);
}

function resourceToSkill(resource: McpResource): SkillBody {
  return normalizeSkill({
    aim: "1.0",
    kind: "Skill",
    name: `knowledge.mcp.${resource.name ?? resource.uri}`,
    version: resource.uri,
    trust: "knowledge"
  });
}

function promptToSkill(prompt: McpPrompt): SkillBody {
  return normalizeSkill({
    aim: "1.0",
    kind: "Skill",
    name: `knowledge.mcp.prompt.${prompt.name}`,
    version: prompt.name,
    trust: "knowledge"
  });
}

export interface McpSnapshotEntry {
  ref: string;
  body: SkillBody;
  hash: string;
}

/** Take a full snapshot of an MCP server's primitives, normalized and hashed. */
export async function mcpSnapshot(
  crypto: CryptoPort,
  client: McpClient,
  cls: McpClassification = {}
): Promise<McpSnapshotEntry[]> {
  const out: McpSnapshotEntry[] = [];
  for (const tool of await client.listTools()) {
    const body = toolToSkill(client.server, tool, cls);
    out.push({ ref: body.name, body, hash: await computeSkillHash(crypto, body) });
  }
  for (const res of await client.listResources()) {
    const body = resourceToSkill(res);
    out.push({ ref: body.name, body, hash: await computeSkillHash(crypto, body) });
  }
  for (const p of await client.listPrompts()) {
    const body = promptToSkill(p);
    out.push({ ref: body.name, body, hash: await computeSkillHash(crypto, body) });
  }
  return out;
}

/** Expose an MCP server as a SkillSource for the resolver (opaque revision). */
export function mcpSkillSource(client: McpClient, cls: McpClassification = {}): SkillSource {
  return {
    name: "mcp",
    async listVersions() {
      return [client.server.id];
    },
    async fetch(ref) {
      const toolName = ref.replace(/^capability\.mcp\./, "");
      const tool = await client.getTool(toolName);
      if (!tool) throw new AimError(AIM_ERROR_CODES.MCP_TOOL_GONE, `MCP tool '${toolName}' not found`);
      return toolToSkill(client.server, tool, cls) as unknown as Record<string, Json>;
    }
  };
}

/**
 * §13.6.4 execution-time drift check for a capability step with MCP origin.
 * Verifies the live tool definition still matches the locked hash before the
 * single call.
 */
export async function mcpInvokeWithDriftCheck(
  crypto: CryptoPort,
  client: McpClient,
  toolName: string,
  lockedHash: string,
  input: Json,
  cls: McpClassification = {}
): Promise<Json> {
  const live = await client.getTool(toolName);
  if (!live) throw new AimError(AIM_ERROR_CODES.MCP_TOOL_GONE, `MCP tool '${toolName}' gone`);
  const liveHash = await computeSkillHash(crypto, toolToSkill(client.server, live, cls));
  if (liveHash !== lockedHash) {
    throw new AimError(AIM_ERROR_CODES.MCP_DRIFT, `MCP tool '${toolName}' drifted since lock`);
  }
  return client.callTool(toolName, input);
}
