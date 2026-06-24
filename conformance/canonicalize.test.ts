// §17.2 (part): RFC 8785 JCS canonicalization.
import { describe, it, expect } from "vitest";
import { canonicalize, serializeNumber } from "@aim/core";

describe("JCS canonicalization (§4.2)", () => {
  it("sorts object keys by code unit", () => {
    expect(canonicalize({ b: 1, a: 2, Z: 3, "10": 4, "1": 5 })).toBe('{"1":5,"10":4,"Z":3,"a":2,"b":1}');
  });

  it("emits non-ASCII literally and escapes control chars", () => {
    expect(canonicalize({ s: "ä\n\t\"\\" })).toBe('{"s":"ä\\n\\t\\"\\\\"}');
  });

  it("uses ECMAScript number formatting", () => {
    expect(serializeNumber(1.0)).toBe("1");
    expect(serializeNumber(1000)).toBe("1000");
    expect(serializeNumber(1e3)).toBe("1000");
    expect(serializeNumber(-0)).toBe("0");
    expect(serializeNumber(0.7)).toBe("0.7");
    expect(serializeNumber(1.5)).toBe("1.5");
  });

  it("rejects non-finite numbers", () => {
    expect(() => serializeNumber(Infinity)).toThrow();
    expect(() => serializeNumber(NaN)).toThrow();
  });

  it("has no insignificant whitespace and stable arrays", () => {
    expect(canonicalize([3, 2, { y: 1, x: 2 }])).toBe('[3,2,{"x":2,"y":1}]');
  });

  it("is deterministic regardless of insertion order", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });
});
