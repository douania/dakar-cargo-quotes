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
