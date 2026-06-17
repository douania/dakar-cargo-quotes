import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  parseContainersFromText,
  pickInboundProvenanceEmailId,
  detectExplicitClientCurrencies,
  normalizeCurrencyCode,
  resolveClientCurrencyOverride,
  resolveThreadClientCurrency,
  applyClientValueCurrencyGuard,
} = await import("../build-case-puzzle/index.ts");

// =====================================================================
// THREAD-TEMPORAL-PROVENANCE-1 (generic, commodity-agnostic)
// A later inbound client email amends/replaces facts of an earlier one.
// =====================================================================

Deno.test("provenance: latest inbound by time wins, with NO is_quotation_request priority", () => {
  // Generic non-GWC thread (electronics): the older email carries the
  // quotation-request flag, a later email amends it. The later one must win.
  const emails = [
    { id: "e1", from_address: "buyer@acme-electronics.com", is_quotation_request: true, sent_at: "2026-01-01T08:00:00Z" },
    { id: "e2", from_address: "buyer@acme-electronics.com", is_quotation_request: false, sent_at: "2026-01-03T08:00:00Z" },
  ];
  // CTO rule: chronologically latest inbound > older quotation-request email.
  assertEquals(pickInboundProvenanceEmailId(emails), "e2");

  // Symmetric: newest email is also the quotation-request -> still the newest.
  const emails2 = [
    { id: "e1", from_address: "buyer@acme-electronics.com", is_quotation_request: false, sent_at: "2026-01-01T08:00:00Z" },
    { id: "e2", from_address: "buyer@acme-electronics.com", is_quotation_request: true, sent_at: "2026-01-03T08:00:00Z" },
  ];
  assertEquals(pickInboundProvenanceEmailId(emails2), "e2");

  // Out-of-order input array (not pre-sorted) is still resolved by sent_at.
  const emailsUnsorted = [
    { id: "newer", from_address: "buyer@acme-electronics.com", is_quotation_request: true, sent_at: "2026-01-05T08:00:00Z" },
    { id: "older", from_address: "buyer@acme-electronics.com", is_quotation_request: false, sent_at: "2026-01-02T08:00:00Z" },
  ];
  assertEquals(pickInboundProvenanceEmailId(emailsUnsorted), "newer");
});

Deno.test("provenance: outbound SODATRA emails are never chosen as the source", () => {
  // First email is SODATRA outbound; the only inbound is the client's reply.
  const emails = [
    { id: "s1", from_address: "ops@sodatra.sn", is_quotation_request: false, sent_at: "2026-02-01T08:00:00Z" },
    { id: "c1", from_address: "logistics@globalcorp.com", is_quotation_request: false, sent_at: "2026-02-02T08:00:00Z" },
  ];
  assertEquals(pickInboundProvenanceEmailId(emails), "c1");
});

Deno.test("provenance: no inbound email -> null (never falsely attribute to emails[0])", () => {
  const emails = [
    { id: "s1", from_address: "ops@sodatra.sn", is_quotation_request: false, sent_at: "2026-02-01T08:00:00Z" },
    { id: "s2", from_address: "billing@sodatra.com", is_quotation_request: false, sent_at: "2026-02-02T08:00:00Z" },
  ];
  assertEquals(pickInboundProvenanceEmailId(emails), null);
  assertEquals(pickInboundProvenanceEmailId([]), null);
});

// =====================================================================
// Container parsing: special equipment types (commodity-agnostic)
// =====================================================================

Deno.test("parseContainersFromText: special equipment FR / FLAT RACK / OT / RF", () => {
  assert(parseContainersFromText("transporting cargo in 40\u2019FR").some((c) => c.type === "40FR" && c.quantity === 1));
  for (const input of ["40'FR", "40 FR", "40ft FR", "40 flat rack", "40FR", "40flatrack"]) {
    assert(parseContainersFromText(input).some((c) => c.type === "40FR"), `${input}`);
  }
  assertEquals(parseContainersFromText("15 x 40'FR"), [{ type: "40FR", quantity: 15 }]);
  assertEquals(parseContainersFromText("2x20OT"), [{ type: "20OT", quantity: 2 }]);
  assertEquals(parseContainersFromText("1x40 reefer"), [{ type: "40RF", quantity: 1 }]);
  assertEquals(parseContainersFromText("1x20 open top"), [{ type: "20OT", quantity: 1 }]);
});

Deno.test("parseContainersFromText: never collapses a special type into 40GP", () => {
  assert(!parseContainersFromText("cargo in 40'FR").some((c) => c.type === "40GP"));
  assert(!parseContainersFromText("40 open top").some((c) => c.type === "40GP"));
});

Deno.test("parseContainersFromText: legacy FCL behavior preserved", () => {
  assertEquals(parseContainersFromText("1x20 + 1x40"), [
    { type: "20GP", quantity: 1 },
    { type: "40GP", quantity: 1 },
  ]);
  assertEquals(parseContainersFromText("40HC"), [{ type: "40HC", quantity: 1 }]);
  assertEquals(parseContainersFromText("40GP"), [{ type: "40GP", quantity: 1 }]);
  assertEquals(parseContainersFromText("20GP"), [{ type: "20GP", quantity: 1 }]);
  assertEquals(parseContainersFromText("2x40HC"), [{ type: "40HC", quantity: 2 }]);
  assertEquals(parseContainersFromText("3 x 20'"), [{ type: "20GP", quantity: 3 }]);
});

// =====================================================================
// Currency: explicit client currency vs stored currency (currency-agnostic)
// =====================================================================

Deno.test("detectExplicitClientCurrencies: recognises ISO codes and symbols", () => {
  assertEquals(detectExplicitClientCurrencies("Value 251,801.152 QAR"), ["QAR"]);
  assertEquals(detectExplicitClientCurrencies("Total 5,000 USD"), ["USD"]);
  assertEquals(detectExplicitClientCurrencies("Prix 12 000 \u20AC EXW"), ["EUR"]);
  assertEquals(detectExplicitClientCurrencies("Please quote, urgent."), []);
  // Ambiguous (two currencies) is reported as two - callers treat as no-op.
  assertEquals(detectExplicitClientCurrencies("Value 100 QAR or 30 EUR").sort(), ["EUR", "QAR"]);
});

Deno.test("normalizeCurrencyCode: codes and symbols normalise to ISO", () => {
  assertEquals(normalizeCurrencyCode("\u20AC"), "EUR");
  assertEquals(normalizeCurrencyCode("eur"), "EUR");
  assertEquals(normalizeCurrencyCode("QAR"), "QAR");
  assertEquals(normalizeCurrencyCode("ZZZ"), "ZZZ");
  assertEquals(normalizeCurrencyCode(""), null);
});

Deno.test("resolveClientCurrencyOverride: single client currency overrides a differing stored one", () => {
  // QAR client value vs stored EUR -> override to QAR (the value case).
  assertEquals(resolveClientCurrencyOverride("Value 251,801.152 QAR", "EUR"), "QAR");
  // Generic, not QAR-specific: USD client value vs stored XOF -> override to USD.
  assertEquals(resolveClientCurrencyOverride("Invoice total 9,000 USD", "XOF"), "USD");
  // Matching -> no override.
  assertEquals(resolveClientCurrencyOverride("Value 5,000 EUR", "EUR"), null);
  // Ambiguous client text -> no override.
  assertEquals(resolveClientCurrencyOverride("Value 100 QAR or 30 EUR", "EUR"), null);
  // No stored currency -> no override (never invent).
  assertEquals(resolveClientCurrencyOverride("Value 100 QAR", ""), null);
});

// --- Currency guard orchestrator (fake Supabase client) ---

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

  update(payload: Record<string, unknown>) {
    this.operation = "update";
    this.updatePayload = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    if (this.table !== "quote_gaps") throw new Error(`Unexpected insert into ${this.table}`);
    this.db.gaps.push({ id: `gap-${this.db.gaps.length + 1}`, status: "open", ...payload } as GapRow);
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
      for (const row of this.rows()) Object.assign(row as Record<string, unknown>, this.updatePayload);
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

function currencyFact(overrides: Partial<FactRow>): FactRow {
  return {
    id: `fact-${Math.random()}`,
    case_id: "case-1",
    fact_key: "cargo.value_currency",
    value_text: "EUR",
    value_number: null,
    value_json: null,
    source_type: "document_regex",
    source_excerpt: "currency_EUR",
    is_current: true,
    ...overrides,
  };
}

Deno.test("currency guard (generic): single client currency deactivates differing non-manual currency + gap", async () => {
  // USD client vs stored XOF - not QAR/EUR, proving the rule is currency-agnostic.
  const db = new FakeServiceClient([currencyFact({ value_text: "XOF", source_excerpt: "currency_XOF" })]);
  const r = await applyClientValueCurrencyGuard({ case_id: "case-1", serviceClient: db, latestInboundText: "Invoice total 9,000 USD CIF Dakar.", fullThreadText: "Invoice total 9,000 USD CIF Dakar." });
  assertEquals(r.factsDeactivated, 1);
  assertEquals(r.gapsIdentified, 1);
  assertEquals(db.facts[0].is_current, false);
  assertEquals(db.gaps[0].gap_key, "cargo.value_currency_conflict");
  assertEquals(db.gaps[0].is_blocking, true);
  assert(db.gaps[0].question_en.includes("USD"));
  assert(db.gaps[0].question_en.includes("XOF"));
});

Deno.test("currency guard: never deactivates operator/manual_input, but still raises gap", async () => {
  for (const src of ["operator", "manual_input"]) {
    const db = new FakeServiceClient([currencyFact({ source_type: src })]);
    const r = await applyClientValueCurrencyGuard({ case_id: "case-1", serviceClient: db, latestInboundText: "Value 251,801.152 QAR", fullThreadText: "Value 251,801.152 QAR" });
    assertEquals(r.factsDeactivated, 0, `source ${src} must stay current`);
    assertEquals(db.facts[0].is_current, true, `source ${src} must stay current`);
    assertEquals(r.gapsIdentified, 1);
  }
});

Deno.test("currency guard: no-op when stored currency already matches client", async () => {
  const db = new FakeServiceClient([currencyFact({ value_text: "QAR", source_excerpt: "currency_QAR" })]);
  const r = await applyClientValueCurrencyGuard({ case_id: "case-1", serviceClient: db, latestInboundText: "Value 251,801.152 QAR", fullThreadText: "Value 251,801.152 QAR" });
  assertEquals(r.factsDeactivated, 0);
  assertEquals(r.gapsIdentified, 0);
  assertEquals(db.facts[0].is_current, true);
});

Deno.test("currency guard: no-op when no stored currency (never invents)", async () => {
  const db = new FakeServiceClient([]);
  const r = await applyClientValueCurrencyGuard({ case_id: "case-1", serviceClient: db, latestInboundText: "Value 251,801.152 QAR", fullThreadText: "Value 251,801.152 QAR" });
  assertEquals(r.factsDeactivated, 0);
  assertEquals(r.gapsIdentified, 0);
});

Deno.test("currency guard: idempotent - second run creates no new gap, no new deactivation", async () => {
  const db = new FakeServiceClient([currencyFact({ source_type: "document_regex" })]);
  await applyClientValueCurrencyGuard({ case_id: "case-1", serviceClient: db, latestInboundText: "Value 251,801.152 QAR", fullThreadText: "Value 251,801.152 QAR" });
  const second = await applyClientValueCurrencyGuard({ case_id: "case-1", serviceClient: db, latestInboundText: "Value 251,801.152 QAR", fullThreadText: "Value 251,801.152 QAR" });
  assertEquals(second.factsDeactivated, 0);
  assertEquals(second.gapsIdentified, 0);
  assertEquals(db.gaps.length, 1);
});

Deno.test("resolveThreadClientCurrency: latest inbound primes; thread fallback only if single", () => {
  // Latest inbound states one currency -> it wins even if the thread is ambiguous.
  assertEquals(resolveThreadClientCurrency("Updated value 9,000 USD", "First 100 QAR. Updated 9,000 USD"), "USD");
  // Latest inbound ambiguous -> fall back to whole thread when it is single.
  assertEquals(resolveThreadClientCurrency("Please advise.", "Value 251,801.152 QAR"), "QAR");
  // Latest inbound ambiguous AND thread ambiguous -> no-op.
  assertEquals(resolveThreadClientCurrency("Please advise.", "100 QAR or 30 EUR"), null);
  // No currency anywhere -> no-op.
  assertEquals(resolveThreadClientCurrency("", ""), null);
});

Deno.test("currency guard: latest inbound currency wins over an ambiguous full thread", async () => {
  // Thread mentions both QAR and EUR, but the LATEST inbound says only USD.
  const db = new FakeServiceClient([currencyFact({ value_text: "QAR", source_excerpt: "currency_QAR" })]);
  const r = await applyClientValueCurrencyGuard({
    case_id: "case-1",
    serviceClient: db,
    latestInboundText: "Revised invoice total 9,000 USD.",
    fullThreadText: "First email 100 QAR. Reply 30 EUR. Revised invoice total 9,000 USD.",
  });
  assertEquals(r.clientCurrencies, ["USD"]);
  assertEquals(r.factsDeactivated, 1);
  assertEquals(r.gapsIdentified, 1);
  assert(db.gaps[0].question_en.includes("USD"));
});

Deno.test("currency guard: no-op when latest inbound and full thread are both ambiguous", async () => {
  const db = new FakeServiceClient([currencyFact({ value_text: "EUR" })]);
  const r = await applyClientValueCurrencyGuard({
    case_id: "case-1",
    serviceClient: db,
    latestInboundText: "Please advise.",
    fullThreadText: "Value 100 QAR or 30 USD.",
  });
  assertEquals(r.factsDeactivated, 0);
  assertEquals(r.gapsIdentified, 0);
  assertEquals(db.facts[0].is_current, true);
});

// =====================================================================
// GWC - single regression fixture only (the case that revealed the gaps)
// =====================================================================

Deno.test("GWC regression fixture: 40'FR parsed, QAR overrides stored EUR", () => {
  assert(parseContainersFromText("buses transported in 40'FR").some((c) => c.type === "40FR"));
  assertEquals(resolveClientCurrencyOverride("Value per bus: 251,801.152 QAR", "EUR"), "QAR");
});
