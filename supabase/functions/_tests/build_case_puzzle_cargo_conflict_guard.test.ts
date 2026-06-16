import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  applyCargoConflictGuards,
  detectCargoConflictGuards,
  extractExplicitBusTotalFromLatestInboundBody,
  looksLikePerUnitWeightExcerpt,
  looksLikeDutyTaxValueExcerpt,
  detectMixedCargoScopeFromBody,
} = await import("../build-case-puzzle/index.ts");

// --- GWC fixture (verified runtime case 08f968c3...) ---
const GWC_BODY =
  "We got an update from customer that now the total bus count is 15 and additionally 1x 20' and 1x 40' container has been added. Bus is increase to 15 Buses and one additional 20 ft container & one 40 ft container (medical equipment) non DGR items";

const GWC_EXTRACTED_FACTS = [
  { key: "cargo.pieces_count", value: 5, sourceExcerpt: "Quantity - 5" },
  { key: "cargo.weight_kg", value: 12320, sourceExcerpt: "GVW (approx.): 12,320 kg per unit" },
  { key: "cargo.value", value: 146619, sourceExcerpt: "Duty and tax 8702090 (48.89% on CIF) = 146619" },
  { key: "cargo.containers", value: "1x20+1x40", sourceExcerpt: "1x 20' and 1x 40' container has been added" },
];

// =====================================================================
// Pure helper tests
// =====================================================================

Deno.test("GWC exact: the 4 cargo-conflict guards are detected", () => {
  const guards = detectCargoConflictGuards({
    latestInboundBody: GWC_BODY,
    extractedFacts: GWC_EXTRACTED_FACTS,
  });
  const keys = guards.map((g: { gap_key: string }) => g.gap_key).sort();
  assertEquals(keys, [
    "cargo.mixed_scope_confirmation",
    "cargo.pieces_count_conflict",
    "cargo.value_conflict",
    "cargo.weight_total_confirmation",
  ]);
  for (const g of guards) {
    assertEquals(g.is_blocking, true);
    assertEquals(g.priority, "critical");
    assertEquals(g.gap_category, "cargo");
  }
});

Deno.test("extractExplicitBusTotalFromLatestInboundBody returns 15 for GWC", () => {
  assertEquals(extractExplicitBusTotalFromLatestInboundBody(GWC_BODY), 15);
});

Deno.test("No false positive: body says only '5 buses' and pieces_count=5", () => {
  const guards = detectCargoConflictGuards({
    latestInboundBody: "Please quote for 5 buses ex works.",
    extractedFacts: [{ key: "cargo.pieces_count", value: 5, sourceExcerpt: "Quantity - 5" }],
  });
  assertEquals(extractExplicitBusTotalFromLatestInboundBody("Please quote for 5 buses ex works."), 5);
  assert(!guards.some((g: { gap_key: string }) => g.gap_key === "cargo.pieces_count_conflict"));
});

Deno.test("No false positive: weight excerpt without 'per unit' / 'each'", () => {
  assertEquals(looksLikePerUnitWeightExcerpt("Total gross weight: 184,800 kg"), false);
  assertEquals(looksLikePerUnitWeightExcerpt("GVW (approx.): 12,320 kg per unit"), true);
  assertEquals(looksLikePerUnitWeightExcerpt("Weight 5000 kg each"), true);
  const guards = detectCargoConflictGuards({
    latestInboundBody: GWC_BODY,
    extractedFacts: [{ key: "cargo.weight_kg", value: 184800, sourceExcerpt: "Total gross weight: 184,800 kg" }],
  });
  assert(!guards.some((g: { gap_key: string }) => g.gap_key === "cargo.weight_total_confirmation"));
});

Deno.test("No false positive: value excerpt is commercial invoice / CIF value (not duty/tax)", () => {
  assertEquals(looksLikeDutyTaxValueExcerpt("Commercial invoice value: 146619 EUR"), false);
  assertEquals(looksLikeDutyTaxValueExcerpt("CIF value 146619 EUR"), false);
  assertEquals(looksLikeDutyTaxValueExcerpt("Duty and tax 8702090 (48.89% on CIF) = 146619"), true);
  const guards = detectCargoConflictGuards({
    latestInboundBody: "Quote please.",
    extractedFacts: [{ key: "cargo.value", value: 146619, sourceExcerpt: "Commercial invoice value: 146619 EUR" }],
  });
  assert(!guards.some((g: { gap_key: string }) => g.gap_key === "cargo.value_conflict"));
});

Deno.test("detectMixedCargoScopeFromBody requires bus + additional container + medical equipment", () => {
  assertEquals(detectMixedCargoScopeFromBody(GWC_BODY), true);
  // Buses only, no medical equipment, no additional container -> false
  assertEquals(detectMixedCargoScopeFromBody("We confirm 15 buses for shipment."), false);
});

Deno.test("Idempotence: decision helper is a no-op when all gaps already open", () => {
  const guards = detectCargoConflictGuards({
    latestInboundBody: GWC_BODY,
    extractedFacts: GWC_EXTRACTED_FACTS,
    existingOpenGapKeys: [
      "cargo.pieces_count_conflict",
      "cargo.weight_total_confirmation",
      "cargo.value_conflict",
      "cargo.mixed_scope_confirmation",
    ],
  });
  assertEquals(guards.length, 0);
});

// =====================================================================
// Orchestrator integration tests (with a fake Supabase client)
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

Deno.test("Orchestrator: GWC case creates 4 blocking gaps and deactivates conflicting facts", async () => {
  const db = new FakeServiceClient(seedGwcFacts());

  const result = await applyCargoConflictGuards({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_BODY,
  });

  assertEquals(result.gapsIdentified, 4);

  const openGapKeys = db.gaps.filter((g) => g.status === "open").map((g) => g.gap_key).sort();
  assertEquals(openGapKeys, [
    "cargo.mixed_scope_confirmation",
    "cargo.pieces_count_conflict",
    "cargo.value_conflict",
    "cargo.weight_total_confirmation",
  ]);
  for (const g of db.gaps) {
    assertEquals(g.is_blocking, true);
    assertEquals(g.priority, "critical");
    assertEquals(g.gap_category, "cargo");
  }

  // pieces_count (ai), weight_kg (ai, per unit), value (attachment, duty/tax) deactivated.
  assertEquals(result.factsDeactivated, 3);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.pieces_count")?.is_current, false);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.weight_kg")?.is_current, false);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.value")?.is_current, false);
  // containers fact is never touched.
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.containers")?.is_current, true);

  // Never writes a corrected value.
  assert(!db.facts.some((f) => f.is_current && f.fact_key === "cargo.pieces_count" && f.value_number === 15));
});

Deno.test("Orchestrator idempotence: second run creates no new gap and no new deactivation", async () => {
  const db = new FakeServiceClient(seedGwcFacts());
  await applyCargoConflictGuards({ case_id: "case-gwc", serviceClient: db, latestInboundBody: GWC_BODY });
  const gapsAfterFirst = db.gaps.length;

  const second = await applyCargoConflictGuards({ case_id: "case-gwc", serviceClient: db, latestInboundBody: GWC_BODY });
  assertEquals(second.gapsIdentified, 0);
  assertEquals(second.factsDeactivated, 0);
  assertEquals(db.gaps.length, gapsAfterFirst);
});

Deno.test("Orchestrator never deactivates operator/manual_input facts", async () => {
  const db = new FakeServiceClient([
    fact({ fact_key: "cargo.pieces_count", value_number: 5, source_excerpt: "Quantity - 5", source_type: "operator" }),
    fact({ fact_key: "cargo.weight_kg", value_number: 12320, source_excerpt: "12,320 kg per unit", source_type: "manual_input" }),
    fact({ fact_key: "cargo.value", value_number: 146619, source_excerpt: "Duty and tax = 146619", source_type: "manual_input" }),
  ]);

  const result = await applyCargoConflictGuards({ case_id: "case-gwc", serviceClient: db, latestInboundBody: GWC_BODY });

  // Gaps still raised, but protected facts are untouched.
  assert(result.gapsIdentified >= 3);
  assertEquals(result.factsDeactivated, 0);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.pieces_count")?.is_current, true);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.weight_kg")?.is_current, true);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.value")?.is_current, true);
});

Deno.test("Orchestrator no-op on empty inbound body", async () => {
  const db = new FakeServiceClient(seedGwcFacts());
  const result = await applyCargoConflictGuards({ case_id: "case-gwc", serviceClient: db, latestInboundBody: "" });
  assertEquals(result.gapsIdentified, 0);
  assertEquals(result.factsDeactivated, 0);
  assertEquals(db.gaps.length, 0);
});
