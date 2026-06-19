/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-O
 * Tests PURS (aucun réseau, aucune DB) de derive-cargo-canonical-payload.
 *
 * Couvre :
 *   - deriveCore : validation, gate attachments (non analysé / type=error),
 *     appel canonicalizer en dry_run UNIQUEMENT, Authorization original transmis
 *   - deriveCargoPayload : mapping articles→cargo_lines, règle poids/volume
 *     mono-ligne, containers→unallocated_equipment
 *   - garde architecturale statique : pas de .rpc(, pas de SUPABASE_SERVICE_ROLE_KEY,
 *     pas d'appel direct à write-cargo-canonical
 *
 * NB : `Deno.serve` gardé par `import.meta.main` → non déclenché à l'import.
 *
 * Exécution :
 *   deno test --no-check --allow-read --allow-env \
 *     supabase/functions/_tests/derive_cargo_canonical_payload_validation.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const {
  deriveCore,
  deriveCargoPayload,
  assessAttachments,
  isDecisiveAttachmentCandidate,
  normalizeCurrency,
  // Phase 2-Q : dérivation depuis le dernier email entrant client.
  deriveCargoPayloadFromLatestInboundEmail,
  parseVehicleFlatRackRevision,
  parseAdditionalMedicalEquipmentContainers,
  hasRevisionTerms,
  isSodatraEmail,
  // Phase 2-Q Patch B : normalisation base64 du dernier email entrant.
  normalizeEmailTextForParsing,
  // Phase 2-Q Patch E : enrichissement specs bus depuis le thread entrant.
  parseBusSpecsFromEmailText,
  findMostRelevantBusSpecsFromThread,
  deriveCargoPayloadFromInboundEmailThread,
  // Phase 2-Q Patch F : enrichissement specs bus depuis les attachments analysés.
  parseBusSpecsFromAttachmentText,
  findBusSpecsFromAnalyzedAttachments,
  enrichCargoPayloadFromAttachments,
} = await import("../derive-cargo-canonical-payload/index.ts");

// Phase 2-Q Patch C : helper d'extraction texte depuis un body MIME brut.
const { extractPlainTextFromMime } = await import(
  "../_shared/email-text-extraction.ts"
);

const VALID_CASE = "11111111-1111-1111-1111-111111111111";
const ORIGINAL_AUTH = "Bearer original-user-token";
const CORR = "00000000-0000-0000-0000-0000000000bb";

const ALWAYS_OWNER = () => Promise.resolve(true);

function analyzedAttachment(extracted_data: unknown, id = "att-1", filename = "doc.pdf") {
  return { id, filename, is_analyzed: true, extracted_data };
}

function okCanonicalizer() {
  return (body: Record<string, unknown>) =>
    Promise.resolve(
      new Response(
        JSON.stringify({ ok: true, mode: body.mode, writer_payload: body.cargo_payload }),
        { status: 200 },
      ),
    );
}

// ── normalizeCurrency ──────────────────────────────────────────────────────
Deno.test("2-O currency — whitelist stricte, sinon null", () => {
  for (const c of ["XOF", "FCFA", "CFA", "EUR", "USD"]) assertEquals(normalizeCurrency(c), c);
  assertEquals(normalizeCurrency("eur"), "EUR");
  assertEquals(normalizeCurrency("GBP"), null);
  assertEquals(normalizeCurrency(123), null);
  assertEquals(normalizeCurrency(null), null);
});

// ── assessAttachments / deriveCore : gate ──────────────────────────────────
Deno.test("2-O gate — source non analysée rejetée", () => {
  const a = assessAttachments([{ id: "x", filename: "f.pdf", is_analyzed: false, extracted_data: null }]);
  assertEquals(a.ok, false);
  assertEquals(a.blocking[0].reason, "not_analyzed");
});

Deno.test("2-O gate — extracted_data.type=error rejeté", () => {
  const a = assessAttachments([analyzedAttachment({ type: "error", message: "boom" })]);
  assertEquals(a.ok, false);
  assertEquals(a.blocking[0].reason, "extraction_error");
});

Deno.test("2-O gate — attachment analysé sans erreur accepté", () => {
  const a = assessAttachments([analyzedAttachment({ type: "quotation", articles: [] })]);
  assertEquals(a.ok, true);
});

// ── isDecisiveAttachmentCandidate ──────────────────────────────────────────
Deno.test("2-O décisif — PDF et Excel sont décisifs", () => {
  assert(isDecisiveAttachmentCandidate({ id: "1", filename: "doc.pdf", content_type: "application/pdf" }));
  assert(isDecisiveAttachmentCandidate({ id: "2", filename: "facture.xlsx", content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  assert(isDecisiveAttachmentCandidate({ id: "3", filename: "data.csv" }));
});

Deno.test("2-O décisif — fichiers techniques / images génériques NON décisifs", () => {
  assertEquals(isDecisiveAttachmentCandidate({ id: "1", filename: "signature.png", content_type: "image/png" }), false);
  assertEquals(isDecisiveAttachmentCandidate({ id: "2", filename: "logo.jpg", content_type: "image/jpeg" }), false);
  assertEquals(isDecisiveAttachmentCandidate({ id: "3", filename: "footer-banner.gif", content_type: "image/gif" }), false);
  assertEquals(isDecisiveAttachmentCandidate({ id: "4", filename: "image001.png", content_type: "image/png" }), false);
  assertEquals(isDecisiveAttachmentCandidate({ id: "5", filename: "notes.txt", content_type: "text/plain" }), false);
});

Deno.test("2-O décisif — images avec signal métier sont décisives", () => {
  assert(isDecisiveAttachmentCandidate({ id: "1", filename: "invoice_scan.png", content_type: "image/png" }));
  assert(isDecisiveAttachmentCandidate({ id: "2", filename: "rfq.jpg", content_type: "image/jpeg" }));
  assert(isDecisiveAttachmentCandidate({ id: "3", filename: "rate-sheet.png", content_type: "image/png" }));
  assert(isDecisiveAttachmentCandidate({ id: "4", filename: "bl.png", content_type: "image/png" }));
  // "bl" doit rester un token isolé (pas un faux positif sur "table"/"blue")
  assertEquals(isDecisiveAttachmentCandidate({ id: "5", filename: "table.png", content_type: "image/png" }), false);
});

// ── assessAttachments : ne bloque que les décisifs ─────────────────────────
Deno.test("2-O gate — logo/signature NON analysé ne bloque pas", () => {
  const a = assessAttachments([
    { id: "1", filename: "signature.png", content_type: "image/png", is_analyzed: false, extracted_data: null },
    { id: "2", filename: "logo.jpg", content_type: "image/jpeg", is_analyzed: false, extracted_data: null },
  ]);
  assertEquals(a.ok, true);
});

Deno.test("2-O gate — PDF NON analysé bloque", () => {
  const a = assessAttachments([
    { id: "1", filename: "quotation.pdf", content_type: "application/pdf", is_analyzed: false, extracted_data: null },
  ]);
  assertEquals(a.ok, false);
  assertEquals(a.blocking[0].reason, "not_analyzed");
});

Deno.test("2-O gate — image inline générique NON analysée ne bloque pas", () => {
  const a = assessAttachments([
    { id: "1", filename: "image001.png", content_type: "image/png", is_analyzed: false, extracted_data: null },
  ]);
  assertEquals(a.ok, true);
});

Deno.test("2-O gate — image invoice/rfq/rate NON analysée bloque", () => {
  for (const fn of ["invoice_scan.png", "rfq.jpg", "rate-sheet.png"]) {
    const a = assessAttachments([
      { id: "1", filename: fn, content_type: "image/png", is_analyzed: false, extracted_data: null },
    ]);
    assertEquals(a.ok, false, fn);
    assertEquals(a.blocking[0].reason, "not_analyzed", fn);
  }
});

// ── deriveCargoPayload : mapping ───────────────────────────────────────────
Deno.test("2-O mapping — articles[] → cargo_lines[]", () => {
  const r = deriveCargoPayload([
    analyzedAttachment({
      type: "invoice",
      articles: [
        { description: "Pompe", hs_code: "8413", quantity: 3, total: 1500, currency: "EUR" },
        { description: "Tuyaux", hs_code: null, quantity: 10, total: 200, currency: "usd" },
      ],
    }),
  ]);
  assertEquals(r.cargo_lines.length, 2);
  assertEquals(r.cargo_lines[0].line_index, 1);
  assertEquals(r.cargo_lines[0].description, "Pompe");
  assertEquals(r.cargo_lines[0].hs_code, "8413");
  assertEquals(r.cargo_lines[0].pieces_count, 3);
  assertEquals(r.cargo_lines[0].value_number, 1500);
  assertEquals(r.cargo_lines[0].value_currency, "EUR");
  assertEquals(r.cargo_lines[0].status, "to_confirm");
  assertEquals(r.cargo_lines[1].line_index, 2);
  assertEquals(r.cargo_lines[1].value_currency, "USD");
  assertEquals(r.sources_used.length, 1);
});

Deno.test("2-O mapping — article totalement vide ignoré (avec warning)", () => {
  const r = deriveCargoPayload([
    analyzedAttachment({
      type: "invoice",
      articles: [
        { description: null, hs_code: null, quantity: null, total: null },
        { description: "Réel", quantity: 1, total: 5, currency: "XOF" },
      ],
    }),
  ]);
  assertEquals(r.cargo_lines.length, 1);
  assertEquals(r.cargo_lines[0].description, "Réel");
  assert(r.warnings.some((w) => w.includes("Article vide")));
});

Deno.test("2-O mapping — poids/volume appliqués si UNE seule ligne cargo", () => {
  const r = deriveCargoPayload([
    analyzedAttachment({
      type: "packing_list",
      poids_brut_kg: 1200,
      volume_cbm: 4.5,
      articles: [{ description: "Machine", quantity: 1, total: 9000, currency: "EUR" }],
    }),
  ]);
  assertEquals(r.cargo_lines.length, 1);
  assertEquals(r.cargo_lines[0].weight_kg, 1200);
  assertEquals(r.cargo_lines[0].volume_cbm, 4.5);
});

Deno.test("2-O mapping — PAS de répartition poids/volume si plusieurs lignes", () => {
  const r = deriveCargoPayload([
    analyzedAttachment({
      type: "packing_list",
      poids_brut_kg: 1200,
      volume_cbm: 4.5,
      articles: [
        { description: "A", quantity: 1, total: 100, currency: "EUR" },
        { description: "B", quantity: 2, total: 200, currency: "EUR" },
      ],
    }),
  ]);
  assertEquals(r.cargo_lines.length, 2);
  assertEquals(r.cargo_lines[0].weight_kg, null);
  assertEquals(r.cargo_lines[0].volume_cbm, null);
  assertEquals(r.cargo_lines[1].weight_kg, null);
  assert(r.warnings.some((w) => w.includes("non répartis")));
});

Deno.test("2-O mapping — containers globaux → unallocated_equipment", () => {
  const r = deriveCargoPayload([
    analyzedAttachment({
      type: "bill_of_lading",
      articles: [{ description: "Cargo", quantity: 1, total: 10, currency: "USD" }],
      containers: [
        { type: "40HC", quantity: 2 },
        { type: "20GP" },
        { number: "ABC", type: null },
      ],
    }),
  ]);
  assertEquals(r.unallocated_equipment.length, 2);
  assertEquals(r.unallocated_equipment[0].equipment_type, "40HC");
  assertEquals(r.unallocated_equipment[0].quantity, 2);
  assertEquals(r.unallocated_equipment[1].equipment_type, "20GP");
  assertEquals(r.unallocated_equipment[1].quantity, 1);
  assertEquals(r.unallocated_equipment[0].status, "to_confirm");
});

// ── deriveCore : orchestration ─────────────────────────────────────────────
Deno.test("2-O core — payload invalide (case_id) → 400 sans appel canonicalizer", async () => {
  let called = false;
  const resp = await deriveCore({ case_id: "nope" }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () => Promise.resolve([]),
    callCanonicalizer: () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(resp.status, 400);
  assertEquals(called, false);
});

Deno.test("2-O core — ownership refusé → 403", async () => {
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: () => Promise.resolve(false),
    loadAttachments: () => Promise.resolve([]),
    callCanonicalizer: okCanonicalizer(),
  });
  assertEquals(resp.status, 403);
});

Deno.test("2-O core — attachment non analysé → 400 sans appel canonicalizer", async () => {
  let called = false;
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () => Promise.resolve([{ id: "x", filename: "f.pdf", is_analyzed: false, extracted_data: null }]),
    callCanonicalizer: () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(resp.status, 400);
  assertEquals(called, false);
});

Deno.test("2-O core — extracted_data.type=error → 400 sans appel canonicalizer", async () => {
  let called = false;
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () => Promise.resolve([analyzedAttachment({ type: "error", message: "x" })]),
    callCanonicalizer: () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(resp.status, 400);
  assertEquals(called, false);
});

Deno.test("2-O core — aucune donnée cargo dérivable → 400", async () => {
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () => Promise.resolve([analyzedAttachment({ type: "logo" })]),
    callCanonicalizer: okCanonicalizer(),
  });
  assertEquals(resp.status, 400);
});

Deno.test("2-O core — canonicalizer appelé en dry_run UNIQUEMENT + Authorization original", async () => {
  let seenMode: unknown = null;
  let seenAuth: string | null = null;
  let seenCaseId: unknown = null;
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () =>
      Promise.resolve([
        analyzedAttachment({
          type: "invoice",
          articles: [{ description: "Pompe", quantity: 1, total: 100, currency: "EUR" }],
        }),
      ]),
    callCanonicalizer: (body, authHeader) => {
      seenMode = body.mode;
      seenAuth = authHeader;
      seenCaseId = body.case_id;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, mode: "dry_run", writer_payload: body.cargo_payload }), { status: 200 }),
      );
    },
  });
  assertEquals(seenMode, "dry_run");
  assertEquals(seenAuth, ORIGINAL_AUTH);
  assertEquals(seenCaseId, VALID_CASE);
  assertEquals(resp.status, 200);
  const out = await resp.json();
  assertEquals(out.ok, true);
  assertEquals(out.derived_payload.cargo_payload.cargo_lines.length, 1);
  assert(out.canonicalize_dry_run);
  assertEquals(out.canonicalize_dry_run.mode, "dry_run");
  assertEquals(out.sources_used.length, 1);
});

Deno.test("2-O core — canonicalizer dry_run 400 → ok:false / CANONICALIZER_VALIDATION_FAILED", async () => {
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () =>
      Promise.resolve([
        analyzedAttachment({ type: "invoice", articles: [{ description: "X", quantity: 1, total: 1, currency: "EUR" }] }),
      ]),
    callCanonicalizer: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: false, error: { code: "VALIDATION_FAILED", message: "bad" } }),
          { status: 400 },
        ),
      ),
  });
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "CANONICALIZER_VALIDATION_FAILED");
  assertEquals(body.canonicalize_status, 400);
  assert(body.canonicalize_dry_run);
  assert(Array.isArray(body.sources_used));
  assert(Array.isArray(body.warnings));
  assertEquals(body.correlation_id, CORR);
});

Deno.test("2-O core — défaillance canonicalizer → UPSTREAM_CANONICALIZER_ERROR (502)", async () => {
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () =>
      Promise.resolve([
        analyzedAttachment({ type: "invoice", articles: [{ description: "X", quantity: 1, total: 1, currency: "EUR" }] }),
      ]),
    callCanonicalizer: () => {
      throw new Error("réseau indisponible");
    },
  });
  assertEquals(resp.status, 502);
  const body = await resp.json();
  assertEquals(body.error.code, "UPSTREAM_CANONICALIZER_ERROR");
});

// ── Garde architecturale statique ──────────────────────────────────────────
Deno.test("2-O garde — pas de RPC, pas de service_role, pas d'appel direct writer", async () => {
  const src = await Deno.readTextFile(
    new URL("../derive-cargo-canonical-payload/index.ts", import.meta.url),
  );
  assertEquals(src.includes(".rpc("), false, "aucun appel RPC direct");
  assertEquals(src.includes("SUPABASE_SERVICE_ROLE_KEY"), false, "pas de service_role");
  assertEquals(
    src.includes("functions/v1/write-cargo-canonical"),
    false,
    "pas d'appel direct au writer (doit passer par le canonicalizer)",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2-Q — Dernier email entrant client comme source READ-ONLY additionnelle
// ════════════════════════════════════════════════════════════════════════════

/** Cherche un item d'équipement (type+quantité) dans toutes les lignes cargo. */
function findEquipment(
  cargoLines: Array<{ equipment: Array<{ equipment_type: string; quantity: number }> }>,
  type: string,
  quantity: number,
): boolean {
  return cargoLines.some((l) =>
    l.equipment.some((e) => e.equipment_type === type && e.quantity === quantity)
  );
}

// ── Helpers purs : parseVehicleFlatRackRevision ────────────────────────────
Deno.test("2-Q vfr — bus count + 40FR ⇒ inférence N × 40FR + warning", () => {
  const r = parseVehicleFlatRackRevision(
    "now the total bus count is 15 and the buses are transported in 40FR",
  );
  assertEquals(r.count, 15);
  assertEquals(r.flatRackForVehicles, true);
  assertEquals(r.inferred?.equipment_type, "40FR");
  assertEquals(r.inferred?.quantity, 15);
  assert(r.warnings.some((w) => w.includes("× 40FR") && /confirmation/i.test(w)));
});

Deno.test("2-Q vfr — 'buses increased to 15' + flat rack ⇒ 15 × 40FR", () => {
  const r = parseVehicleFlatRackRevision("buses increased to 15, all on flat rack");
  assertEquals(r.inferred?.quantity, 15);
  assertEquals(r.inferred?.equipment_type, "40FR");
});

Deno.test("2-Q vfr — buses en 40FR SANS compte ⇒ aucune quantité inventée + warning", () => {
  const r = parseVehicleFlatRackRevision("the buses are transported in 40FR");
  assertEquals(r.count, null);
  assertEquals(r.flatRackForVehicles, true);
  assertEquals(r.inferred, null);
  assert(r.warnings.some((w) => /no.*count|no quantity/i.test(w)));
});

Deno.test("2-Q vfr — '15 buses' SANS 40FR ⇒ pas d'inférence 40FR", () => {
  const r = parseVehicleFlatRackRevision("we will ship 15 buses next week");
  assertEquals(r.count, 15);
  assertEquals(r.flatRackForVehicles, false);
  assertEquals(r.inferred, null);
  assertEquals(r.warnings.length, 0);
});

// ── Helpers purs : parseAdditionalMedicalEquipmentContainers ───────────────
Deno.test("2-Q med — '1x 20' et '1x 40' ⇒ 20GP + 40GP, contexte médical", () => {
  const r = parseAdditionalMedicalEquipmentContainers(
    "additionally 1x 20 and 1x 40 container has been added for medical equipment non DGR",
  );
  assertEquals(r.medicalContext, true);
  const twenty = r.equipment.find((e) => e.equipment_type === "20GP");
  const forty = r.equipment.find((e) => e.equipment_type === "40GP");
  assertEquals(twenty?.quantity, 1);
  assertEquals(forty?.quantity, 1);
  assertEquals(twenty?.status, "to_confirm");
});

Deno.test("2-Q med — forme texte 'one additional 20 ft' / 'one 40 ft'", () => {
  const r = parseAdditionalMedicalEquipmentContainers(
    "one additional 20 ft and one 40 ft container",
  );
  assertEquals(r.equipment.find((e) => e.equipment_type === "20GP")?.quantity, 1);
  assertEquals(r.equipment.find((e) => e.equipment_type === "40GP")?.quantity, 1);
});

Deno.test("2-Q med — '40FR' ne doit PAS être lu comme conteneur 40GP", () => {
  const r = parseAdditionalMedicalEquipmentContainers("buses in 40FR");
  assertEquals(r.equipment.length, 0);
});

Deno.test("2-Q med — PAS de double comptage : '1x 20'' et 'one additional 20 ft' ⇒ 20GP=1", () => {
  const r = parseAdditionalMedicalEquipmentContainers(
    "additionally 1x 20' and 1x 40' container has been added and one additional 20 ft container & one 40 ft container (medical equipment) non DGR",
  );
  assertEquals(r.equipment.find((e) => e.equipment_type === "20GP")?.quantity, 1);
  assertEquals(r.equipment.find((e) => e.equipment_type === "40GP")?.quantity, 1);
});

// ── Pattern complet réaliste (review fix) ──────────────────────────────────
// Le signal flat-rack DOIT être explicite ("buses in 40FR") — un "40'" / "40 ft"
// seul ne suffit jamais à inférer du 40FR.
Deno.test("2-Q full — pattern complet : 40FR=15, 20GP=1, 40GP=1, sans double comptage", () => {
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-full",
    subject: null,
    body_text:
      "now the total bus count is 15 and buses in 40FR. Additionally 1x 20' and 1x 40' " +
      "container has been added. Bus is increase to 15 Buses and one additional 20 ft " +
      "container & one 40 ft container (medical equipment) non DGR items",
  });
  assert(findEquipment(r.cargo_lines, "40FR", 15), "15 × 40FR (bus)");
  assert(findEquipment(r.cargo_lines, "20GP", 1), "1 × 20GP (medical)");
  assert(findEquipment(r.cargo_lines, "40GP", 1), "1 × 40GP (medical)");
  // Anti double comptage : exactement un item 20GP et un item 40GP, quantité 1.
  const all = r.cargo_lines.flatMap((l) => l.equipment);
  assertEquals(all.filter((e) => e.equipment_type === "20GP").length, 1);
  assertEquals(all.filter((e) => e.equipment_type === "40GP").length, 1);
  assertEquals(all.find((e) => e.equipment_type === "20GP")?.quantity, 1);
  assertEquals(all.find((e) => e.equipment_type === "40GP")?.quantity, 1);
});

// Test NÉGATIF : "40 ft" seul (sans signal FR explicite) ne doit PAS inférer 40FR.
Deno.test("2-Q full — '40 ft' médical seul + bus count ⇒ AUCUN 40FR inféré (40GP possible)", () => {
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-neg",
    subject: null,
    body_text:
      "now the total bus count is 15 and one additional 40 ft container for medical equipment",
  });
  // Aucune inférence flat-rack : pas de signal FR explicite tié au véhicule.
  assert(
    r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")),
    "aucun 40FR ne doit être inféré",
  );
  // Le conteneur 40 pieds reste comptabilisable comme 40GP (contexte médical).
  assert(findEquipment(r.cargo_lines, "40GP", 1), "40GP possible (médical)");
});

// ── hasRevisionTerms / isSodatraEmail ──────────────────────────────────────
Deno.test("2-Q termes — révision détectée vs simple discussion", () => {
  assertEquals(hasRevisionTerms("now the total bus count is 15"), true);
  assertEquals(hasRevisionTerms("additionally 1x20 added"), true);
  assertEquals(hasRevisionTerms("thanks for the quote, looks good"), false);
});

Deno.test("2-Q sodatra — exclut les domaines sortants SODATRA", () => {
  assertEquals(isSodatraEmail("ops@sodatra.sn"), true);
  assertEquals(isSodatraEmail("sales@sodatra.com"), true);
  assertEquals(isSodatraEmail("client@example.com"), false);
  assertEquals(isSodatraEmail(""), false);
});

// ── deriveCargoPayloadFromLatestInboundEmail (pur) ─────────────────────────
Deno.test("2-Q test#4 — '1x20 et 1x40 medical equipment' ⇒ ligne médicale, pas de 40FR", () => {
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-med",
    subject: "additional containers",
    body_text: "additionally 1x20 and 1x40 container for medical equipment non DGR",
  });
  // Une ligne médicale dérivée (ou équipement non alloué) — ici contexte médical.
  const medical = r.cargo_lines.find((l) => l.description === "Medical equipment non-DGR");
  assert(medical, "ligne médicale attendue");
  assert(findEquipment(r.cargo_lines, "20GP", 1));
  assert(findEquipment(r.cargo_lines, "40GP", 1));
  // Aucune inférence 40FR bus.
  assertEquals(findEquipment(r.cargo_lines, "40FR", 1), false);
  assert(r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")));
  assertEquals(r.source_email_id, "email-med");
});

Deno.test("2-Q test#2 — 'buses in 40FR' sans compte ⇒ pas d'équipement véhicule inventé", () => {
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-2",
    subject: null,
    body_text: "the buses are transported in 40FR",
  });
  assertEquals(findEquipment(r.cargo_lines, "40FR", 1), false);
  // Aucune ligne véhicule dérivée (pas de quantité).
  assertEquals(r.cargo_lines.length, 0);
  assert(r.warnings.some((w) => /no.*count|no quantity/i.test(w)));
});

Deno.test("2-Q test#3 — '15 buses' sans 40FR ⇒ pas d'invention 40FR", () => {
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-3",
    subject: null,
    body_text: "we will ship 15 buses",
  });
  assert(r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")));
});

// ── deriveCore : intégration de la source email (test#1) ───────────────────
Deno.test("2-Q test#1 — deriveCore intègre la révision email (15 × 40FR + médical)", async () => {
  let seenMode: unknown = null;
  let seenAuth: string | null = null;
  let seenSource: Record<string, unknown> | null = null;

  const latestEmail = {
    id: "email-latest",
    subject: "Revised cargo",
    body_text:
      "Hello, now the total bus count is 15. The buses are transported in 40FR. " +
      "Additionally 1x 20 and 1x 40 container has been added for medical equipment non DGR.",
    sent_at: "2026-06-18T10:00:00Z",
    from_address: "client@example.com",
  };

  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () => Promise.resolve([]), // aucune source attachment
    loadLatestInboundEmail: () => Promise.resolve(latestEmail),
    callCanonicalizer: (body, authHeader) => {
      seenMode = body.mode;
      seenAuth = authHeader;
      seenSource = body.source as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, mode: "dry_run", writer_payload: body.cargo_payload }),
          { status: 200 },
        ),
      );
    },
  });

  // Canonicalizer appelé en dry_run UNIQUEMENT + Authorization original transmis.
  assertEquals(seenMode, "dry_run");
  assertEquals(seenAuth, ORIGINAL_AUTH);
  assertEquals(resp.status, 200);

  const out = await resp.json();
  assertEquals(out.ok, true);
  const lines = out.derived_payload.cargo_payload.cargo_lines;
  assert(lines.length >= 2, "au moins 2 lignes cargo");
  assert(findEquipment(lines, "40FR", 15), "ligne bus : 15 × 40FR");

  const medical = lines.find((l: { description: string | null }) =>
    l.description === "Medical equipment non-DGR"
  );
  assert(medical, "ligne médicale attendue");
  assert(findEquipment(lines, "20GP", 1), "médical : 1 × 20GP");
  assert(findEquipment(lines, "40GP", 1), "médical : 1 × 40GP");

  // Warning d'inférence explicite.
  assert(
    out.warnings.some((w: string) => w.includes("× 40FR") && /confirmation/i.test(w)),
    "warning 15 × 40FR / operator confirmation",
  );

  // source_email_id pointe vers le dernier email entrant.
  assertEquals(seenSource?.source_email_id, "email-latest");
});

Deno.test("2-Q merge — email sans terme de révision : warnings remontés mais cargo NON ajouté", async () => {
  let seenLines: unknown[] = [];
  const latestEmail = {
    id: "email-norev",
    subject: null,
    // contient 40FR + bus + compte MAIS aucun terme de révision (update/now/...)
    body_text: "for reference, 15 buses on 40FR",
    sent_at: "2026-06-18T10:00:00Z",
    from_address: "client@example.com",
  };
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () =>
      Promise.resolve([
        analyzedAttachment({ type: "invoice", articles: [{ description: "Pompe", quantity: 1, total: 100, currency: "EUR" }] }),
      ]),
    loadLatestInboundEmail: () => Promise.resolve(latestEmail),
    callCanonicalizer: (body) => {
      seenLines = (body.cargo_payload as { cargo_lines: unknown[] }).cargo_lines;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, mode: "dry_run" }), { status: 200 }),
      );
    },
  });
  assertEquals(resp.status, 200);
  // Seule la ligne attachment subsiste (pas d'ajout email, faute de terme de révision).
  assertEquals(seenLines.length, 1);
  const out = await resp.json();
  // Le warning d'inférence est tout de même remonté.
  assert(out.warnings.some((w: string) => w.includes("× 40FR")));
});

Deno.test("2-Q rétro-compat — deriveCore sans loadLatestInboundEmail fonctionne", async () => {
  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () =>
      Promise.resolve([
        analyzedAttachment({ type: "invoice", articles: [{ description: "X", quantity: 1, total: 1, currency: "EUR" }] }),
      ]),
    callCanonicalizer: okCanonicalizer(),
  });
  assertEquals(resp.status, 200);
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2-Q PATCH B — décodage base64 EN MÉMOIRE du body_text du dernier email
// ════════════════════════════════════════════════════════════════════════════

// body_text = payload MIME base64 brut. Décode (en mémoire) vers :
//   C0 - Public / Dear Cherif, ... total bus count is 15 ... 40'FR ...
//   ... one 40 ft container (medical equipment) non DGR items
const BASE64_EMAIL_BODY =
  "QzAgLSBQdWJsaWMKCkRlYXIgQ2hlcmlmLAoKV2UgZ290IGFuIHVwZGF0ZSBmcm9tIGN1c3RvbWVy" +
  "IHRoYXQgbm93IHRoZSB0b3RhbCBidXMgY291bnQgaXMgMTUKYW5kIGFkZGl0aW9uYWxseSAxeCAy" +
  "MCcgYW5kIDF4IDQwJyBjb250YWluZXIgaGFzIGJlZW4gYWRkZWQsIGNvdWxkCnlvdSBwbGVhc2Ug" +
  "dXBkYXRlIHRoZSByYXRlcyBhY2NvcmRpbmdseS4gQWRkaXRpb25hbGx5LCB3ZSBhcmUKdHJhbnNw" +
  "b3J0aW5nIGJ1c2VzIGluIDQwJ0ZSIChDYXJyaWVyIC0gQ01BIENHTSkuCgpCdXMgaXMgaW5jcmVh" +
  "c2UgdG8gMTUgQnVzZXMgYW5kIG9uZSBhZGRpdGlvbmFsIDIwIGZ0IGNvbnRhaW5lciAmCm9uZSA0" +
  "MCBmdCBjb250YWluZXIgKG1lZGljYWwgZXF1aXBtZW50KSBub24gREdSIGl0ZW1zCg==";

// base64 neutre (>80 chars, charset valide) décodant en prose sans indicateur
// cargo/email fort → ne doit PAS être décodé (fallback).
const BASE64_NEUTRAL =
  "VGhlIHF1aWNrIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZy4gTG9yZW0gaXBzdW0g" +
  "ZG9sb3Igc2l0IGFtZXQsIHRoZSB3ZWF0aGVyIHRvZGF5IGlzIG5pY2UgYW5kIHN1bm55IGhlcmUu";

// Test #1 — helper pur décode un body base64 réaliste.
Deno.test("2-Q B64 #1 — normalizeEmailTextForParsing décode un body base64 réaliste", () => {
  const r = normalizeEmailTextForParsing(null, BASE64_EMAIL_BODY);
  assertEquals(r.decoded, true);
  assert(r.text.includes("total bus count is 15"), "texte décodé contient le compte bus");
  assert(r.text.includes("40'FR"), "texte décodé contient 40'FR");
  assert(r.text.includes("medical equipment"), "texte décodé contient medical equipment");
  assert(r.warning !== null && /base64-decoded in memory/i.test(r.warning));
});

// Test #2 — dérivation cargo depuis le body base64.
Deno.test("2-Q B64 #2 — deriveCargoPayloadFromLatestInboundEmail décode et dérive le cargo", () => {
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-b64",
    subject: null,
    body_text: BASE64_EMAIL_BODY,
  });
  // 15 × 40FR (bus) + ligne médicale 20GP=1 / 40GP=1.
  assert(findEquipment(r.cargo_lines, "40FR", 15), "15 × 40FR (bus)");
  assert(findEquipment(r.cargo_lines, "20GP", 1), "1 × 20GP (medical)");
  assert(findEquipment(r.cargo_lines, "40GP", 1), "1 × 40GP (medical)");
  // Anti double comptage : exactement un item 20GP et un item 40GP.
  const all = r.cargo_lines.flatMap((l) => l.equipment);
  assertEquals(all.filter((e) => e.equipment_type === "20GP").length, 1);
  assertEquals(all.filter((e) => e.equipment_type === "40GP").length, 1);
  // Warnings : décodage base64 + confirmation opérateur 15 × 40FR.
  assert(
    r.warnings.some((w) => /base64-decoded in memory/i.test(w)),
    "warning décodage base64 en mémoire",
  );
  assert(
    r.warnings.some((w) => w.includes("× 40FR") && /confirmation/i.test(w)),
    "warning 15 × 40FR / operator confirmation",
  );
});

// Test #3 — un body déjà lisible ne doit PAS être décodé (même résultat cargo).
Deno.test("2-Q B64 #3 — body lisible non décodé, même cargo qu'avant", () => {
  const readableBody =
    "now the total bus count is 15 and buses in 40FR. Additionally 1x 20' and 1x 40' " +
    "container has been added. Bus is increase to 15 Buses and one additional 20 ft " +
    "container & one 40 ft container (medical equipment) non DGR items";
  const norm = normalizeEmailTextForParsing(null, readableBody);
  assertEquals(norm.decoded, false);
  assertEquals(norm.warning, null);

  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-readable",
    subject: null,
    body_text: readableBody,
  });
  assert(findEquipment(r.cargo_lines, "40FR", 15), "15 × 40FR");
  assert(findEquipment(r.cargo_lines, "20GP", 1), "1 × 20GP");
  assert(findEquipment(r.cargo_lines, "40GP", 1), "1 × 40GP");
  // Aucun warning de décodage (rien n'a été décodé).
  assertEquals(r.warnings.some((w) => /base64-decoded/i.test(w)), false);
});

// Test #4 — chaîne base64-like mais non email/cargo : pas de throw, pas de décodage.
Deno.test("2-Q B64 #4 — base64 neutre : fallback decoded=false, aucun cargo inventé", () => {
  const norm = normalizeEmailTextForParsing(null, BASE64_NEUTRAL);
  assertEquals(norm.decoded, false);
  assertEquals(norm.warning, null);

  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-neutral",
    subject: null,
    body_text: BASE64_NEUTRAL,
  });
  assertEquals(r.cargo_lines.length, 0);
  assertEquals(r.unallocated_equipment.length, 0);
  assertEquals(r.warnings.some((w) => /base64-decoded/i.test(w)), false);
});

// Test #5 — '15 buses + one additional 40 ft medical equipment' n'infère PAS 40FR.
Deno.test("2-Q B64 #5 — plain '40 ft medical' (post-normalisation) n'infère pas 40FR", () => {
  const body = "15 buses and one additional 40 ft container for medical equipment non DGR";
  const norm = normalizeEmailTextForParsing(null, body);
  assertEquals(norm.decoded, false); // déjà lisible (medical equipment / non dgr)
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-plain40",
    subject: null,
    body_text: body,
  });
  assert(
    r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")),
    "aucun 40FR inféré depuis un simple '40 ft'",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2-Q PATCH C — extraction MIME/multipart EN MÉMOIRE du body_text
// ════════════════════════════════════════════════════════════════════════════

// text/plain base64 décodant vers le texte cargo (Dear Cherif / total bus count
// is 15 / 1x 20' / 1x 40' / buses in 40'FR / medical equipment / non DGR).
const MIME_PLAIN_B64 =
  "RGVhciBDaGVyaWYsCgpXZSBnb3QgYW4gdXBkYXRlIGZyb20gY3VzdG9tZXIgdGhhdCBub3cgdGhl" +
  "IHRvdGFsIGJ1cyBjb3VudCBpcyAxNQphbmQgYWRkaXRpb25hbGx5IDF4IDIwJyBhbmQgMXggNDAn" +
  "IGNvbnRhaW5lciBoYXMgYmVlbiBhZGRlZCwgY291bGQKeW91IHBsZWFzZSB1cGRhdGUgdGhlIHJh" +
  "dGVzIGFjY29yZGluZ2x5LiBBZGRpdGlvbmFsbHksIHdlIGFyZQp0cmFuc3BvcnRpbmcgYnVzZXMg" +
  "aW4gNDAnRlIgKENhcnJpZXIgLSBDTUEgQ0dNKS4KCkJ1cyBpcyBpbmNyZWFzZSB0byAxNSBCdXNl" +
  "cyBhbmQgb25lIGFkZGl0aW9uYWwgMjAgZnQgY29udGFpbmVyICYKb25lIDQwIGZ0IGNvbnRhaW5l" +
  "ciAobWVkaWNhbCBlcXVpcG1lbnQpIG5vbiBER1IgaXRlbXMK";

// text/html base64 décodant vers le même contenu cargo enveloppé en HTML.
const MIME_HTML_B64 =
  "PGh0bWw+PGJvZHk+PHA+RGVhciBDaGVyaWYsPC9wPjxwPm5vdyB0aGUgdG90YWwgYnVzIGNvdW50" +
  "IGlzIDE1IGFuZCBidXNlcyBpbiA0MCdGUi48L3A+PHA+QWRkaXRpb25hbGx5IDF4IDIwJyBhbmQg" +
  "MXggNDAnIGNvbnRhaW5lciBoYXMgYmVlbiBhZGRlZC4gQnVzIGlzIGluY3JlYXNlIHRvIDE1IEJ1" +
  "c2VzIGFuZCBvbmUgYWRkaXRpb25hbCAyMCBmdCBjb250YWluZXIgJiBvbmUgNDAgZnQgY29udGFp" +
  "bmVyIChtZWRpY2FsIGVxdWlwbWVudCkgbm9uIERHUiBpdGVtczwvcD48L2JvZHk+PC9odG1sPg==";

// base64 neutre (prose sans indicateur cargo/email fort).
const MIME_NEUTRAL_B64 =
  "VGhlIHF1aWNrIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZy4gTG9yZW0gaXBzdW0g" +
  "ZG9sb3Igc2l0IGFtZXQsIHRoZSB3ZWF0aGVyIHRvZGF5IGlzIG5pY2UgYW5kIHN1bm55IGhlcmUu";

function buildMimeMultipart(plainB64: string | null, htmlB64: string | null): string {
  const lines = ['Content-Type: multipart/alternative; boundary="BOUND123"', ""];
  if (plainB64 !== null) {
    lines.push(
      "--BOUND123",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      plainB64,
    );
  }
  if (htmlB64 !== null) {
    lines.push(
      "--BOUND123",
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      htmlB64,
    );
  }
  lines.push("--BOUND123--", "");
  return lines.join("\n");
}

// Test #1 — helper MIME extrait la partie text/plain base64 d'un multipart.
Deno.test("2-Q MIME #1 — extractPlainTextFromMime décode la partie text/plain base64", () => {
  const mime = buildMimeMultipart(MIME_PLAIN_B64, MIME_HTML_B64);
  const out = extractPlainTextFromMime(mime);
  assert(out.includes("Dear Cherif"), "Dear Cherif");
  assert(out.includes("total bus count is 15"), "total bus count is 15");
  assert(out.includes("1x 20'"), "1x 20'");
  assert(out.includes("1x 40'"), "1x 40'");
  assert(out.includes("buses in 40'FR"), "buses in 40'FR");
  assert(out.includes("medical equipment"), "medical equipment");
  assert(out.includes("non DGR"), "non DGR");
});

// Test #2 — dérivation cargo depuis un body MIME multipart.
Deno.test("2-Q MIME #2 — deriveCargoPayloadFromLatestInboundEmail décode le MIME et dérive le cargo", () => {
  const mime = buildMimeMultipart(MIME_PLAIN_B64, MIME_HTML_B64);
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-mime",
    subject: null,
    body_text: mime,
  });
  assert(findEquipment(r.cargo_lines, "40FR", 15), "15 × 40FR (bus)");
  assert(findEquipment(r.cargo_lines, "20GP", 1), "1 × 20GP (medical)");
  assert(findEquipment(r.cargo_lines, "40GP", 1), "1 × 40GP (medical)");
  // Anti double comptage.
  const all = r.cargo_lines.flatMap((l) => l.equipment);
  assertEquals(all.filter((e) => e.equipment_type === "20GP").length, 1);
  assertEquals(all.filter((e) => e.equipment_type === "40GP").length, 1);
  // Warnings : MIME-decoded + confirmation opérateur 15 × 40FR.
  assert(
    r.warnings.some((w) => /MIME-decoded in memory/i.test(w)),
    "warning MIME-decoded in memory",
  );
  assert(
    r.warnings.some((w) => w.includes("× 40FR") && /confirmation/i.test(w)),
    "warning 15 × 40FR / operator confirmation",
  );
});

// Test #3 — un body base64 « nu » conserve le comportement Patch B (warning base64).
Deno.test("2-Q MIME #3 — base64 simple : fallback Patch B conservé (warning base64-decoded)", () => {
  const norm = normalizeEmailTextForParsing(null, BASE64_EMAIL_BODY);
  assertEquals(norm.decoded, true);
  assert(
    norm.warning !== null && /base64-decoded in memory/i.test(norm.warning),
    "warning base64-decoded (pas MIME)",
  );
  assertEquals(/MIME-decoded/i.test(norm.warning ?? ""), false);
});

// Test #4 — un body déjà lisible n'est ni MIME ni base64 décodé.
Deno.test("2-Q MIME #4 — body lisible : ni MIME ni base64 décodé", () => {
  const readableBody =
    "Hello, now the total bus count is 15 and buses in 40FR. Additionally 1x 20' " +
    "and 1x 40' container for medical equipment non DGR.";
  const norm = normalizeEmailTextForParsing(null, readableBody);
  assertEquals(norm.decoded, false);
  assertEquals(norm.warning, null);
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-readable-mime",
    subject: null,
    body_text: readableBody,
  });
  assert(findEquipment(r.cargo_lines, "40FR", 15));
  assertEquals(r.warnings.some((w) => /decoded in memory/i.test(w)), false);
});

// Test #5 — MIME html-only : HTML strippé, cargo dérivé.
Deno.test("2-Q MIME #5 — MIME html-only : tags strippés, cargo dérivé", () => {
  const mime = buildMimeMultipart(null, MIME_HTML_B64);
  const norm = normalizeEmailTextForParsing(null, mime);
  assertEquals(norm.decoded, true);
  assert(norm.warning !== null && /MIME-decoded in memory/i.test(norm.warning));
  // Aucune balise HTML résiduelle dans le texte extrait.
  assertEquals(/<[a-z/][^>]*>/i.test(norm.text), false, "pas de balise HTML résiduelle");

  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-html",
    subject: null,
    body_text: mime,
  });
  assert(findEquipment(r.cargo_lines, "40FR", 15), "15 × 40FR");
  assert(findEquipment(r.cargo_lines, "20GP", 1), "1 × 20GP");
  assert(findEquipment(r.cargo_lines, "40GP", 1), "1 × 40GP");
});

// Test #6 — MIME/base64-like sans indicateur : pas de throw, pas de cargo inventé.
Deno.test("2-Q MIME #6 — MIME neutre : aucun cargo inventé, aucun 40FR", () => {
  const mime = buildMimeMultipart(MIME_NEUTRAL_B64, null);
  const norm = normalizeEmailTextForParsing(null, mime);
  // Rien d'exploitable : pas d'indicateur fort → non retenu (decoded=false).
  assertEquals(norm.decoded, false);
  assertEquals(norm.warning, null);
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-mime-neutral",
    subject: null,
    body_text: mime,
  });
  assertEquals(r.cargo_lines.length, 0);
  assertEquals(r.unallocated_equipment.length, 0);
  assert(
    r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")),
    "aucun 40FR inféré",
  );
});

// Test #7 — plain '15 buses + one additional 40 ft container medical' → pas de 40FR.
Deno.test("2-Q MIME #7 — plain '40 ft medical' : pas de 40FR, 40GP possible (médical)", () => {
  const body =
    "15 buses and one additional 40 ft container for medical equipment non DGR";
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-plain40-mime",
    subject: null,
    body_text: body,
  });
  assert(
    r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")),
    "aucun 40FR inféré depuis un simple '40 ft'",
  );
  assert(findEquipment(r.cargo_lines, "40GP", 1), "40GP possible (contexte médical)");
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2-Q PATCH D — déclenchement relâché de l'extraction MIME/encodée
// ════════════════════════════════════════════════════════════════════════════

// Corps base64 long (cargo) suivi d'un artefact de séparateur non-base64.
// Pas de marqueur MIME explicite ⇒ looksLikeMime échoue, et le fallback base64
// « nu » échoue ("-"/"_" hors charset) : sans Patch D l'extraction n'était jamais
// tentée.
const BASE64_ARTIFACT_BODY = BASE64_EMAIL_BODY + "\n--___";

// Corps base64-ish neutre LONG (> 200 chars) + artefact, sans indicateur cargo.
const BASE64_NEUTRAL_LONG_ARTIFACT =
  BASE64_NEUTRAL + BASE64_NEUTRAL + BASE64_NEUTRAL + "\n--___";

// Test #1 — normalize décode un body base64 long avec artefact de séparateur.
Deno.test("2-Q D #1 — artefact '--___' : body décodé en mémoire (warning + texte lisible)", () => {
  const r = normalizeEmailTextForParsing(null, BASE64_ARTIFACT_BODY);
  assertEquals(r.decoded, true);
  assert(
    r.warning !== null && /(MIME|base64)-decoded in memory/i.test(r.warning),
    "warning decoded in memory",
  );
  assert(r.text.includes("total bus count is 15"), "total bus count is 15");
  assert(r.text.includes("40'FR"), "40'FR");
  assert(r.text.includes("medical equipment"), "medical equipment");
});

// Test #2 — dérivation cargo depuis le body avec artefact.
Deno.test("2-Q D #2 — artefact '--___' : derive produit 40FR=15 + médical 20GP/40GP", () => {
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-artifact",
    subject: null,
    body_text: BASE64_ARTIFACT_BODY,
  });
  assert(findEquipment(r.cargo_lines, "40FR", 15), "15 × 40FR (bus)");
  assert(findEquipment(r.cargo_lines, "20GP", 1), "1 × 20GP (medical)");
  assert(findEquipment(r.cargo_lines, "40GP", 1), "1 × 40GP (medical)");
  // Anti double comptage.
  const all = r.cargo_lines.flatMap((l) => l.equipment);
  assertEquals(all.filter((e) => e.equipment_type === "20GP").length, 1);
  assertEquals(all.filter((e) => e.equipment_type === "40GP").length, 1);
  assert(
    r.warnings.some((w) => /decoded in memory/i.test(w)),
    "warning decoded in memory",
  );
  assert(
    r.warnings.some((w) => w.includes("× 40FR") && /confirmation/i.test(w)),
    "warning 15 × 40FR / operator confirmation",
  );
});

// Test #3 — body base64-ish neutre long + artefact, sans indicateur cargo/email.
Deno.test("2-Q D #3 — artefact neutre : aucun décodage accepté, aucun cargo inventé", () => {
  const norm = normalizeEmailTextForParsing(null, BASE64_NEUTRAL_LONG_ARTIFACT);
  assertEquals(norm.decoded, false);
  assertEquals(norm.warning, null);
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-artifact-neutral",
    subject: null,
    body_text: BASE64_NEUTRAL_LONG_ARTIFACT,
  });
  assertEquals(r.cargo_lines.length, 0);
  assertEquals(r.unallocated_equipment.length, 0);
  assert(
    r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")),
    "aucun 40FR inféré",
  );
});

// Test #7 (Patch D) — plain '40 ft container medical' n'infère toujours pas 40FR.
Deno.test("2-Q D #7 — plain '40 ft medical' : toujours pas de 40FR", () => {
  const r = deriveCargoPayloadFromLatestInboundEmail({
    id: "email-plain40-d",
    subject: null,
    body_text: "15 buses and one additional 40 ft container for medical equipment non DGR",
  });
  assert(
    r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")),
    "aucun 40FR inféré depuis un simple '40 ft'",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2-Q PATCH E — enrichissement specs bus depuis le THREAD entrant complet
// ════════════════════════════════════════════════════════════════════════════
//
// Règle métier : le DERNIER email pilote la quantité finale (15) et l'équipement
// (40FR + médical). Les emails ANTÉRIEURS ne fournissent QUE des spécifications
// stables (modèle / dimensions / poids unitaire). La quantité antérieure (5)
// n'écrase JAMAIS la quantité finale (15).
//
// Schéma cargo canonique : weight_kg et volume_cbm sont supportés ; aucun champ
// "dimensions" structuré n'existe → dims/modèle bruts uniquement en warning.

/** Première ligne cargo contenant un équipement du type donné. */
function findLineWithEquipment(
  lines: Array<{ equipment: Array<{ equipment_type: string }> }>,
  type: string,
) {
  return lines.find((l) => l.equipment.some((e) => e.equipment_type === type));
}

// Dernier email entrant (révision) : compte final 15, 40FR, médical 1×20 + 1×40.
const LATEST_REVISION_EMAIL = {
  id: "email-latest-e",
  subject: "Revised cargo",
  body_text:
    "Hello, now the total bus count is 15. The buses are transported in 40FR. " +
    "Additionally 1x 20 and 1x 40 container has been added for medical equipment non DGR.",
  sent_at: "2026-06-18T10:00:00Z",
  from_address: "client@example.com",
};

// Email antérieur : 5 bus + dimensions + GVW explicites (specs stables).
const EARLIER_SPECS_EMAIL = {
  id: "email-earlier-e",
  subject: "Initial request",
  body_text:
    "We plan to ship 5 Hyundai Universe Passenger Bus. " +
    "Each bus dimensions 12000 x 2500 x 3500 mm, GVW 18000 kg.",
  sent_at: "2026-06-10T09:00:00Z",
  from_address: "client@example.com",
};

// ── parseBusSpecsFromEmailText (pur) ───────────────────────────────────────
Deno.test("2-Q E — parseBusSpecsFromEmailText : dims + poids explicites liés au bus", () => {
  const s = parseBusSpecsFromEmailText(EARLIER_SPECS_EMAIL.body_text);
  assertEquals(s.unitWeightKg, 18000);
  assert(s.dimsM !== null, "dimensions parsées");
  assertEquals(s.dimsM?.l, 12); // 12000 mm → 12 m
  assertEquals(s.dimsM?.w, 2.5); // 2500 mm → 2.5 m
  assertEquals(s.dimsM?.h, 3.5); // 3500 mm → 3.5 m
  assert((s.model ?? "").includes("Hyundai"), "modèle documentaire capturé");
});

Deno.test("2-Q E — parseBusSpecsFromEmailText : dims de conteneur SANS contexte bus ⇒ rien", () => {
  const s = parseBusSpecsFromEmailText(
    "Container internal dimensions 12000 x 2350 x 2390 mm, payload 28000 kg.",
  );
  assertEquals(s.dimsM, null);
  assertEquals(s.unitWeightKg, null);
});

// ── findMostRelevantBusSpecsFromThread (pur) ───────────────────────────────
Deno.test("2-Q E — findMostRelevantBusSpecsFromThread : spec unique retenue", () => {
  const { spec, warnings } = findMostRelevantBusSpecsFromThread([EARLIER_SPECS_EMAIL]);
  assert(spec !== null, "spec trouvée");
  assertEquals(spec?.unitWeightKg, 18000);
  assertEquals(spec?.dimsM?.l, 12);
  assertEquals(spec?.sourceEmailId, "email-earlier-e");
  assertEquals(warnings.length, 0);
});

Deno.test("2-Q E — findMostRelevantBusSpecsFromThread : poids en CONFLIT ⇒ non propagé + warning", () => {
  const a = { ...EARLIER_SPECS_EMAIL, id: "e-a", body_text: "5 Hyundai buses, GVW 18000 kg" };
  const b = { ...EARLIER_SPECS_EMAIL, id: "e-b", body_text: "note: buses GVW 16000 kg" };
  const { spec, warnings } = findMostRelevantBusSpecsFromThread([a, b]);
  assertEquals(spec, null, "aucune spec propagée en cas de conflit pur");
  assert(
    warnings.some((w) => /conflicting bus unit weight/i.test(w)),
    "warning de conflit de poids",
  );
});

// ── deriveCargoPayloadFromInboundEmailThread (pur) ─────────────────────────
// Test #1 — fusion thread : 15 conservé, 40FR=15, médical, bus enrichi.
Deno.test("2-Q E #1 — thread complet : 15 × 40FR + médical + bus enrichi (poids/volume)", () => {
  const r = deriveCargoPayloadFromInboundEmailThread([
    EARLIER_SPECS_EMAIL,
    LATEST_REVISION_EMAIL,
  ]);
  // Quantité finale pilotée par le dernier email : 15 (jamais 5).
  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assert(busLine, "ligne bus présente");
  assertEquals(busLine?.pieces_count, 15, "pieces_count final = 15 (pas 5)");
  assertEquals(busLine?.status, "to_confirm");
  assert(
    busLine?.equipment.some((e) => e.equipment_type === "40FR" && e.quantity === 15),
    "40FR quantité 15",
  );
  // Enrichissement (champs schéma supportés uniquement) :
  // weight_kg = 18000 × 15 = 270000 ; volume_cbm = 12×2.5×3.5×15 = 1575.
  assertEquals(busLine?.weight_kg, 270000, "poids total = poids unitaire × 15");
  assertEquals(busLine?.volume_cbm, 1575, "volume = L×W×H × 15");
  // Ligne médicale 1×20GP + 1×40GP.
  const medical = r.cargo_lines.find((l) => l.description === "Medical equipment non-DGR");
  assert(medical, "ligne médicale présente");
  assert(findEquipment(r.cargo_lines, "20GP", 1), "médical 1 × 20GP");
  assert(findEquipment(r.cargo_lines, "40GP", 1), "médical 1 × 40GP");
  // Warning de propagation + confirmation opérateur.
  assert(
    r.warnings.some((w) =>
      /propagated from earlier client email/i.test(w) && /confirmation required/i.test(w)
    ),
    "warning de propagation specs + confirmation opérateur",
  );
});

// Test #2 — aucune spec antérieure : comportement Patch D inchangé.
Deno.test("2-Q E #2 — dernier email seul (pas de specs antérieures) : Patch D inchangé", () => {
  const r = deriveCargoPayloadFromInboundEmailThread([LATEST_REVISION_EMAIL]);
  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assert(busLine, "ligne bus présente");
  assertEquals(busLine?.pieces_count, 15);
  // Aucune valeur enrichie (pas de specs).
  assertEquals(busLine?.weight_kg, null);
  assertEquals(busLine?.volume_cbm, null);
  assertEquals(
    r.warnings.some((w) => /propagated from earlier client email/i.test(w)),
    false,
    "aucun warning de propagation sans specs antérieures",
  );
});

// Test #3 — specs antérieures en conflit : pas d'enrichissement silencieux.
Deno.test("2-Q E #3 — specs antérieures en conflit : bus NON enrichi + warning conflit", () => {
  const a = {
    ...EARLIER_SPECS_EMAIL,
    id: "e-conf-a",
    body_text: "5 Hyundai buses, GVW 18000 kg",
    sent_at: "2026-06-09T09:00:00Z",
  };
  const b = {
    ...EARLIER_SPECS_EMAIL,
    id: "e-conf-b",
    body_text: "correction: buses GVW 16000 kg",
    sent_at: "2026-06-10T09:00:00Z",
  };
  const r = deriveCargoPayloadFromInboundEmailThread([a, b, LATEST_REVISION_EMAIL]);
  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assert(busLine, "ligne bus présente");
  assertEquals(busLine?.pieces_count, 15, "quantité finale toujours 15");
  assertEquals(busLine?.weight_kg, null, "poids non propagé en cas de conflit");
  assert(
    r.warnings.some((w) => /conflicting bus unit weight/i.test(w)),
    "warning de conflit de poids",
  );
});

// Test #4 — email antérieur quantité 5 SANS dims/poids : aucune surcharge, aucun enrichissement.
Deno.test("2-Q E #4 — antérieur '5 buses' sans specs : 15 conservé, aucun enrichissement", () => {
  const earlierNoSpecs = {
    ...EARLIER_SPECS_EMAIL,
    id: "e-nospecs",
    body_text: "We will ship 5 buses next week, please advise.",
  };
  const r = deriveCargoPayloadFromInboundEmailThread([earlierNoSpecs, LATEST_REVISION_EMAIL]);
  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assert(busLine, "ligne bus présente");
  assertEquals(busLine?.pieces_count, 15, "quantité finale 15 (pas 5)");
  assertEquals(busLine?.weight_kg, null);
  assertEquals(busLine?.volume_cbm, null);
  assertEquals(
    r.warnings.some((w) => /propagated from earlier client email/i.test(w)),
    false,
  );
});

// Test #5 — plain '40 ft medical' au niveau thread : toujours pas de 40FR inféré.
Deno.test("2-Q E #5 — thread : plain '40 ft medical' n'infère pas de 40FR", () => {
  const r = deriveCargoPayloadFromInboundEmailThread([
    {
      id: "e-plain40",
      subject: null,
      body_text:
        "now 15 buses and one additional 40 ft container for medical equipment non DGR",
      sent_at: "2026-06-18T10:00:00Z",
      from_address: "client@example.com",
    },
  ]);
  assert(
    r.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")),
    "aucun 40FR inféré depuis un simple '40 ft'",
  );
});

// Test #6 — deriveCore intègre le thread (15 × 40FR + médical + enrichissement) en dry_run.
Deno.test("2-Q E #6 — deriveCore via loadInboundEmails : enrichissement bus en dry_run", async () => {
  let seenMode: unknown = null;
  let seenSource: Record<string, unknown> | null = null;
  let seenLines: Array<{
    equipment: Array<{ equipment_type: string; quantity: number }>;
    weight_kg: number | null;
    volume_cbm: number | null;
    pieces_count: number | null;
  }> = [];

  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () => Promise.resolve([]),
    loadInboundEmails: () => Promise.resolve([EARLIER_SPECS_EMAIL, LATEST_REVISION_EMAIL]),
    callCanonicalizer: (body) => {
      seenMode = body.mode;
      seenSource = body.source as Record<string, unknown>;
      seenLines = (body.cargo_payload as { cargo_lines: typeof seenLines }).cargo_lines;
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, mode: "dry_run", writer_payload: body.cargo_payload }),
          { status: 200 },
        ),
      );
    },
  });

  assertEquals(seenMode, "dry_run");
  assertEquals(resp.status, 200);

  const busLine = findLineWithEquipment(seenLines, "40FR");
  assert(busLine, "ligne bus présente dans le payload dry_run");
  assertEquals(busLine?.pieces_count, 15);
  assertEquals(busLine?.weight_kg, 270000);
  assertEquals(busLine?.volume_cbm, 1575);
  assert(findEquipment(seenLines, "40FR", 15), "40FR × 15");
  assert(findEquipment(seenLines, "20GP", 1), "médical 1 × 20GP");
  assert(findEquipment(seenLines, "40GP", 1), "médical 1 × 40GP");
  // source_email_id pointe vers le dernier email (révision finale).
  assertEquals(seenSource?.source_email_id, "email-latest-e");

  const out = await resp.json();
  assertEquals(out.ok, true);
  assert(
    out.warnings.some((w: string) => /propagated from earlier client email/i.test(w)),
    "warning de propagation specs remonté",
  );
});

// Test #7 — FORMAT EMAIL CLIENT RÉALISTE (premier email Hyundai, structure
// étiquetée multi-lignes : Quantity / Length / Width / Height / GVW per unit).
// La quantité antérieure (5) ne doit JAMAIS écraser la quantité finale (15).
Deno.test("2-Q E #7 — email client réaliste (Hyundai) : 5 n'écrase pas 15, enrichissement exact", () => {
  const earlierRealEmail = {
    id: "email-hyundai-real",
    subject: "RFQ - bus shipment",
    body_text: [
      "Hyundai Universe Passenger Bus",
      "Quantity: 5",
      "Length: 12,030 mm",
      "Width: 2,495 mm",
      "Height: 3,385 mm",
      "GVW approx.: 12,320 kg per unit",
    ].join("\n"),
    sent_at: "2026-06-08T08:00:00Z",
    from_address: "client@example.com",
  };

  // Specs parsées (helper pur) — valeurs explicites uniquement.
  const specs = parseBusSpecsFromEmailText(earlierRealEmail.body_text);
  assertEquals(specs.unitWeightKg, 12320, "poids unitaire 12320 kg (GVW per unit)");
  assert(specs.dimsM !== null, "dimensions parsées");
  assertEquals(specs.dimsM?.l, 12.03, "L = 12.03 m (12,030 mm)");
  assertEquals(specs.dimsM?.w, 2.495, "W = 2.495 m (2,495 mm)");
  assertEquals(specs.dimsM?.h, 3.385, "H = 3.385 m (3,385 mm)");

  // Fusion thread : dernier email (révision) pilote la quantité finale = 15.
  const r = deriveCargoPayloadFromInboundEmailThread([
    earlierRealEmail,
    LATEST_REVISION_EMAIL,
  ]);

  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assert(busLine, "ligne bus présente");
  // Quantité finale : 15 (jamais 5).
  assertEquals(busLine?.pieces_count, 15, "pieces_count = 15 (pas 5)");
  assertEquals(busLine?.status, "to_confirm", "statut reste to_confirm");
  assert(
    busLine?.equipment.some((e) => e.equipment_type === "40FR" && e.quantity === 15),
    "40FR quantité 15",
  );
  // Enrichissement (champs schéma supportés) :
  // weight_kg = 12320 × 15 = 184800 ; volume_cbm = 12.03×2.495×3.385×15 = 1524.004.
  assertEquals(busLine?.weight_kg, 184800, "poids total = 12320 × 15");
  assertEquals(busLine?.volume_cbm, 1524.004, "volume = L×W×H × 15 (round3)");

  // Ligne médicale inchangée : 1×20GP + 1×40GP, et AUCUN 40FR sur le médical
  // (plain '40 ft medical' n'infère pas 40FR).
  const medical = r.cargo_lines.find((l) => l.description === "Medical equipment non-DGR");
  assert(medical, "ligne médicale présente");
  assertEquals(
    medical?.equipment.every((e) => e.equipment_type !== "40FR"),
    true,
    "aucun 40FR sur la ligne médicale",
  );
  assert(findEquipment(r.cargo_lines, "20GP", 1), "médical 1 × 20GP");
  assert(findEquipment(r.cargo_lines, "40GP", 1), "médical 1 × 40GP");

  // Warning de propagation + confirmation opérateur.
  assert(
    r.warnings.some((w) =>
      /propagated from earlier client email/i.test(w) && /confirmation required/i.test(w)
    ),
    "warning de propagation specs + confirmation opérateur",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2-Q PATCH F — enrichissement specs bus depuis les ATTACHMENTS analysés
// ════════════════════════════════════════════════════════════════════════════
//
// Runtime : 1 seul email dans le thread, specs bus ABSENTES de body_text mais
// présentes dans email_attachments.extracted_text (PDF analysé). Le dernier
// email fixe la quantité finale (15) ; la quantité documentaire de l'attachment
// (5) ne doit JAMAIS écraser pieces_count.

// Texte extrait réaliste du PDF "Hyundai Universe Passenger Bus.pdf".
const ATTACHMENT_BUS_SPEC_TEXT = [
  "Commodity - Buses / Quantity - 5",
  "Make/Model: Hyundai Universe Passenger Bus",
  "Length:12,030 mm / Width : 2,495 mm / Height : 3,385 mm",
  "GVW (approx.): 12,320 kg per unit",
].join("\n");

const BUS_SPEC_PDF = {
  id: "att-hyundai-pdf",
  filename: "Hyundai Universe Passenger Bus.pdf",
  content_type: "application/pdf",
  is_analyzed: true,
  // extracted_data non-null/non-error pour passer la gate, sans articles.
  extracted_data: { type: "specification" },
  extracted_text: ATTACHMENT_BUS_SPEC_TEXT,
};

// Test #1 — parseur pur attachment : dims + poids, quantité 5 NON finale.
Deno.test("2-Q F #1 — parseBusSpecsFromAttachmentText : dims + GVW, quantité 5 documentaire", () => {
  const s = parseBusSpecsFromAttachmentText(
    ATTACHMENT_BUS_SPEC_TEXT,
    "Hyundai Universe Passenger Bus.pdf",
  );
  assertEquals(s.unitWeightKg, 12320, "GVW per unit = 12320 kg");
  assert(s.dimsM !== null, "dimensions parsées");
  assertEquals(s.dimsM?.l, 12.03, "L = 12.03 m");
  assertEquals(s.dimsM?.w, 2.495, "W = 2.495 m");
  assertEquals(s.dimsM?.h, 3.385, "H = 3.385 m");
  // Le parseur n'expose AUCUNE quantité (la quantité 5 reste documentaire).
  assert(!("pieces_count" in (s as Record<string, unknown>)), "pas de quantité dans BusSpecs");
});

// Test #2 — deriveCore : dernier email (15) + attachment PDF (specs) en dry_run.
Deno.test("2-Q F #2 — deriveCore : email 15 + attachment PDF ⇒ bus enrichi (184800 / 1524.004)", async () => {
  let seenMode: unknown = null;
  let seenSource: Record<string, unknown> | null = null;
  let seenLines: Array<{
    equipment: Array<{ equipment_type: string; quantity: number }>;
    weight_kg: number | null;
    volume_cbm: number | null;
    pieces_count: number | null;
    status: string;
  }> = [];

  const resp = await deriveCore({ case_id: VALID_CASE }, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    loadAttachments: () => Promise.resolve([BUS_SPEC_PDF]),
    loadInboundEmails: () => Promise.resolve([LATEST_REVISION_EMAIL]),
    callCanonicalizer: (body) => {
      seenMode = body.mode;
      seenSource = body.source as Record<string, unknown>;
      seenLines = (body.cargo_payload as { cargo_lines: typeof seenLines }).cargo_lines;
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, mode: "dry_run", writer_payload: body.cargo_payload }),
          { status: 200 },
        ),
      );
    },
  });

  assertEquals(seenMode, "dry_run", "canonicalizer en dry_run UNIQUEMENT");
  assertEquals(resp.status, 200);

  const busLine = findLineWithEquipment(seenLines, "40FR");
  assert(busLine, "ligne bus présente");
  assertEquals(busLine?.pieces_count, 15, "pieces_count = 15 (jamais 5)");
  assertEquals(busLine?.status, "to_confirm");
  assert(findEquipment(seenLines, "40FR", 15), "40FR × 15");
  assertEquals(busLine?.weight_kg, 184800, "poids = 12320 × 15");
  assertEquals(busLine?.volume_cbm, 1524.004, "volume = 12.03×2.495×3.385 × 15");
  // Ligne médicale inchangée.
  assert(findEquipment(seenLines, "20GP", 1), "médical 1 × 20GP");
  assert(findEquipment(seenLines, "40GP", 1), "médical 1 × 40GP");
  // source_email_id reste le dernier email (pas l'attachment).
  assertEquals(seenSource?.source_email_id, "email-latest-e");

  const out = await resp.json();
  assertEquals(out.ok, true);
  assert(
    out.warnings.some((w: string) =>
      /propagated from PDF attachment/i.test(w) && /confirmation required/i.test(w)
    ),
    "warning de propagation depuis l'attachment PDF + confirmation",
  );
});

// Test #3 — attachment avec mêmes dimensions mais SANS contexte bus ⇒ pas d'enrichissement.
Deno.test("2-Q F #3 — dims identiques sans contexte bus : aucun enrichissement", () => {
  const base = deriveCargoPayloadFromInboundEmailThread([LATEST_REVISION_EMAIL]);
  const containerPdf = {
    id: "att-container",
    filename: "container-internal-specs.pdf",
    content_type: "application/pdf",
    is_analyzed: true,
    extracted_data: { type: "specification" },
    extracted_text:
      "Container internal dimensions Length: 12,030 mm Width: 2,495 mm " +
      "Height: 3,385 mm GVW: 12,320 kg",
  };
  const r = enrichCargoPayloadFromAttachments(base, [containerPdf]);
  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assert(busLine, "ligne bus présente");
  assertEquals(busLine?.weight_kg, null, "poids non enrichi (pas de contexte bus)");
  assertEquals(busLine?.volume_cbm, null, "volume non enrichi (pas de contexte bus)");
  assertEquals(
    r.warnings.some((w) => /propagated from PDF attachment/i.test(w)),
    false,
  );
});

// Test #4 — contexte bus mais GVW absent ⇒ politique conservatrice : aucun enrichissement.
Deno.test("2-Q F #4 — contexte bus sans GVW : aucun enrichissement (4 signaux requis)", () => {
  const noGvwText = [
    "Make/Model: Hyundai Universe Passenger Bus",
    "Length: 12,030 mm",
    "Width: 2,495 mm",
    "Height: 3,385 mm",
  ].join("\n");
  // Parseur pur : rien (GVW manquant).
  const s = parseBusSpecsFromAttachmentText(noGvwText, "Hyundai Universe Passenger Bus.pdf");
  assertEquals(s.dimsM, null);
  assertEquals(s.unitWeightKg, null);

  const base = deriveCargoPayloadFromInboundEmailThread([LATEST_REVISION_EMAIL]);
  const r = enrichCargoPayloadFromAttachments(base, [
    { ...BUS_SPEC_PDF, id: "att-nogvw", extracted_text: noGvwText },
  ]);
  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assertEquals(busLine?.weight_kg, null);
  assertEquals(busLine?.volume_cbm, null);
  assertEquals(
    r.warnings.some((w) => /propagated from PDF attachment/i.test(w)),
    false,
    "aucun warning de propagation sans GVW",
  );
});

// Test #5 — attachments en conflit (poids ET dimensions) ⇒ champs non enrichis + warnings.
Deno.test("2-Q F #5 — attachments en conflit : bus non enrichi + warning conflit, 15 inchangé", () => {
  const attA = { ...BUS_SPEC_PDF, id: "att-A", extracted_text: ATTACHMENT_BUS_SPEC_TEXT };
  const attB = {
    ...BUS_SPEC_PDF,
    id: "att-B",
    filename: "Hyundai bus alt.pdf",
    extracted_text: [
      "Make/Model: Hyundai Universe Passenger Bus",
      "Length: 13,000 mm / Width : 2,550 mm / Height : 3,400 mm",
      "GVW (approx.): 14,000 kg per unit",
    ].join("\n"),
  };
  const res = findBusSpecsFromAnalyzedAttachments([attA, attB]);
  assertEquals(res.spec, null, "aucune spec propagée (poids ET dims en conflit)");
  assert(
    res.warnings.some((w) => /conflicting bus unit weight/i.test(w)),
    "warning conflit de poids",
  );
  assert(
    res.warnings.some((w) => /conflicting bus dimensions/i.test(w)),
    "warning conflit de dimensions",
  );

  const base = deriveCargoPayloadFromInboundEmailThread([LATEST_REVISION_EMAIL]);
  const r = enrichCargoPayloadFromAttachments(base, [attA, attB]);
  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assertEquals(busLine?.pieces_count, 15, "quantité finale toujours 15");
  assertEquals(busLine?.weight_kg, null, "poids non enrichi (conflit)");
  assertEquals(busLine?.volume_cbm, null, "volume non enrichi (conflit)");
});

// Test #6 — ne PAS écraser une valeur déjà enrichie par le thread email.
Deno.test("2-Q F #6 — valeurs déjà enrichies (thread email) non écrasées par l'attachment", () => {
  const earlierEmail = {
    id: "email-earlier-f",
    subject: "Initial request",
    body_text: [
      "Hyundai Universe Passenger Bus",
      "Quantity: 5",
      "Length: 12,030 mm",
      "Width: 2,495 mm",
      "Height: 3,385 mm",
      "GVW approx.: 12,320 kg per unit",
    ].join("\n"),
    sent_at: "2026-06-08T08:00:00Z",
    from_address: "client@example.com",
  };
  const base = deriveCargoPayloadFromInboundEmailThread([earlierEmail, LATEST_REVISION_EMAIL]);
  const baseBus = findLineWithEquipment(base.cargo_lines, "40FR");
  assertEquals(baseBus?.weight_kg, 184800, "pré-condition : déjà enrichi par email");

  // Attachment avec un poids DIFFÉRENT ne doit PAS écraser la valeur email.
  const attDiff = {
    ...BUS_SPEC_PDF,
    id: "att-diff",
    extracted_text: [
      "Make/Model: Hyundai Universe Passenger Bus",
      "Length: 12,030 mm / Width : 2,495 mm / Height : 3,385 mm",
      "GVW (approx.): 9,999 kg per unit",
    ].join("\n"),
  };
  const r = enrichCargoPayloadFromAttachments(base, [attDiff]);
  const busLine = findLineWithEquipment(r.cargo_lines, "40FR");
  assertEquals(busLine?.weight_kg, 184800, "valeur email conservée (non écrasée)");
  assertEquals(busLine?.volume_cbm, 1524.004, "valeur email conservée (non écrasée)");
});

// Test #7 — plain "40 ft medical" : toujours pas de 40FR (contexte Patch F).
Deno.test("2-Q F #7 — plain '40 ft medical' : pas de 40FR, attachment sans effet", () => {
  const r = deriveCargoPayloadFromInboundEmailThread([
    {
      id: "e-plain40-f",
      subject: null,
      body_text:
        "now 15 buses and one additional 40 ft container for medical equipment non DGR",
      sent_at: "2026-06-18T10:00:00Z",
      from_address: "client@example.com",
    },
  ]);
  const enriched = enrichCargoPayloadFromAttachments(r, [BUS_SPEC_PDF]);
  assert(
    enriched.cargo_lines.every((l) => l.equipment.every((e) => e.equipment_type !== "40FR")),
    "aucun 40FR inféré depuis un simple '40 ft'",
  );
});
