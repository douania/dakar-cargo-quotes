import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY,
  ensureExportSeaFreightPartnerOrchestration,
} = await import("../build-case-puzzle/index.ts");

type FactRow = {
  case_id: string;
  fact_key: string;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown | null;
  is_current: boolean;
};

type GapRow = {
  id: string;
  case_id: string;
  gap_key: string;
  status: string;
  is_blocking: boolean;
};

type RequestRow = {
  id: string;
  case_id: string;
  partner_name: string;
  partner_email: string | null;
  purpose: string;
  purpose_detail: string | null;
  status: string;
  related_lot_index: number | null;
};

type ResponseFactRow = {
  id: string;
  case_id: string;
  request_id: string;
  fact_key: string;
  validation_status: string;
};

class QueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private inFilter: [string, unknown[]] | null = null;
  private pendingInsert: Record<string, unknown> | null = null;
  private pendingUpdate: Record<string, unknown> | null = null;

  constructor(private db: FakeServiceClient, private table: string) {}

  select() {
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

  insert(payload: Record<string, unknown>) {
    this.pendingInsert = payload;
    if (this.table === "quote_gaps") {
      this.db.gaps.push({
        id: `gap-${this.db.gaps.length + 1}`,
        status: "open",
        ...payload,
      } as GapRow);
      this.pendingInsert = null;
    } else if (this.table === "external_quote_requests") {
      const row = {
        id: `req-${this.db.requests.length + 1}`,
        ...payload,
      } as RequestRow;
      this.db.requests.push(row);
      this.pendingInsert = row as unknown as Record<string, unknown>;
    } else if (this.table === "case_timeline_events") {
      this.db.events.push(payload);
      this.pendingInsert = null;
    } else {
      throw new Error(`Unexpected insert into ${this.table}`);
    }
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.pendingUpdate = payload;
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  single() {
    if (this.pendingInsert) return Promise.resolve({ data: this.pendingInsert, error: null });
    const rows = this.rows();
    if (this.pendingUpdate) {
      for (const row of rows) Object.assign(row, this.pendingUpdate);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }

  then(
    resolve: (value: { data: Array<Record<string, unknown>> | null; error: null }) => void,
    reject: (reason?: unknown) => void,
  ) {
    this.execute().then(resolve, reject);
  }

  private execute() {
    if (this.pendingUpdate) {
      const rows = this.rows();
      for (const row of rows) Object.assign(row, this.pendingUpdate);
      this.pendingUpdate = null;
      return Promise.resolve({ data: null, error: null });
    }
    if (this.pendingInsert) {
      return Promise.resolve({ data: [this.pendingInsert], error: null });
    }
    return Promise.resolve({ data: this.rows(), error: null });
  }

  private rows(): Array<Record<string, unknown>> {
    let rows: Array<Record<string, unknown>>;
    if (this.table === "quote_facts") rows = this.db.facts as unknown as Array<Record<string, unknown>>;
    else if (this.table === "quote_gaps") rows = this.db.gaps as unknown as Array<Record<string, unknown>>;
    else if (this.table === "external_quote_requests") rows = this.db.requests as unknown as Array<Record<string, unknown>>;
    else if (this.table === "external_quote_response_facts") rows = this.db.responseFacts as unknown as Array<Record<string, unknown>>;
    else rows = [];

    return rows.filter((row) => {
      for (const [key, value] of this.filters) {
        if (row[key] !== value) return false;
      }
      if (this.inFilter) {
        const [key, values] = this.inFilter;
        if (!values.includes(row[key])) return false;
      }
      return true;
    });
  }
}

class FakeServiceClient {
  facts: FactRow[];
  gaps: GapRow[] = [];
  requests: RequestRow[] = [];
  responseFacts: ResponseFactRow[] = [];
  events: Array<Record<string, unknown>> = [];

  constructor(facts: FactRow[]) {
    this.facts = facts;
  }

  from(table: string) {
    return new QueryBuilder(this, table);
  }
}

function exportFacts(): FactRow[] {
  const case_id = "case-export";
  return [
    fact(case_id, "service.package", "EXPORT_SENEGAL"),
    fact(case_id, "routing.origin_port", "Dakar Sea port"),
    fact(case_id, "routing.destination_port", "Djibouti Sea Port"),
    fact(case_id, "routing.final_destination", "Ethiopia"),
    fact(case_id, "routing.incoterm", "FOB"),
    fact(case_id, "cargo.weight_kg", null, 40000),
    fact(case_id, "pricing.destination_free_time_days", null, 30),
    fact(case_id, "cargo.containers", null, null, [
      { type: "20GP", quantity: 1 },
      { type: "40HC", quantity: 1 },
    ]),
  ];
}

function fact(
  case_id: string,
  fact_key: string,
  value_text: string | null,
  value_number: number | null = null,
  value_json: unknown | null = null,
): FactRow {
  return { case_id, fact_key, value_text, value_number, value_json, is_current: true };
}

function freightRequest(status: string, id = "req-freight"): RequestRow {
  return {
    id,
    case_id: "case-export",
    partner_name: "Carrier",
    partner_email: null,
    purpose: "freight_rate",
    purpose_detail: null,
    status,
    related_lot_index: null,
  };
}

function responseFact(
  validation_status: string,
  fact_key = "cargo.freight_cost",
  request_id = "req-freight",
): ResponseFactRow {
  return {
    id: `fact-${validation_status}-${fact_key}`,
    case_id: "case-export",
    request_id,
    fact_key,
    validation_status,
  };
}

Deno.test("export SEA_FREIGHT orchestration creates blocking gap and freight_rate draft", async () => {
  const db = new FakeServiceClient(exportFacts());

  const result = await ensureExportSeaFreightPartnerOrchestration({
    case_id: "case-export",
    serviceClient: db,
  });

  assertEquals(result.gapCreated, true);
  assertEquals(result.requestCreated, true);
  assertEquals(db.gaps.length, 1);
  assertEquals(db.gaps[0].gap_key, EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY);
  assertEquals(db.gaps[0].is_blocking, true);
  assertEquals(db.requests.length, 1);
  assertEquals(db.requests[0].purpose, "freight_rate");
  assertEquals(db.requests[0].status, "draft");
  assert(db.requests[0].purpose_detail?.includes("Origine : Dakar Sea port"));
  assert(db.requests[0].purpose_detail?.includes("Destination : Djibouti Sea Port"));
  assert(db.requests[0].purpose_detail?.includes("Destination finale : Ethiopia"));
  assert(db.requests[0].purpose_detail?.includes("Incoterm : FOB"));
  assert(db.requests[0].purpose_detail?.includes("Conteneurs : 1x20GP + 1x40HC"));
  assert(db.requests[0].purpose_detail?.includes("Poids : 40000 kg"));
  assert(db.requests[0].purpose_detail?.includes("Free time destination : 30 jours"));
  assert(db.requests[0].purpose_detail?.includes("Package : EXPORT_SENEGAL"));
  assert(db.requests[0].purpose_detail?.includes("Service requis : SEA_FREIGHT"));
});

Deno.test("export SEA_FREIGHT orchestration is idempotent on rerun", async () => {
  const db = new FakeServiceClient(exportFacts());

  await ensureExportSeaFreightPartnerOrchestration({ case_id: "case-export", serviceClient: db });
  const second = await ensureExportSeaFreightPartnerOrchestration({ case_id: "case-export", serviceClient: db });

  assertEquals(second.gapMaintained, true);
  assertEquals(second.requestAlreadyExists, true);
  assertEquals(db.gaps.filter((g) => g.status === "open").length, 1);
  assertEquals(db.requests.length, 1);
});

Deno.test("export SEA_FREIGHT orchestration keeps gap but does not duplicate existing open freight_rate request", async () => {
  const db = new FakeServiceClient(exportFacts());
  db.requests.push({
    id: "req-existing",
    case_id: "case-export",
    partner_name: "Carrier",
    partner_email: null,
    purpose: "freight_rate",
    purpose_detail: null,
    status: "sent",
    related_lot_index: null,
  });

  const result = await ensureExportSeaFreightPartnerOrchestration({
    case_id: "case-export",
    serviceClient: db,
  });

  assertEquals(result.gapCreated, true);
  assertEquals(result.requestAlreadyExists, true);
  assertEquals(result.requestCreated, false);
  assertEquals(db.requests.length, 1);
});

Deno.test("export SEA_FREIGHT orchestration keeps blocking gap when freight response fact is only proposed", async () => {
  const db = new FakeServiceClient(exportFacts());
  db.requests.push(freightRequest("response_analyzed"));
  db.responseFacts.push(responseFact("proposed"));

  const result = await ensureExportSeaFreightPartnerOrchestration({
    case_id: "case-export",
    serviceClient: db,
  });

  assertEquals(result.coveredByPartnerFact, false);
  assertEquals(result.gapCreated, true);
  assertEquals(result.requestAlreadyExists, true);
  assertEquals(result.requestCreated, false);
  assertEquals(db.gaps.length, 1);
  assertEquals(db.gaps[0].gap_key, EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY);
  assertEquals(db.gaps[0].status, "open");
  assertEquals(db.requests.length, 1);
});

Deno.test("export SEA_FREIGHT orchestration keeps blocking gap when closed request has no validated freight fact", async () => {
  const db = new FakeServiceClient(exportFacts());
  db.requests.push(freightRequest("closed"));

  const result = await ensureExportSeaFreightPartnerOrchestration({
    case_id: "case-export",
    serviceClient: db,
  });

  assertEquals(result.coveredByPartnerFact, false);
  assertEquals(result.gapCreated, true);
  assertEquals(result.requestCreated, true);
  assertEquals(db.gaps.length, 1);
  assertEquals(db.gaps[0].status, "open");
  assertEquals(db.requests.length, 2);
});

Deno.test("export SEA_FREIGHT orchestration keeps blocking gap when facts_validated request has only non-freight fact", async () => {
  const db = new FakeServiceClient(exportFacts());
  db.requests.push(freightRequest("facts_validated"));
  db.responseFacts.push(responseFact("validated", "cargo.insurance_cost"));

  const result = await ensureExportSeaFreightPartnerOrchestration({
    case_id: "case-export",
    serviceClient: db,
  });

  assertEquals(result.coveredByPartnerFact, false);
  assertEquals(result.gapCreated, true);
  assertEquals(result.requestAlreadyExists, true);
  assertEquals(result.requestCreated, false);
  assertEquals(db.gaps.length, 1);
  assertEquals(db.gaps[0].status, "open");
  assertEquals(db.requests.length, 1);
});

Deno.test("export SEA_FREIGHT orchestration does not block when facts_validated request has validated freight fact", async () => {
  const db = new FakeServiceClient(exportFacts());
  db.requests.push(freightRequest("facts_validated"));
  db.responseFacts.push(responseFact("validated"));

  const result = await ensureExportSeaFreightPartnerOrchestration({
    case_id: "case-export",
    serviceClient: db,
  });

  assertEquals(result.coveredByPartnerFact, true);
  assertEquals(result.gapCreated, false);
  assertEquals(result.requestCreated, false);
  assertEquals(db.gaps.length, 0);
  assertEquals(db.requests.length, 1);
});

Deno.test("export SEA_FREIGHT orchestration keeps blocking gap when closed request has only rejected freight facts", async () => {
  const db = new FakeServiceClient(exportFacts());
  db.requests.push(freightRequest("closed"));
  db.responseFacts.push(responseFact("rejected"));

  const result = await ensureExportSeaFreightPartnerOrchestration({
    case_id: "case-export",
    serviceClient: db,
  });

  assertEquals(result.coveredByPartnerFact, false);
  assertEquals(result.gapCreated, true);
  assertEquals(result.requestCreated, true);
  assertEquals(db.gaps.length, 1);
  assertEquals(db.gaps[0].status, "open");
  assertEquals(db.requests.length, 2);
});

Deno.test("export SEA_FREIGHT orchestration leaves FCL facts unchanged", async () => {
  const db = new FakeServiceClient(exportFacts());
  const before = JSON.stringify(db.facts);

  await ensureExportSeaFreightPartnerOrchestration({
    case_id: "case-export",
    serviceClient: db,
  });

  assertEquals(JSON.stringify(db.facts), before);
});
