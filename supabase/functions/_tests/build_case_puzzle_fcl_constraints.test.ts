import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  applyFclConstraintPostProcessing,
  countContainers,
  deriveTotalWeightIfSafe,
  parseDestinationFreeTime,
  parseFinalDestinationTransit,
  parsePerContainerWeight,
} = await import("../build-case-puzzle/index.ts");

type FactRow = {
  id: string;
  case_id: string;
  fact_key: string;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown | null;
  source_type: string | null;
  source_excerpt?: string | null;
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

  rpc(name: string, payload: Record<string, unknown>) {
    assertEquals(name, "supersede_fact");
    assertEquals(payload.p_source_type, "ai_extraction");
    for (const fact of this.facts) {
      if (fact.case_id === payload.p_case_id && fact.fact_key === payload.p_fact_key && fact.is_current) {
        fact.is_current = false;
      }
    }
    this.facts.push({
      id: `fact-${this.facts.length + 1}`,
      case_id: String(payload.p_case_id),
      fact_key: String(payload.p_fact_key),
      value_text: (payload.p_value_text as string | null) ?? null,
      value_number: (payload.p_value_number as number | null) ?? null,
      value_json: payload.p_value_json ?? null,
      source_type: String(payload.p_source_type),
      source_excerpt: (payload.p_source_excerpt as string | null) ?? null,
      is_current: true,
    });
    return Promise.resolve({ data: `fact-${this.facts.length}`, error: null });
  }
}

const rfqText = `
Origin Port: Dakar Sea port (FOB)
Destination Port: Djibouti Sea Port, Djibouti
Volume: 1x20 & 1x40HC
Weight: 20 MT per container
Free time: Need 30 Days free time at destination as Cargo is intransit to Ethiopia.
`;

function fact(overrides: Partial<FactRow>): FactRow {
  return {
    id: `fact-seed-${Math.random()}`,
    case_id: "case-1",
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

Deno.test("FCL constraints - derives total and per-container weight when containers are explicit", async () => {
  const db = new FakeServiceClient([
    fact({
      fact_key: "cargo.containers",
      value_json: [{ type: "20GP", quantity: 1 }, { type: "40HC", quantity: 1 }],
    }),
  ]);

  await applyFclConstraintPostProcessing({
    case_id: "case-1",
    serviceClient: db,
    text: rfqText,
    sourceEmailId: "email-1",
  });

  const total = db.facts.find((f) => f.fact_key === "cargo.weight_kg" && f.is_current);
  const perContainer = db.facts.find((f) => f.fact_key === "cargo.weight_per_container_kg" && f.is_current);

  assertEquals(perContainer?.value_number, 20000);
  assertEquals(total?.value_number, 40000);
  assertEquals(total?.source_type, "ai_extraction");
  assert(total?.source_excerpt?.startsWith("[deterministic_calc]"));
  assert(total?.source_excerpt?.includes("20 MT per container"));
});

Deno.test("FCL constraints - per-container weight without containers creates blocking total-weight gap", async () => {
  const db = new FakeServiceClient([
    fact({
      fact_key: "cargo.weight_kg",
      value_number: 20000,
      source_excerpt: "Weight: 20 MT per container",
    }),
  ]);

  await applyFclConstraintPostProcessing({
    case_id: "case-1",
    serviceClient: db,
    text: "Weight: 20 MT per container",
    sourceEmailId: "email-1",
  });

  const total = db.facts.find((f) => f.fact_key === "cargo.weight_kg" && f.is_current);
  const gap = db.gaps.find((g) => g.gap_key === "cargo.weight_kg" && g.status === "open");

  assertEquals(total, undefined);
  assertEquals(gap?.is_blocking, true);
});

Deno.test("FCL constraints - extracts destination free time", () => {
  const parsed = parseDestinationFreeTime("Need 30 Days free time at destination");
  assertEquals(parsed?.days, 30);
});

Deno.test("FCL constraints - extracts final destination and transit via port", () => {
  const parsed = parseFinalDestinationTransit(rfqText);
  assertEquals(parsed?.finalDestination, "Ethiopia");
  assertEquals(parsed?.transitViaPort, "Djibouti Sea Port");
});

Deno.test("FCL constraints - manual total weight is not overwritten", async () => {
  const db = new FakeServiceClient([
    fact({
      fact_key: "cargo.containers",
      value_json: [{ type: "20GP", quantity: 1 }, { type: "40HC", quantity: 1 }],
    }),
    fact({
      fact_key: "cargo.weight_kg",
      value_number: 12345,
      source_type: "manual_input",
    }),
  ]);

  await applyFclConstraintPostProcessing({
    case_id: "case-1",
    serviceClient: db,
    text: rfqText,
    sourceEmailId: "email-1",
  });

  const total = db.facts.find((f) => f.fact_key === "cargo.weight_kg" && f.is_current);
  assertEquals(total?.value_number, 12345);
  assertEquals(total?.source_type, "manual_input");
});

Deno.test("FCL constraints - pure helper keeps safe derivation explicit", () => {
  const perContainer = parsePerContainerWeight("Weight: 20 MT per container");
  const containers = countContainers([{ type: "20GP", quantity: 1 }, { type: "40HC", quantity: 1 }]);
  const derived = deriveTotalWeightIfSafe(perContainer, containers);

  assertEquals(derived?.weightPerContainerKg, 20000);
  assertEquals(derived?.totalWeightKg, 40000);
});
