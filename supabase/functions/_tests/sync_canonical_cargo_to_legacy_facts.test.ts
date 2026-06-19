/**
 * CARGO-CANONICAL-TO-LEGACY-FACTS-SYNC-AUDIT-1
 * Tests PURS (aucun réseau, aucune DB) du mapping canonique → legacy facts.
 *
 * L'import dynamique charge index.ts ; `Deno.serve` n'est PAS déclenché
 * (gardé par `import.meta.main`), donc aucun serveur ni I/O n'est lancé.
 *
 * Exécution :
 *   deno test supabase/functions/_tests/sync_canonical_cargo_to_legacy_facts.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const {
  buildLegacyFactsPreview,
  parseSyncRequest,
  ALLOWED_LEGACY_FACT_KEYS,
} = await import("../sync-canonical-cargo-to-legacy-facts/index.ts");

const CASE = "11111111-1111-1111-1111-111111111111";

/** Liste des facts INTERDITS en V1 : ne doivent JAMAIS apparaître. */
const FORBIDDEN_KEYS = [
  "cargo.value",
  "cargo.caf_value",
  "cargo.hs_code",
  "cargo.volume_cbm",
  "service.package",
  "routing.incoterm",
  "routing.destination_port",
  "customs.regime_code",
  "regulatory.exemption_title",
  "cargo.pad_category",
  "cargo.pad_rate_fcfa_per_ton",
  "cargo.freight_cost",
  "cargo.freight_currency",
];

function keys(facts: Array<{ fact_key: string }>): string[] {
  return facts.map((f) => f.fact_key);
}
function getFact(facts: Array<{ fact_key: string }>, k: string) {
  return facts.find((f) => f.fact_key === k);
}

// ── Mapping équipement multi-type → cargo.containers ──
Deno.test("équipement multi-type → cargo.containers agrégé + container_count", () => {
  const { facts, skipped } = buildLegacyFactsPreview(
    [],
    [
      { equipment_type: "40HC", quantity: 2, status: "confirmed" },
      { equipment_type: "20GP", quantity: 3, status: "to_confirm" },
      { equipment_type: "40HC", quantity: 1, status: "confirmed" },
    ],
  );

  const containers = getFact(facts, "cargo.containers");
  assert(containers, "cargo.containers doit être présent");
  // Agrégé par type, trié déterministe (20GP avant 40HC)
  assertEquals(containers!.value_json, [
    { type: "20GP", quantity: 3 },
    { type: "40HC", quantity: 3 },
  ]);

  const count = getFact(facts, "cargo.container_count");
  assertEquals(count!.value_number, 6);

  // Plusieurs types → container_type absent (skippé)
  assertEquals(getFact(facts, "cargo.container_type"), undefined);
  assert(keys(skipped).includes("cargo.container_type"));
});

Deno.test("container_count correct = somme des quantités", () => {
  const { facts } = buildLegacyFactsPreview(
    [],
    [
      { equipment_type: "20GP", quantity: 5, status: "confirmed" },
      { equipment_type: "20GP", quantity: 7, status: "confirmed" },
    ],
  );
  assertEquals(getFact(facts, "cargo.container_count")!.value_number, 12);
});

Deno.test("container_type présent si un seul type unique", () => {
  const { facts } = buildLegacyFactsPreview(
    [],
    [
      { equipment_type: "40HC", quantity: 2, status: "confirmed" },
      { equipment_type: "40HC", quantity: 1, status: "to_confirm" },
    ],
  );
  const t = getFact(facts, "cargo.container_type");
  assert(t, "container_type doit être présent");
  assertEquals(t!.value_text, "40HC");
});

Deno.test("container_type absent si plusieurs types", () => {
  const { facts, skipped } = buildLegacyFactsPreview(
    [],
    [
      { equipment_type: "40HC", quantity: 1, status: "confirmed" },
      { equipment_type: "20GP", quantity: 1, status: "confirmed" },
    ],
  );
  assertEquals(getFact(facts, "cargo.container_type"), undefined);
  assert(keys(skipped).includes("cargo.container_type"));
});

// ── Équipement superseded ignoré (lecture courants uniquement) ──
Deno.test("équipement superseded est ignoré", () => {
  const { facts, skipped } = buildLegacyFactsPreview(
    [],
    [{ equipment_type: "40HC", quantity: 9, status: "superseded" }],
  );
  // Aucun équipement courant → containers/count/type tous skippés
  assertEquals(getFact(facts, "cargo.containers"), undefined);
  assert(keys(skipped).includes("cargo.containers"));
  assert(keys(skipped).includes("cargo.container_count"));
});

// ── Aucun fact interdit généré ──
Deno.test("aucun fact interdit n'est jamais généré (cas riche)", () => {
  const { facts } = buildLegacyFactsPreview(
    [
      {
        line_index: 1,
        status: "confirmed",
        description: "Matériel industriel",
        weight_kg: 1500,
        pieces_count: 10,
        is_current: true,
      },
    ],
    [{ equipment_type: "40HC", quantity: 2, status: "confirmed" }],
  );
  const produced = keys(facts);
  for (const f of produced) {
    assert(
      (ALLOWED_LEGACY_FACT_KEYS as readonly string[]).includes(f),
      `fact non whitelisté émis: ${f}`,
    );
  }
  for (const forbidden of FORBIDDEN_KEYS) {
    assert(!produced.includes(forbidden), `fact interdit émis: ${forbidden}`);
  }
});

// ── description déterministe vs ambiguë ──
Deno.test("description émise si déterministe (une seule distincte)", () => {
  const { facts } = buildLegacyFactsPreview(
    [
      { line_index: 1, description: "Riz", is_current: true },
      { line_index: 2, description: "Riz", is_current: true },
    ],
    [],
  );
  assertEquals(getFact(facts, "cargo.description")!.value_text, "Riz");
});

Deno.test("description skippée si plusieurs distinctes (ambigu)", () => {
  const { facts, skipped } = buildLegacyFactsPreview(
    [
      { line_index: 1, description: "Riz", is_current: true },
      { line_index: 2, description: "Sucre", is_current: true },
    ],
    [],
  );
  assertEquals(getFact(facts, "cargo.description"), undefined);
  assert(keys(skipped).includes("cargo.description"));
});

// ── weight_kg / pieces_count : somme seulement si toutes numériques ──
Deno.test("weight_kg = somme si toutes les lignes numériques", () => {
  const { facts } = buildLegacyFactsPreview(
    [
      { line_index: 1, weight_kg: 1000, is_current: true },
      { line_index: 2, weight_kg: 500, is_current: true },
    ],
    [],
  );
  assertEquals(getFact(facts, "cargo.weight_kg")!.value_number, 1500);
});

Deno.test("weight_kg skippé si une valeur manquante (ambigu)", () => {
  const { facts, skipped } = buildLegacyFactsPreview(
    [
      { line_index: 1, weight_kg: 1000, is_current: true },
      { line_index: 2, weight_kg: null, is_current: true },
    ],
    [],
  );
  assertEquals(getFact(facts, "cargo.weight_kg"), undefined);
  assert(keys(skipped).includes("cargo.weight_kg"));
});

Deno.test("pieces_count = somme si toutes numériques", () => {
  const { facts } = buildLegacyFactsPreview(
    [
      { line_index: 1, pieces_count: 4, is_current: true },
      { line_index: 2, pieces_count: 6, is_current: true },
    ],
    [],
  );
  assertEquals(getFact(facts, "cargo.pieces_count")!.value_number, 10);
});

// ── Cas vide ──
Deno.test("aucune donnée → aucun fact, tout skippé", () => {
  const { facts, skipped } = buildLegacyFactsPreview([], []);
  assertEquals(facts.length, 0);
  assert(skipped.length > 0);
});

// ── parseSyncRequest ──
Deno.test("parseSyncRequest : défaut dry_run", () => {
  const r = parseSyncRequest({ case_id: CASE });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.mode, "dry_run");
});

Deno.test("parseSyncRequest : commit accepté", () => {
  const r = parseSyncRequest({ case_id: CASE, mode: "commit" });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.mode, "commit");
});

Deno.test("parseSyncRequest : case_id non-UUID rejeté", () => {
  const r = parseSyncRequest({ case_id: "nope" });
  assert(!r.ok);
});

Deno.test("parseSyncRequest : mode invalide rejeté", () => {
  const r = parseSyncRequest({ case_id: CASE, mode: "delete" });
  assert(!r.ok);
});
