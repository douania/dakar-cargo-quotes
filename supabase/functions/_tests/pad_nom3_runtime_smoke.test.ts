/**
 * PAD-NOM-3 — Runtime Smoke Tests
 * Verifies that run-pricing's PAD alias lookup chain works with the 324 newly injected aliases.
 * 
 * Tests the EXACT same logic as run-pricing:
 * 1. Normalize description with normalizePricingText()
 * 2. Query pad_designation_aliases WHERE normalized_term = X AND is_validated = true
 * 3. Lookup port_tariffs WHERE provider=PAD, category=DROIT_PASSAGE, operation_type=IMPORT
 * 4. Verify amount resolution
 * 
 * NOTE: Requires SUPABASE_SERVICE_ROLE_KEY (RLS on pad_designation_aliases = authenticated only).
 *       run-pricing uses serviceClient (service role) — tests must replicate that.
 * 
 * Run: deno test --allow-env --allow-net supabase/functions/_tests/pad_nom3_runtime_smoke.test.ts
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// run-pricing uses serviceClient (service role) to query pad_designation_aliases.
// RLS on that table requires 'authenticated' role, so we must use service role key.
const HAS_KEY = !!SERVICE_ROLE_KEY;
if (!HAS_KEY) {
  console.warn("⚠️ PAD-NOM-3 tests require SUPABASE_SERVICE_ROLE_KEY — all tests will be skipped");
}

// Exact replica of run-pricing's normalizePricingText
function normalizePricingText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

// ─── S1: gasoil → T06 → 885 FCFA/t ───
Deno.test("S1 — gasoil → T06 (official_nomenclature) → 885 FCFA/t", async () => {
  if (!HAS_KEY) { console.log("⏭️ Skipped (no key)"); return; }
  const supabase = getClient();
  const normalized = normalizePricingText("GASOIL");
  assertEquals(normalized, "gasoil");

  const { data: aliases, error } = await supabase
    .from("pad_designation_aliases")
    .select("pad_category, bl_term, source_type, is_validated")
    .eq("normalized_term", normalized)
    .eq("is_validated", true);

  assertEquals(error, null);
  assertExists(aliases);
  assertEquals(aliases.length, 1, `Expected 1 alias, got ${aliases.length}`);
  assertEquals(aliases[0].pad_category, "T06");
  assertEquals(aliases[0].source_type, "official_nomenclature");

  const { data: tariff } = await supabase
    .from("port_tariffs")
    .select("amount, unit")
    .eq("provider", "PAD")
    .eq("category", "DROIT_PASSAGE")
    .eq("operation_type", "IMPORT")
    .eq("classification", "T06")
    .eq("is_active", true)
    .maybeSingle();

  assertExists(tariff);
  assertEquals(tariff.amount, 885);
  console.log("✅ S1: gasoil → T06 → 885 FCFA/t");
});

// ─── S2: crustaces nda → P01 → 28100 FCFA/t ───
Deno.test("S2 — crustaces nda → P01 (official_nomenclature) → 28100 FCFA/t", async () => {
  if (!HAS_KEY) { console.log("⏭️ Skipped (no key)"); return; }
  const supabase = getClient();
  const normalized = normalizePricingText("Crustacés NDA");
  assertEquals(normalized, "crustaces nda");

  const { data: aliases } = await supabase
    .from("pad_designation_aliases")
    .select("pad_category, source_type")
    .eq("normalized_term", normalized)
    .eq("is_validated", true);

  assertExists(aliases);
  assertEquals(aliases.length, 1);
  assertEquals(aliases[0].pad_category, "P01");

  const { data: tariff } = await supabase
    .from("port_tariffs")
    .select("amount")
    .eq("provider", "PAD")
    .eq("category", "DROIT_PASSAGE")
    .eq("operation_type", "IMPORT")
    .eq("classification", "P01")
    .eq("is_active", true)
    .maybeSingle();

  assertExists(tariff);
  assertEquals(tariff.amount, 28100);
  console.log("✅ S2: crustaces nda → P01 → 28100 FCFA/t");
});

// ─── S3: biscuits → T12 → 4780 FCFA/t ───
Deno.test("S3 — biscuits → T12 (official_nomenclature) → 4780 FCFA/t", async () => {
  if (!HAS_KEY) { console.log("⏭️ Skipped (no key)"); return; }
  const supabase = getClient();

  const { data: aliases } = await supabase
    .from("pad_designation_aliases")
    .select("pad_category")
    .eq("normalized_term", "biscuits")
    .eq("is_validated", true);

  assertExists(aliases);
  assertEquals(aliases.length, 1);
  assertEquals(aliases[0].pad_category, "T12");

  const { data: tariff } = await supabase
    .from("port_tariffs")
    .select("amount")
    .eq("provider", "PAD")
    .eq("category", "DROIT_PASSAGE")
    .eq("operation_type", "IMPORT")
    .eq("classification", "T12")
    .eq("is_active", true)
    .maybeSingle();

  assertExists(tariff);
  assertEquals(tariff.amount, 4780);
  console.log("✅ S3: biscuits → T12 → 4780 FCFA/t");
});

// ─── S4: amidon (T12 courante nouvellement injectée) ───
Deno.test("S4 — amidon (T12 courante NOM-2) → T12 → 4780 FCFA/t", async () => {
  if (!HAS_KEY) { console.log("⏭️ Skipped (no key)"); return; }
  const supabase = getClient();

  const { data: aliases } = await supabase
    .from("pad_designation_aliases")
    .select("pad_category, source_type")
    .eq("normalized_term", "amidon")
    .eq("is_validated", true);

  assertExists(aliases);
  assertEquals(aliases.length, 1);
  assertEquals(aliases[0].pad_category, "T12");
  assertEquals(aliases[0].source_type, "official_nomenclature");

  const { data: tariff } = await supabase
    .from("port_tariffs")
    .select("amount")
    .eq("provider", "PAD")
    .eq("category", "DROIT_PASSAGE")
    .eq("operation_type", "IMPORT")
    .eq("classification", "T12")
    .eq("is_active", true)
    .maybeSingle();

  assertExists(tariff);
  assertEquals(tariff.amount, 4780);
  console.log("✅ S4: amidon → T12 → 4780 FCFA/t (official_nomenclature, NOM-2)");
});

// ─── S5: geomembranes → NO alias → gap expected ───
Deno.test("S5 — geomembranes → 0 alias (hors nomenclature officielle)", async () => {
  if (!HAS_KEY) { console.log("⏭️ Skipped (no key)"); return; }
  const supabase = getClient();
  const normalized = normalizePricingText("Géomembranes");
  assertEquals(normalized, "geomembranes");

  const { data: aliases } = await supabase
    .from("pad_designation_aliases")
    .select("pad_category")
    .eq("normalized_term", normalized)
    .eq("is_validated", true);

  assertExists(aliases);
  assertEquals(aliases.length, 0, `geomembranes should have 0 aliases, got ${aliases.length}`);
  console.log("✅ S5: geomembranes → 0 alias (correct: hors nomenclature, futur PAD-R1)");
});

// ─── S6: No validated ESTIMATED source type ───
Deno.test("S6 — zero validated ESTIMATED aliases in pad_designation_aliases", async () => {
  if (!HAS_KEY) { console.log("⏭️ Skipped (no key)"); return; }
  const supabase = getClient();

  const { data: estimated } = await supabase
    .from("pad_designation_aliases")
    .select("normalized_term")
    .eq("source_type", "estimated")
    .eq("is_validated", true);

  assertExists(estimated);
  assertEquals(estimated.length, 0, `Found ${estimated.length} validated ESTIMATED aliases`);
  console.log("✅ S6: 0 validated ESTIMATED aliases — only official sources active");
});
