/**
 * PAD-PRODUCER-UPSTREAM-1B (Option B) — tests ciblés logique PURE.
 *
 * Couvre la sélection d'alias et la construction de row, sans DB ni réseau.
 * (L'import est sûr : le serveur n'est démarré que sous `import.meta.main`.)
 *
 * Run: deno test supabase/functions/_tests/produce_pad_classification_candidates.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCandidateRow,
  normalizePadText,
  selectValidatedAliasDecision,
  type PadAliasRow,
} from "../produce-pad-classification-candidates/index.ts";

const alias = (over: Partial<PadAliasRow>): PadAliasRow => ({
  normalized_term: null,
  pad_category: null,
  bl_term: null,
  commodity_category_id: null,
  is_validated: true,
  source_type: "seed",
  source_reference: null,
  ...over,
});

// ── 1. Alias exact unique → match + row valide, sans montant, status suggested ──
Deno.test("alias exact unique → candidate suggested, no amount", () => {
  const decision = selectValidatedAliasDecision({
    normalizedDescription: normalizePadText("Ciment"),
    aliases: [
      alias({ normalized_term: "ciment", pad_category: "T12", bl_term: "CIMENT", commodity_category_id: "cat-1" }),
      alias({ normalized_term: "riz", pad_category: "T05" }),
    ],
  });
  assertEquals(decision.kind, "match");
  if (decision.kind !== "match") return;
  assertEquals(decision.pad_category, "T12");

  const row = buildCandidateRow({
    caseId: "00000000-0000-0000-0000-000000000001",
    padCategory: decision.pad_category,
    designationNormalized: normalizePadText("Ciment"),
    alias: decision.alias,
    descriptionFact: {
      id: "fact-1",
      fact_key: "cargo.description",
      value_text: "Ciment",
      value_json: null,
      confidence: 0.8,
      source_type: "email_body",
      source_excerpt: "…ciment…",
    },
    requestedBy: "user-1",
  });

  assertEquals(row.candidate_kind, "pad_category");
  assertEquals(row.candidate_value, "T12");
  assertEquals(row.pad_category, "T12");
  assertEquals(row.source, "validated_alias");
  assertEquals(row.status, "suggested");
  assertEquals(row.is_current, true);
  assertEquals(row.confidence, 0.9);
  assertEquals(row.score, 0.9);
  assertEquals(row.rank, 1);
  // Aucun montant calculé dans cette phase.
  assertEquals(row.droit_passage_value, null);
  assertEquals(row.droit_passage_currency, null);
  assertEquals(row.droit_passage_unit, null);
  assertEquals(row.source_fact_id, "fact-1");
  assertEquals((row.evidence as { pricing_effect: string }).pricing_effect, "none");
  assertEquals((row.evidence as { auto_propagate: boolean }).auto_propagate, false);
});

// ── 2. Aucun alias (cas "Buses and medical equipment") → no_validated_alias_match ──
Deno.test("no alias match → reason no_validated_alias_match", () => {
  const decision = selectValidatedAliasDecision({
    normalizedDescription: normalizePadText("Buses and medical equipment"),
    aliases: [
      alias({ normalized_term: "ciment", pad_category: "T12" }),
      alias({ normalized_term: "riz", pad_category: "T05" }),
    ],
  });
  assertEquals(decision.kind, "none");
  if (decision.kind === "none") {
    assertEquals(decision.reason, "no_validated_alias_match");
  }
});

// ── 3. Collision multi-catégorie → reason alias_collision ──
Deno.test("multi-category collision → reason alias_collision", () => {
  const decision = selectValidatedAliasDecision({
    normalizedDescription: normalizePadText("véhicule"),
    aliases: [
      alias({ normalized_term: "vehicule", pad_category: "T02" }),
      alias({ normalized_term: "vehicule", pad_category: "T03" }),
    ],
  });
  assertEquals(decision.kind, "collision");
  if (decision.kind === "collision") {
    assertEquals(decision.reason, "alias_collision");
    assertEquals(decision.categories, ["T02", "T03"]);
  }
});

// ── 4. Idempotence : la row porte la clé unique stable (case_id, article_id null,
//      candidate_kind, source, candidate_value) consommée par le pré-check handler. ──
Deno.test("idempotency key tuple is stable", () => {
  const row = buildCandidateRow({
    caseId: "00000000-0000-0000-0000-000000000002",
    padCategory: "T12",
    designationNormalized: "ciment",
    alias: alias({ normalized_term: "ciment", pad_category: "T12" }),
    descriptionFact: null,
    requestedBy: null,
  });
  assertEquals(row.article_id, null);
  assertEquals(row.candidate_kind, "pad_category");
  assertEquals(row.source, "validated_alias");
  assertEquals(row.candidate_value, "T12");
  // source_fact_id facultatif : null si fact absent.
  assertEquals(row.source_fact_id, null);
});

// ── Bonus : normalisation prudente (accents/casse/espaces) pour exact match ──
Deno.test("normalizePadText strips accents, case, extra spaces", () => {
  assertEquals(normalizePadText("  Véhicule   Neuf "), "vehicule neuf");
  assert(normalizePadText("CIMENT") === normalizePadText("ciment"));
});

// ── Garde-fou : un alias non validé ne doit jamais matcher ──
Deno.test("unvalidated alias never matches", () => {
  const decision = selectValidatedAliasDecision({
    normalizedDescription: normalizePadText("ciment"),
    aliases: [alias({ normalized_term: "ciment", pad_category: "T12", is_validated: false })],
  });
  assertEquals(decision.kind, "none");
});
