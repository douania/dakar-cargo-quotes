import { assert, assertEquals, assertStrictEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { computeCommercialTotals } from "./commercial-totals.ts";
import {
  readOverridesFromFacts,
  resolveExplicitlyRemovedServiceKeys,
} from "../_shared/service-scope.ts";
import { withLocalTransportDebours } from "../_shared/local-transport-debours.ts";

/**
 * SCOPE-REMOVE — direct tests for `applyExplicitServiceRemovals`.
 *
 * Incident pinned here: `service.overrides.remove` listed TRUCKING and
 * CUSTOMS_DAKAR (among others) but the engine structural lines still carried
 * them, with their amounts, after run-pricing. The helper must drop exactly
 * those lines AND subtract their amounts from the raw engine totals, while:
 * - never touching a `canonical.service_key === null` line (Droits & Taxes,
 *   Port (PAD), Magasinage… — mandatory/débours charges are not a decision
 *   this layer may take);
 * - never touching a non-`engine_structural` line;
 * - honouring the add-wins doctrine through the shared
 *   `resolveExplicitlyRemovedServiceKeys` helper;
 * - staying idempotent and safe on old/malformed totals shapes.
 */

type EngineLine = {
  [key: string]: unknown;
  id?: string;
  bloc?: string;
  category?: string;
  description?: string;
  amount?: number | null;
  currency?: string;
  source?: { type?: string; reference?: string; confidence?: number };
  canonical?: {
    service_key?: string | null;
    dedup_group?: string | null;
    origin_layer?: string;
  } | null;
};

// The Edge Function is imported for its pure helpers only — no HTTP listener wanted.
Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");
const { applyExplicitServiceRemovals, canonicalizeLine, SCOPE_REMOVE_TOTALS_INCOHERENT } = await import("./index.ts") as unknown as {
  SCOPE_REMOVE_TOTALS_INCOHERENT: string;
  applyExplicitServiceRemovals: (
    lines: EngineLine[],
    engineTotals: unknown,
    removedKeys: Set<string>,
  ) => { keptLines: EngineLine[]; removedLines: EngineLine[]; adjustedTotals: unknown };
  canonicalizeLine: (
    line: EngineLine,
    context: { origin_layer: "engine_structural" },
  ) => EngineLine;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a plain totals record");
  }
  return value as Record<string, unknown>;
}

const INCIDENT_FACTS = [{
  fact_key: "service.overrides",
  value_json: { add: [], remove: ["PORT_DAKAR_HANDLING", "TRUCKING", "EMPTY_RETURN", "CUSTOMS_DAKAR"] },
}];

function incidentRemovedKeys(): Set<string> {
  return resolveExplicitlyRemovedServiceKeys(readOverridesFromFacts(INCIDENT_FACTS));
}

/** Engine-shaped raw lines (same shapes as quotation-engine emits). */
function rawIncidentLines(): EngineLine[] {
  return [
    withLocalTransportDebours({
      id: "transport_20dv_0",
      bloc: "operationnel",
      category: "Transport",
      description: "Transport 20DV → Dakar ville",
      amount: 250000,
      currency: "FCFA",
      source: { type: "OFFICIAL", reference: "Grille transport local validée", confidence: 0.95 },
    }),
    {
      id: "customs_fee",
      bloc: "honoraires",
      category: "Dédouanement",
      description: "Honoraires de dédouanement",
      amount: 75000,
      currency: "FCFA",
      source: { type: "CALCULATED", reference: "sodatra_fee_rules", confidence: 0.9 },
    },
    {
      // Real engine shape: THC lines sit in bloc 'operationnel' (not 'terminal')
      // and 155 000 FCFA is the standard 20P/20DV grid amount.
      id: "dthc",
      bloc: "operationnel",
      category: "Terminal (DPW)",
      description: "THC IMPORT 20DV",
      amount: 155000,
      currency: "FCFA",
      source: { type: "OFFICIAL", reference: "DPW_TARIFS_2025_0001.pdf", confidence: 0.95 },
    },
    {
      id: "port_pad",
      bloc: "operationnel",
      category: "Port (PAD)",
      description: "Redevance portuaire marchandise",
      amount: 90000,
      currency: "FCFA",
      source: { type: "OFFICIAL", reference: "PAD Tarifs", confidence: 0.9 },
    },
    {
      id: "duties_total",
      bloc: "debours",
      category: "Droits & Taxes",
      description: "Droits et taxes (1 article: 8429.11)",
      amount: 500000,
      currency: "FCFA",
      source: { type: "CALCULATED", reference: "TEC UEMOA — 1 code(s) HS traité(s)", confidence: 0.95 },
    },
  ];
}

/** Mirror of the engine's own totals arithmetic for the fixture above. */
function modernTotals(): Record<string, number> {
  return {
    // DTHC (155 000) + Port (PAD) (90 000); the Transport line sits in the LT bucket
    operationnel: 245000,
    honoraires: 75000,
    debours: 500000,
    border: 0,
    terminal: 0,
    local_transport_debours_ttc: 250000,
    dap: 570000,
    ddp: 1070000,
  };
}

function canonicalized(): EngineLine[] {
  return rawIncidentLines().map((l) => canonicalizeLine(l, { origin_layer: "engine_structural" }));
}

// ─── 1. Incident scenario, end-to-end through the REAL canonicalization ─────

Deno.test("SCOPE-REMOVE: incident — TRUCKING & CUSTOMS_DAKAR leave lines AND totals, DTHC intact", () => {
  const lines = canonicalized();
  // Real mapping proof (canonicalizeLine, not hand-stamped blocks).
  assertEquals(
    lines.map((l) => l.canonical?.service_key ?? null),
    ["TRUCKING", "CUSTOMS_DAKAR", "DTHC", null, null],
  );

  const res = applyExplicitServiceRemovals(lines, modernTotals(), incidentRemovedKeys());

  assertEquals(res.removedLines.map((l) => l.canonical?.service_key), ["TRUCKING", "CUSTOMS_DAKAR"]);
  assertEquals(res.keptLines.map((l) => l.id), ["dthc", "port_pad", "duties_total"]);

  const dthc = res.keptLines[0];
  assertEquals(dthc.amount, 155000);
  assertEquals(dthc.source?.reference, "DPW_TARIFS_2025_0001.pdf");

  const totals = asRecord(res.adjustedTotals);
  assertEquals(totals.operationnel, 245000);
  assertEquals(totals.honoraires, 0);
  assertEquals(totals.local_transport_debours_ttc, 0);
  assertEquals(totals.terminal, 0);
  assertEquals(totals.debours, 500000);
  assertEquals(totals.border, 0);
  assertEquals(totals.dap, 245000);
  assertEquals(totals.ddp, 745000);
  for (const [key, value] of Object.entries(totals)) {
    assert(typeof value === "number" && value >= 0, `unexpected total ${key}=${value}`);
  }

  // Commercial totals follow with no double counting: VAT on ADJUSTED honoraires.
  const commercial = computeCommercialTotals({ engineTotals: totals, lines: res.keptLines });
  assertEquals(commercial.honorairesHt, 0);
  assertEquals(commercial.honorairesTva, 0);
  assertEquals(commercial.dap, 245000);
  assertEquals(commercial.ddp, 745000);
  assertEquals(commercial.totalPayable, 745000);
  assertEquals(commercial.deboursDouaniers, 500000);

  // Control: before removal the same pipeline owed 1 083 500 payable.
  const before = computeCommercialTotals({ engineTotals: modernTotals(), lines });
  assertEquals(before.totalPayable, 1083500);
});

// ─── 2. Frontière Mali ↔ BORDER_FEES; Terminal Mali stays null ──────────────

Deno.test("SCOPE-REMOVE: Frontière Mali maps to BORDER_FEES and is removable; Terminal Mali stays null", () => {
  const border = canonicalizeLine({
    id: "border_esc_0",
    bloc: "border",
    category: "Frontière Mali",
    description: "Escorte douanière",
    amount: 120000,
    currency: "XOF",
    source: { type: "OFFICIAL", reference: "Border Clearing Rates", confidence: 0.9 },
  }, { origin_layer: "engine_structural" });
  assertEquals(border.canonical?.service_key, "BORDER_FEES");

  const terminalMali = canonicalizeLine({
    id: "terminal_kati_0",
    bloc: "terminal",
    category: "Terminal Mali",
    description: "Manutention Kati",
    amount: 80000,
    currency: "XOF",
    source: { type: "OFFICIAL", reference: "Destination Terminal Rates", confidence: 0.85 },
  }, { origin_layer: "engine_structural" });
  assertEquals(terminalMali.canonical?.service_key ?? null, null);

  const removed = resolveExplicitlyRemovedServiceKeys(readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: [], remove: ["BORDER_FEES"] } },
  ]));
  const res = applyExplicitServiceRemovals([border, terminalMali], {
    operationnel: 0,
    honoraires: 0,
    debours: 0,
    border: 120000,
    terminal: 80000,
    local_transport_debours_ttc: 0,
    dap: 200000,
    ddp: 200000,
  }, removed);

  assertEquals(res.removedLines.map((l) => l.id), ["border_esc_0"]);
  assertEquals(res.keptLines.map((l) => l.id), ["terminal_kati_0"]);
  const totals = asRecord(res.adjustedTotals);
  assertEquals(totals.border, 0);
  assertEquals(totals.terminal, 80000);
  assertEquals(totals.dap, 80000);
  assertEquals(totals.ddp, 80000);
});

// ─── 3. Add wins through the shared helper ──────────────────────────────────

Deno.test("SCOPE-REMOVE: add wins — a re-added service keeps its structural line and amounts", () => {
  const lines = canonicalized();
  const removed = resolveExplicitlyRemovedServiceKeys(readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: ["TRUCKING"], remove: ["TRUCKING", "CUSTOMS_DAKAR"] } },
  ]));
  const res = applyExplicitServiceRemovals(lines, modernTotals(), removed);

  assertEquals(res.removedLines.map((l) => l.canonical?.service_key), ["CUSTOMS_DAKAR"]);
  assert(res.keptLines.some((l) => l.canonical?.service_key === "TRUCKING"));
  const totals = asRecord(res.adjustedTotals);
  assertEquals(totals.local_transport_debours_ttc, 250000);
  assertEquals(totals.honoraires, 0);
  assertEquals(totals.dap, 495000);
  assertEquals(totals.ddp, 995000);
});

// ─── 4. Null service_key is untouchable, even under a maximal removal set ───

Deno.test("SCOPE-REMOVE: canonical.service_key null is NEVER dropped, mandatory-fee labels included", () => {
  const nullKeyLines = canonicalized().filter((l) => (l.canonical?.service_key ?? null) === null);
  assertEquals(nullKeyLines.map((l) => l.category), ["Port (PAD)", "Droits & Taxes"]);

  const removed = new Set([
    "PORT_DAKAR_HANDLING", "TRUCKING", "EMPTY_RETURN", "CUSTOMS_DAKAR", "DTHC", "AGENCY", "BORDER_FEES",
  ]);
  const res = applyExplicitServiceRemovals(nullKeyLines, { operationnel: 90000, debours: 500000 }, removed);
  assertEquals(res.removedLines.length, 0);
  assertEquals(res.keptLines.length, 2);
  assertEquals(asRecord(res.adjustedTotals).operationnel, 90000);
});

// ─── 5. Only engine_structural lines are candidates ─────────────────────────

Deno.test("SCOPE-REMOVE: non-engine_structural lines are kept even when their key is removed", () => {
  const enrichment: EngineLine = {
    id: "psl_trucking",
    bloc: "operationnel",
    category: "TRUCKING",
    amount: 60000,
    canonical: { service_key: "TRUCKING", dedup_group: "TRUCKING", origin_layer: "package_enrichment" },
  };
  const manual: EngineLine = {
    id: "manual_trucking",
    amount: 10000,
    canonical: { service_key: "TRUCKING", dedup_group: "TRUCKING", origin_layer: "manual_override" },
  };
  const res = applyExplicitServiceRemovals([enrichment, manual], { operationnel: 0 }, new Set(["TRUCKING"]));
  assertEquals(res.removedLines.length, 0);
  assertEquals(res.keptLines.map((l) => l.id), ["psl_trucking", "manual_trucking"]);
});

// ─── 6. Matching is on service_key, never dedup_group ───────────────────────

Deno.test("SCOPE-REMOVE: dedup_group is never used for matching (DTHC vs TERMINAL_HANDLING)", () => {
  const dthc = canonicalizeLine({
    bloc: "operationnel",
    category: "Terminal (DPW)",
    description: "THC IMPORT 20DV",
    amount: 155000,
    source: { type: "OFFICIAL", reference: "DPW_TARIFS_2025_0001.pdf", confidence: 0.95 },
  }, { origin_layer: "engine_structural" });
  assertEquals(dthc.canonical?.dedup_group, "TERMINAL_HANDLING");

  const res = applyExplicitServiceRemovals([dthc], { operationnel: 155000 }, new Set(["TERMINAL_HANDLING"]));
  assertEquals(res.removedLines.length, 0);
  assertEquals(res.keptLines[0].amount, 155000);
});

// ─── 7. Null / non-finite amounts ───────────────────────────────────────────

Deno.test("SCOPE-REMOVE: null and non-finite amounts drop the line but never corrupt totals", () => {
  const toConfirm = canonicalizeLine({
    id: "t1",
    bloc: "operationnel",
    category: "Transport",
    description: "Transport 40DC → destination inconnue",
    amount: null,
    source: { type: "TO_CONFIRM", reference: "no exact rate", confidence: 0 },
  }, { origin_layer: "engine_structural" });
  const weird: EngineLine = {
    id: "t2",
    bloc: "operationnel",
    amount: Number.POSITIVE_INFINITY,
    canonical: { service_key: "TRUCKING", dedup_group: "TRUCKING", origin_layer: "engine_structural" },
  };
  const totalsBefore = {
    operationnel: 40000,
    honoraires: 10000,
    debours: 0,
    border: 0,
    terminal: 0,
    local_transport_debours_ttc: 0,
    dap: 50000,
    ddp: 50000,
  };
  const res = applyExplicitServiceRemovals([toConfirm, weird], totalsBefore, new Set(["TRUCKING"]));
  assertEquals(res.removedLines.map((l) => l.id), ["t1", "t2"]);
  assertEquals(asRecord(res.adjustedTotals), { ...totalsBefore });

  // Non-firm amounts require no bucket at all: null totals stay a pass-through.
  const resNull = applyExplicitServiceRemovals([toConfirm, weird], null, new Set(["TRUCKING"]));
  assertEquals(resNull.removedLines.length, 2);
  assertStrictEquals(resNull.adjustedTotals, null);
});

// ─── 8. Old totals shape (no local_transport_debours_ttc, no dap/ddp) ───────

Deno.test("SCOPE-REMOVE: old engine totals — LT débours subtracted from its bloc, no key invented", () => {
  const lt = canonicalizeLine(withLocalTransportDebours({
    id: "t_lt",
    bloc: "operationnel",
    category: "Transport",
    description: "Transport 20DV → Dakar",
    amount: 250000,
    currency: "FCFA",
    source: { type: "OFFICIAL", reference: "Grille transport local validée", confidence: 0.95 },
  }), { origin_layer: "engine_structural" });
  const oldTotals = { operationnel: 300000, honoraires: 50000, debours: 0, border: 0, terminal: 0 };

  const res = applyExplicitServiceRemovals([lt], oldTotals, new Set(["TRUCKING"]));
  const totals = asRecord(res.adjustedTotals);
  assertEquals(totals.operationnel, 50000);
  assertEquals(totals.honoraires, 50000);
  assert(!("local_transport_debours_ttc" in totals));
  assert(!("dap" in totals));
  assert(!("ddp" in totals));

  // Same legacy shape but WITHOUT the legacy bloc to adjust: fail-closed.
  assertThrows(
    () => applyExplicitServiceRemovals([lt], { honoraires: 50000 }, new Set(["TRUCKING"])),
    Error,
    SCOPE_REMOVE_TOTALS_INCOHERENT,
  );
});

// ─── 9. Idempotence ─────────────────────────────────────────────────────────

Deno.test("SCOPE-REMOVE: idempotent — a second application removes nothing and subtracts 0", () => {
  const removed = incidentRemovedKeys();
  const first = applyExplicitServiceRemovals(canonicalized(), modernTotals(), removed);
  const second = applyExplicitServiceRemovals(first.keptLines, first.adjustedTotals, removed);
  assertEquals(second.removedLines.length, 0);
  assertEquals(second.keptLines, first.keptLines);
  assertEquals(second.adjustedTotals, first.adjustedTotals);
});

// ─── 10. Strict pass-throughs ───────────────────────────────────────────────

Deno.test("SCOPE-REMOVE: empty removal set passes through; incoherent totals throw", () => {
  const lines = canonicalized();
  const noop = applyExplicitServiceRemovals(lines, modernTotals(), new Set());
  assertStrictEquals(noop.keptLines, lines);
  assertEquals(noop.removedLines.length, 0);

  // Firm removed lines with null totals: no coherent adjustment possible → throw.
  assertThrows(
    () => applyExplicitServiceRemovals(lines, null, incidentRemovedKeys()),
    Error,
    SCOPE_REMOVE_TOTALS_INCOHERENT,
  );

  // Firm non-LT line with an unknown bloc: no adjustable bucket → throw.
  const unknownBloc: EngineLine = {
    id: "u1",
    bloc: "mystere",
    amount: 1000,
    canonical: { service_key: "TRUCKING", dedup_group: "TRUCKING", origin_layer: "engine_structural" },
  };
  assertThrows(
    () => applyExplicitServiceRemovals([unknownBloc], modernTotals(), new Set(["TRUCKING"])),
    Error,
    SCOPE_REMOVE_TOTALS_INCOHERENT,
  );
});

// ─── 11. Static wiring: mono-lot and multi-lot share the helper ─────────────

Deno.test("SCOPE-REMOVE: mono-lot and multi-lot branches call the same helper (static wiring)", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes("export function applyExplicitServiceRemovals("));
  // Definition + exactly the two call sites (multi-lot, mono-lot).
  assertEquals(src.split("applyExplicitServiceRemovals(").length - 1, 3);
  assert(src.includes("[SCOPE-REMOVE] Lot ${"));
  assert(src.includes("[SCOPE-REMOVE] Mono-lot:"));
});
