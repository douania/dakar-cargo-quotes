/**
 * PAD-ALIAS-ENRICHMENT-PIPELINE-1 / Phase C2-D — Tests ciblés logique PURE.
 *
 * Couvre validateInput, detectCollision, buildPdaInsertPayload, buildCdmUpdatePayload
 * sans DB ni réseau. (L'import est sûr : le serveur n'est démarré que sous
 * `import.meta.main`.)
 *
 * Run: deno test supabase/functions/_tests/validate_pad_alias_enrichment.test.ts
 */

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCdmUpdatePayload,
  buildPdaInsertPayload,
  detectCollision,
  validateInput,
  type CdmRow,
  type CategoryRow,
} from "../validate-pad-alias-enrichment/index.ts";

const VALID_CDM_ID = "00000000-0000-0000-0000-000000000001";
const VALID_CAT_ID = "00000000-0000-0000-0000-000000000002";
const OTHER_CAT_ID = "00000000-0000-0000-0000-000000000003";
const CALLER_ID   = "00000000-0000-0000-0000-000000000099";

// ── validateInput ─────────────────────────────────────────────────────────────

Deno.test("validateInput: null body → invalid", () => {
  const r = validateInput(null);
  assertFalse(r.ok);
  if (!r.ok) assertEquals(r.details, "body_not_object");
});

Deno.test("validateInput: array body → invalid", () => {
  const r = validateInput([]);
  assertFalse(r.ok);
  if (!r.ok) assertEquals(r.details, "body_not_object");
});

Deno.test("validateInput: missing cdm_id → invalid", () => {
  const r = validateInput({ commodity_category_id: VALID_CAT_ID });
  assertFalse(r.ok);
  if (!r.ok) assertEquals(r.details, "cdm_id_invalid");
});

Deno.test("validateInput: non-UUID cdm_id → invalid", () => {
  const r = validateInput({ cdm_id: "not-a-uuid", commodity_category_id: VALID_CAT_ID });
  assertFalse(r.ok);
  if (!r.ok) assertEquals(r.details, "cdm_id_invalid");
});

Deno.test("validateInput: missing commodity_category_id → invalid", () => {
  const r = validateInput({ cdm_id: VALID_CDM_ID });
  assertFalse(r.ok);
  if (!r.ok) assertEquals(r.details, "commodity_category_id_invalid");
});

Deno.test("validateInput: non-UUID commodity_category_id → invalid", () => {
  const r = validateInput({ cdm_id: VALID_CDM_ID, commodity_category_id: "bad" });
  assertFalse(r.ok);
  if (!r.ok) assertEquals(r.details, "commodity_category_id_invalid");
});

Deno.test("validateInput: valid minimal input → ok, source_reference null", () => {
  const r = validateInput({ cdm_id: VALID_CDM_ID, commodity_category_id: VALID_CAT_ID });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.input.cdm_id, VALID_CDM_ID);
    assertEquals(r.input.commodity_category_id, VALID_CAT_ID);
    assertEquals(r.input.source_reference, null);
  }
});

Deno.test("validateInput: source_reference trimmed, empty becomes null", () => {
  const r = validateInput({
    cdm_id: VALID_CDM_ID,
    commodity_category_id: VALID_CAT_ID,
    source_reference: "  ",
  });
  assert(r.ok);
  if (r.ok) assertEquals(r.input.source_reference, null);
});

Deno.test("validateInput: source_reference trimmed non-empty kept", () => {
  const r = validateInput({
    cdm_id: VALID_CDM_ID,
    commodity_category_id: VALID_CAT_ID,
    source_reference: "  PAD-C2D:case-1  ",
  });
  assert(r.ok);
  if (r.ok) assertEquals(r.input.source_reference, "PAD-C2D:case-1");
});

// ── detectCollision ───────────────────────────────────────────────────────────

Deno.test("detectCollision: no existing aliases → none", () => {
  const r = detectCollision([], VALID_CAT_ID);
  assertEquals(r.kind, "none");
});

Deno.test("detectCollision: existing alias same category → same_category", () => {
  const r = detectCollision(
    [{ id: "alias-1", commodity_category_id: VALID_CAT_ID }],
    VALID_CAT_ID,
  );
  assertEquals(r.kind, "same_category");
  if (r.kind === "same_category") assertEquals(r.existingId, "alias-1");
});

Deno.test("detectCollision: existing alias different category → different_category", () => {
  const r = detectCollision(
    [{ id: "alias-2", commodity_category_id: OTHER_CAT_ID }],
    VALID_CAT_ID,
  );
  assertEquals(r.kind, "different_category");
  if (r.kind === "different_category") {
    assertEquals(r.existingId, "alias-2");
    assertEquals(r.existingCategoryId, OTHER_CAT_ID);
  }
});

Deno.test("detectCollision: any different category blocks even if same category also exists", () => {
  // same_category alias vient EN PREMIER — l'ancienne logique aurait retourné same_category (faux).
  // La nouvelle logique scanne tous les aliases, trouve la catégorie différente → different_category.
  const r = detectCollision(
    [
      { id: "alias-same", commodity_category_id: VALID_CAT_ID },
      { id: "alias-diff", commodity_category_id: OTHER_CAT_ID },
    ],
    VALID_CAT_ID,
  );
  assertEquals(r.kind, "different_category");
  if (r.kind === "different_category") {
    assertEquals(r.existingId, "alias-diff");
    assertEquals(r.existingCategoryId, OTHER_CAT_ID);
  }
});

Deno.test("detectCollision: existing alias null commodity_category_id → different_category", () => {
  const r = detectCollision(
    [{ id: "alias-null", commodity_category_id: null }],
    VALID_CAT_ID,
  );
  assertEquals(r.kind, "different_category");
  if (r.kind === "different_category") assertEquals(r.existingCategoryId, "");
});

// ── buildPdaInsertPayload ─────────────────────────────────────────────────────

const CDM_STUB: CdmRow = {
  id: VALID_CDM_ID,
  observed_term: "Ciment en sacs 50kg",
  normalized_term: "ciment en sacs 50kg",
  source_reference: "PAD-ALIAS-ENRICHMENT-PIPELINE-1:case-1:cargo.description",
};

const CATEGORY_STUB: CategoryRow = {
  id: VALID_CAT_ID,
  pad_category: "T05",
};

Deno.test("buildPdaInsertPayload: is_validated always true", () => {
  const row = buildPdaInsertPayload({
    cdm: CDM_STUB,
    category: CATEGORY_STUB,
    callerId: CALLER_ID,
    sourceReference: null,
    now: "2026-06-20T14:00:00.000Z",
  });
  assertEquals(row.is_validated, true);
});

Deno.test("buildPdaInsertPayload: source_type is ai_suggestion_validated", () => {
  const row = buildPdaInsertPayload({
    cdm: CDM_STUB,
    category: CATEGORY_STUB,
    callerId: CALLER_ID,
    sourceReference: null,
    now: "2026-06-20T14:00:00.000Z",
  });
  assertEquals(row.source_type, "ai_suggestion_validated");
});

Deno.test("buildPdaInsertPayload: validated_by is callerId, not from body", () => {
  const row = buildPdaInsertPayload({
    cdm: CDM_STUB,
    category: CATEGORY_STUB,
    callerId: CALLER_ID,
    sourceReference: null,
    now: "2026-06-20T14:00:00.000Z",
  });
  assertEquals(row.validated_by, CALLER_ID);
});

Deno.test("buildPdaInsertPayload: normalized_term and pad_category from CDM/category", () => {
  const row = buildPdaInsertPayload({
    cdm: CDM_STUB,
    category: CATEGORY_STUB,
    callerId: CALLER_ID,
    sourceReference: null,
    now: "2026-06-20T14:00:00.000Z",
  });
  assertEquals(row.normalized_term, "ciment en sacs 50kg");
  assertEquals(row.pad_category, "T05");
  assertEquals(row.commodity_category_id, VALID_CAT_ID);
  assertEquals(row.bl_term, "Ciment en sacs 50kg");
});

Deno.test("buildPdaInsertPayload: explicit source_reference takes priority over CDM", () => {
  const row = buildPdaInsertPayload({
    cdm: CDM_STUB,
    category: CATEGORY_STUB,
    callerId: CALLER_ID,
    sourceReference: "EXPLICIT-REF",
    now: "2026-06-20T14:00:00.000Z",
  });
  assertEquals(row.source_reference, "EXPLICIT-REF");
});

Deno.test("buildPdaInsertPayload: null source_reference falls back to CDM source_reference", () => {
  const row = buildPdaInsertPayload({
    cdm: CDM_STUB,
    category: CATEGORY_STUB,
    callerId: CALLER_ID,
    sourceReference: null,
    now: "2026-06-20T14:00:00.000Z",
  });
  assertEquals(row.source_reference, CDM_STUB.source_reference);
});

Deno.test("buildPdaInsertPayload: no pricing/quote/CCC fields in payload", () => {
  const row = buildPdaInsertPayload({
    cdm: CDM_STUB,
    category: CATEGORY_STUB,
    callerId: CALLER_ID,
    sourceReference: null,
    now: "2026-06-20T14:00:00.000Z",
  });
  const keys = Object.keys(row);
  const forbidden = [
    "quote_case_id", "case_id", "pricing", "tariff", "freight",
    "ccc_id", "classification_candidate", "fact_key", "value_text",
    "pad_rate", "pad_amount",
  ];
  for (const f of forbidden) {
    assertFalse(keys.includes(f), `payload must not include field: ${f}`);
  }
});

// ── buildCdmUpdatePayload ─────────────────────────────────────────────────────

Deno.test("buildCdmUpdatePayload: is_validated true, pad_category_candidate null", () => {
  const update = buildCdmUpdatePayload({
    requestedCategoryId: VALID_CAT_ID,
    callerId: CALLER_ID,
    now: "2026-06-20T14:00:00.000Z",
  });
  assertEquals(update.is_validated, true);
  assertEquals(update.pad_category_candidate, null);
  assertEquals(update.commodity_category_id, VALID_CAT_ID);
  assertEquals(update.validated_by, CALLER_ID);
  assertEquals(update.validated_at, "2026-06-20T14:00:00.000Z");
});

Deno.test("buildCdmUpdatePayload: no pricing/quote/CCC fields in payload", () => {
  const update = buildCdmUpdatePayload({
    requestedCategoryId: VALID_CAT_ID,
    callerId: CALLER_ID,
    now: "2026-06-20T14:00:00.000Z",
  });
  const keys = Object.keys(update);
  const forbidden = [
    "quote_case_id", "case_id", "fact_key", "value_text",
    "pad_rate", "pad_amount", "freight",
  ];
  for (const f of forbidden) {
    assertFalse(keys.includes(f), `CDM update must not include field: ${f}`);
  }
});
