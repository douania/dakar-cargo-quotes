/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-M
 * Tests PURS (aucun réseau, aucune DB) de l'Edge Function write-cargo-canonical.
 *
 * Couvre :
 *   - validatePayload : whitelists status/currency, bornes numériques, UUID,
 *     line_index >= 1, equipment_type non vide, quantity > 0, refus excerpt trop long
 *   - buildCargoLineRpcArgs / buildEquipmentRpcArgs : mapping payload → RPC
 *
 * NB : l'import dynamique charge index.ts ; `Deno.serve` n'est PAS déclenché
 * (gardé par `import.meta.main`), donc aucun serveur ni I/O n'est lancé.
 *
 * Exécution :
 *   deno test supabase/functions/_tests/write_cargo_canonical_validation.test.ts
 * Vérification statique :
 *   deno check supabase/functions/_tests/write_cargo_canonical_validation.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const {
  validatePayload,
  buildCargoLineRpcArgs,
  buildEquipmentRpcArgs,
} = await import("../write-cargo-canonical/index.ts");

const VALID_CASE = "11111111-1111-1111-1111-111111111111";
const VALID_QRL = "22222222-2222-2222-2222-222222222222";
const VALID_EMAIL = "33333333-3333-3333-3333-333333333333";
const VALID_SUPERSEDES = "44444444-4444-4444-4444-444444444444";

function minimalValid() {
  return {
    case_id: VALID_CASE,
    source: { source_email_id: null, source_quote_request_line_id: null, source_excerpt: null },
    cargo_lines: [
      {
        line_index: 1,
        status: "to_confirm",
        description: "Machine",
        equipment: [{ equipment_type: "40HC", quantity: 2, status: "confirmed" }],
      },
    ],
    unallocated_equipment: [{ equipment_type: "20GP", quantity: 1, status: "to_confirm" }],
  };
}

Deno.test("2-M validate — payload minimal valide est accepté", () => {
  const r = validatePayload(minimalValid());
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.case_id, VALID_CASE);
    assertEquals(r.value.cargo_lines.length, 1);
    assertEquals(r.value.cargo_lines[0].equipment.length, 1);
    assertEquals(r.value.unallocated_equipment.length, 1);
  }
});

Deno.test("2-M validate — case_id manquant/invalide rejeté", () => {
  assertEquals(validatePayload({ cargo_lines: [] }).ok, false);
  assertEquals(validatePayload({ case_id: "not-a-uuid", cargo_lines: [] }).ok, false);
  assertEquals(validatePayload(null).ok, false);
  assertEquals(validatePayload(42).ok, false);
});

Deno.test("2-M validate — cargo_lines doit être un tableau", () => {
  const r = validatePayload({ case_id: VALID_CASE, cargo_lines: {} });
  assertEquals(r.ok, false);
});

Deno.test("2-M validate — cargo_lines vide accepté si unallocated_equipment présent", () => {
  const r = validatePayload({
    case_id: VALID_CASE,
    cargo_lines: [],
    unallocated_equipment: [{ equipment_type: "20GP", quantity: 1, status: "to_confirm" }],
  });
  assert(r.ok);
});

Deno.test("2-M validate — payload sans cargo line ni unallocated equipment est rejeté", () => {
  assertEquals(validatePayload({ case_id: VALID_CASE, cargo_lines: [] }).ok, false);
  assertEquals(
    validatePayload({ case_id: VALID_CASE, cargo_lines: [], unallocated_equipment: [] }).ok,
    false,
  );
});

Deno.test("2-M validate — line_index < 1 ou non entier rejeté", () => {
  for (const li of [0, -1, 1.5, "1"]) {
    const p = minimalValid();
    p.cargo_lines[0].line_index = li as number;
    assertEquals(validatePayload(p).ok, false, `line_index=${li}`);
  }
});

Deno.test("2-M validate — status ligne whitelist stricte (superseded interdit)", () => {
  for (const s of ["superseded", "draft", "", "TO_CONFIRM"]) {
    const p = minimalValid();
    p.cargo_lines[0].status = s;
    assertEquals(validatePayload(p).ok, false, `status=${s}`);
  }
  for (const s of ["to_confirm", "confirmed"]) {
    const p = minimalValid();
    p.cargo_lines[0].status = s;
    assert(validatePayload(p).ok, `status=${s}`);
  }
});

Deno.test("2-M validate — currency whitelist stricte", () => {
  for (const c of ["GBP", "xof", "", "CHF"]) {
    const p = minimalValid();
    (p.cargo_lines[0] as Record<string, unknown>).value_currency = c;
    assertEquals(validatePayload(p).ok, false, `currency=${c}`);
  }
  for (const c of ["XOF", "FCFA", "CFA", "EUR", "USD"]) {
    const p = minimalValid();
    (p.cargo_lines[0] as Record<string, unknown>).value_currency = c;
    assert(validatePayload(p).ok, `currency=${c}`);
  }
});

Deno.test("2-M validate — valeurs numériques négatives ou NaN rejetées", () => {
  for (const field of ["value_number", "weight_kg", "volume_cbm", "pieces_count"]) {
    const p = minimalValid();
    (p.cargo_lines[0] as Record<string, unknown>)[field] = -1;
    assertEquals(validatePayload(p).ok, false, `${field}=-1`);
    const p2 = minimalValid();
    (p2.cargo_lines[0] as Record<string, unknown>)[field] = "5";
    assertEquals(validatePayload(p2).ok, false, `${field}="5"`);
  }
});

Deno.test("2-M validate — equipment_type vide rejeté, quantity <= 0 rejeté", () => {
  const p1 = minimalValid();
  p1.cargo_lines[0].equipment[0].equipment_type = "   ";
  assertEquals(validatePayload(p1).ok, false);

  for (const q of [0, -2, 1.5]) {
    const p = minimalValid();
    p.cargo_lines[0].equipment[0].quantity = q;
    assertEquals(validatePayload(p).ok, false, `quantity=${q}`);
  }
});

Deno.test("2-M validate — equipment status autorise superseded", () => {
  const p = minimalValid();
  p.cargo_lines[0].equipment[0].status = "superseded";
  assert(validatePayload(p).ok);
});

Deno.test("2-M validate — UUID invalide pour supersedes/source rejeté", () => {
  const p1 = minimalValid();
  (p1.cargo_lines[0] as Record<string, unknown>).supersedes_cargo_line_id = "x";
  assertEquals(validatePayload(p1).ok, false);

  const p2 = minimalValid();
  p2.source.source_email_id = "nope" as unknown as null;
  assertEquals(validatePayload(p2).ok, false);
});

Deno.test("2-M validate — source.source_excerpt trop long est rejeté (400)", () => {
  const p = minimalValid();
  p.source.source_excerpt = "a".repeat(5000) as unknown as null;
  assertEquals(validatePayload(p).ok, false);
});

Deno.test("2-M validate — equipment.source_excerpt trop long est rejeté (400)", () => {
  const p = minimalValid();
  (p.cargo_lines[0].equipment[0] as Record<string, unknown>).source_excerpt = "a".repeat(5000);
  assertEquals(validatePayload(p).ok, false);
});

Deno.test("2-M mapping — buildCargoLineRpcArgs mappe tous les paramètres RPC", () => {
  const r = validatePayload({
    case_id: VALID_CASE,
    source: {
      source_email_id: VALID_EMAIL,
      source_quote_request_line_id: VALID_QRL,
      source_excerpt: "ctx",
    },
    cargo_lines: [
      {
        line_index: 3,
        status: "confirmed",
        description: "desc",
        hs_code: "8704",
        value_number: 1000,
        value_currency: "EUR",
        weight_kg: 12,
        volume_cbm: 3.5,
        pieces_count: 4,
        supersedes_cargo_line_id: VALID_SUPERSEDES,
        equipment: [],
      },
    ],
    unallocated_equipment: [],
  });
  assert(r.ok);
  if (!r.ok) return;
  const args = buildCargoLineRpcArgs(r.value, r.value.cargo_lines[0]);
  assertEquals(args, {
    p_case_id: VALID_CASE,
    p_line_index: 3,
    p_status: "confirmed",
    p_description: "desc",
    p_hs_code: "8704",
    p_value_number: 1000,
    p_value_currency: "EUR",
    p_weight_kg: 12,
    p_volume_cbm: 3.5,
    p_pieces_count: 4,
    p_source_quote_request_line_id: VALID_QRL,
    p_source_email_id: VALID_EMAIL,
    p_source_excerpt: "ctx",
    p_supersedes_cargo_line_id: VALID_SUPERSEDES,
  });
});

Deno.test("2-M mapping — buildEquipmentRpcArgs : attaché vs non alloué (cargo_line_id)", () => {
  const r = validatePayload(minimalValid());
  assert(r.ok);
  if (!r.ok) return;

  const attached = buildEquipmentRpcArgs(
    r.value,
    r.value.cargo_lines[0].equipment[0],
    "55555555-5555-5555-5555-555555555555",
  );
  assertEquals(attached.p_cargo_line_id, "55555555-5555-5555-5555-555555555555");
  assertEquals(attached.p_equipment_type, "40HC");
  assertEquals(attached.p_quantity, 2);
  assertEquals(attached.p_status, "confirmed");
  assertEquals(attached.p_case_id, VALID_CASE);

  const unalloc = buildEquipmentRpcArgs(r.value, r.value.unallocated_equipment[0], null);
  assertEquals(unalloc.p_cargo_line_id, null);
  assertEquals(unalloc.p_equipment_type, "20GP");
  assertEquals(unalloc.p_quantity, 1);
});

Deno.test("2-M mapping — equipment source_excerpt : fallback sur source.source_excerpt", () => {
  const r = validatePayload({
    case_id: VALID_CASE,
    source: { source_email_id: null, source_quote_request_line_id: null, source_excerpt: "ctx-dossier" },
    cargo_lines: [
      {
        line_index: 1,
        status: "to_confirm",
        equipment: [
          { equipment_type: "40HC", quantity: 1, status: "to_confirm", source_excerpt: "ctx-equip" },
          { equipment_type: "20GP", quantity: 1, status: "to_confirm" },
        ],
      },
    ],
    unallocated_equipment: [],
  });
  assert(r.ok);
  if (!r.ok) return;

  // Excerpt propre à l'équipement → conservé
  const withOwn = buildEquipmentRpcArgs(r.value, r.value.cargo_lines[0].equipment[0], "x");
  assertEquals(withOwn.p_source_excerpt, "ctx-equip");

  // Excerpt absent → fallback sur source.source_excerpt
  const withFallback = buildEquipmentRpcArgs(r.value, r.value.cargo_lines[0].equipment[1], "x");
  assertEquals(withFallback.p_source_excerpt, "ctx-dossier");
});
