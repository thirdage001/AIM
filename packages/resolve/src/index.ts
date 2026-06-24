// @aim/resolve — the Resolve conformance level (§12, §13.6).

export {
  parseVersion,
  compareVersions,
  satisfies,
  highestCompatible,
  type SemVer
} from "./semver.js";

export {
  resolveSkill,
  resolveManifest,
  type SkillSource,
  type ResolveOptions,
  type SkillResolution,
  type ResolveManifestResult
} from "./resolver.js";

export {
  mcpSnapshot,
  mcpSkillSource,
  mcpInvokeWithDriftCheck,
  type McpClient,
  type McpTool,
  type McpResource,
  type McpPrompt,
  type McpClassification,
  type McpSnapshotEntry
} from "./mcp.js";
