import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");
Deno.env.delete("LOVABLE_API_KEY");

const {
  extractHsCodesFromTextDetailed,
  guardAiCargoHsCodeFact,
} = await import("../build-case-puzzle/index.ts");

type HsRow = {
  code_normalized: string;
  description: string | null;
  dd: number | null;
  tva: number | null;
};

type GapRow = {
  id: string;
  case_id: string;
  gap_key: string;
  status: string;
  is_blocking: boolean;
};

type EventRow = {
  id: string;
  case_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
};

class QueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private inFilter: [string, unknown[]] | null = null;
  private likeFilter: [string, string] | null = null;
  private limitCount: number | null = null;

  constructor(private db: FakeHsServiceClient, private table: string) {}

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

  like(key: string, pattern: string) {
    this.likeFilter = [key, pattern];
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    if (this.table === "case_timeline_events") {
      this.db.events.push({
        id: `event-${this.db.events.length + 1}`,
        ...payload,
      } as EventRow);
      return Promise.resolve({ data: null, error: null });
    }
    if (this.table === "quote_gaps") {
      this.db.gaps.push({
        id: `gap-${this.db.gaps.length + 1}`,
        status: "open",
        ...payload,
      } as GapRow);
      return Promise.resolve({ data: null, error: null });
    }
    throw new Error(`Unexpected insert into ${this.table}`);
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  then(
    resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => void,
    reject: (reason?: unknown) => void,
  ) {
    Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }

  private rows(): Array<Record<string, unknown>> {
    let rows: Array<Record<string, unknown>>;
    if (this.table === "hs_codes") rows = this.db.hsRows as unknown as Array<Record<string, unknown>>;
    else if (this.table === "case_timeline_events") rows = this.db.events as unknown as Array<Record<string, unknown>>;
    else if (this.table === "quote_gaps") rows = this.db.gaps as unknown as Array<Record<string, unknown>>;
    else rows = [];

    rows = rows.filter((row) => {
      for (const [key, value] of this.filters) {
        if (readFilterValue(row, key) !== value) return false;
      }
      if (this.inFilter) {
        const [key, values] = this.inFilter;
        if (!values.includes(readFilterValue(row, key))) return false;
      }
      if (this.likeFilter) {
        const [key, pattern] = this.likeFilter;
        const prefix = pattern.endsWith("%") ? pattern.slice(0, -1) : pattern;
        if (!String(readFilterValue(row, key) ?? "").startsWith(prefix)) return false;
      }
      return true;
    });

    if (this.limitCount != null) rows = rows.slice(0, this.limitCount);
    return rows;
  }
}

class FakeHsServiceClient {
  gaps: GapRow[] = [];
  events: EventRow[] = [];

  constructor(public hsRows: HsRow[]) {}

  from(table: string) {
    return new QueryBuilder(this, table);
  }
}

function readFilterValue(row: Record<string, unknown>, key: string): unknown {
  if (key.startsWith("event_data->>")) {
    const eventKey = key.slice("event_data->>".length);
    return (row.event_data as Record<string, unknown> | undefined)?.[eventKey];
  }
  return row[key];
}

function hsRows(): HsRow[] {
  return [
    { code_normalized: "8425110000", description: "Rollers", dd: 5, tva: 18 },
    { code_normalized: "8431100000", description: "Head board", dd: 5, tva: 18 },
  ];
}

Deno.test("multi-HS label line extracts every HS8 token with hs_label context", () => {
  const matches = extractHsCodesFromTextDetailed([
    "HS Code: 84251100 & 84311000",
    "Material Description: Rollers & Head Board",
  ].join("\n"));

  const hsLabelMatches = matches.filter((m) => m.context === "hs_label");
  assertEquals(hsLabelMatches.map((m) => m.digits), ["84251100", "84311000"]);
  assertEquals(hsLabelMatches.map((m) => m.sourceLen), [8, 8]);
  assertEquals(hsLabelMatches.every((m) => m.excerpt?.includes("HS Code: 84251100 & 84311000")), true);

  assertEquals(
    extractHsCodesFromTextDetailed("HS Codes: 84251100, 84311000")
      .filter((m) => m.context === "hs_label")
      .map((m) => m.digits),
    ["84251100", "84311000"],
  );
  assertEquals(
    extractHsCodesFromTextDetailed("SH: 84251100 / 84311000")
      .filter((m) => m.context === "hs_label")
      .map((m) => m.digits),
    ["84251100", "84311000"],
  );
});

Deno.test("AI cargo.hs_code combined value is routed to suggestions and gap without auto-write", async () => {
  const db = new FakeHsServiceClient(hsRows());

  const result = await guardAiCargoHsCodeFact(db, {
    case_id: "case-1",
    rawHs: "84251100 & 84311000",
    cargoDescription: "Rollers & Head Board",
    sourceExcerpt: "HS Code: 84251100 & 84311000",
  });

  assertEquals(result.shouldWrite, false);
  assertEquals(result.routedSourceDigits, ["84251100", "84311000"]);
  assertEquals(db.events.map((e) => e.event_data.source_digits), ["84251100", "84311000"]);
  assertEquals(db.events.map((e) => e.event_data.source_context), ["hs_label", "hs_label"]);
  assertEquals(db.gaps.length, 1);
  assertEquals(db.gaps[0].gap_key, "cargo.hs_code");

  await guardAiCargoHsCodeFact(db, {
    case_id: "case-1",
    rawHs: "84251100 & 84311000",
    cargoDescription: "Rollers & Head Board",
    sourceExcerpt: "HS Code: 84251100 & 84311000",
  });
  assertEquals(db.events.length, 2);
  assertEquals(db.gaps.length, 1);
});

Deno.test("AI cargo.hs_code unique HS10 keeps existing write path", async () => {
  const db = new FakeHsServiceClient(hsRows());

  const result = await guardAiCargoHsCodeFact(db, {
    case_id: "case-1",
    rawHs: "8425110000",
  });

  assertEquals(result.shouldWrite, true);
  if (result.shouldWrite) {
    assertEquals(result.code10, "8425110000");
    assertEquals(result.confidence, 1);
  }
  assertEquals(db.events.length, 0);
  assertEquals(db.gaps.length, 0);
});

Deno.test("AI cargo.hs_code unique HS8 remains suggestion-only", async () => {
  const db = new FakeHsServiceClient(hsRows());

  const result = await guardAiCargoHsCodeFact(db, {
    case_id: "case-1",
    rawHs: "84251100",
    sourceExcerpt: "HS Code: 84251100",
  });

  assertEquals(result.shouldWrite, false);
  assertEquals(result.routedSourceDigits, ["84251100"]);
  assertEquals(db.events.map((e) => e.event_data.source_digits), ["84251100"]);
  assertEquals(db.gaps.length, 1);
  assertEquals(db.gaps[0].gap_key, "cargo.hs_code");
});
