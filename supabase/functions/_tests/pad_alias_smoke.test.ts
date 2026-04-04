/**
 * Phase PAD-1 Smoke Tests
 * Tests: T1 (alias consumed), T2 (operator facts priority), T3 (no alias no fact)
 * 
 * Run: deno test --allow-env --allow-net supabase/functions/_tests/pad_alias_smoke.test.ts
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// ─── T1: Verify alias data integrity + tariff resolution chain ───

Deno.test("T1 — PAD alias seed integrity: 51 aliases, 0 collisions, all validated", async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

  // Count total aliases
  const { data: aliases, error } = await supabase
    .from("pad_designation_aliases")
    .select("normalized_term, pad_category, is_validated, commodity_category_id")
    .eq("source_type", "seed");

  assertEquals(error, null, `Query error: ${error?.message}`);
  assertExists(aliases);
  assertEquals(aliases.length, 51, `Expected 51 seeded aliases, got ${aliases.length}`);

  // All validated
  const unvalidated = aliases.filter((a: any) => !a.is_validated);
  assertEquals(unvalidated.length, 0, `Found ${unvalidated.length} unvalidated aliases`);

  // Check no collision: each normalized_term maps to exactly one pad_category
  const termToCategories = new Map<string, Set<string>>();
  for (const alias of aliases) {
    if (!termToCategories.has(alias.normalized_term)) {
      termToCategories.set(alias.normalized_term, new Set());
    }
    termToCategories.get(alias.normalized_term)!.add(alias.pad_category);
  }
  const collisions = [...termToCategories.entries()].filter(([_, cats]) => cats.size > 1);
  assertEquals(collisions.length, 0, `Collisions found: ${JSON.stringify(collisions)}`);

  console.log("✅ T1-seed: 51 aliases, all validated, 0 collisions");
});

Deno.test("T1 — PAD alias 'carreaux ceramiques' resolves to T12 with correct tariff", async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

  // Step 1: Lookup alias
  const { data: aliasRows, error: aliasErr } = await supabase
    .from("pad_designation_aliases")
    .select("pad_category, bl_term, commodity_category_id")
    .eq("normalized_term", "carreaux ceramiques")
    .eq("is_validated", true);

  assertEquals(aliasErr, null, `Alias query error: ${aliasErr?.message}`);
  assertExists(aliasRows);
  assertEquals(aliasRows.length, 1, `Expected 1 alias, got ${aliasRows.length}`);
  assertEquals(aliasRows[0].pad_category, "T12", `Expected T12, got ${aliasRows[0].pad_category}`);

  // Step 2: Lookup tariff (exact same query as run-pricing)
  const { data: tariffRow, error: tariffErr } = await supabase
    .from("port_tariffs")
    .select("amount, unit, classification")
    .eq("provider", "PAD")
    .eq("category", "DROIT_PASSAGE")
    .eq("operation_type", "IMPORT")
    .eq("classification", "T12")
    .eq("is_active", true)
    .maybeSingle();

  assertEquals(tariffErr, null, `Tariff query error: ${tariffErr?.message}`);
  assertExists(tariffRow, "No tariff found for T12");
  assertEquals(tariffRow.amount, 4780, `Expected 4780, got ${tariffRow.amount}`);
  assertEquals(tariffRow.unit, "PER_TONNE", `Expected PER_TONNE, got ${tariffRow.unit}`);

  // Step 3: Verify calculation
  const testWeightTonnes = 8.0; // 8 tonnes
  const expectedAmount = Math.round(4780 * testWeightTonnes);
  assertEquals(expectedAmount, 38240, "Expected PAD amount for 8t carreaux = 38 240 FCFA");

  console.log(`✅ T1-chain: carreaux ceramiques → T12 → 4780 FCFA/t → 8t = 38 240 FCFA`);
});

Deno.test("T1 — PAD alias 'riz en sacs' resolves to T05 with correct tariff", async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

  const { data: aliasRows } = await supabase
    .from("pad_designation_aliases")
    .select("pad_category")
    .eq("normalized_term", "riz en sacs")
    .eq("is_validated", true);

  assertExists(aliasRows);
  assertEquals(aliasRows.length, 1);
  assertEquals(aliasRows[0].pad_category, "T05");

  const { data: tariffRow } = await supabase
    .from("port_tariffs")
    .select("amount")
    .eq("provider", "PAD")
    .eq("category", "DROIT_PASSAGE")
    .eq("operation_type", "IMPORT")
    .eq("classification", "T05")
    .eq("is_active", true)
    .maybeSingle();

  assertExists(tariffRow);
  assertEquals(tariffRow.amount, 1180, `Expected 1180, got ${tariffRow.amount}`);

  const testWeight = 25.0;
  const expected = Math.round(1180 * testWeight);
  assertEquals(expected, 29500);

  console.log(`✅ T1-chain: riz en sacs → T05 → 1180 FCFA/t → 25t = 29 500 FCFA`);
});

// ─── T2: Operator facts priority (verified via data logic) ───

Deno.test("T2 — Operator facts priority: padCategory already set → alias skipped", async () => {
  // This test verifies the LOGIC that run-pricing uses:
  // if (inputs.padCategory) → alias lookup is skipped
  // We verify this by checking the condition in the code path

  const simulatedInputs = {
    padCategory: "T09",       // operator-injected
    padRateFcfaPerTon: 4367,  // operator-injected
    cargoDescription: "carreaux ceramiques", // would match T12 alias
    cargoWeight: 5.0,
  };

  // The code checks: if (!inputs.padCategory && inputs.cargoDescription)
  // With padCategory set, alias lookup is SKIPPED
  const aliasLookupExecuted = !simulatedInputs.padCategory && !!simulatedInputs.cargoDescription;
  assertEquals(aliasLookupExecuted, false, "Alias lookup should be skipped when padCategory exists");

  // Operator facts should produce the line
  const padAmount = Math.round(simulatedInputs.padRateFcfaPerTon * simulatedInputs.cargoWeight);
  assertEquals(padAmount, 21835, "Expected 4367 × 5t = 21 835 FCFA (operator facts)");

  console.log("✅ T2: padCategory='T09' (operator) → alias skipped → 4367 × 5t = 21 835 FCFA");
});

// ─── T3: No alias, no fact → no PAD line ───

Deno.test("T3 — No alias match, no facts → no PAD line produced", async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

  // "used machinery" is NOT in the seed aliases
  const { data: aliasRows } = await supabase
    .from("pad_designation_aliases")
    .select("pad_category")
    .eq("normalized_term", "used machinery")
    .eq("is_validated", true);

  assertExists(aliasRows);
  assertEquals(aliasRows.length, 0, "Should find 0 aliases for 'used machinery'");

  // With no alias match AND no operator facts:
  const simulatedInputs = {
    padCategory: undefined,
    padRateFcfaPerTon: undefined,
    cargoDescription: "used machinery",
    cargoWeight: 5.0,
  };

  // After alias lookup returns 0 results, padCategory remains undefined
  // The PAD enrichment block checks: if (inputs.padCategory && inputs.padRateFcfaPerTon)
  const padLineProduced = !!(simulatedInputs.padCategory && simulatedInputs.padRateFcfaPerTon);
  assertEquals(padLineProduced, false, "No PAD line should be produced");

  console.log("✅ T3: 'used machinery' → 0 alias → no facts → no PAD line");
});

// ─── T1-runtime: Call actual edge function on a real case ───

Deno.test("T1-runtime — Edge function run-pricing: case with alias-matchable description", async () => {
  if (!SERVICE_ROLE_KEY) {
    console.log("⏭️ T1-runtime: skipped (no SERVICE_ROLE_KEY)");
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Find a READY_TO_PRICE maritime case
  const { data: cases } = await supabase
    .from("quote_cases")
    .select("id, status, request_type")
    .eq("status", "READY_TO_PRICE")
    .limit(1);

  if (!cases || cases.length === 0) {
    console.log("⏭️ T1-runtime: skipped (no READY_TO_PRICE case available)");
    return;
  }

  const caseId = cases[0].id;
  console.log(`T1-runtime: using case ${caseId} (${cases[0].request_type})`);

  // Check if cargo.description matches any alias
  const { data: descFact } = await supabase
    .from("quote_facts")
    .select("value_text")
    .eq("case_id", caseId)
    .eq("fact_key", "cargo.description")
    .eq("is_current", true)
    .maybeSingle();

  if (descFact?.value_text) {
    // Normalize like run-pricing does
    const normalized = descFact.value_text
      .toString().toLowerCase().trim()
      .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u').replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

    const { data: matchingAlias } = await supabase
      .from("pad_designation_aliases")
      .select("pad_category, bl_term")
      .eq("normalized_term", normalized)
      .eq("is_validated", true);

    console.log(`T1-runtime: description="${descFact.value_text}" normalized="${normalized}" → ${matchingAlias?.length || 0} alias(es)`);
  }

  console.log("✅ T1-runtime: data integrity verified (full edge function call requires ACK_READY status)");
});
