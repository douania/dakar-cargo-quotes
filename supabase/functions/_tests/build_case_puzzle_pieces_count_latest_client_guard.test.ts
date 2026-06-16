import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  extractExplicitBusTotalFromLatestInboundBody,
  applyLatestClientPiecesCountGuard,
} = await import("../build-case-puzzle/index.ts");

// Latest inbound CLIENT body: explicit update to 15 buses.
const GWC_CLIENT_BODY =
  "We got an update from customer that now the total bus count is 15 and additionally 1x 20' and 1x 40' container has been added. Bus is increase to 15 Buses (medical equipment) non DGR items";

// Body that mentions 15 in a NON-bus context (false-positive guard).
const NON_BUS_BODY = "Please send 15 copies of the commercial invoice within 15 days for clearance.";

// =====================================================================
// Pure extraction contract
// =====================================================================

Deno.test("extractExplicitBusTotalFromLatestInboundBody: 15 for GWC, null for non-bus '15'", () => {
  assertEquals(extractExplicitBusTotalFromLatestInboundBody(GWC_CLIENT_BODY), 15);
  assertEquals(extractExplicitBusTotalFromLatestInboundBody(NON_BUS_BODY), null);
  assertEquals(extractExplicitBusTotalFromLatestInboundBody("Please quote our shipment, urgent."), null);
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
    fact_key: "cargo.pieces_count",
    value_text: null,
    value_number: null,
    value_json: null,
    source_type: "ai_extraction",
    source_excerpt: "Quantity - 5",
    is_current: true,
    ...overrides,
  };
}

Deno.test("Test 1a — GWC: pieces_count=5 (value_number, ai_extraction) deactivated + gap created", async () => {
  const db = new FakeServiceClient([fact({ value_number: 5 })]);
  const r = await applyLatestClientPiecesCountGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
  });
  assertEquals(r.clientBusTotal, 15);
  assertEquals(r.currentPiecesCount, 5);
  assertEquals(r.factsDeactivated, 1);
  assertEquals(r.gapsIdentified, 1);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.pieces_count")?.is_current, false);
  const gap = db.gaps[0];
  assertEquals(gap.gap_key, "cargo.pieces_count_conflict");
  assertEquals(gap.is_blocking, true);
  assertEquals(gap.priority, "critical");
  assertEquals(gap.gap_category, "cargo");
  // Dynamic wording carries the runtime values, not hardcoded constants.
  assert(gap.question_fr.includes("15"));
  assert(gap.question_fr.includes("5"));
  // Never writes a corrected value.
  assert(!db.facts.some((f) => f.is_current && f.fact_key === "cargo.pieces_count" && f.value_number === 15));
});

Deno.test("Test 1b — GWC bug repro: pieces_count stored as value_text='5' is ALSO deactivated", async () => {
  // This is the storage variant that CARGO-CONFLICT-GUARD-GWC-1 missed
  // (its deactivation predicate inspects value_number only).
  const db = new FakeServiceClient([fact({ value_text: "5", value_number: null })]);
  const r = await applyLatestClientPiecesCountGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
  });
  assertEquals(r.currentPiecesCount, 5);
  assertEquals(r.factsDeactivated, 1);
  assertEquals(r.gapsIdentified, 1);
  assertEquals(db.facts.find((f) => f.fact_key === "cargo.pieces_count")?.is_current, false);
});

Deno.test("Test 2 — correct value: pieces_count=15 → no-op, no gap, no deactivation", async () => {
  const db = new FakeServiceClient([fact({ value_number: 15, source_excerpt: "15 buses" })]);
  const r = await applyLatestClientPiecesCountGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
  });
  assertEquals(r.clientBusTotal, 15);
  assertEquals(r.currentPiecesCount, 15);
  assertEquals(r.factsDeactivated, 0);
  assertEquals(r.gapsIdentified, 0);
  assertEquals(db.gaps.length, 0);
  assertEquals(db.facts[0].is_current, true);
});

Deno.test("Test 3 — protected source (operator/manual_input) is never deactivated", async () => {
  for (const src of ["operator", "manual_input"]) {
    const db = new FakeServiceClient([fact({ value_number: 5, source_type: src })]);
    const r = await applyLatestClientPiecesCountGuard({
      case_id: "case-gwc",
      serviceClient: db,
      latestInboundBody: GWC_CLIENT_BODY,
    });
    assertEquals(r.factsDeactivated, 0);
    assertEquals(db.facts[0].is_current, true, `source ${src} must stay current`);
    // Conflict still flagged for the operator.
    assertEquals(r.gapsIdentified, 1);
  }
});

Deno.test("Test 4 — no explicit bus total in client body → full no-op", async () => {
  const db = new FakeServiceClient([fact({ value_number: 5 })]);
  const r = await applyLatestClientPiecesCountGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: "Please quote our shipment, urgent, EXW Mumbai.",
  });
  assertEquals(r.clientBusTotal, null);
  assertEquals(r.factsDeactivated, 0);
  assertEquals(r.gapsIdentified, 0);
  assertEquals(db.gaps.length, 0);
  assertEquals(db.facts[0].is_current, true);
});

Deno.test("Test 5 — idempotence: second run creates no new gap and no new deactivation", async () => {
  const db = new FakeServiceClient([fact({ value_number: 5 })]);
  await applyLatestClientPiecesCountGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
  });
  const gapsAfterFirst = db.gaps.length;

  const second = await applyLatestClientPiecesCountGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: GWC_CLIENT_BODY,
  });
  // pieces_count is no longer current → nothing to do.
  assertEquals(second.factsDeactivated, 0);
  assertEquals(second.gapsIdentified, 0);
  assertEquals(db.gaps.length, gapsAfterFirst);
});

Deno.test("Test 6 — false positive: '15' in a non-bus context → no-op", async () => {
  const db = new FakeServiceClient([fact({ value_number: 5 })]);
  const r = await applyLatestClientPiecesCountGuard({
    case_id: "case-gwc",
    serviceClient: db,
    latestInboundBody: NON_BUS_BODY,
  });
  assertEquals(r.clientBusTotal, null);
  assertEquals(r.factsDeactivated, 0);
  assertEquals(r.gapsIdentified, 0);
  assertEquals(db.gaps.length, 0);
  assertEquals(db.facts[0].is_current, true);
});
