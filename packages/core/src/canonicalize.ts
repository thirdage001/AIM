// RFC 8785 JSON Canonicalization Scheme (JCS), §4.2 of the spec.
// Pure, synchronous, dependency-free. Produces the exact byte string that is
// then hashed (§4.1). The trickiest part is number serialization; see below.

import { AimError, AIM_ERROR_CODES } from "./errors.js";
import type { Json } from "./model.js";

/**
 * Canonicalize a JSON value to its RFC 8785 string form:
 *  - object keys sorted by UTF-16 code unit (JS default string sort),
 *  - no insignificant whitespace,
 *  - minimal string escaping, non-ASCII emitted literally (UTF-8 source text),
 *  - ECMAScript number serialization (which RFC 8785 adopts).
 */
export function canonicalize(value: Json): string {
  return serialize(value);
}

function serialize(value: Json): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value);
    case "string":
      return serializeString(value);
    case "object":
      if (Array.isArray(value)) return serializeArray(value);
      return serializeObject(value as { [k: string]: Json });
    default:
      throw new AimError(
        AIM_ERROR_CODES.SCHEMA_INVALID,
        `Value of type ${typeof value} is not representable in canonical JSON`
      );
  }
}

function serializeArray(arr: Json[]): string {
  let out = "[";
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) out += ",";
    out += serialize(arr[i] as Json);
  }
  return out + "]";
}

function serializeObject(obj: { [k: string]: Json }): string {
  // RFC 8785: members are sorted on the UTF-16 code units of their names.
  const keys = Object.keys(obj).sort();
  let out = "{";
  let first = true;
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue; // undefined is not JSON; skip like JSON.stringify
    if (!first) out += ",";
    first = false;
    out += serializeString(key) + ":" + serialize(v);
  }
  return out + "}";
}

// RFC 8785 §3.2.2.2 — minimal escaping.
const ESCAPE: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r"
};

function serializeString(str: string): string {
  let out = '"';
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    const esc = ESCAPE[ch];
    if (esc !== undefined) {
      out += esc;
    } else if (code < 0x20) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else {
      // Everything else (including non-ASCII) is emitted literally.
      out += ch;
    }
  }
  return out + '"';
}

/**
 * Number serialization. RFC 8785 adopts the ECMAScript Number-to-String
 * algorithm, which is exactly what `String(n)` / `Number.prototype.toString`
 * implements in modern engines (Node, Deno, Workers). The only normalizations
 * we apply: collapse -0 to 0, and reject non-finite values (not valid JSON).
 */
export function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new AimError(
      AIM_ERROR_CODES.SCHEMA_INVALID,
      `Non-finite number (${String(n)}) is not valid JSON`
    );
  }
  if (Object.is(n, -0)) return "0";
  return String(n);
}

const ENCODER = new TextEncoder();

/** Canonical bytes (UTF-8) of a JSON value — the input to SHA-256 (§4.1). */
export function canonicalBytes(value: Json): Uint8Array {
  return ENCODER.encode(canonicalize(value));
}
