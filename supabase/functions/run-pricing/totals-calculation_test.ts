import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");

const { getOpenCommunicationLoopsGuard } = await import("./index.ts");

/**
 * PAD-TOTALS-1 Unit Tests
 * Tests the totals calculation logic for all 3 engine paths:
 * 1. Standard import (with dap/ddp from engine)
 * 2. Export guard (no dap/ddp, has honoraires + operationnel)
 * 3. Provisional DDP (no dap/ddp, has honoraires + operationnel + debours=0)
 */

// Extract the totals calculation logic (same as run-pricing L2480-2527)
function computeTotals(engineTotals: any, tariffLines: any[]) {
  const engineOperationnel = Number(engineTotals?.operationnel) || 0;
  const engineHonoraires   = Number(engineTotals?.honoraires) || 0;
  const engineDebours      = Number(engineTotals?.debours) || 0;
  const engineBorder       = Number(engineTotals?.border) || 0;
  const engineTerminal     = Number(engineTotals?.terminal) || 0;

  const rawDap = Number(engineTotals?.dap);
  const rawDdp = Number(engineTotals?.ddp);
  const hasRawDap = engineTotals?.dap !== undefined && engineTotals?.dap !== null && Number.isFinite(rawDap);
  const hasRawDdp = engineTotals?.ddp !== undefined && engineTotals?.ddp !== null && Number.isFinite(rawDdp);

  const engineDapComputed = hasRawDap
    ? rawDap
    : engineOperationnel + engineHonoraires + engineBorder + engineTerminal;

  const engineDdpComputed = hasRawDdp
    ? rawDdp
    : engineDapComputed + engineDebours;

  const enrichmentAmount = tariffLines
    .filter((l: any) => {
      const layer = l.canonical?.origin_layer;
      if (layer !== 'enrichment_pad' && layer !== 'enrichment_terminal_storage') return false;
      const sourceType = String(l?.source?.type || '').trim().split('+')[0].split(':')[0].toUpperCase();
      if (sourceType === 'TO_CONFIRM') return false;
      return (Number(l.amount) || 0) > 0;
    })
    .reduce((sum: number, l: any) => sum + (Number(l.amount) || 0), 0);

  const TVA_RATE = 0.18;
  const honoraires_ht = engineHonoraires;
  const honoraires_tva = Math.round(honoraires_ht * TVA_RATE);

  const totalHt  = engineDdpComputed + enrichmentAmount;
  const totalTtc = totalHt + honoraires_tva;

  return {
    totalHt, totalTtc, honoraires_ht, honoraires_tva,
    engineDapComputed, engineDdpComputed, enrichmentAmount,
    debours: engineDebours + enrichmentAmount,
    debours_engine: engineDebours,
    debours_enrichment: enrichmentAmount,
  };
}

// ── Test 1: Standard import with dap/ddp from engine ──
type GuardRow = Record<string, unknown>;

class GuardQueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private inFilters: Array<[string, unknown[]]> = [];

  constructor(private db: FakePricingGuardClient, private table: string) {}

  select(_columns?: string, _options?: Record<string, unknown>) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  in(column: string, values: string[]) {
    this.inFilters.push([column, values]);
    return this;
  }

  then(
    resolve: (value: { data: Array<Record<string, unknown>> | null; error: { message?: string } | null }) => void,
    reject: (reason?: unknown) => void,
  ) {
    Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }

  private rows(): GuardRow[] {
    let rows: GuardRow[] = [];
    if (this.table === "external_quote_requests") rows = this.db.partnerRequests;
    else if (this.table === "external_quote_response_facts") rows = this.db.partnerFacts;
    else if (this.table === "client_gap_requests") rows = this.db.clientGapRequests;
    else if (this.table === "quote_gaps") rows = this.db.quoteGaps;

    return rows.filter((row) => {
      for (const [column, value] of this.filters) {
        if (row[column] !== value) return false;
      }
      for (const [column, values] of this.inFilters) {
        if (!values.includes(row[column])) return false;
      }
      return true;
    });
  }
}

class FakePricingGuardClient {
  partnerRequests: GuardRow[] = [];
  partnerFacts: GuardRow[] = [];
  clientGapRequests: GuardRow[] = [];
  quoteGaps: GuardRow[] = [];

  from(table: string) {
    return new GuardQueryBuilder(this, table);
  }
}

function guardClient() {
  return new FakePricingGuardClient();
}

Deno.test("open communication guard blocks draft partner requests", async () => {
  const db = guardClient();
  db.partnerRequests.push({ id: "req-draft", case_id: "case-1", status: "draft" });

  const guard = await getOpenCommunicationLoopsGuard(db, "case-1");

  assertEquals(guard.blocked, true);
  assertEquals(guard.open_partner_requests_count, 1);
  assertEquals(guard.pending_partner_facts_count, 0);
  assertEquals(guard.open_client_gap_requests_count, 0);
});

Deno.test("open communication guard blocks sent partner requests", async () => {
  const db = guardClient();
  db.partnerRequests.push({ id: "req-sent", case_id: "case-1", status: "sent" });

  const guard = await getOpenCommunicationLoopsGuard(db, "case-1");

  assertEquals(guard.blocked, true);
  assertEquals(guard.open_partner_requests_count, 1);
});

Deno.test("open communication guard blocks proposed partner facts", async () => {
  const db = guardClient();
  db.partnerFacts.push({ id: "fact-proposed", case_id: "case-1", validation_status: "proposed" });

  const guard = await getOpenCommunicationLoopsGuard(db, "case-1");

  assertEquals(guard.blocked, true);
  assertEquals(guard.pending_partner_facts_count, 1);
});

Deno.test("open communication guard allows terminal partner requests without proposed facts", async () => {
  const db = guardClient();
  db.partnerRequests.push(
    { id: "req-validated", case_id: "case-1", status: "facts_validated" },
    { id: "req-closed", case_id: "case-1", status: "closed" },
  );
  db.partnerFacts.push({ id: "fact-valid", case_id: "case-1", validation_status: "validated" });

  const guard = await getOpenCommunicationLoopsGuard(db, "case-1");

  assertEquals(guard.blocked, false);
  assertEquals(guard.open_partner_requests_count, 0);
  assertEquals(guard.pending_partner_facts_count, 0);
});

Deno.test("open communication guard blocks active client requests linked to open gaps", async () => {
  const db = guardClient();
  db.clientGapRequests.push({ id: "client-req", case_id: "case-1", status: "sent", gap_key: "cargo.value" });
  db.quoteGaps.push({ id: "gap-open", case_id: "case-1", status: "open", gap_key: "cargo.value" });

  const guard = await getOpenCommunicationLoopsGuard(db, "case-1");

  assertEquals(guard.blocked, true);
  assertEquals(guard.open_client_gap_requests_count, 1);
});

Deno.test("open communication guard ignores old client requests whose gap is resolved", async () => {
  const db = guardClient();
  db.clientGapRequests.push({ id: "client-req", case_id: "case-1", status: "sent", gap_key: "cargo.value" });
  db.quoteGaps.push({ id: "gap-resolved", case_id: "case-1", status: "resolved", gap_key: "cargo.value" });

  const guard = await getOpenCommunicationLoopsGuard(db, "case-1");

  assertEquals(guard.blocked, false);
  assertEquals(guard.open_client_gap_requests_count, 0);
});

Deno.test("Standard import: uses engine dap/ddp, includes enrichments", () => {
  const engineTotals = {
    honoraires: 1260000,
    operationnel: 2265000,
    debours: 0,
    border: 0,
    terminal: 0,
    dap: 3525000,
    ddp: 3525000,
  };
  const tariffLines = [
    { amount: 4015200, canonical: { origin_layer: 'enrichment_pad' }, source: { type: 'OFFICIAL' } },
    { amount: 2227680, canonical: { origin_layer: 'enrichment_terminal_storage' }, source: { type: 'OFFICIAL' } },
  ];

  const result = computeTotals(engineTotals, tariffLines);

  assertEquals(result.totalHt, 3525000 + 4015200 + 2227680); // 9,767,880
  assertEquals(result.totalHt, 9767880);
  assertEquals(result.honoraires_tva, Math.round(1260000 * 0.18)); // 226,800
  assertEquals(result.totalTtc, 9767880 + 226800); // 9,994,680
  assertEquals(result.debours, 0 + 4015200 + 2227680);
  console.log("✅ Standard import: total_ht =", result.totalHt);
});

// ── Test 2: Export guard INITIAL (L1715) — no dap/ddp, honoraires=0, debours=0 ──
Deno.test("Export guard initial: reconstructs from zero — total_ht = 0 (correct for empty lines)", () => {
  const engineTotals = { honoraires: 0, debours: 0 };
  const tariffLines: any[] = [];

  const result = computeTotals(engineTotals, tariffLines);

  // With no lines and no engine values, total should be 0 — this is correct for initial export guard
  assertEquals(result.totalHt, 0);
  assertEquals(result.totalTtc, 0);
  assertEquals(result.engineDapComputed, 0);
  assertEquals(result.engineDdpComputed, 0);
  console.log("✅ Export guard initial (empty): total_ht =", result.totalHt, "(expected 0)");
});

// ── Test 3: Export guard AFTER enrichment (L1793) — no dap/ddp, has honoraires + operationnel ──
Deno.test("Export guard enriched: reconstructs dap/ddp from blocs", () => {
  const engineTotals = {
    honoraires: 175000,
    debours: 0,
    operationnel: 85000,
  };
  const tariffLines: any[] = [];

  const result = computeTotals(engineTotals, tariffLines);

  // No dap/ddp → reconstruct: dap = operationnel + honoraires = 260000, ddp = dap + 0 = 260000
  assertEquals(result.engineDapComputed, 260000);
  assertEquals(result.engineDdpComputed, 260000);
  assertEquals(result.totalHt, 260000);
  assert(result.totalHt > 0, "Export guard must NOT produce total_ht = 0");
  assertEquals(result.honoraires_tva, Math.round(175000 * 0.18));
  assertEquals(result.totalTtc, 260000 + result.honoraires_tva);
  console.log("✅ Export guard enriched: total_ht =", result.totalHt);
});

// ── Test 4: Provisional DDP (L1708) — no dap/ddp, has honoraires + operationnel + debours=0 ──
Deno.test("Provisional DDP: reconstructs dap/ddp from blocs", () => {
  const engineTotals = {
    honoraires: 500000,
    debours: 0,
    operationnel: 300000,
  };
  const tariffLines: any[] = [];

  const result = computeTotals(engineTotals, tariffLines);

  assertEquals(result.engineDapComputed, 800000);
  assertEquals(result.engineDdpComputed, 800000);
  assertEquals(result.totalHt, 800000);
  assert(result.totalHt > 0, "Provisional DDP must NOT produce total_ht = 0");
  console.log("✅ Provisional DDP: total_ht =", result.totalHt);
});

// ── Test 5: TO_CONFIRM lines excluded ──
Deno.test("TO_CONFIRM enrichment lines are excluded from totals", () => {
  const engineTotals = { honoraires: 100000, debours: 0, dap: 100000, ddp: 100000 };
  const tariffLines = [
    { amount: 50000, canonical: { origin_layer: 'enrichment_pad' }, source: { type: 'TO_CONFIRM' } },
    { amount: 30000, canonical: { origin_layer: 'enrichment_pad' }, source: { type: 'OFFICIAL' } },
    { amount: 20000, canonical: { origin_layer: 'enrichment_terminal_storage' }, source: { type: 'to_confirm+note' } },
  ];

  const result = computeTotals(engineTotals, tariffLines);

  assertEquals(result.enrichmentAmount, 30000); // Only OFFICIAL line
  assertEquals(result.totalHt, 100000 + 30000);
  console.log("✅ TO_CONFIRM exclusion: enrichment =", result.enrichmentAmount);
});

// ── Test 6: Provisional DDP with debours > 0 ──
Deno.test("Provisional DDP with nonzero debours reconstructs correctly", () => {
  const engineTotals = {
    honoraires: 400000,
    debours: 200000,
    operationnel: 300000,
  };
  const tariffLines: any[] = [];

  const result = computeTotals(engineTotals, tariffLines);

  assertEquals(result.engineDapComputed, 700000); // oper + honor
  assertEquals(result.engineDdpComputed, 900000); // dap + debours
  assertEquals(result.totalHt, 900000);
  assertEquals(result.debours_engine, 200000);
  console.log("✅ Provisional DDP with debours: total_ht =", result.totalHt);
});

// ── Test 7: Engine dap/ddp = 0 (legitimate zero, not missing) ──
Deno.test("Engine dap/ddp = 0 is treated as present (not reconstructed)", () => {
  const engineTotals = {
    honoraires: 100000,
    debours: 0,
    operationnel: 50000,
    dap: 0,
    ddp: 0,
  };
  const tariffLines: any[] = [];

  const result = computeTotals(engineTotals, tariffLines);

  // dap=0 is finite → hasRawDap=true → use 0, NOT reconstruct
  assertEquals(result.engineDapComputed, 0);
  assertEquals(result.engineDdpComputed, 0);
  assertEquals(result.totalHt, 0);
  console.log("✅ Engine dap=0: treated as present, total_ht = 0");
});

// ── Test 8: Legacy debours field preserved ──
Deno.test("Legacy debours field = debours_engine + enrichment", () => {
  const engineTotals = { honoraires: 100000, debours: 50000, dap: 200000, ddp: 250000 };
  const tariffLines = [
    { amount: 30000, canonical: { origin_layer: 'enrichment_pad' }, source: { type: 'OFFICIAL' } },
  ];

  const result = computeTotals(engineTotals, tariffLines);

  assertEquals(result.debours, 80000); // 50000 + 30000
  assertEquals(result.debours_engine, 50000);
  assertEquals(result.debours_enrichment, 30000);
  console.log("✅ Legacy debours =", result.debours);
});
