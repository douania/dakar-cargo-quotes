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
} = await import("../derive-cargo-canonical-payload/index.ts");

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
