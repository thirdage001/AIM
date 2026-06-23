# AIM — Authored Intent Manifest

**Spezifikation Version 1.0 — Normatives Dokument**

Status: Stabil · Format: kanonisch `*.aim.json`, lesbar `*.aim` · Schema: JSON Schema 2020-12

> **Lesart dieses Dokuments.** Abschnitt 0 ist die lesbare Einführung in Prosa — ein
> Mensch sollte AIM allein daraus verstehen können. Ab Abschnitt 1 beginnt die
> normative Spezifikation für eine Implementierung. Wer AIM nur verstehen will, liest
> Abschnitt 0. Wer es baut, liest den Rest.

---

## 0. Überblick

### Worum es geht

Ein Mensch sagt, was er erreichen will. Zwischen diesem Satz und einem korrekt
ausgeführten, mehrstufigen Workflow in der echten Welt liegt mehr als ein einziger
Modellaufruf. Ein komplexer Intent ist keine einzelne Aktion: Die richtigen Schritte
müssen gefunden, die Details jeder API und jedes Tools getroffen, Zustände und IDs über
Schritte hinweg konsistent gehalten, nichts erfunden werden. Kein einzelner Prompt
erzeugt das zuverlässig in einem Zug — nicht weil das Modell schwach wäre, sondern
weil die Aufgabe ihrer Natur nach eine Kette voneinander abhängiger Schritte ist, von
denen jeder verankert und überprüfbar sein muss.

Genau deshalb sind Zwischenschritte nicht etwas, das man aus Vorsicht hinzufügt — sie
*sind* die Substanz der Arbeit. AIM macht diese Zwischenschritte explizit und
inspizierbar: Jeder Schritt hat eine definierte Ausgabe, der Datenfluss zwischen den
Schritten ist benannt, jede Übergabestelle ist prüfbar. Das **Manifest** ist das
Gerüst, das die Aufgabe ohnehin braucht — nützlich für die Maschine (Korrektheit,
Zustand, Verankerung) und für den Menschen (lesen, versionieren, freigeben)
gleichermaßen.

Erst beschreiben, dann ausführen — nicht um das Modell auszubremsen, sondern weil ein
zuverlässiger Workflow seine explizite Struktur *ist*. Der Mensch ist hier kein
Bremsklotz; er ist eine von mehreren Prüfinstanzen an Übergabestellen, die es aus
Korrektheitsgründen ohnehin geben muss.

### Das Bild dahinter

Ein Workflow zu bauen ist wie ein mehrgängiges Menü zu kochen — wobei die meisten
Zutaten erst während des Kochens entstehen:

- **Skills** sind die *Grundzutaten und Geräte* — Wissen über eine API, eine
  ausführbare Aktion, eine Rechenfunktion. Jede ist beschriftet (versioniert) und
  versiegelt (gehasht), damit niemand heimlich etwas austauscht.
- **Kontext** ist die *Auswahl*, die dieser eine Gang wirklich braucht — nicht der
  ganze Vorratsschrank.
- Der **Prompt** ist das *Rezept eines Gangs* — er sagt dem Modell, was aus den
  Zutaten werden soll. In AIM kein zufälliger Textblock, sondern ein beschriebenes
  Rezept mit Rolle, Ziel, Regeln und der Form des Ergebnisses (Abschnitt 9.6).
- **Capabilities** sind die *Handgriffe nach außen* — alles, was die Küche verlässt
  und deshalb besonders abgesichert wird.
- Der **Plan** ist die *Abfolge der Gänge* — und genau hier liegt der Kern: Ein Gang
  liefert die Zutat für den nächsten. Der Fond aus dem ersten Schritt ist die
  Grundlage der Sauce im zweiten; ohne ihn kann der zweite Schritt nicht beginnen.

Diese Abhängigkeit ist der eigentliche Punkt. Man kann ein solches Menü nicht in einem
einzigen Griff zubereiten, weil viele Zutaten zu Beginn schlicht noch nicht existieren
— sie sind das *Ergebnis* vorheriger Schritte. Im Manifest heißt das: Die Ausgabe
eines Schritts wird benannt und fließt als Eingabe in den nächsten (in AIM über
*Bindings*, Abschnitt 8). Erst dieses Weiterreichen von Zwischenprodukten macht aus
einzelnen Aktionen einen Workflow.

An jeder Übergabe lässt sich kosten und nachwürzen: Stimmt das Zwischenergebnis nicht,
geht es nicht weiter (Validierung, Abschnitt 10). Und bei Schritten, die das Lokal
verlassen — eine Bestellung rausgeben —, fragt die Küche vorher nach (Approval), kann
einen Fehlgang zurücknehmen (Kompensation) und gibt denselben Gang nie doppelt aus
(Idempotenz).

Das Manifest schreibt dieses Menü auf. Ein **Adapter** kocht es später mit einer
konkreten Laufzeit.

### Zwei Oberflächen, eine Wahrheit

Damit es lesbar *und* maschinell exakt bleibt, hat AIM zwei Oberflächen für dieselbe
Sache:

- **`*.aim`** — lesbar, zum Schreiben und Reviewen durch Menschen.
- **`*.aim.json`** — kanonisch, gehasht, zum Ausführen durch Maschinen.

Die lesbare Form wird **deterministisch** in die kanonische übersetzt; Hashes, Locks
und Prüfsummen erzeugt das Werkzeug, nicht der Mensch (Abschnitt 5.2). So liest und
schreibt man dies:

```aim
manifest "Rechnungsfelder extrahieren und ablegen"
  intent: Felder aus einem Dokument extrahieren und als Datensatz ablegen.

uses:
  knowledge  invoice-fields   ^1.2
  capability store.upsert      2.x   approval(required)

step extract (model, skill: invoice-fields)
  prompt:
    rolle:  Rechnungs-Extraktor
    ziel:   Extrahiere die Pflichtfelder als JSON.
    regeln:
      - Nur Werte aus dem Dokument verwenden.
      - Keine fehlenden Werte erfinden.
    ausgabe: JSON nach Schema InvoiceFields
  output: InvoiceFields

step store (capability write, skill: store.upsert)
  when:  non-empty(extract.fields)
  input:
    record = extract.fields
  idempotency: extract.fields.invoiceNo
  approval: required
  compensation: store.delete
```

### Drei Versprechen

1. **Erst beschreiben, dann handeln.** Nichts wird ausgeführt, was nicht zuvor als
   Manifest dasteht, geprüft und (bei Schreibzugriffen) freigegeben wurde.
2. **Was zählt, ist versiegelt.** Skills werden auf exakte, gehashte Versionen
   festgenagelt. „Neueste Version" gibt es nicht.
3. **Unsicherheit wird sichtbar.** Annahmen und offene Fragen stehen im Manifest; eine
   offene Frage kann die Ausführung blockieren, bis ein Mensch sie beantwortet.

### Wo Determinismus lebt — und wo nicht

Das Manifest selbst ist vollständig deterministisch: gleiche Bytes, gleicher Hash,
gleiches Verhalten. Zwei Dinge sind es bewusst nicht — die Erzeugung eines Manifests
aus natürlicher Sprache und der Aufruf eines Sprachmodells *innerhalb* eines Schritts.
Genau deshalb stehen beide unter Prüf- und Freigabetoren und nicht im sicheren Kern.

---

## 1. Einleitung

AIM ist ein deklaratives, JSON-basiertes Manifestformat. Ein Manifest beschreibt
einen KI-gestützten Workflow vollständig und überprüfbar: welche Fähigkeiten
(Skills) er benutzt, welche Schritte er in welcher Reihenfolge ausführt, wie Daten
zwischen den Schritten fließen, welche Sicherheits- und Freigaberegeln gelten und wie
das Ergebnis geprüft wird.

Ein Manifest ist das einzige maßgebliche Artefakt zur Ausführung. Eine konforme
Runtime führt ausschließlich aus, was im Manifest steht. AIM ist runtime-unabhängig;
die konkrete Ausführung erfolgt über einen Adapter (Abschnitt 13).

### 1.1 Geltungsbereich (Conformance Levels)

Eine Implementierung MUSS angeben, welche Stufe sie erfüllt.

| Level | Inhalt | Pflicht |
|------|--------|---------|
| **Core** | Manifest-Objektmodell (§6), Kanonisierung & Hashing (§4), beide Oberflächen inkl. `.aim`-Compiler (§5), Binding-Auflösung (§8), Plan-Ausführung & Prompt Composer (§9), Validierung (§10), Lifecycle (§11), Lock-Verifikation (§12.4), ein Referenz-Adapter (§13) | ja |
| **Resolve** | Skill Resolver mit Trust-Anchors und Konfliktauflösung (§12.1–12.3) | optional |
| **Author** | Erzeugung von Draft-Manifesten aus natürlicher Sprache inkl. Klärungsschleife und Selbstbeschreibung (§3.1–§3.5) | optional |

Der Kern (Core) MUSS ohne jedes Sprachmodell funktionieren: Ein von Hand
geschriebenes, gültiges Manifest ist vollständig ausführbar.

### 1.2 Normative Sprache

Die Schlüsselwörter **MUSS**, **MUSS NICHT**, **SOLLTE**, **SOLLTE NICHT** und
**KANN** sind im Sinne von RFC 2119 zu verstehen.

---

## 2. Terminologie

- **Manifest** — ein `*.aim.json`-Dokument nach diesem Modell.
- **Skill** — ein versioniertes, gehashtes Fähigkeits- oder Wissensmodul.
- **Trust-Achse** — Sicherheitsklasse eines Skills: `knowledge`, `capability` oder
  `transform`.
- **Binding** — ein Referenzausdruck, der einen Wert aus Inputs, Schrittausgaben
  oder Transforms bezieht.
- **Plan** — der gerichtete azyklische Graph (DAG) der Schritte.
- **Prompt** — ein semantisches Objekt (Rolle, Ziel, Regeln, Ausgabevertrag), aus dem
  der Prompt Composer zur Laufzeit den endgültigen Prompt-Text erzeugt.
- **Lock** — die Datei `aim.lock`, die jeden Skill auf eine exakte, gehashte Version
  festschreibt.
- **Adapter** — übersetzt ein gelocktes Manifest in konkrete Laufzeitaufrufe.

---

## 3. Kernkonzept

Ein Manifest trennt zwei Welten:

- **Authoring** — die Erzeugung des Manifests (z. B. durch ein Sprachmodell). Nicht
  deterministisch.
- **Ausführung** — die Abarbeitung des Manifests durch eine Runtime. Deterministisch
  in allem, was nicht ein explizit als `model` markierter Schritt ist.

Alles, was zur Ausführung gelangt, MUSS validiert, gehasht und (bei Bedarf)
freigegeben sein. Daraus folgen die in §10–§12 normierten Tore.

**Invarianten (gelten überall):**

1. Was nicht im Manifest steht, existiert für die Ausführung nicht.
2. Identität ist der Inhalts-Hash, nicht der Name oder die Versionsbezeichnung.
3. Der Datenflussgraph MUSS allein durch statische Analyse des Manifests bestimmbar
   sein. Inline-Code ist NICHT zulässig (§8).
4. Schreibende Operationen MÜSSEN idempotent sein (§9.4).
5. Unsicherheit wird explizit repräsentiert (§6.9), nicht weggelassen.

### 3.1 Der Gesamtablauf

Vom gesprochenen Wunsch bis zum Ergebnis durchläuft das System eine feste Kette. Die
**Vertrauensgrenze** trennt die nicht-deterministische obere Hälfte (Erzeugung) von
der deterministischen unteren Hälfte (Ausführung).

```
 Sprache ──ASR──▶ Text ──Authoring (LLM, §3.3)──▶ Draft-Manifest (mode: draft)
                                                        │
                          Klärungsschleife (§3.4) ◀─────┤   offene Fragen?
                          (Antwort, ggf. per Sprache)   │
                                                        ▼
 ═══════════════════════ VERTRAUENSGRENZE ═══════════════════════
                                                        ▼
   Compile (§5.2) ─▶ Resolve & Lock (§12) ─▶ Validierung (§10)
        ─▶ Lifecycle-Tore (§11) ─▶ Human Review (§11, G2-6)
        ─▶ Ausführung (§9, Adapter §13) ─▶ Evaluation (§10.2) ─▶ Ergebnis
```

Nur die obere Hälfte ist neu in diesem Abschnitt; alles unterhalb der Grenze ist in
den genannten Abschnitten bereits normiert. Entscheidend: Die obere Hälfte **endet
immer** bei einem Manifest im Zustand `draft`. Sie überschreitet die Grenze nicht
selbst.

### 3.2 Sprache als Eingabe

Sprache ist **kein** Sonderfall des Modells. Eine Spracherkennung (ASR) erzeugt aus
Audio einen Text; ab diesem Text ist der Ablauf identisch zu jeder anderen
Texteingabe. AIM spezifiziert ASR nicht und macht keine Annahmen über die Modalität.

- Der transkribierte Text wird zu `intent.text` (§6.1) mit `source:
  "natural-language"`.
- Auch die Antworten in der Klärungsschleife (§3.4) KÖNNEN per Sprache erfolgen; auch
  sie sind nach ASR nur Text.

> „Voice" ist eine Frontend-Eigenschaft, keine Eigenschaft von AIM. Alles, was zählt,
> ist der Text und das daraus erzeugte Manifest.

### 3.3 Die Authoring-Schicht (Conformance-Level *Author*)

Authoring ist die Transformation *Text → Draft-Manifest*. Sie wird von einem
Sprachmodell ausgeführt, geführt durch die Selbstbeschreibungs-Skills aus §3.5. Sie
ist die einzige nicht-deterministische Stufe der oberen Hälfte und steht deshalb unter
strengen Regeln.

Eine konforme Authoring-Implementierung:

1. erzeugt ein Manifest mit `lifecycle.mode: "draft"` und DARF keinen höheren Zustand
   setzen (sonst `AIM-E-4001`);
2. **schlägt Skills vor, löst sie aber nicht auf.** Sie füllt `ref`, `trust` und
   `constraint` einer Skill-Referenz (§7.3) sowie optional eine natürlichsprachliche
   Bedarfsbeschreibung. Sie DARF `resolved`, `hash`, `scopes` und `anchor` **nicht**
   selbst setzen — diese erzeugt der Resolver (§12), nicht der Autor (sonst
   `AIM-E-4002`);
3. **erfindet nichts.** Fehlen Fakten (IDs, Werte, API-Versionen, Tabellennamen), MUSS
   die Schicht sie als `uncertainty.openQuestions` mit `blocksExecution: true` oder als
   `uncertainty.assumptions` mit Konfidenz markieren (§6.9) — niemals raten;
4. erzeugt `intent`, `inputs`, den `plan` mit Schritten und Prompt-Spezifikationen
   (§9.6) sowie die Bindings zwischen den Schritten (§8);
5. setzt **keine** vom Werkzeug erzeugten Felder (`provenance.manifestHash`,
   `aim.lock`-Referenzen) — diese entstehen erst beim Compile (§5.2).

Damit gilt das Leitprinzip: **Der Autor schlägt vor, der Resolver verifiziert, die
Policy gibt frei, der Compiler schreibt fest.** Ein Sprachmodell kann also einen
kompletten Workflow *entwerfen*, aber nichts davon *scharf schalten*.

### 3.4 Klärungsschleife

Ein Draft mit offenen Fragen (`blocksExecution: true`) kann die Vertrauensgrenze nicht
überschreiten (§11, G2-3). Die Klärungsschleife löst das interaktiv:

```
solange offene, blockierende Fragen existieren:
    stelle dem Menschen die nächste Frage (ggf. per Sprache)
    Antwort  ──▶ Authoring aktualisiert den Draft
    neuer manifestHash, neues Diff (§5.2) zur Vorfassung
```

- Jede Antwort erzeugt eine neue Manifest-Fassung mit eigenem Hash; der Verlauf ist
  damit nachvollziehbar und diffbar.
- Die Schleife endet, wenn keine blockierende Frage mehr offen ist. Erst dann kann der
  deterministische Unterbau beginnen.

### 3.5 Selbstbeschreibung: `aim.core` und `aim.authoring`

Damit ein Sprachmodell gültige Manifeste erzeugen kann, beschreibt AIM sich selbst
durch zwei `knowledge`-Skills:

- **`aim.core`** — das Objektmodell (§6–§9) in modelllesbarer Form. Es MUSS aus dem
  normativen JSON Schema (§15) **generiert oder dagegen geprüft** werden, damit
  Beschreibung und Schema nicht auseinanderdriften.
- **`aim.authoring`** — die Prozedur dieses Abschnitts: wie aus Intent ein Draft wird,
  welche Felder der Autor füllt, welche er auslässt, und wie Unsicherheit zu
  repräsentieren ist.

Beide sind reguläre, gehashte Skills und unterliegen denselben Integritätsregeln wie
jeder andere `knowledge`-Skill (§7). Die Authoring-Schicht ist damit selbst
versionierbar und überprüfbar.

> **Conformance.** Diese fünf Unterabschnitte definieren das optionale Level
> **Author**. Eine Core-Implementierung benötigt sie nicht: Ein von Hand geschriebenes
> Draft-Manifest tritt an genau derselben Stelle in den Ablauf ein (oberhalb der
> Vertrauensgrenze) und durchläuft danach identisch den deterministischen Unterbau.

---

## 4. Kanonisierung & Hashing

1. Jeder Hash ist `sha256:` gefolgt von 64 Zeichen Hex in Kleinbuchstaben.
2. Vor dem Hashen wird ein JSON-Wert nach **RFC 8785 (JSON Canonicalization Scheme,
   JCS)** kanonisiert: lexikografisch sortierte Objektschlüssel, UTF-8, minimale
   Zahlendarstellung, keine signifikanten Leerzeichen.
3. `manifestHash` ist der Hash über das kanonisierte Manifest **ohne** das Feld
   `provenance.manifestHash` selbst (dieses Feld wird vor der Berechnung entfernt und
   danach eingesetzt).
4. Der Hash eines Skills ist der Hash über seinen kanonisierten, normalisierten
   Skill-Körper (§7.4).

---

## 5. Dateiformat & Oberflächen

AIM hat zwei Oberflächen für dasselbe Manifest. Die kanonische Form ist maßgeblich;
die lesbare Form ist eine deterministische Projektion davon.

### 5.1 Kanonische Oberfläche (`*.aim.json`)

- Kanonische Endung: `*.aim.json`. Eine Implementierung MUSS dieses Format lesen und
  schreiben können.
- Dies ist die einzige Form, die gehasht, gelockt, validiert und ausgeführt wird.
- Pro Projekt existiert genau eine `aim.lock` (§12.4).
- Empfohlenes Layout:

```
project/
├── manifests/
│   ├── invoice.aim       # lesbare Quelle (vom Menschen gepflegt)
│   └── invoice.aim.json  # kanonisch (vom Compiler erzeugt)
├── skills/               # lokale Skill-Quellen (optional)
└── aim.lock              # generiert, eingecheckt
```

### 5.2 Lesbare Autorenoberfläche (`*.aim`)

`*.aim` ist eine einrückungsbasierte, menschenlesbare Schreibweise für genau dasselbe
Modell. Sie existiert, damit Manifeste von Hand geschrieben und im Review gelesen
werden können, ohne JSON, Hashes und `${…}`-Bindings zu Gesicht zu bekommen.

Eine Implementierung des Conformance-Levels **Core** MUSS einen Compiler in beide
Richtungen bereitstellen:

```
*.aim  ──compile──▶  *.aim.json      (deterministisch, MUSS)
*.aim.json  ──render──▶  *.aim       (lesbares Rendering, MUSS; für das Review-Gate §11)
```

**Round-Trip-Garantie.** `compile` MUSS deterministisch sein: dieselbe `.aim`-Datei
ergibt byte-identisches kanonisches JSON (nach JCS, §4). `render(compile(x))` MUSS
semantisch äquivalent zu `x` sein (gleiche Felder, ggf. normalisierte Reihenfolge).

**Abbildungsregeln (lesbar → kanonisch).** Der Compiler:

1. expandiert Kurz-Bindings zu kanonischen Bindings:
   `extract.fields` → `${steps.extract.output.fields}`,
   `inputs.x` → `${inputs.x}`,
   `normalize-date(extract.fields.date)` → `${transform.normalize-date(steps.extract.output.fields.date)}`;
2. ergänzt für jeden `uses`-Eintrag `trust`, `resolved`, `hash` und `anchor` aus dem
   Resolver bzw. der Lock (§12) — diese Felder werden **nie** von Hand geschrieben;
3. erzeugt `provenance.manifestHash`, `createdAt` und die Lock-Referenz;
4. setzt `lifecycle.mode` nicht selbst über `reviewable` hinaus — der Übergang zu
   `executable` erfolgt ausschließlich über die Tore in §11.

Vom Menschen geschriebene Felder sind damit nur: Intent, Inputs, `uses`-Constraints,
Schritte, Prompts, Conditions, Approval-/Kompensationsangaben und offene Fragen. Alles
Sicherheits- und Integritätsrelevante erzeugt das Werkzeug.

> `*.aim` ist syntaktischer Zucker, kein zweites Datenmodell. Bei jedem Widerspruch
> zwischen lesbarer und kanonischer Form gewinnt die kanonische Form.

---

## 6. Manifest-Objektmodell

Top-Level-Objekt. Pflichtfelder im Core: `aim`, `kind`, `id`, `intent`, `plan`,
`lifecycle`, `provenance`.

```json
{
  "aim": "1.0",
  "kind": "Manifest",
  "id": "mf_8c1d4f",
  "intent":      { "...": "§6.1" },
  "inputs":      { "...": "§6.2" },
  "skills":      [ "...§6.3" ],
  "context":     { "...": "§6.4" },
  "plan":        { "...": "§6.5" },
  "policy":      { "...": "§6.6" },
  "evaluation":  { "...": "§6.7" },
  "lifecycle":   { "...": "§6.8" },
  "uncertainty": { "...": "§6.9" },
  "provenance":  { "...": "§6.10" }
}
```

### 6.1 `intent`
| Feld | Typ | Pflicht | Bedeutung |
|------|-----|---------|-----------|
| `text` | string | ja | Menschliche Absicht in natürlicher Sprache |
| `source` | enum `natural-language` \| `authored` \| `imported` | ja | Herkunft |
| `authoredBy` | enum `ai` \| `human` | ja | Wer das Manifest erzeugt hat |

### 6.2 `inputs`
Objekt: Name → Input-Deklaration. Wird beim Start der Ausführung gegen die hier
deklarierten Typen geprüft.

| Feld | Typ | Pflicht |
|------|-----|---------|
| `type` | enum `string` \| `number` \| `boolean` \| `object` \| `array` \| `file` | ja |
| `required` | boolean | ja |
| `description` | string | nein |

### 6.3 `skills`
Array von Skill-Referenzen. Enthält NUR aufgelöste Referenzen, keine Skill-Inhalte
(siehe §7).

### 6.4 `context`
| Feld | Typ | Pflicht | Bedeutung |
|------|-----|---------|-----------|
| `strategy` | enum `full` \| `minimal-relevant` | ja | Auswahlstrategie |
| `include` | string[] | nein | Selektoren `skill:<ref>#<section>` oder `input:<name>` |
| `exclude` | string[] | nein | Selektoren, die ausgeschlossen werden |

`context` beschreibt die Auswahlregel, nicht den fertigen Text. Der konkrete Kontext
entsteht zur Laufzeit; nur die Regel ist Teil des Manifests.

### 6.5 `plan`
| Feld | Typ | Pflicht |
|------|-----|---------|
| `steps` | Step[] (§9.1) | ja |
| `runtime` | RuntimeRef (§13.1) | nein (Adapter kann Default setzen) |

### 6.6 `policy`
```json
{
  "knowledge":  { "requireIntegrity": true,  "autoLoad": false },
  "capability": { "requireIntegrity": true,  "requireAuthorization": true },
  "write":      { "requireApproval": true,   "requireIdempotency": true },
  "audit":      { "logEveryCapabilityCall": true }
}
```
Fehlt `policy`, gelten genau diese Werte als Default. Die Defaults sind restriktiv.

### 6.7 `evaluation`
```json
{
  "pre":  { "schema": true, "bindings": true, "idFormat": true, "locks": true },
  "post": { "idExistence": true, "onFailure": "compensate" }
}
```
`onFailure` ∈ { `compensate`, `halt`, `return_error` }. Siehe §10.

### 6.8 `lifecycle`
| Feld | Typ | Pflicht |
|------|-----|---------|
| `mode` | enum `draft` \| `reviewable` \| `executable` | ja |

### 6.9 `uncertainty`
```json
{
  "assumptions":  [ { "text": "…", "confidence": 0.0 } ],
  "openQuestions":[ { "q": "…", "blocksExecution": true } ]
}
```
Jede offene Frage mit `blocksExecution: true` verhindert den Zustand `executable`.

### 6.10 `provenance`
| Feld | Typ | Pflicht |
|------|-----|---------|
| `manifestHash` | string `sha256:…` | ja |
| `createdAt` | RFC 3339 Zeitstempel | ja |
| `lock` | string (Pfad zur Lock-Datei) | ja |

---

## 7. Skill-Modell

Jeder Skill trägt zwei unabhängige Klassifikationen.

### 7.1 Trust-Achse (Sicherheit)
| Wert | Bedeutung | Pflichtprüfung |
|------|-----------|----------------|
| `knowledge` | Inhalt wird in den Modellkontext injiziert (Injektionsvektor) | Integrität (Hash/Signatur) |
| `capability` | Kann externe Aktionen auslösen (Aktionsvektor) | Integrität **und** Autorisierung (Scopes, Approval) |
| `transform` | Reine, seiteneffektfreie Datenfunktion | Integrität; deterministisch und testbar |

Ein `knowledge`-Skill wird NICHT automatisch geladen, nur weil seine Quelle als
vertrauenswürdig gilt. Er durchläuft denselben Integritätscheck wie `capability`.

### 7.2 Domänen-Achse (Auffindbarkeit)
Freie Namensräume ohne Sicherheitsbedeutung, z. B. `domain.*`, `runtime.*`,
`project.*`, `policy.*`, `eval.*`. Dient nur der Suche und Lesbarkeit.

### 7.3 Skill-Referenz im Manifest
```json
{
  "ref": "capability.store.upsert",
  "trust": "capability",
  "constraint": "2.x",
  "resolved": "2.4.0",
  "hash": "sha256:f0e1…",
  "scopes": ["records:write"],
  "approval": "required",
  "anchor": "pinned-hash"
}
```
| Feld | Typ | Pflicht | Bedeutung |
|------|-----|---------|-----------|
| `ref` | string | ja | Logischer Name |
| `trust` | enum (§7.1) | ja | Sicherheitsklasse |
| `constraint` | string | ja | Versionsbedingung, menschenseitig (§12.1) |
| `need` | string | nein | Natürlichsprachliche Bedarfsbeschreibung; vom Autor (§3.3) gesetzt, vom Resolver zur Skill-Findung genutzt |
| `resolved` | string | ja (ab `reviewable`) | Exakt aufgelöste Version |
| `hash` | string | ja (ab `reviewable`) | Inhalts-Hash, MUSS mit Lock übereinstimmen |
| `scopes` | string[] | nur bei `capability` | Benötigte Berechtigungen |
| `approval` | enum `none` \| `required` | nur bei `capability` | Freigabebedarf |
| `anchor` | enum `pinned-hash` \| `signature` | ja bei Erst-Install | Vertrauensanker (§7.5) |

### 7.4 Skill-Körper (normalisierte Form)
Ein geladener Skill wird in folgende kanonische Form normalisiert, bevor er gehasht
wird:
```json
{
  "aim": "1.0",
  "kind": "Skill",
  "name": "capability.store.upsert",
  "version": "2.4.0",
  "trust": "capability",
  "interface": {
    "inputSchema":  "<JSON-Schema oder Schema-Referenz>",
    "outputSchema": "<JSON-Schema oder Schema-Referenz>"
  },
  "scopes": ["records:write"],
  "rules": ["…"]
}
```
`transform`-Skills MÜSSEN zusätzlich rein sein: gleiche Eingabe ⇒ gleiche Ausgabe,
keine Seiteneffekte.

### 7.5 Vertrauensanker (verhindert Trust-On-First-Use)
Beim erstmaligen Laden eines Skills MUSS einer der folgenden Anker vorliegen:
- **`pinned-hash`** — ein im Manifest oder per Konfiguration fest hinterlegter
  Inhalts-Hash, gegen den der geladene Inhalt geprüft wird, oder
- **`signature`** — eine kryptografische Signatur eines Schlüssels aus einem
  konfigurierten Trust-Store.

Liegt kein Anker vor, MUSS der Skill in **Quarantäne** verbleiben und darf nicht in
den Zustand `executable` eingehen.

---

## 8. Binding-Ausdrücke

Datenfluss wird ausschließlich durch Bindings ausgedrückt. Ein Binding ist ein
Referenzausdruck — **kein** ausführbarer Code. Dadurch ist der gesamte Datenfluss
durch Parsen bestimmbar.

### 8.1 Grammatik (EBNF)
```
binding     = "${" , expr , "}" ;
expr        = reference | transform ;

reference   = "inputs." , path
            | "steps." , ident , ".output" , [ "." , path ]
            | "skills." , skillref , ".resolved" ;

transform   = transform-name , "(" , [ arg , { "," , arg } ] , ")" ;
arg         = expr | literal ;

path        = segment , { ("." , segment) | ("[" , integer , "]") } ;
segment     = ident ;
ident       = letter , { letter | digit | "_" | "-" } ;
skillref    = ident , { "." , ident } ;
literal     = string | number | "true" | "false" | "null" ;
transform-name = skillref ;   (* MUSS auf einen Skill mit trust = transform zeigen *)
```

### 8.2 Auflösungssemantik
- `inputs.<path>` löst gegen die zur Laufzeit übergebenen Inputs auf.
- `steps.<id>.output[.<path>]` löst gegen die Ausgabe eines abgeschlossenen Schritts
  auf. Begründet eine Abhängigkeitskante `<id> → aktueller Schritt`.
- `skills.<ref>.resolved` liefert die aufgelöste Versionsbezeichnung als String.
- `transform-name(args…)` ruft einen `transform`-Skill auf. Argumente werden zuerst
  aufgelöst, dann übergeben.

### 8.3 Statische Anforderungen
- Jede Referenz MUSS auf ein existierendes Ziel zeigen (deklarierter Input,
  vorhandener Schritt, deklarierter Skill).
- `condition`-Bindings (§9.1) MÜSSEN auf einen `transform`-Skill zeigen, der einen
  booleschen Wert liefert.
- Aus Bindings abgeleitete Kanten und explizite `dependsOn`-Kanten zusammen MÜSSEN
  einen azyklischen Graphen bilden.

---

## 9. Plan & Ausführungssemantik

### 9.1 Schritt (Step)
| Feld | Typ | Pflicht | Bedeutung |
|------|-----|---------|-----------|
| `id` | string | ja | Eindeutig im Plan |
| `type` | enum `model` \| `capability` \| `transform` | ja | Schrittart |
| `uses` | string (Skill-`ref`) | ja | Referenzierter Skill, `trust` MUSS zu `type` passen |
| `prompt` | Prompt (§9.6) | ja, wenn `type = model` | Semantische Prompt-Spezifikation |
| `input` | object | nein | Werte dürfen Bindings sein |
| `output` | `{ "schema": "<ref>" }` | nein | Ausgabe-Schema für Validierung |
| `effect` | enum `read` \| `write` | nur bei `capability` | Schreib- oder Lesezugriff |
| `idempotencyKey` | binding | ja, wenn `effect = write` | Schlüssel für Idempotenz |
| `approval` | enum `none` \| `required` | nein | Freigabebedarf des Schritts |
| `compensation` | string (Skill-`ref`) | nein | Kompensierender `capability`-Skill |
| `condition` | binding | nein | Boolescher Transform; bei `false` wird der Schritt übersprungen |
| `dependsOn` | string[] | nein | Zusätzliche Abhängigkeiten |

### 9.2 Scheduling (Pseudocode)
```
function execute(manifest, inputs):
    assertExecutable(manifest)            # §11
    graph = buildGraph(manifest.plan)     # dependsOn ∪ binding-Kanten
    order = topologicalSort(graph)        # Zyklus ⇒ Fehler AIM-E-1002
    completed = []
    for step in order:
        if step.condition and resolve(step.condition) == false:
            continue
        if step.approval == "required" or needsApproval(step, manifest.policy):
            awaitApproval(step)           # blockierend
        boundInput = resolveBindings(step.input)
        result = runStep(step, boundInput)   # §13
        if result.error:
            return rollback(completed, result)   # §9.5
        record(step.id, result.output)
        if step.compensation: completed.push(step)
    return success(collectOutputs())
```

### 9.3 Schrittarten
- `model` — ruft ein Sprachmodell auf (nicht deterministisch). Der Schritt MUSS eine
  Prompt-Spezifikation (§9.6) tragen; die Ausgabe SOLLTE gegen `output.schema`
  validiert werden.
- `capability` — ruft eine externe Aktion über einen `capability`-Skill auf.
- `transform` — wendet einen reinen `transform`-Skill an (deterministisch).

### 9.4 Idempotenz
- Jeder Schritt mit `effect = write` MUSS einen `idempotencyKey` deklarieren.
- Die Runtime MUSS einen Idempotenz-Speicher mit Schlüssel
  `(manifest.id, step.id, value(idempotencyKey))` führen.
- Ist der Schlüssel bereits mit Erfolg verbucht, MUSS der Schritt übersprungen und
  die zuvor verbuchte Ausgabe wiederverwendet werden.

### 9.5 Kompensation (Saga)
- Schlägt ein Schritt fehl, MUSS die Runtime die bereits abgeschlossenen Schritte mit
  deklarierter `compensation` in **umgekehrter Abschlussreihenfolge** kompensieren.
- Eine `compensation` ist ein `capability`-Skill, der die Wirkung des Schritts
  rückgängig macht. Sie erhält die Ausgabe des ursprünglichen Schritts als Eingabe.
- Kompensationen MÜSSEN selbst idempotent sein.

### 9.6 Prompt-Objektmodell

Ein Prompt ist in AIM ein **semantisches Objekt**, kein roher String. Das Manifest
beschreibt die *Absicht* eines Prompts; der konkrete Prompt-Text entsteht erst zur
Laufzeit aus dieser Absicht plus dem ausgewählten Kontext (§9.7). So bleibt der Prompt
lesbar, diffbar und reviewbar, und sein Inhalt fließt in den `manifestHash` ein — eine
Promptänderung ist damit eine sichtbare Manifeständerung.

Jeder `model`-Schritt trägt genau ein `prompt`-Objekt:

```json
"prompt": {
  "role": "Rechnungs-Extraktor",
  "goal": "Extrahiere die deklarierten Pflichtfelder als strukturiertes JSON.",
  "style": "strict",
  "rules": [
    "Nur Werte aus dem Dokument verwenden.",
    "Keine fehlenden Werte erfinden.",
    "Nummern und Bezeichner exakt übernehmen."
  ],
  "contextFrom": ["knowledge.invoice-fields", "input:document"],
  "output": { "format": "json", "schema": "InvoiceFields" },
  "onMissingData": "return_validation_error"
}
```

| Feld | Typ | Pflicht | Bedeutung |
|------|-----|---------|-----------|
| `role` | string | ja | Rolle/Persona, die das Modell einnimmt |
| `goal` | string | ja | Was der Schritt erreichen soll |
| `style` | enum `strict` \| `concise` \| `explanatory` | nein | Tonalität/Strenge der Ausgabe |
| `rules` | string[] | nein | Harte Regeln, die der Composer wörtlich übernimmt |
| `contextFrom` | string[] | nein | Selektoren (`<skill-ref>` oder `input:<name>`), aus denen Kontext gezogen wird; eingegrenzt durch `context` (§6.4) |
| `output` | `{ format, schema }` | ja | Ausgabevertrag; `format` ∈ `json`\|`text`, `schema` referenziert ein Schema |
| `onMissingData` | enum `return_validation_error` \| `proceed_with_nulls` | nein | Verhalten bei fehlenden Pflichtdaten |

Anforderungen:
- `prompt.output.schema` MUSS mit `step.output.schema` übereinstimmen, falls beide
  gesetzt sind.
- Jeder Eintrag in `contextFrom` MUSS auf einen im Manifest deklarierten Skill oder
  Input zeigen (statisch prüfbar).
- Ein Prompt enthält **keine** eingebetteten Skill-Inhalte oder Beispieldaten; diese
  kommen ausschließlich über `contextFrom` und werden vom Composer eingesetzt.

### 9.7 Prompt Composer

Der Prompt Composer ist die Komponente, die aus dem `prompt`-Objekt und dem
ausgewählten Kontext den endgültigen Prompt-Text für den Adapter erzeugt.

**Kompositionsreihenfolge (normativ).** Der Composer setzt den finalen Prompt
deterministisch in dieser Reihenfolge zusammen:

```
1. role            → Systemrolle
2. goal            → Aufgabenstellung
3. contextFrom     → ausgewählter, nach §6.4 gefilterter Kontext (Wissen, Inputs)
4. rules           → wörtlich übernommene harte Regeln
5. output          → Ausgabevertrag (Format + Schema)
6. onMissingData   → Fehlerverhalten
```

**Eigenschaften:**
- Der Composer ist **deterministisch** bezüglich seiner Eingaben: gleiche
  Prompt-Spezifikation und gleicher ausgewählter Kontext ⇒ gleicher Prompt-Text. Nicht
  deterministisch ist allein die *Antwort des Modells*.
- Der Composer DARF die `rules` nicht umformulieren oder zusammenfassen; sie werden
  wörtlich übernommen.
- Der zur Laufzeit erzeugte Kontext (Schritt 3) ist nicht Teil des Manifests und damit
  nicht hashrelevant; die *Auswahlregel* (`context`, `contextFrom`) hingegen schon.
- Verlangt der Ausgabevertrag `format: json` mit Schema, MUSS die Modellausgabe gegen
  dieses Schema validiert werden; bei Verstoß `AIM-E-3001`.

Damit gilt der Leitsatz aus Abschnitt 0 auch technisch: Skills sind die Zutaten,
der Kontext ihre Auswahl, der Prompt das Rezept — und der Composer ist der Schritt,
der aus Rezept und Zutaten das fertige Briefing kocht.

---

## 10. Validierung

Validierung erfolgt in zwei Phasen mit unterschiedlicher Wirkung.

### 10.1 Pre-Execution Gates (können die Ausführung verhindern)
Alle MÜSSEN grün sein, bevor ein Manifest in `executable` übergeht:
1. **schema** — Manifest valide gegen das JSON Schema (§15).
2. **bindings** — alle Bindings parsbar und auflösbar; DAG azyklisch (§8.3).
3. **idFormat** — alle als ID typisierten Werte erfüllen ihr Formatmuster
   (Formatgültigkeit, nicht Existenz).
4. **locks** — jeder Skill ist gelockt; `hash` im Manifest == Lock-Hash == Live-Hash
   der Quelle.

### 10.2 Post-Execution Evaluation (kann nur beobachten)
Läuft nach Schritten und kann Kompensation oder Halt auslösen, aber Schäden nicht
verhindern:
- **idExistence** — Existenz referenzierter IDs, nur per Roundtrip gegen das
  Zielsystem feststellbar.
- Struktur- und Reason-Code-Prüfungen, Fehlerklassifikation, Retry-Entscheidung.

Sicherheit bei schreibenden Schritten ergibt sich aus **Approval + Idempotenz +
Kompensation** (§9), nicht aus der Post-Evaluation.

---

## 11. Lifecycle-Zustandsautomat

```
draft ──[G1]──▶ reviewable ──[G2]──▶ executable
```

**G1 (draft → reviewable):**
- Manifest valide gegen JSON Schema, und
- alle Bindings parsbar, und
- DAG azyklisch.

**G2 (reviewable → executable) — alle Bedingungen:**
1. alle Pre-Gates (§10.1) grün
2. alle Skills aufgelöst, gelockt, Hash-verifiziert; Vertrauensanker vorhanden (§7.5)
3. keine offene Frage mit `blocksExecution: true`
4. jeder Schritt mit `effect = write` besitzt einen `idempotencyKey`
5. Approval-Policy erfüllt (alle `approval: required` freigegeben)
6. **Review bestätigt** — ein Mensch hat ein lesbares Rendering des Manifests sowie,
   falls eine Vorversion existiert, ein Manifest-Diff bestätigt.

Eine Core-Implementierung MUSS einen menschenlesbaren Renderer und einen
Manifest-Diff bereitstellen (Bedingung 6 ist nicht optional).

---

## 12. Resolution & Lock

### 12.1 Versionsbedingungen
- AIM-verwaltete Skills verwenden **SemVer**. `constraint` ist ein SemVer-Range
  (`^1.2`, `2.x`, `>=1.4 <2.0`) oder ein Pin (`=1.0.0`).
- Externe Quellen mit eigenem Schema (z. B. ein datierter Stand) werden als opake
  `sourceRevision` geführt. Maßgebliche Identität in der Lock ist stets der
  **Inhalts-Hash**, nicht der Versionsstring.

### 12.2 Auflösungsalgorithmus (Pseudocode)
```
function resolve(skillRef, constraint, sources):
    candidates = []
    for src in sources where allowed(src):
        candidates += listVersions(src, skillRef) matching constraint
    pick = highestCompatible(candidates)        # einziges Verfahren
    if pick == none: error(AIM-E-2001 "no matching version")
    body = quarantineFetch(pick)                # isoliert laden
    verifyAnchor(body, skillRef.anchor)         # §7.5, sonst AIM-E-2003
    normalized = normalize(body)                # §7.4
    h = sha256(JCS(normalized))
    validateSkill(normalized)                   # sonst AIM-E-2004
    return { resolved: pick.version, hash: h, source: src }
```

### 12.3 Transitive Abhängigkeiten und Konflikte
- Abhängigkeiten eines Skills werden mit demselben Verfahren aufgelöst.
- Verlangen zwei Skills inkompatible Versionen eines dritten Skills, ist das ein
  **harter Fehler** (`AIM-E-2002`). Es gibt keine stille Auswahl.

### 12.4 Lock-Datei `aim.lock`
```json
{
  "aimLock": "1.0",
  "resolverStrategy": "highest-compatible",
  "skills": {
    "knowledge.invoice-fields": {
      "resolved": "1.2.3",
      "hash": "sha256:a1b2…",
      "source": "registry",
      "anchor": "signature",
      "installedAt": "2026-06-23T10:00:00Z"
    },
    "capability.store.upsert": {
      "resolved": "2.4.0",
      "hash": "sha256:f0e1…",
      "source": "mcp",
      "anchor": "pinned-hash",
      "installedAt": "2026-06-23T10:00:00Z"
    }
  }
}
```
Vor der Ausführung MUSS die Runtime für jeden Skill prüfen: `manifest.hash ==
lock.hash`. Weicht der Live-Hash der Quelle vom Lock-Hash ab, MUSS die Ausführung mit
`AIM-E-2005` abgebrochen werden.

---

## 13. Runtime-Adapter

Ein Adapter übersetzt ein gelocktes Manifest in konkrete Aufrufe. Er DARF die
Plan-Semantik (§9) NICHT verändern; insbesondere MÜSSEN DAG-Reihenfolge, Idempotenz
und Kompensation eingehalten werden.

### 13.1 Runtime-Referenz im Manifest
```json
"runtime": {
  "adapter": "reference-node",
  "model": { "provider": "<name>", "name": "<model>" },
  "streaming": false
}
```

### 13.2 Adapter-Schnittstelle (zu implementieren)
```typescript
interface RuntimeAdapter {
  name: string;

  // true, wenn dieser Adapter das Manifest ausführen kann
  supports(manifest: Manifest): boolean;

  // ein model-Schritt: ruft das Sprachmodell mit komponiertem Kontext auf
  runModelStep(step: Step, context: ComposedContext,
               input: Json): Promise<StepResult>;

  // ein capability-Schritt: führt die externe Aktion aus
  runCapabilityStep(step: Step, skill: ResolvedSkill,
                    input: Json): Promise<StepResult>;

  // ein transform-Schritt: reine Funktion, deterministisch
  runTransformStep(step: Step, skill: ResolvedSkill,
                   args: Json[]): Promise<StepResult>;
}

type StepResult =
  | { output: Json; error: null }
  | { output: null; error: { code: string; message: string } };
```

Core verlangt genau einen Referenz-Adapter `reference-node`. Weitere Adapter sind
optional, MÜSSEN aber die Konformitätsregeln in §13.4 erfüllen.

### 13.3 Verantwortungsteilung (Runtime vs. Adapter)

Dies ist die zentrale Entwurfsentscheidung für alle Framework-Adapter. Frameworks wie
Vercel AI SDK, LangChain oder die Agents-SDKs bringen eigene Orchestrierung mit
(Agent-Loops, Graphen, automatische Tool-Schleifen). AIM nutzt davon **nur die
Einzelaufruf-Ebene**, nicht die Orchestrierung.

| Zuständigkeit | Wer |
|---------------|-----|
| Plan-DAG, Reihenfolge, Conditions (§9.2) | **AIM-Runtime** |
| Idempotenz (§9.4), Kompensation/Saga (§9.5) | **AIM-Runtime** |
| Approval-Tore, Policy, Audit (§6.6, §11) | **AIM-Runtime** |
| Binding-Auflösung (§8), Kontextauswahl (§6.4) | **AIM-Runtime** |
| Prompt-Komposition zum finalen Text (§9.7) | **AIM-Runtime** |
| Ein einzelner Modellaufruf | Adapter → Framework |
| Ein einzelner Tool-/Capability-Aufruf | Adapter → Framework |
| Strukturierte Ausgabe gegen ein Schema erzwingen | Adapter → Framework |

Daraus folgt normativ:

- Ein Adapter DARF die **Agent-/Graph-Orchestrierung** eines Frameworks NICHT als
  Ausführungsmodell verwenden (kein LangGraph-Graph, keine selbstlaufende
  Agent-Schleife als Workflow-Steuerung). Diese Schichten umgehen die Tore aus §9 und
  §11.
- Ein `model`-Schritt ist genau **ein** Modellaufruf. Lässt das Framework das Modell
  eigenständig mehrere Tools nacheinander aufrufen („tool loop"), MUSS der Adapter
  dies deaktivieren oder auf einen einzigen Aufruf begrenzen; Mehrschritt-Logik gehört
  in den Plan, nicht in den Modellaufruf.
- Die Framework-Version SOLLTE wie jede Abhängigkeit gepinnt und gelockt werden (ein
  `runtime`-Skill mit `trust: capability`-Charakter, §12).

### 13.4 Adapter-Konformität

Ein konformer Adapter MUSS:

1. die Methoden aus §13.2 implementieren und bei jedem Schritt-Typ den korrekten
   `StepResult` zurückgeben;
2. die vom Composer (§9.7) gelieferte finale Prompt-Repräsentation unverändert an das
   Framework übergeben — er DARF Rolle, Regeln oder Kontext nicht umschreiben;
3. den Ausgabevertrag durchsetzen: bei `output.format = json` mit Schema die native
   Structured-Output-Funktion des Frameworks nutzen und das Ergebnis gegen das Schema
   prüfen (`AIM-E-3001` bei Verstoß);
4. `capability`-Skills als Framework-Tools so registrieren, dass das `inputSchema` des
   Skills (§7.4) das Tool-Schema bildet;
5. die Orchestrierung der AIM-Runtime überlassen (§13.3) und keinen Schritt
   selbstständig wiederholen, kompensieren oder freigeben;
6. Fehler des Frameworks auf die AIM-Fehler-Taxonomie (§14) abbilden.

### 13.5 Framework-Mapping (informativ)

Die folgende Zuordnung zeigt, wie AIM-Konzepte auf gängige Frameworks abgebildet
werden. Sie ist **informativ**: Die konkreten API-Oberflächen dieser SDKs ändern sich
häufig und SOLLTEN beim Implementieren gegen die jeweils aktuelle Dokumentation
geprüft werden.

| AIM-Konzept | Vercel AI SDK | LangChain JS | Google GenAI | OpenAI / Agents | Anthropic | MCP-Runtime |
|-------------|---------------|--------------|--------------|-----------------|-----------|-------------|
| `model`-Schritt, Text | `generateText` | `model.invoke` | `generateContent` | Completions/Responses | `messages.create` | (über Modell-Provider) |
| `model`-Schritt, JSON nach Schema | `generateObject` (schema) | `withStructuredOutput` | `responseSchema` + JSON-MimeType | Structured Outputs / `response_format` | Tool-erzwungenes JSON | (über Modell-Provider) |
| `capability`-Skill | `tools[].execute` mit `parameters` | `tool()` / `StructuredTool` | Function Declaration | Function Tool | `tools[].input_schema` | MCP-Tool (1:1) |
| `inputSchema` des Skills | Zod/JSON-Schema des Tools | Tool-Schema | `parameters`-Schema | `parameters` | `input_schema` | MCP-Tool-Schema |
| Kontext (§6.4) | System-/Messages | System Message | `systemInstruction` / Parts | System Message | `system` | Resource → Kontext |
| Idempotenz / Saga / Approval | — (AIM-Runtime) | — (AIM-Runtime) | — (AIM-Runtime) | — (AIM-Runtime) | — (AIM-Runtime) | — (AIM-Runtime) |

`runtime.adapter`-Bezeichner (Vorschlag): `reference-node`, `vercel-ai-sdk`,
`langchain-js`, `google-genai`, `openai-agents`, `anthropic-tools`, `mcp-runtime`.

**Beispiel-Skizze (Vercel-AI-SDK-Adapter, informativ).** Zeigt die Schichtung: Die
AIM-Runtime hat Prompt, Kontext und Input bereits aufgelöst; der Adapter übersetzt nur
einen einzelnen Aufruf.

```typescript
async runModelStep(step, context, input): Promise<StepResult> {
  const schema = loadSchema(step.prompt.output.schema);   // §9.6
  try {
    // Genau EIN Aufruf, kein Tool-Loop — Orchestrierung bleibt bei der Runtime.
    const { object } = await generateObject({
      model: resolveModel(step /* runtime.model */),
      schema,                                              // Structured Output
      system: context.system,                              // komponierter Kontext (§9.7)
      prompt: context.prompt,                              // finaler Prompt-Text
    });
    if (!validate(schema, object)) {
      return { output: null, error: { code: "AIM-E-3001", message: "schema" } };
    }
    return { output: object, error: null };
  } catch (e) {
    return { output: null, error: mapFrameworkError(e) };  // §14
  }
}

async runCapabilityStep(step, skill, input): Promise<StepResult> {
  // capability-Skill = ein Framework-Tool; Schema kommt aus dem Skill (§7.4).
  // Direkter, einzelner Aufruf — Approval/Idempotenz hat die Runtime bereits erledigt.
  try {
    const result = await invokeTool(skill.interface, input);
    return { output: result, error: null };
  } catch (e) {
    return { output: null, error: mapFrameworkError(e) };
  }
}
```

So bleibt der Kern der ursprünglichen Idee erhalten — *AIMScript beschreibt, Adapter
übersetzen, SDKs führen aus* —, ohne dass ein Framework heimlich die Sicherheits- und
Ablauf-Tore übernimmt.

### 13.6 MCP als Skill- und Tool-Quelle

Das Model Context Protocol (MCP) ist sowohl eine **Skill-Quelle** für den Resolver
(§12) als auch ein **Ausführungsziel** für einen Adapter (§13). Dieser Abschnitt
verbindet beide.

MCP ist dynamisch: Ein Server stellt seine Fähigkeiten zur Laufzeit bereit und kann
sie jederzeit ändern. AIM verlangt jedoch gelockte, gehashte Skills vor der
Ausführung. Die Auflösung dieses Widerspruchs ist die Leitregel des Abschnitts:

> **MCP wird zur Resolve-Zeit als Snapshot erfasst, normalisiert, gehasht und
> gelockt. Die Ausführung verweigert, wenn der Server seither gedriftet ist.**

Damit erhält ein veränderlicher MCP-Server dieselbe Integritätsgarantie wie jede
andere Quelle.

#### 13.6.1 Abbildung der MCP-Primitive

| MCP-Primitiv | AIM-Abbildung | Trust-Achse | Vektor |
|--------------|---------------|-------------|--------|
| **Tool** | `capability`-Skill; `tool.inputSchema` → `interface.inputSchema` (§7.4) | `capability` | Aktion |
| **Resource** | `knowledge`-Skill; Inhalt wird in den Kontext injiziert | `knowledge` | Injektion |
| **Prompt** (Template) | Prompt-Fragment; fließt in `prompt.rules`/`role` ein (§9.6) | `knowledge` | Injektion |

Jedes abgebildete Primitiv wird zu einem regulären AIM-Skill und durchläuft denselben
Pfad wie jede andere Quelle: Quarantäne → Normalisierung → Hash → Validierung → Lock.

#### 13.6.2 Auflösung (Resolve-Zeit, §12)

`mcp` ist ein Quelltyp im Resolver. Der Ablauf konkretisiert §12.2:

```
quarantineFetch(mcpServer):
    connect(server.transport, server.id)     # stdio oder HTTP/SSE
    tools     = server.listTools()
    resources = server.listResources()
    prompts   = server.listPrompts()
    for each primitive:
        skill = normalize(primitive)          # §13.6.1
        skill.hash = sha256(JCS(skill))       # §4
    return skills
```

Die Lock-Datei (§12.4) erhält für MCP-Skills zusätzliche Felder:

```json
"capability.mcp.files.read_file": {
  "resolved": "rev-2026-06-23",
  "hash": "sha256:…",
  "source": "mcp",
  "server": { "transport": "stdio", "id": "files-server@1.2.0" },
  "anchor": "pinned-hash",
  "installedAt": "2026-06-23T10:00:00Z"
}
```

- `resolved` ist ein opaker `sourceRevision` (§12.1); MCP kennt kein SemVer. Maßgebend
  ist allein der `hash`.
- `server` hält fest, *womit* verbunden wurde. Das ist Dokumentation, **nicht** die
  Integritätsgarantie — die liefert der Hash.

#### 13.6.3 Sicherheitsregeln (verbindlich)

MCP wurde nicht mit AIMs Vertrauensmodell im Blick entworfen. Daher gelten verschärfte
Regeln:

1. **Scopes sind nicht ableitbar.** Ein MCP-Tool sagt nicht, welche Berechtigung es
   benötigt. `scopes` (§7.3) MÜSSEN beim Resolve **explizit** durch Operator oder Autor
   vergeben werden; sie werden NICHT aus der MCP-Beschreibung erraten.
2. **`effect`-Hinweise sind nicht vertrauenswürdig.** MCP-Annotationen wie
   `readOnlyHint`/`destructiveHint` sind Hinweise, keine Garantien. Fehlt eine
   verlässliche, vom Operator bestätigte Einstufung, MUSS der Skill als
   `effect: write` behandelt werden (fail-safe) — mit allen Folgen (Idempotenz,
   Approval, §9.4).
3. **Resources und Prompts sind Injektionsvektoren.** Sie erhalten Trust-Achse
   `knowledge`, werden gehasht und unterliegen `policy.knowledge.autoLoad = false`
   (§6.6). Eine manipulierte Resource kann den Workflow ebenso kapern wie ein
   bösartiges Tool.
4. **Erstvertrauen (TOFU).** Da MCP-Server üblicherweise nicht signiert sind, wird der
   Vertrauensanker (§7.5) durch eine **explizite Operator-Freigabe des ersten
   Snapshots** etabliert: Der freigegebene Snapshot-Hash wird zum `pinned-hash`. Ohne
   diese Freigabe bleibt der Skill in Quarantäne.

#### 13.6.4 Ausführung (Adapter-Zeit, §13)

Ein MCP-fähiger Adapter (`runtime.adapter: mcp-runtime` oder ein Framework-Adapter mit
MCP-Anbindung) führt einen `capability`-Schritt mit MCP-Herkunft so aus:

```
runCapabilityStep(step, skill, input):
    connect(skill.server)                     # gepinnte Identität aus Lock
    live = server.getTool(skill.name)
    if live == none:        return error(AIM-E-2007)   # Tool verschwunden
    if sha256(JCS(normalize(live))) != skill.hash:
                            return error(AIM-E-2006)    # Drift seit Lock
    result = server.callTool(skill.name, input)         # genau EIN Aufruf
    return { output: result, error: null }
```

Verbindliche Punkte:

- **Drift-Prüfung vor jedem Aufruf.** Weicht die Live-Definition vom Lock-Hash ab,
  bricht der Schritt mit `AIM-E-2006` ab. Neue oder geänderte Tools werden NICHT
  automatisch übernommen.
- **Ein Schritt = ein Tool-Aufruf.** Der Adapter DARF den MCP-Server bzw. das Modell
  keine eigenständige Tool-Schleife fahren lassen (§13.3). MCP-Server, die eine
  Agent-artige Selbststeuerung anbieten, werden ausschließlich auf der
  Einzelaufruf-Ebene genutzt.
- **Orchestrierung bleibt bei der AIM-Runtime.** Approval, Idempotenz und Kompensation
  hat die Runtime bereits vor dem Adapter-Aufruf erledigt.

#### 13.6.5 Drift und Re-Resolve

Ändert ein MCP-Server seine Tools, Resources oder Prompts, ist das kein
Laufzeitereignis, sondern ein **Anlass für Re-Resolve**:

1. Resolver erfasst einen neuen Snapshot und berechnet neue Hashes.
2. Unterschiede erzeugen ein Manifest-Diff (§5.2, §11).
3. Der geänderte Snapshot durchläuft erneut die Operator-Freigabe (§13.6.3, Regel 4)
   und das Review-Gate (§11, G2-6), bevor er `executable` werden kann.

So bleibt die ursprüngliche Rollenteilung exakt erhalten: *MCP liefert Fähigkeiten,
AIM normalisiert sie, AIM entscheidet kontrolliert über ihren Einsatz.*

> **Conformance.** MCP-Unterstützung gehört zum Level **Resolve** (Quelle) und
> erfordert zusätzlich einen MCP-fähigen Adapter. Sie ist NICHT Teil von **Core**.

---

## 14. Fehler-Taxonomie

| Code | Bedeutung |
|------|-----------|
| `AIM-E-1001` | Manifest nicht valide gegen JSON Schema |
| `AIM-E-1002` | Plan enthält einen Zyklus |
| `AIM-E-1003` | Binding nicht auflösbar (unbekanntes Ziel) |
| `AIM-E-1004` | Schreibender Schritt ohne `idempotencyKey` |
| `AIM-E-1005` | Offene Frage mit `blocksExecution` blockiert `executable` |
| `AIM-E-1006` | Erforderliche Freigabe fehlt |
| `AIM-E-2001` | Keine zur Bedingung passende Skill-Version gefunden |
| `AIM-E-2002` | Versionskonflikt bei transitiver Abhängigkeit |
| `AIM-E-2003` | Vertrauensanker fehlt oder ungültig |
| `AIM-E-2004` | Skill-Körper nicht valide |
| `AIM-E-2005` | Hash-Abweichung zwischen Lock und Quelle/Manifest |
| `AIM-E-2006` | MCP-Definition weicht zur Laufzeit vom Lock ab (Drift) |
| `AIM-E-2007` | Im Lock referenziertes MCP-Tool auf dem Server nicht mehr vorhanden |
| `AIM-E-3001` | Schritt-Ausgabe verletzt `output.schema` |
| `AIM-E-3002` | Kompensation fehlgeschlagen |
| `AIM-E-4001` | Authoring-Ausgabe setzt einen Lifecycle-Zustand über `draft` |
| `AIM-E-4002` | Authoring-Ausgabe setzt resolver-eigene Felder (`resolved`/`hash`/`scopes`/`anchor`) |

---

## 15. JSON Schema (normativ)

JSON Schema Draft 2020-12. Gekürzte, aber implementierbare Fassung; eine
Implementierung MUSS sie auf alle Felder aus §6–§9 erweitern.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aim.spec/1.0/manifest.json",
  "type": "object",
  "required": ["aim", "kind", "id", "intent", "plan", "lifecycle", "provenance"],
  "properties": {
    "aim":  { "const": "1.0" },
    "kind": { "const": "Manifest" },
    "id":   { "type": "string", "pattern": "^mf_[a-z0-9]+$" },
    "intent": {
      "type": "object",
      "required": ["text", "source", "authoredBy"],
      "properties": {
        "text":       { "type": "string", "minLength": 1 },
        "source":     { "enum": ["natural-language", "authored", "imported"] },
        "authoredBy": { "enum": ["ai", "human"] }
      }
    },
    "inputs": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["type", "required"],
        "properties": {
          "type":        { "enum": ["string","number","boolean","object","array","file"] },
          "required":    { "type": "boolean" },
          "description": { "type": "string" }
        }
      }
    },
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["ref", "trust", "constraint"],
        "properties": {
          "ref":        { "type": "string" },
          "trust":      { "enum": ["knowledge", "capability", "transform"] },
          "constraint": { "type": "string" },
          "need":       { "type": "string" },
          "resolved":   { "type": "string" },
          "hash":       { "type": "string", "pattern": "^sha256:[a-f0-9]{64}$" },
          "scopes":     { "type": "array", "items": { "type": "string" } },
          "approval":   { "enum": ["none", "required"] },
          "anchor":     { "enum": ["pinned-hash", "signature"] }
        }
      }
    },
    "plan": {
      "type": "object",
      "required": ["steps"],
      "properties": {
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "type", "uses"],
            "properties": {
              "id":             { "type": "string" },
              "type":           { "enum": ["model", "capability", "transform"] },
              "uses":           { "type": "string" },
              "prompt": {
                "type": "object",
                "required": ["role", "goal", "output"],
                "properties": {
                  "role":   { "type": "string" },
                  "goal":   { "type": "string" },
                  "style":  { "enum": ["strict", "concise", "explanatory"] },
                  "rules":  { "type": "array", "items": { "type": "string" } },
                  "contextFrom": { "type": "array", "items": { "type": "string" } },
                  "output": {
                    "type": "object",
                    "required": ["format"],
                    "properties": {
                      "format": { "enum": ["json", "text"] },
                      "schema": { "type": "string" }
                    }
                  },
                  "onMissingData": { "enum": ["return_validation_error", "proceed_with_nulls"] }
                }
              },
              "input":          { "type": "object" },
              "output":         { "type": "object",
                                   "properties": { "schema": { "type": "string" } } },
              "effect":         { "enum": ["read", "write"] },
              "idempotencyKey": { "type": "string" },
              "approval":       { "enum": ["none", "required"] },
              "compensation":   { "type": "string" },
              "condition":      { "type": "string" },
              "dependsOn":      { "type": "array", "items": { "type": "string" } }
            },
            "allOf": [
              {
                "if":   { "properties": { "effect": { "const": "write" } } },
                "then": { "required": ["idempotencyKey"] }
              },
              {
                "if":   { "properties": { "type": { "const": "model" } } },
                "then": { "required": ["prompt"] }
              }
            ]
          }
        },
        "runtime": { "type": "object" }
      }
    },
    "policy":     { "type": "object" },
    "evaluation": { "type": "object" },
    "lifecycle": {
      "type": "object",
      "required": ["mode"],
      "properties": { "mode": { "enum": ["draft", "reviewable", "executable"] } }
    },
    "uncertainty": { "type": "object" },
    "provenance": {
      "type": "object",
      "required": ["manifestHash", "createdAt", "lock"],
      "properties": {
        "manifestHash": { "type": "string", "pattern": "^sha256:[a-f0-9]{64}$" },
        "createdAt":    { "type": "string", "format": "date-time" },
        "lock":         { "type": "string" }
      }
    }
  }
}
```

---

## 16. Vollständiges Beispiel

Workflow: aus einem hochgeladenen Dokument strukturierte Felder extrahieren und als
Datensatz ablegen. Das Beispiel ist gegen §15 valide und nutzt alle Kernmechanismen.

```json
{
  "aim": "1.0",
  "kind": "Manifest",
  "id": "mf_8c1d4f",
  "intent": {
    "text": "Felder aus einem Dokument extrahieren und als Datensatz ablegen.",
    "source": "natural-language",
    "authoredBy": "human"
  },
  "inputs": {
    "document":    { "type": "file",   "required": true },
    "targetTable": { "type": "string", "required": true }
  },
  "skills": [
    { "ref": "knowledge.invoice-fields", "trust": "knowledge",
      "constraint": "^1.2", "resolved": "1.2.3",
      "hash": "sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
      "anchor": "signature" },
    { "ref": "transform.normalize-date", "trust": "transform",
      "constraint": "=1.0.0", "resolved": "1.0.0",
      "hash": "sha256:9c8d7e6f5a4b3c2d1e0f00112233445566778899aabbccddeeff001122334455",
      "anchor": "pinned-hash" },
    { "ref": "transform.non-empty", "trust": "transform",
      "constraint": "=1.0.0", "resolved": "1.0.0",
      "hash": "sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      "anchor": "pinned-hash" },
    { "ref": "capability.store.upsert", "trust": "capability",
      "constraint": "2.x", "resolved": "2.4.0",
      "hash": "sha256:f0e1d2c3b4a5968778695a4b3c2d1e0f00112233445566778899aabbccddeeff",
      "scopes": ["records:write"], "approval": "required",
      "anchor": "pinned-hash" }
  ],
  "context": {
    "strategy": "minimal-relevant",
    "include": ["skill:knowledge.invoice-fields#required-fields", "input:document"],
    "exclude": ["skill:knowledge.invoice-fields#examples"]
  },
  "plan": {
    "runtime": { "adapter": "reference-node", "model": { "provider": "x", "name": "y" } },
    "steps": [
      {
        "id": "extract",
        "type": "model",
        "uses": "knowledge.invoice-fields",
        "prompt": {
          "role": "Rechnungs-Extraktor",
          "goal": "Extrahiere die deklarierten Pflichtfelder als strukturiertes JSON.",
          "style": "strict",
          "rules": [
            "Nur Werte aus dem Dokument verwenden.",
            "Keine fehlenden Werte erfinden.",
            "Nummern und Bezeichner exakt übernehmen."
          ],
          "contextFrom": ["knowledge.invoice-fields", "input:document"],
          "output": { "format": "json", "schema": "InvoiceFields" },
          "onMissingData": "return_validation_error"
        },
        "output": { "schema": "InvoiceFields" }
      },
      {
        "id": "store",
        "type": "capability",
        "uses": "capability.store.upsert",
        "effect": "write",
        "input": {
          "table":  "${inputs.targetTable}",
          "record": "${steps.extract.output.fields}",
          "date":   "${transform.normalize-date(steps.extract.output.fields.date)}"
        },
        "idempotencyKey": "${steps.extract.output.fields.invoiceNo}",
        "approval": "required",
        "compensation": "capability.store.delete",
        "condition": "${transform.non-empty(steps.extract.output.fields)}",
        "dependsOn": ["extract"]
      }
    ]
  },
  "policy": {
    "knowledge":  { "requireIntegrity": true, "autoLoad": false },
    "capability": { "requireIntegrity": true, "requireAuthorization": true },
    "write":      { "requireApproval": true, "requireIdempotency": true },
    "audit":      { "logEveryCapabilityCall": true }
  },
  "evaluation": {
    "pre":  { "schema": true, "bindings": true, "idFormat": true, "locks": true },
    "post": { "idExistence": true, "onFailure": "compensate" }
  },
  "uncertainty": {
    "assumptions":  [ { "text": "Datum liegt extrahierbar vor.", "confidence": 0.7 } ],
    "openQuestions": [ { "q": "Duplikate aktualisieren oder ablehnen?", "blocksExecution": true } ]
  },
  "lifecycle": { "mode": "reviewable" },
  "provenance": {
    "manifestHash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    "createdAt": "2026-06-23T10:00:00Z",
    "lock": "aim.lock"
  }
}
```

Dieses Beispiel ist `reviewable`, nicht `executable`: Die offene Frage hat
`blocksExecution: true` (G2-Bedingung 3 nicht erfüllt).

---

## 17. Konformitäts-Checkliste

Eine **Core**-Implementierung gilt als konform, wenn sie nachweislich:

1. ein Manifest gegen das Schema (§15) validiert und `AIM-E-1001` bei Verstoß meldet;
2. Manifeste nach JCS kanonisiert und `manifestHash` korrekt berechnet (§4);
3. die Binding-Grammatik (§8.1) parst und alle Referenzen statisch auflöst;
4. den DAG aus `dependsOn` und Bindings bildet und Zyklen mit `AIM-E-1002` ablehnt;
5. Schritte in topologischer Reihenfolge ausführt (§9.2), Conditions auswertet und
   übersprungene Schritte korrekt behandelt;
6. Idempotenz erzwingt (§9.4) und Schreibschritte ohne Schlüssel mit `AIM-E-1004`
   ablehnt;
7. bei Fehlern Kompensationen in umgekehrter Reihenfolge ausführt (§9.5);
8. die Pre-Gates (§10.1) prüft und den Lifecycle-Automaten (§11) inklusive
   Review-Gate durchsetzt;
9. Lock-Hashes vor jeder Ausführung verifiziert (§12.4) und Abweichungen mit
   `AIM-E-2005` abbricht;
10. mindestens den Adapter `reference-node` (§13) bereitstellt;
11. einen menschenlesbaren Renderer und ein Manifest-Diff bereitstellt (§11, G2-6);
12. den Prompt Composer (§9.7) deterministisch implementiert und Modellausgaben gegen
    den Ausgabevertrag prüft (`AIM-E-3001` bei Verstoß);
13. einen Compiler `*.aim → *.aim.json` bereitstellt, der deterministisch und
    round-trip-treu ist (§5.2).
