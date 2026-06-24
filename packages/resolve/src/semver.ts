// Minimal, dependency-free SemVer for AIM-managed skills (§12.1). Supports the
// constraint forms the spec names: ^1.2, 2.x, >=1.4 <2.0, =1.0.0, and *.

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(v: string): SemVer | null {
  // strip a leading 'v' and any prerelease/build metadata
  const core = v.trim().replace(/^v/, "").split(/[-+]/)[0]!;
  const parts = core.split(".");
  if (parts.length === 0 || parts.length > 3) return null;
  const nums = parts.map((p) => (p === "x" || p === "*" ? 0 : Number(p)));
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return { major: nums[0] ?? 0, minor: nums[1] ?? 0, patch: nums[2] ?? 0 };
}

export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

type Comparator = (v: SemVer) => boolean;

function rangeFromCaret(token: string): Comparator | null {
  const base = parseVersion(token.slice(1));
  if (!base) return null;
  // ^1.2.3 allows >=1.2.3 <2.0.0 ; ^0.x has stricter semantics but for skill
  // ranges we use the common major-pinned interpretation.
  const upperMajor = base.major === 0 ? base.major : base.major + 1;
  const upperMinor = base.major === 0 ? base.minor + 1 : 0;
  const lower = base;
  return (v) => {
    if (compareVersions(v, lower) < 0) return false;
    const upper: SemVer = base.major === 0 ? { major: 0, minor: upperMinor, patch: 0 } : { major: upperMajor, minor: 0, patch: 0 };
    return compareVersions(v, upper) < 0;
  };
}

function rangeFromX(token: string): Comparator | null {
  // forms like 2.x, 2.*, 1.2.x
  const parts = token.split(".");
  const major = parts[0];
  if (major === undefined) return null;
  const maj = Number(major);
  if (!Number.isInteger(maj)) return null;
  const minorTok = parts[1];
  if (minorTok === undefined || minorTok === "x" || minorTok === "*") {
    return (v) => v.major === maj;
  }
  const min = Number(minorTok);
  return (v) => v.major === maj && v.minor === min;
}

function comparator(token: string): Comparator | null {
  token = token.trim();
  if (token === "" || token === "*") return () => true;
  if (token.startsWith("^")) return rangeFromCaret(token);
  if (token.startsWith(">=")) {
    const b = parseVersion(token.slice(2));
    return b ? (v) => compareVersions(v, b) >= 0 : null;
  }
  if (token.startsWith(">")) {
    const b = parseVersion(token.slice(1));
    return b ? (v) => compareVersions(v, b) > 0 : null;
  }
  if (token.startsWith("<=")) {
    const b = parseVersion(token.slice(2));
    return b ? (v) => compareVersions(v, b) <= 0 : null;
  }
  if (token.startsWith("<")) {
    const b = parseVersion(token.slice(1));
    return b ? (v) => compareVersions(v, b) < 0 : null;
  }
  if (token.startsWith("=")) {
    const b = parseVersion(token.slice(1));
    return b ? (v) => compareVersions(v, b) === 0 : null;
  }
  if (token.includes("x") || token.includes("*")) return rangeFromX(token);
  // bare version → exact match
  const b = parseVersion(token);
  return b ? (v) => compareVersions(v, b) === 0 : null;
}

/** Does `version` satisfy `range`? Space-separated comparators are AND-ed. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const tokens = range.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  for (const tok of tokens) {
    const cmp = comparator(tok);
    if (!cmp) return false;
    if (!cmp(v)) return false;
  }
  return true;
}

/** Highest version (string) satisfying the range, or null. */
export function highestCompatible(versions: string[], range: string): string | null {
  const matching = versions
    .map((s) => ({ s, v: parseVersion(s) }))
    .filter((x): x is { s: string; v: SemVer } => x.v !== null && satisfies(x.s, range));
  if (matching.length === 0) return null;
  matching.sort((a, b) => compareVersions(b.v, a.v));
  return matching[0]!.s;
}
