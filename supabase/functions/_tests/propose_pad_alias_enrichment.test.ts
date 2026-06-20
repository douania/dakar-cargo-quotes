/**
 * PAD-ALIAS-ENRICHMENT-PIPELINE-1 / Phase B — tests ciblés logique PURE.
 *
 * Couvre normalisation, décision d'enrichissement et construction de la row CDM,
 * sans DB ni réseau. (L'import est sûr : le serveur n'est démarré que sous
 * `import.meta.main`.)
 *
 * Run: deno test supabase/functions/_tests/propose_pad_alias_enrichment.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCommodityDesignationMatchProposal,
  normalizePadAliasText,
  selectEnrichmentDecision,
  type CdmProposalRow,
  type ValidatedAliasRow,
} from "../propose-pad-alias-enrichment/index.ts";

// ── Normalisation prudente ──
Deno.test("normalizePadAliasText strips accents, case, extra spaces", () => {
  assertEquals(normalizePadAliasText("  Bus  Hyundai   Universe "), "bus hyundai universe");
  assertEquals(normalizePadAliasText("Véhicule"), "vehicule");
  assert(normalizePadAliasText("AUTOBUS") === normalizePadAliasText("autobus"));
  assertEquals(normalizePadAliasText(null), "");
  assertEquals(normalizePadAliasText(42), "");
});

// ── Décision : description absente → pas de proposition ──
Deno.test("missing description → missing_cargo_description", () => {
  const d = selectEnrichmentDecision({
    rawDescription: "   ",
    existingPadCategory: null,
    validatedAliases: [],
    existingProposals: [],
  });
  assertEquals(d.kind, "missing_cargo_description");
});

// ── Décision : déjà classé → already_classified ──
Deno.test("existing pad_category → already_classified", () => {
  const d = selectEnrichmentDecision({
    rawDescription: "buses and medical equipment",
    existingPadCategory: "T02",
    validatedAliases: [],
    existingProposals: [],
  });
  assertEquals(d.kind, "already_classified");
});

// ── Décision : alias validé exact présent → validated_alias_already_exists ──
Deno.test("existing validated alias → validated_alias_already_exists", () => {
  const aliases: ValidatedAliasRow[] = [
    { normalized_term: "ciment", is_validated: true },
    { normalized_term: "Buses and medical equipment", is_validated: true },
  ];
  const d = selectEnrichmentDecision({
    rawDescription: "Buses and medical equipment",
    existingPadCategory: null,
    validatedAliases: aliases,
    existingProposals: [],
  });
  assertEquals(d.kind, "validated_alias_already_exists");
});

// ── Décision : proposition CDM non validée déjà présente → proposal_already_exists ──
Deno.test("existing unvalidated CDM proposal → proposal_already_exists", () => {
  const proposals: CdmProposalRow[] = [
    { id: "p-1", normalized_term: "buses and medical equipment", is_validated: false },
  ];
  const d = selectEnrichmentDecision({
    rawDescription: "Buses and medical equipment",
    existingPadCategory: null,
    validatedAliases: [],
    existingProposals: proposals,
  });
  assertEquals(d.kind, "proposal_already_exists");
  if (d.kind === "proposal_already_exists") {
    assertEquals(d.existing.id, "p-1");
  }
});

// ── Décision : une proposition validée NE compte PAS comme doublon ──
Deno.test("validated CDM row does not count as existing proposal", () => {
  const proposals: CdmProposalRow[] = [
    { id: "p-validated", normalized_term: "buses and medical equipment", is_validated: true },
  ];
  const d = selectEnrichmentDecision({
    rawDescription: "Buses and medical equipment",
    existingPadCategory: null,
    validatedAliases: [],
    existingProposals: proposals,
  });
  assertEquals(d.kind, "create");
});

// ── Décision : description inconnue → create ──
Deno.test("unmatched description → create decision", () => {
  const d = selectEnrichmentDecision({
    rawDescription: "Buses and medical equipment",
    existingPadCategory: null,
    validatedAliases: [{ normalized_term: "ciment", is_validated: true }],
    existingProposals: [],
  });
  assertEquals(d.kind, "create");
  if (d.kind === "create") {
    assertEquals(d.observedTerm, "Buses and medical equipment");
    assertEquals(d.normalizedTerm, "buses and medical equipment");
  }
});

// ── Construction row CDM : is_validated false, pas de catégorie, source_type autorisé ──
Deno.test("build CDM proposal: review-only, no category, allowed source_type", () => {
  const row = buildCommodityDesignationMatchProposal({
    caseId: "00000000-0000-0000-0000-000000000001",
    observedTerm: "Buses and medical equipment",
    normalizedTerm: "buses and medical equipment",
  });

  assertEquals(row.is_validated, false);
  assertEquals(row.commodity_category_id, null);
  assertEquals(row.pad_category_candidate, null);
  assertEquals(row.match_score, null);
  assertEquals(row.validated_by, null);
  assertEquals(row.validated_at, null);
  assertEquals(row.source_type, "document_extraction");
  assertEquals(row.match_method, "pad_alias_enrichment_unmatched_description");
  assertEquals(row.observed_term, "Buses and medical equipment");
  assertEquals(row.normalized_term, "buses and medical equipment");
  assertEquals(
    row.source_reference,
    "PAD-ALIAS-ENRICHMENT-PIPELINE-1:00000000-0000-0000-0000-000000000001:cargo.description",
  );

  // Garde-fou : la payload ne porte AUCUN champ propre à pad_designation_aliases
  // (bl_term, pad_category, commodity_category_id NOT NULL, etc.).
  const keys = Object.keys(row);
  assert(!keys.includes("bl_term"), "must not write pad_designation_aliases.bl_term");
  assert(!keys.includes("pad_category"), "must not write pad_designation_aliases.pad_category");
});

// ── source_type doit rester dans le CHECK existant de CDM ──
Deno.test("source_type stays within allowed CDM CHECK values", () => {
  const allowed = new Set(["manual", "document_extraction", "operator_correction", "seeded_synonym"]);
  const row = buildCommodityDesignationMatchProposal({
    caseId: "00000000-0000-0000-0000-000000000002",
    observedTerm: "x",
    normalizedTerm: "x",
  });
  assert(allowed.has(row.source_type), `source_type ${row.source_type} not allowed`);
});
