// §17.13: the .aim compiler is deterministic and round-trip-true.
import { describe, it, expect } from "vitest";
import { compile, render, expandShortBinding, contractBinding, canonicalize } from "@aim/core";

const SOURCE = `manifest "Rechnungsfelder extrahieren und ablegen"
  intent: Felder aus einem Dokument extrahieren und als Datensatz ablegen.
  source: natural-language
  authoredBy: human
  id: mf_8c1d4f

inputs:
  document file required
  targetTable string required

uses:
  knowledge invoice-fields ^1.2
  transform normalize-date =1.0.0
  transform non-empty =1.0.0
  capability store.upsert 2.x approval(required)

context: minimal-relevant

step extract (model, skill: invoice-fields)
  prompt:
    rolle: Rechnungs-Extraktor
    ziel: Extrahiere die Pflichtfelder als JSON.
    stil: strict
    regeln:
      - Nur Werte aus dem Dokument verwenden.
      - Keine fehlenden Werte erfinden.
    kontext: knowledge.invoice-fields, input:document
    ausgabe: json InvoiceFields
    fehlt: return_validation_error
  output: InvoiceFields

step store (capability write, skill: store.upsert)
  when: non-empty(extract.fields)
  dependsOn: extract
  input:
    table = inputs.targetTable
    record = extract.fields
  output: StoreResult
  idempotency: extract.fields.invoiceNo
  approval: required
  compensation: store.delete

lifecycle: draft
`;

describe("short-binding expansion (§5.2)", () => {
  it("expands and contracts symmetrically", () => {
    expect(expandShortBinding("extract.fields")).toBe("${steps.extract.output.fields}");
    expect(expandShortBinding("inputs.targetTable")).toBe("${inputs.targetTable}");
    expect(expandShortBinding("non-empty(extract.fields)")).toBe("${transform.non-empty(steps.extract.output.fields)}");
    expect(contractBinding("${steps.extract.output.fields.invoiceNo}")).toBe("extract.fields.invoiceNo");
    expect(contractBinding("${transform.non-empty(steps.extract.output.fields)}")).toBe("non-empty(extract.fields)");
  });
});

describe(".aim compiler (§5.2)", () => {
  it("compile is deterministic (byte-identical canonical JSON)", () => {
    const a = canonicalize(compile(SOURCE) as never);
    const b = canonicalize(compile(SOURCE) as never);
    expect(a).toBe(b);
  });

  it("expands canonical bindings during compile", () => {
    const m = compile(SOURCE);
    const store = m.plan.steps.find((s) => s.id === "store")!;
    expect(store.idempotencyKey).toBe("${steps.extract.output.fields.invoiceNo}");
    expect(store.condition).toBe("${transform.non-empty(steps.extract.output.fields)}");
    expect((store.input as Record<string, unknown>).record).toBe("${steps.extract.output.fields}");
    expect(store.uses).toBe("capability.store.upsert");
    expect(store.compensation).toBe("capability.store.delete");
  });

  it("render(compile(x)) round-trips semantically", () => {
    const m1 = compile(SOURCE);
    const m2 = compile(render(m1));
    expect(canonicalize(m2 as never)).toBe(canonicalize(m1 as never));
  });
});
