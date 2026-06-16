import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  hasRecentClientUpdateSignal,
  looksLikeHistoricalSodatraQuotationDoc,
  excerptComesFromHistoricalDoc,
  isDocProvenanceGuardedCargoKey,
  detectHistoricalDocCargoFacts,
  applyEmailDocProvenanceGuard,
} = await import("../build-case-puzzle/index.ts");

// --- GWC fixture (verified runtime case) ------------------------------------
// Latest inbound CLIENT body: explicit update to 15 buses + additional containers.
const GWC_CLIENT_BODY =
  "We got an update from customer that now the total bus count is 15 and additionally 1x 20' and 1x 40' container has been added. Bus is increase to 15 Buses and one additional 20 ft container & one 40 ft container (medical equipment) non DGR items";

// Old SODATRA quotation PDF (attached to Cherif's outbound reply) — 5 buses.
const GWC_HISTORICAL_PDF_TEXT = [
  "SODATRA Transit Logistique - Quotation",
  "Hyundai Buses",
  "Quantity - 5",
  "GVW (approx.): 12,320 kg per unit",
  "Container: 1x 20' and 1x 40' container has been added",
  "Duty and tax 8702090 (48.89% on CIF) = 146619",
].join("\n");

// Cargo facts the AI would extract from the historical PDF.
const GWC_CANDIDATE_FACTS = [
  { key: "cargo.pieces_count", sourceExcerpt: "Quantity - 5" },
  { key: "cargo.weight_kg", sourceExcerpt: "GVW (approx.): 12,320 kg per unit" },
  { key: "cargo.value", sourceExcerpt: "Duty and tax 8702090 (48.89% on CIF) = 146619" },
  { key: "cargo.containers", sourceExcerpt: "1x 20' and 1x 40' container has been added" },
];

// =====================================================================
// Pure helper tests
// =====================================================================

Deno.test("hasRecentClientUpdateSignal: GWC update body true, neutral body false", () => {
  assertEquals(hasRecentClientUpdateSignal(GWC_CLIENT_BODY), true);
  assertEquals(
    hasRecentClientUpdateSignal("Please find attached our shipping documents for clearance."),
    false,
  );
  assertEquals(hasRecentClientUpdateSignal(""), false);
});

Deno.test("looksLikeHistoricalSodatraQuotationDoc: SODATRA + quotation signal only", () => {
  // SODATRA owner + filename quotation signal
  assertEquals(
    looksLikeHistoricalSodatraQuotationDoc({ ownerIsSodatra: true, filename: "Quotation_GWC.pdf" }),
    true,
  );
  // SODATRA owner + text quotation/duty-tax signal
  assertEquals(
    looksLikeHistoricalSodatraQuotationDoc({
      ownerIsSodatra: true,
      filename: "doc.pdf",
      extractedText: GWC_HISTORICAL_PDF_TEXT,
    }),
    true,
  );
  // NOT SODATRA → never flagged (current client attachment)
  assertEquals(
    looksLikeHistoricalSodatraQuotationDoc({
      ownerIsSodatra: false,
      filename: "Quotation_GWC.pdf",
      extractedText: GWC_HISTORICAL_PDF_TEXT,
    }),
    false,
  );
  // SODATRA owner forwarding a plain client doc WITHOUT quotation signal → not flagged
  assertEquals(
    looksLikeHistoricalSodatraQuotationDoc({
      ownerIsSodatra: true,
      filename: "client_packing_list.pdf",
      extractedText: "Packing list\nHyundai buses\n15 units\nNhava Sheva to Dakar",
    }),
    false,
  );
});

Deno.test("excerptComesFromHistoricalDoc: substring match with min length", () => {
  assert(excerptComesFromHistoricalDoc("Quantity - 5", [GWC_HISTORICAL_PDF_TEXT]));
  assert(excerptComesFromHistoricalDoc("Duty and tax 8702090 (48.89% on CIF) = 146619", [GWC_HISTORICAL_PDF_TEXT]));
  // Not present
  assertEquals(excerptComesFromHistoricalDoc("total bus count is 15", [GWC_HISTORICAL_PDF_TEXT]), false);
  // Too short / empty
  assertEquals(excerptComesFromHistoricalDoc("5", [GWC_HISTORICAL_PDF_TEXT]), false);
  assertEquals(excerptComesFromHistoricalDoc("Quantity - 5", []), false);
});

Deno.test("isDocProvenanceGuardedCargoKey: containers guarded only when body shows addition", () => {
  assertEquals(isDocProvenanceGuardedCargoKey("cargo.pieces_count", "anything"), true);
  assertEquals(isDocProvenanceGuardedCargoKey("cargo.weight_kg", "anything"), true);
  assertEquals(isDocProvenanceGuardedCargoKey("cargo.value", "anything"), true);
  // routing/contact never guarded
  assertEquals(isDocProvenanceGuardedCargoKey("routing.origin_port", GWC_CLIENT_BODY), false);
  assertEquals(isDocProvenanceGuardedCargoKey("contacts.client_company", GWC_CLIENT_BODY), false);
  // containers: guarded when addition present, not otherwise
  assertEquals(isDocProvenanceGuardedCargoKey("cargo.containers", GWC_CLIENT_BODY), true);
  assertEquals(isDocProvenanceGuardedCargoKey("cargo.containers", "We confirm 15 buses."), false);
});

Deno.test("Test 1 — GWC: historical-PDF cargo facts are flagged for drop (containers kept, re-confirmed by client)", () => {
  const flagged = detectHistoricalDocCargoFacts({
    latestInboundBody: GWC_CLIENT_BODY,
    historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
    candidateFacts: GWC_CANDIDATE_FACTS,
  }).sort();
  assertEquals(flagged, ["cargo.pieces_count", "cargo.value", "cargo.weight_kg"]);
  // containers NOT flagged: its excerpt is echoed by the latest client body.
  assert(!flagged.includes("cargo.containers"));
});

Deno.test("Test 2 — current client attachment is not blocked (owner not SODATRA → no historical docs)", () => {
  const flagged = detectHistoricalDocCargoFacts({
    latestInboundBody: "Please quote, EXW. Weight 8000 kg, 2x40HC.",
    historicalDocTexts: [], // client-owned attachment never enters historicalDocTexts
    candidateFacts: [
      { key: "cargo.weight_kg", sourceExcerpt: "Total gross weight: 8,000 kg" },
      { key: "cargo.containers", sourceExcerpt: "2x40HC" },
    ],
  });
  assertEquals(flagged, []);
});

Deno.test("Test 3 — SODATRA non-cargo doc: routing/contact facts are never flagged", () => {
  const flagged = detectHistoricalDocCargoFacts({
    latestInboundBody: GWC_CLIENT_BODY,
    historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
    candidateFacts: [
      { key: "routing.origin_port", sourceExcerpt: "SODATRA Transit Logistique - Quotation" },
      { key: "contacts.client_company", sourceExcerpt: "Hyundai Buses" },
    ],
  });
  assertEquals(flagged, []);
});

Deno.test("Test 6 — false positive: no historical doc, or no update signal → nothing flagged", () => {
  // Update signal present, but no historical SODATRA quotation doc collected.
  assertEquals(
    detectHistoricalDocCargoFacts({
      latestInboundBody: GWC_CLIENT_BODY,
      historicalDocTexts: [],
      candidateFacts: GWC_CANDIDATE_FACTS,
    }),
    [],
  );
  // Historical doc present, but the client body has no update signal.
  assertEquals(
    detectHistoricalDocCargoFacts({
      latestInboundBody: "Please find attached the quotation and confirm.",
      historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
      candidateFacts: GWC_CANDIDATE_FACTS,
    }),
    [],
  );
});

// =====================================================================
// Orchestrator integration tests (fake Supabase client)
// =====================================================================

type FactRow = {
  id: string;
  case_id: string;
  fact_key: string;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown | null;
  source_type: string | null;
  source_excerpt: string | null;
  is_current: boolean;
};

type GapRow = {
  id: string;
  case_id: string;
  gap_key: string;
  gap_category: string;
  status: string;
  is_blocking: boolean;
  priority: string;
  question_fr: string;
  question_en: string;
};

class QueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private inFilter: [string, unknown[]] | null = null;
  private operation: "select" | "update" | null = null;
  private updatePayload: Record<string, unknown> | null = null;

  constructor(private db: FakeServiceClient, private table: string) {}

  select() {
    this.operation = "select";
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }

  in(key: string, values: unknown[]) {
    this.inFilter = [key, values];
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.operation = "update";
    this.updatePayload = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    if (this.table !== "quote_gaps") throw new Error(`Unexpected insert into ${this.table}`);
    this.db.gaps.push({
      id: `gap-${this.db.gaps.length + 1}`,
      status: "open",
      ...payload,
    } as GapRow);
    return Promise.resolve({ data: null, error: null });
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  then(resolve: (value: { data: unknown[] | null; error: null }) => void, reject: (reason?: unknown) => void) {
    this.execute().then(resolve, reject);
  }

  private execute() {
    if (this.operation === "update") {
      const rows = this.rows();
      for (const row of rows) Object.assign(row as Record<string, unknown>, this.updatePayload);
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: this.rows(), error: null });
  }

  private rows(): Array<Record<string, unknown>> {
    const source = (this.table === "quote_facts" ? this.db.facts : this.db.gaps) as Array<Record<string, unknown>>;
    return source.filter((row: Record<string, unknown>) => {
      for (const [key, value] of this.filters) {
        if (row[key] !== value) return false;
      }
      if (this.inFilter) {
        const [key, values] = this.inFilter;
        if (!values.includes(row[key])) return false;
      }
      return true;
    }) as Array<Record<string, unknown>>;
  }
}

class FakeServiceClient {
  facts: FactRow[];
  gaps: GapRow[] = [];

  constructor(facts: FactRow[]) {
    this.facts = facts;
  }

  from(table: string) {
    return new QueryBuilder(this, table);
  }
}

function fact(overrides: Partial<FactRow>): FactRow {
  return {
    id: `fact-seed-${Math.random()}`,
    case_id: "case-gwc",
    fact_key: "",
    value_text: null,
    value_number: null,
    value_json: null,
    source_type: "ai_extraction",
    source_excerpt: null,
    is_current: true,
    ...overrides,
  };
}

function seedGwcFacts(): FactRow[] {
  return [
    fact({ fact_key: "cargo.pieces_count", value_number: 5, source_excerpt: "Quantity - 5", source_type: "ai_extraction" }),
    fact({ fact_key: "cargo.weight_kg", value_number: 12320, source_excerpt: "GVW (approx.): 12,320 kg per unit", source_type: "ai_extraction" }),
    fact({ fact_key: "cargo.value", value_number: 146619, source_excerpt: "Duty and tax 8702090 (48.89% on CIF) = 146619", source_type: "attachment_extracted" }),
    fact({ fact_key: "cargo.containers", value_text: "1x20+1x40", source_excerpt: "1x 20' and 1x 40' container has been added", source_type: "ai_extraction" }),
  ];
}

Deno.test("Orchestrator — GWC: deactivates historical-PDF cargo facts, keeps client-confirmed containers, raises 1 gap", async () => {
  const db = new FakeServiceClient(seedGwcFacts());

  const result = await applyEmailDocProvenanceGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
    historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
  });

  // pieces_count, weight_kg, value declassed; containers kept (re-confirmed by client).
  assertEquals(result.factsDeactivated, 3);
  assertEquals(result.declassedKeys.sort(), ["cargo.pieces_count", "cargo.value", "cargo.weight_kg"]);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.pieces_count")?.is_current, false);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.weight_kg")?.is_current, false);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.value")?.is_current, false);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.containers")?.is_current, true);

  // One blocking provenance gap.
  assertEquals(result.gapsIdentified, 1);
  const openGaps = db.gaps.filter((g) => g.status === "open");
  assertEquals(openGaps.length, 1);
  assertEquals(openGaps[0].gap_key, "cargo.document_provenance_conflict");
  assertEquals(openGaps[0].is_blocking, true);
  assertEquals(openGaps[0].priority, "critical");
  assertEquals(openGaps[0].gap_category, "cargo");

  // Never writes a corrected value.
  assert(!db.facts.some((f) => f.is_current && f.fact_key === "cargo.pieces_count" && f.value_number === 15));
});

Deno.test("Orchestrator — Test 4: never deactivates operator/manual_input facts", async () => {
  const db = new FakeServiceClient([
    fact({ fact_key: "cargo.pieces_count", value_number: 5, source_excerpt: "Quantity - 5", source_type: "operator" }),
    fact({ fact_key: "cargo.weight_kg", value_number: 12320, source_excerpt: "GVW (approx.): 12,320 kg per unit", source_type: "manual_input" }),
    fact({ fact_key: "cargo.value", value_number: 146619, source_excerpt: "Duty and tax 8702090 (48.89% on CIF) = 146619", source_type: "manual_input" }),
  ]);

  const result = await applyEmailDocProvenanceGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
    historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
  });

  assertEquals(result.factsDeactivated, 0);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.pieces_count")?.is_current, true);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.weight_kg")?.is_current, true);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.value")?.is_current, true);
  // No fact declassed → no gap raised.
  assertEquals(result.gapsIdentified, 0);
  assertEquals(db.gaps.length, 0);
});

Deno.test("Orchestrator — Test 5: idempotent (second run creates no new gap, no new deactivation)", async () => {
  const db = new FakeServiceClient(seedGwcFacts());
  await applyEmailDocProvenanceGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
    historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
  });
  const gapsAfterFirst = db.gaps.length;

  const second = await applyEmailDocProvenanceGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
    historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
  });
  assertEquals(second.factsDeactivated, 0);
  assertEquals(second.gapsIdentified, 0);
  assertEquals(db.gaps.length, gapsAfterFirst);
});

Deno.test("Orchestrator — pre-write drop still raises the gap (first run, facts never written)", async () => {
  // No current facts (they were dropped pre-write), but preWriteDroppedFactKeys provided.
  const db = new FakeServiceClient([]);
  const result = await applyEmailDocProvenanceGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
    historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
    preWriteDroppedFactKeys: ["cargo.pieces_count", "cargo.weight_kg", "cargo.value"],
  });
  assertEquals(result.factsDeactivated, 0);
  assertEquals(result.gapsIdentified, 1);
  assertEquals(db.gaps[0].gap_key, "cargo.document_provenance_conflict");
});

Deno.test("Orchestrator — Test 6: no historical doc or no update signal → full no-op", async () => {
  // No historical docs.
  const db1 = new FakeServiceClient(seedGwcFacts());
  const r1 = await applyEmailDocProvenanceGuard({
    case_id: "case-gwc",
    serviceClient: db1,
    latestInboundBody: GWC_CLIENT_BODY,
    historicalDocTexts: [],
  });
  assertEquals(r1.factsDeactivated, 0);
  assertEquals(r1.gapsIdentified, 0);
  assertEquals(db1.gaps.length, 0);
  assertEquals(db1.facts.every((f) => f.is_current), true);

  // No update signal in client body.
  const db2 = new FakeServiceClient(seedGwcFacts());
  const r2 = await applyEmailDocProvenanceGuard({
    case_id: "case-gwc",
    serviceClient: db2,
    latestInboundBody: "Please find attached the quotation and confirm.",
    historicalDocTexts: [GWC_HISTORICAL_PDF_TEXT],
  });
  assertEquals(r2.factsDeactivated, 0);
  assertEquals(r2.gapsIdentified, 0);
  assertEquals(db2.gaps.length, 0);
});
