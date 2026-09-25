import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LOT_CONTAINERS_UNREADABLE, readLotContainers } from "../_shared/lot-confirmation.ts";

/**
 * MULTI-LOT-TERMINAL-1 (GO CTO 2026-09-25, option B) — per-lot containers in run-pricing.
 * The multi-lot loop reads the lot's own `cargo.containers` with `readLotContainers` (shared
 * with the PAD allocation check): valid → these containers are priced; invalid → the lot is
 * blocked with LOT_CONTAINERS_UNREADABLE before the engine; absent → unchanged merged path.
 * The loop itself is exercised end to end by scripts/lot-local-handlers/parcours.ts.
 */

// The Edge Function is imported for its pure helpers only — no HTTP listener.
Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");
const { buildPricingInputs, mergeFactsForLot } = await import("./index.ts") as {
  buildPricingInputs: (facts: unknown[]) => { containers?: unknown[] };
  mergeFactsForLot: (globalFacts: unknown[], lotFacts: unknown[]) => unknown[];
};

// Dossier fact as written by the build for the LAST lot of the sandbox (JSON), line facts as
// written by the real extraction (text).
const dossier = [{ fact_key: "cargo.containers", value_json: [{ type: "20DV", quantity: 1, coc_soc: null }], value_text: null, value_number: null }];
const lot = (value: unknown, valueType = "text") => [{ key: "cargo.containers", value, valueType, confidence: 0.95 }];

Deno.test("LOT CONTAINERS/run-pricing: the legacy merged read loses a text value (the defect the reader replaces)", () => {
  assertEquals(buildPricingInputs(mergeFactsForLot(dossier, lot("2x40HC"))).containers, []);
});

Deno.test("LOT CONTAINERS/run-pricing: the lot's own text or JSON gives the same containers, never the dossier's", () => {
  const fromText = readLotContainers(lot("2x40HC"));
  const fromJson = readLotContainers(lot(JSON.stringify([{ type: "40HC", quantity: 2, coc_soc: null }]), "json"));
  assertEquals(fromText, { status: "valid", containers: [{ type: "40HC", quantity: 2, coc_soc: null }] });
  assertEquals(fromText, fromJson);
});

Deno.test("LOT CONTAINERS/run-pricing: unreadable is explicit; absent keeps the merged path", () => {
  assertEquals(readLotContainers(lot("deux conteneurs 40HC")), { status: "invalid" });
  assertEquals(LOT_CONTAINERS_UNREADABLE, "LOT_CONTAINERS_UNREADABLE");
  assertEquals(readLotContainers([{ key: "cargo.weight_kg", value: "36000", valueType: "number" }]), { status: "absent" });
  assertEquals(buildPricingInputs(mergeFactsForLot(dossier, [])).containers, [{ type: "20DV", quantity: 1, coc_soc: null }]);
});
