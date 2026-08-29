/**
 * Phase P1-A2 — Tests PURS du domaine de manage-quote-scenario.
 *
 * Aucun réseau, aucune DB, aucun Deno.serve : l'import cible `domain.ts`, qui
 * ne dépend d'aucun client Supabase. L'autorité finale reste SQL (CHECK,
 * triggers, RPC) ; ces tests vérifient que la couche Edge refuse AVANT la base
 * et pour le MÊME motif.
 *
 * Couvre les invariants P1-A2 côté Edge :
 *   - six formes de périmètre anonymisées, validées de bout en bout ;
 *   - RoRo / ConRo : périmètres DESCRIPTIFS parfaitement légitimes ;
 *   - points ouverts DÉRIVÉS, exacts et triés ; jamais déclarés par l'appelant ;
 *   - contraintes CONNUES (DG, transit, payeur distinct, jeux documentaires
 *     séparés, multi-destination affectée) : jamais des points ouverts ;
 *   - snapshot fermé : clés monétaires, décimaux, UUID et dépassement de taille
 *     rejetés récursivement ;
 *   - empreinte stable par permutation, sensible au contenu ;
 *   - promotion / propagation / identité forgée : refus nommés ;
 *   - traduction des codes d'erreur de la RPC.
 *
 * Exécution :
 *   deno test supabase/functions/_tests/manage_quote_scenario_domain.test.ts
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildFingerprintInput,
  buildRpcArgs,
  computeRequestFingerprint,
  deriveOpenPoints,
  FORBIDDEN_PAYLOAD_KEYS,
  hasMonetaryKeyToken,
  jsonbTextByteLength,
  mapRpcErrorCode,
  MAX_CARGO_UNITS,
  MAX_SNAPSHOT_BYTES,
  MIN_CARGO_UNITS,
  PROMOTION_OPERATIONS,
  PROPAGATION_OPERATIONS,
  RESERVE_CODES,
  SCENARIO_WRITABLE_STATUSES,
  snapshotStructuralViolation,
  stableStringify,
  validateManageScenarioPayload,
  validateScopeSnapshot,
} from "../manage-quote-scenario/domain.ts";

const CASE_ID = "11111111-1111-1111-1111-111111111111";
const SCENARIO_ID = "22222222-2222-2222-2222-222222222222";
const ASSUMPTION_ID = "33333333-3333-3333-3333-333333333333";
const ACTOR_ID = "44444444-4444-4444-4444-444444444444";
const KEY = "idem-scenario-0001";

type Json = Record<string, unknown>;

/** Lot minimal entièrement renseigné : aucune ambiguïté, donc aucun point ouvert. */
function cleanUnit(ref: string, overrides: Json = {}): Json {
  return {
    unit_ref: ref,
    unit_kind: "CONTAINER",
    equipment_code: "eq-40hc",
    packaging: "palletized",
    quantity: 1,
    gross_weight_kg: 18000,
    chargeable_weight_kg: 18000,
    volume_dm3: 60000,
    temperature_control_required: false,
    temperature_setpoint_celsius: null,
    classification_status: "confirmed",
    destination_ref: "dest-main",
    dangerous_goods: false,
    required_attachment_status: "not_required",
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Six formes de périmètre anonymisées
// ───────────────────────────────────────────────────────────────────────────

/** 1. Import maritime conteneurisé, périmètre net et confirmé. */
function shapeImportMaritimeClean(): Json {
  return {
    schema_version: 1,
    transport_mode: "MARITIME",
    movement_direction: "IMPORT",
    terminal_operation_mode: "LOLO",
    origin: {
      location_kind: "PORT",
      location_code: "port-a",
      location_status: "confirmed",
    },
    destination: {
      location_kind: "PORT",
      location_code: "port-b",
      location_status: "confirmed",
    },
    cargo_units: [cleanUnit("lot-1", { quantity: 2 })],
    customs: {
      regime_status: "known",
      regime_code: "reg-c400",
      split_declarations: false,
    },
    booking: { stage: "booked", carrier_ref: "carrier-x" },
    documents: { split_required: false, sets_count: 1 },
    parties: {
      payer_is_shipper: true,
      payer_ref: "party-1",
      consignee_ref: "party-2",
    },
    constraints: { multi_destination: false, transit_country_refs: [] },
  };
}

/** 2. Export aérien : base taxable, classification, emballage et pièce manquants. */
function shapeExportAirIncomplete(): Json {
  return {
    schema_version: 1,
    transport_mode: "AIR",
    movement_direction: "EXPORT",
    terminal_operation_mode: null,
    origin: {
      location_kind: "AIRPORT",
      location_code: "apt-a",
      location_status: "confirmed",
    },
    destination: {
      location_kind: "AIRPORT",
      location_code: "apt-b",
      location_status: "confirmed",
    },
    cargo_units: [
      cleanUnit("lot-1", {
        unit_kind: "PALLET",
        equipment_code: null,
        packaging: "unknown",
        quantity: 4,
        gross_weight_kg: 850,
        chargeable_weight_kg: null,
        volume_dm3: 3200,
        classification_status: "unknown",
        // Marchandise dangereuse DÉCLARÉE : contrainte connue, pas une ambiguïté.
        dangerous_goods: true,
        required_attachment_status: "missing",
      }),
    ],
    customs: { regime_status: "unknown", split_declarations: false },
    booking: { stage: "none" },
    documents: { split_required: false, sets_count: 1 },
    parties: { payer_is_shipper: true },
    constraints: { multi_destination: false, transit_country_refs: [] },
  };
}

/** 3. Réexport RoRo : mode terminal DESCRIPTIF, périmètre complet, aucun tarif. */
function shapeReexportRoRo(): Json {
  return {
    schema_version: 1,
    transport_mode: "MARITIME",
    movement_direction: "REEXPORT",
    terminal_operation_mode: "RORO",
    origin: {
      location_kind: "PORT",
      location_code: "port-a",
      location_status: "confirmed",
    },
    destination: {
      location_kind: "PORT",
      location_code: "port-c",
      location_status: "confirmed",
    },
    cargo_units: [
      cleanUnit("lot-1", {
        unit_kind: "VEHICLE",
        equipment_code: "eq-self-propelled",
        packaging: "unpacked",
        quantity: 3,
        gross_weight_kg: 4200,
        chargeable_weight_kg: 4200,
        volume_dm3: 24000,
        destination_ref: "dest-c",
      }),
    ],
    customs: {
      regime_status: "known",
      regime_code: "reg-reexport",
      split_declarations: false,
    },
    booking: { stage: "booked", carrier_ref: "carrier-y" },
    documents: { split_required: false, sets_count: 1 },
    parties: { payer_is_shipper: true },
    constraints: { multi_destination: false, transit_country_refs: [] },
  };
}

/** 4. Transit multimodal : destination à arbitrer et pré-booking. */
function shapeTransitMultimodal(): Json {
  return {
    schema_version: 1,
    transport_mode: "MULTIMODAL",
    movement_direction: "TRANSIT",
    terminal_operation_mode: null,
    origin: {
      location_kind: "PORT",
      location_code: "port-a",
      location_status: "confirmed",
    },
    destination: {
      location_kind: "INLAND_POINT",
      location_code: null,
      location_status: "alternatives_open",
      alternatives: ["inland-b", "inland-c"],
    },
    cargo_units: [
      cleanUnit("lot-1", {
        unit_kind: "BREAKBULK",
        equipment_code: "eq-flatrack",
        packaging: "crated",
        destination_ref: "dest-transit",
        required_attachment_status: "provided",
      }),
    ],
    customs: {
      regime_status: "known",
      regime_code: "reg-transit",
      split_declarations: false,
    },
    booking: { stage: "pre_booking" },
    documents: { split_required: false, sets_count: 1 },
    parties: { payer_is_shipper: true },
    // Transit par pays tiers : contrainte connue et documentée, pas un manque.
    constraints: {
      multi_destination: false,
      transit_country_refs: ["ctry-1", "ctry-2"],
    },
  };
}

/** 5. Reefer maritime : consigne absente, port à proposer, classification en conflit. */
function shapeReeferConflict(): Json {
  return {
    schema_version: 1,
    transport_mode: "MARITIME",
    movement_direction: "IMPORT",
    terminal_operation_mode: null,
    origin: {
      location_kind: "PORT",
      location_code: null,
      location_status: "to_propose",
    },
    destination: {
      location_kind: "PORT",
      location_code: "port-b",
      location_status: "confirmed",
    },
    cargo_units: [
      cleanUnit("lot-1", {
        equipment_code: "eq-40rh",
        temperature_control_required: true,
        temperature_setpoint_celsius: null,
        classification_status: "conflict",
        required_attachment_status: "provided",
      }),
      cleanUnit("lot-2", {
        equipment_code: "eq-40rh",
        temperature_control_required: true,
        // Consigne ENTIÈRE : une consigne fractionnaire devrait changer d'unité.
        temperature_setpoint_celsius: -18,
        required_attachment_status: "provided",
      }),
    ],
    customs: {
      regime_status: "known",
      regime_code: "reg-c400",
      split_declarations: false,
    },
    booking: { stage: "booked", carrier_ref: "carrier-x" },
    documents: { split_required: false, sets_count: 1 },
    parties: { payer_is_shipper: true },
    constraints: { multi_destination: false, transit_country_refs: [] },
  };
}

/**
 * 6. Cross-trade ConRo : multi-destination ENTIÈREMENT affectée, jeux
 * documentaires séparés, payeur distinct du chargeur, marchandise dangereuse,
 * déclarations scindées. Que des contraintes CONNUES.
 */
function shapeCrossTradeKnownConstraints(): Json {
  return {
    schema_version: 1,
    transport_mode: "MARITIME",
    movement_direction: "CROSS_TRADE",
    terminal_operation_mode: "CONRO",
    origin: {
      location_kind: "PORT",
      location_code: "port-d",
      location_status: "confirmed",
    },
    destination: {
      location_kind: "PORT",
      location_code: "port-e",
      location_status: "confirmed",
    },
    cargo_units: [
      cleanUnit("lot-1", { destination_ref: "dest-a", dangerous_goods: true }),
      cleanUnit("lot-2", { destination_ref: "dest-b", unit_kind: "VEHICLE" }),
    ],
    customs: {
      regime_status: "known",
      regime_code: "reg-c400",
      split_declarations: true,
    },
    booking: { stage: "booked", carrier_ref: "carrier-z" },
    documents: { split_required: true, sets_count: 3 },
    parties: {
      payer_is_shipper: false,
      payer_ref: "party-9",
      consignee_ref: "party-8",
    },
    constraints: { multi_destination: true, transit_country_refs: [] },
  };
}

const SIX_SHAPES: ReadonlyArray<[string, () => Json]> = [
  ["import maritime confirmé", shapeImportMaritimeClean],
  ["export aérien incomplet", shapeExportAirIncomplete],
  ["réexport RoRo", shapeReexportRoRo],
  ["transit multimodal", shapeTransitMultimodal],
  ["reefer en conflit", shapeReeferConflict],
  ["cross-trade ConRo", shapeCrossTradeKnownConstraints],
];

function createPayload(overrides: Json = {}): Json {
  return {
    case_id: CASE_ID,
    operation: "create",
    idempotency_key: KEY,
    title: "Périmètre import conteneurisé",
    scope_snapshot: shapeImportMaritimeClean(),
    ...overrides,
  };
}

function expectOk(raw: unknown) {
  const result = validateManageScenarioPayload(raw);
  assert(
    result.ok,
    `attendu valide, obtenu: ${result.ok ? "" : result.message}`,
  );
  return result.value;
}

function expectFail(raw: unknown) {
  const result = validateManageScenarioPayload(raw);
  assert(!result.ok, "attendu invalide, obtenu valide");
  return result;
}

const keysOf = (points: ReadonlyArray<{ key: string }>) =>
  points.map((p) => p.key);

// ── 1. Six formes anonymisées ──────────────────────────────────────────────

Deno.test("les six formes de périmètre sont acceptées telles quelles", () => {
  for (const [label, build] of SIX_SHAPES) {
    const snapshot = build();
    const checked = validateScopeSnapshot(snapshot);
    assert(checked.ok, `${label} : ${checked.ok ? "" : checked.message}`);
    // Le snapshot est persisté TEL QUEL : aucune valeur inventée, aucun défaut.
    assertEquals(
      checked.value,
      snapshot,
      `${label} : le snapshot a été altéré`,
    );
  }
});

Deno.test("les six formes traversent la validation complète du payload", () => {
  for (const [label, build] of SIX_SHAPES) {
    const normalized = expectOk(createPayload({ scope_snapshot: build() }));
    assertEquals(normalized.operation, "create", label);
    assertEquals(normalized.status, "draft", label);
    assertEquals(normalized.scenario_id, null, label);
    // Les points ouverts sont TOUJOURS dérivés, jamais absents ni fournis.
    assert(Array.isArray(normalized.open_points), label);
  }
});

Deno.test("chaque forme reste largement sous la borne de taille du snapshot", () => {
  for (const [label, build] of SIX_SHAPES) {
    const bytes = jsonbTextByteLength(build());
    assert(
      bytes <= MAX_SNAPSHOT_BYTES,
      `${label} : ${bytes} octets dépassent ${MAX_SNAPSHOT_BYTES}`,
    );
  }
});

// ── 2. RoRo / ConRo : descriptif, autorisé, sans tarif ─────────────────────

Deno.test("RoRo et ConRo sont des périmètres légitimes et n'ouvrent aucun point", () => {
  for (const build of [shapeReexportRoRo, shapeCrossTradeKnownConstraints]) {
    const snapshot = build();
    const checked = validateScopeSnapshot(snapshot);
    assert(checked.ok, checked.ok ? "" : checked.message);
    assertEquals(deriveOpenPoints(snapshot), []);
  }
});

Deno.test("le mode terminal doit être dit explicitement, null compris", () => {
  const snapshot = shapeReexportRoRo();
  delete snapshot.terminal_operation_mode;
  const checked = validateScopeSnapshot(snapshot);
  assert(!checked.ok);
  assert(checked.message.includes("terminal_operation_mode"), checked.message);

  const unknownMode = shapeReexportRoRo();
  unknownMode.terminal_operation_mode = "LIFT_ON";
  assert(!validateScopeSnapshot(unknownMode).ok);
});

Deno.test("le mode terminal manquant n'est un point ouvert que sur un périmètre maritime", () => {
  // MARITIME sans mode terminal : manque réel.
  const maritime = shapeImportMaritimeClean();
  maritime.terminal_operation_mode = null;
  assertEquals(keysOf(deriveOpenPoints(maritime)), [
    "terminal_operation_mode_unknown",
  ]);

  // AIR et MULTIMODAL : la notion n'a pas de portée, rien n'est ouvert.
  assertEquals(
    keysOf(deriveOpenPoints(shapeTransitMultimodal())).includes(
      "terminal_operation_mode_unknown",
    ),
    false,
  );
  assertEquals(
    keysOf(deriveOpenPoints(shapeExportAirIncomplete())).includes(
      "terminal_operation_mode_unknown",
    ),
    false,
  );
});

// ── 3. Points ouverts exacts ───────────────────────────────────────────────

Deno.test("points ouverts exacts : import maritime confirmé n'en ouvre aucun", () => {
  assertEquals(deriveOpenPoints(shapeImportMaritimeClean()), []);
});

Deno.test("points ouverts exacts : export aérien incomplet", () => {
  assertEquals(keysOf(deriveOpenPoints(shapeExportAirIncomplete())), [
    "attachment_required:lot-1",
    "chargeable_basis_unconfirmed:lot-1",
    "commodity_classification_unknown:lot-1",
    "customs_regime_unknown",
    "equipment_unknown:lot-1",
    "packaging_unknown:lot-1",
  ]);
});

Deno.test("points ouverts exacts : transit multimodal", () => {
  assertEquals(keysOf(deriveOpenPoints(shapeTransitMultimodal())), [
    "booking_pre_booking",
    "port_alternatives_open:destination",
  ]);
});

Deno.test("points ouverts exacts : reefer en conflit", () => {
  const points = deriveOpenPoints(shapeReeferConflict());
  assertEquals(keysOf(points), [
    "classification_conflict:lot-1",
    "port_to_propose:origin",
    "temperature_setpoint_missing:lot-1",
    "terminal_operation_mode_unknown",
  ]);
  // Le lot 2, dont la consigne est renseignée, n'ouvre rien.
  assertEquals(points.filter((p) => p.ref === "lot-2"), []);
  // Chaque point porte son code et sa référence : la clé n'est pas opaque.
  assertEquals(
    points.map((p) => [p.code, p.ref]),
    [
      ["classification_conflict", "lot-1"],
      ["port_to_propose", "origin"],
      ["temperature_setpoint_missing", "lot-1"],
      ["terminal_operation_mode_unknown", null],
    ],
  );
});

Deno.test("la forme d'un point ouvert est le contrat que la base compare", () => {
  // La base REDÉRIVE les points ouverts et n'écrit que sa propre dérivation ;
  // le tableau transmis n'est comparé que pour lever OPEN_POINTS_FORGED en cas
  // d'écart. Ce test fige donc ce que le miroir SQL doit reproduire à
  // l'identique : trois champs — ni plus, ni moins — et un tri par clé.
  const points = deriveOpenPoints(shapeExportAirIncomplete());
  assertEquals(points.length, 6);
  for (const point of points) {
    assertEquals(Object.keys(point).sort(), ["code", "key", "ref"]);
    // Clés ASCII imprimables uniquement : c'est la condition pour que le tri
    // JavaScript (unités de code) et le tri SQL en collation "C" (octets)
    // produisent le MÊME tableau, donc pour que la comparaison stricte de la
    // base ne dépende pas de la collation de l'instance.
    assert(/^[\x20-\x7E]+$/.test(point.key), point.key);
  }
  assertEquals(points[0], {
    key: "attachment_required:lot-1",
    code: "attachment_required",
    ref: "lot-1",
  });
  assertEquals(points[3], {
    key: "customs_regime_unknown",
    code: "customs_regime_unknown",
    ref: null,
  });
});

Deno.test("la dérivation est pure, totale et triée", () => {
  for (const [label, build] of SIX_SHAPES) {
    const snapshot = build();
    const first = deriveOpenPoints(snapshot);
    const second = deriveOpenPoints(build());
    assertEquals(first, second, `${label} : dérivation instable`);
    assertEquals(
      keysOf(first),
      [...keysOf(first)].sort(),
      `${label} : points ouverts non triés`,
    );
    // La dérivation ne mute jamais le snapshot qu'elle lit.
    assertEquals(
      snapshot,
      build(),
      `${label} : snapshot muté par la dérivation`,
    );
  }
});

Deno.test("un port à proposer et des alternatives ouvertes sont des points distincts", () => {
  const snapshot = shapeImportMaritimeClean();
  (snapshot.origin as Json).location_status = "to_propose";
  (snapshot.destination as Json).location_status = "alternatives_open";
  (snapshot.destination as Json).alternatives = ["port-b", "port-f"];
  assertEquals(keysOf(deriveOpenPoints(snapshot)), [
    "port_alternatives_open:destination",
    "port_to_propose:origin",
  ]);
});

Deno.test("aérien : base taxable contradictoire ouverte au même titre qu'absente", () => {
  const snapshot = shapeExportAirIncomplete();
  const unit = (snapshot.cargo_units as Json[])[0];
  // Taxable strictement inférieur au brut : contradiction, jamais un montant.
  unit.chargeable_weight_kg = 400;
  unit.gross_weight_kg = 850;
  assert(
    keysOf(deriveOpenPoints(snapshot)).includes(
      "chargeable_basis_unconfirmed:lot-1",
    ),
  );

  unit.chargeable_weight_kg = 900;
  assertEquals(
    keysOf(deriveOpenPoints(snapshot)).includes(
      "chargeable_basis_unconfirmed:lot-1",
    ),
    false,
  );

  // La même absence sur un périmètre maritime n'ouvre rien.
  const maritime = shapeImportMaritimeClean();
  (maritime.cargo_units as Json[])[0].chargeable_weight_kg = null;
  assertEquals(deriveOpenPoints(maritime), []);
});

// ── 4. Contraintes connues : jamais des points ouverts ─────────────────────

Deno.test("les contraintes connues n'ouvrent aucun point", () => {
  const snapshot = shapeCrossTradeKnownConstraints();
  // DG + transit + payeur distinct + documents scindés + déclarations scindées
  // + multi-destination entièrement affectée + ConRo.
  (snapshot.constraints as Json).transit_country_refs = ["ctry-1"];
  assertEquals(deriveOpenPoints(snapshot), []);

  const units = snapshot.cargo_units as Json[];
  assertEquals(units[0].dangerous_goods, true);
  assertEquals((snapshot.documents as Json).split_required, true);
  assertEquals((snapshot.parties as Json).payer_is_shipper, false);
  assertEquals((snapshot.customs as Json).split_declarations, true);
  assertEquals((snapshot.constraints as Json).multi_destination, true);
});

Deno.test("multi-destination : seule une répartition incomplète ouvre un point", () => {
  const assigned = shapeCrossTradeKnownConstraints();
  assertEquals(deriveOpenPoints(assigned), []);

  const partial = shapeCrossTradeKnownConstraints();
  (partial.cargo_units as Json[])[1].destination_ref = null;
  assertEquals(keysOf(deriveOpenPoints(partial)), [
    "destination_split_unknown",
  ]);

  // Sans multi-destination annoncée, une destination non affectée n'ouvre rien :
  // la répartition n'est simplement pas une dimension du périmètre.
  const single = shapeCrossTradeKnownConstraints();
  (single.constraints as Json).multi_destination = false;
  (single.cargo_units as Json[])[1].destination_ref = null;
  assertEquals(deriveOpenPoints(single), []);
});

Deno.test("un draft peut conserver des points ouverts non couverts : aucune garde pricing", () => {
  const normalized = expectOk(
    createPayload({
      scope_snapshot: shapeExportAirIncomplete(),
      title: "Périmètre aérien",
    }),
  );
  assertEquals(normalized.status, "draft");
  assertEquals(normalized.open_points?.length, 6);
  assertEquals(normalized.links, []);
});

// ── 5. Snapshot fermé : monnaie, décimaux, UUID, dépassement ───────────────

Deno.test("toute clé monétaire est rejetée, à toute profondeur", () => {
  for (
    const key of [
      "total_amount",
      "unit_price",
      "freight_cost",
      "vat",
      "currency",
      "taux",
    ]
  ) {
    assertEquals(hasMonetaryKeyToken(key), true, key);
    assertEquals(
      snapshotStructuralViolation({ [key]: 1 }),
      `monetary_key:${key}`,
      key,
    );
  }
  // En profondeur, sous un tableau, la clé est trouvée tout autant.
  assertEquals(
    snapshotStructuralViolation({ cargo_units: [{ nested: { total: 3 } }] }),
    "monetary_key:total",
  );
  // Et le snapshot complet est rejeté AVANT tout contrôle de schéma.
  const snapshot = shapeImportMaritimeClean() as Json;
  (snapshot.cargo_units as Json[])[0].freight_rate = 1200;
  const checked = validateScopeSnapshot(snapshot);
  assert(!checked.ok);
  assert(
    checked.message.includes("monetary_key:freight_rate"),
    checked.message,
  );
});

Deno.test("les clés légitimes contenant un fragment monétaire survivent", () => {
  // Comparaison TOKEN À TOKEN : `chargeable_weight_kg` contient « charge »,
  // `separate_documents` contient « rate », `taux` n'est pas un sous-mot ici.
  for (
    const key of [
      "chargeable_weight_kg",
      "separate_documents",
      "gross_weight_kg",
    ]
  ) {
    assertEquals(hasMonetaryKeyToken(key), false, key);
  }
  assert(validateScopeSnapshot(shapeExportAirIncomplete()).ok);
});

Deno.test("aucun nombre décimal dans un périmètre", () => {
  assertEquals(
    snapshotStructuralViolation({ quantity: 1.5 }),
    "non_integer_number:1.5",
  );
  assertEquals(
    snapshotStructuralViolation({ quantity: Number.NaN }),
    "non_finite_number",
  );

  const snapshot = shapeImportMaritimeClean();
  (snapshot.cargo_units as Json[])[0].gross_weight_kg = 18000.5;
  assert(!validateScopeSnapshot(snapshot).ok);

  // Consigne de température : entière ou rien.
  const reefer = shapeReeferConflict();
  (reefer.cargo_units as Json[])[1].temperature_setpoint_celsius = -18.5;
  const checked = validateScopeSnapshot(reefer);
  assert(!checked.ok);
  assert(checked.message.includes("non_integer_number"), checked.message);
});

Deno.test("aucun UUID dans un périmètre", () => {
  assertEquals(
    snapshotStructuralViolation({
      ref: "3f1c0b2a-7d4e-4c8b-9a1f-2e5d6c7b8a90",
    }),
    "uuid_in_snapshot",
  );
  // Majuscules comprises : le motif SQL est insensible à la casse.
  assertEquals(
    snapshotStructuralViolation({
      ref: "3F1C0B2A-7D4E-4C8B-9A1F-2E5D6C7B8A90",
    }),
    "uuid_in_snapshot",
  );
  // Un identifiant de ligne glissé dans une référence anonyme est refusé, alors
  // même qu'il satisferait le format des références.
  const snapshot = shapeImportMaritimeClean();
  (snapshot.cargo_units as Json[])[0].destination_ref = ASSUMPTION_ID;
  const checked = validateScopeSnapshot(snapshot);
  assert(!checked.ok);
  assert(checked.message.includes("uuid_in_snapshot"), checked.message);

  // Une référence anonyme voisine reste acceptée.
  assertEquals(snapshotStructuralViolation({ ref: "dest-3f1c0b2a" }), null);
});

Deno.test("le périmètre est borné : profondeur, longueur de chaîne, taille", () => {
  const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  assertEquals(snapshotStructuralViolation(deep), "depth_exceeded:6");
  assertEquals(
    snapshotStructuralViolation({ ref: "x".repeat(201) }),
    "string_too_long",
  );
  assertEquals(
    snapshotStructuralViolation({ ref: "xy" }),
    "control_character",
  );
  assertEquals(
    snapshotStructuralViolation({ q: 1_000_000_000_001 }),
    "integer_out_of_range:1000000000001",
  );

  // Un objet volumineux dépasse la borne mesurée à la façon de PostgreSQL, et
  // le snapshot correspondant est refusé.
  const bulky: Json = {};
  for (let i = 0; i < 400; i++) bulky[`key_${i}`] = "v".repeat(60);
  assert(jsonbTextByteLength(bulky) > MAX_SNAPSHOT_BYTES);
  assert(!validateScopeSnapshot(bulky).ok);
});

Deno.test("la taille est mesurée comme PostgreSQL rend le jsonb", () => {
  // PostgreSQL insère un espace après chaque `:` et chaque `,` : mesurer la
  // forme compacte laisserait passer un payload que le CHECK refuserait.
  assertEquals(
    jsonbTextByteLength({ a: 1, b: [1, 2] }),
    '{"a": 1, "b": [1, 2]}'.length,
  );
  assertEquals(jsonbTextByteLength({}), 2);
  assertEquals(jsonbTextByteLength({ a: "é" }), '{"a": "é"}'.length + 1); // é = 2 octets
});

Deno.test("le périmètre est un vocabulaire FERMÉ", () => {
  const snapshot = shapeImportMaritimeClean();
  snapshot.extra_dimension = "x";
  assert(!validateScopeSnapshot(snapshot).ok);

  const unit = shapeImportMaritimeClean();
  (unit.cargo_units as Json[])[0].extra_field = "x";
  assert(!validateScopeSnapshot(unit).ok);

  for (
    const [field, value] of [
      ["schema_version", 2],
      ["transport_mode", "RAIL"],
      ["movement_direction", "DOMESTIC"],
    ] as const
  ) {
    const bad = shapeImportMaritimeClean();
    bad[field] = value;
    assert(!validateScopeSnapshot(bad).ok, String(field));
  }
});

Deno.test("le nombre de lots est borné et un périmètre décrit au moins un lot", () => {
  const empty = shapeImportMaritimeClean();
  empty.cargo_units = [];
  assert(!validateScopeSnapshot(empty).ok);

  const absent = shapeImportMaritimeClean();
  delete absent.cargo_units;
  assert(!validateScopeSnapshot(absent).ok);

  const full = shapeImportMaritimeClean();
  full.cargo_units = Array.from(
    { length: MAX_CARGO_UNITS },
    (_, i) => cleanUnit(`lot-${i + 1}`),
  );
  assert(validateScopeSnapshot(full).ok);
  assertEquals(MIN_CARGO_UNITS, 1);

  const tooMany = shapeImportMaritimeClean();
  tooMany.cargo_units = Array.from(
    { length: MAX_CARGO_UNITS + 1 },
    (_, i) => cleanUnit(`lot-${i + 1}`),
  );
  assert(!validateScopeSnapshot(tooMany).ok);

  const duplicated = shapeImportMaritimeClean();
  duplicated.cargo_units = [cleanUnit("lot-1"), cleanUnit("lot-1")];
  assert(!validateScopeSnapshot(duplicated).ok);
});

// ── 6. Empreinte : stable par permutation, sensible au contenu ─────────────

Deno.test("stableStringify trie les clés récursivement sans reparser les chaînes", () => {
  assertEquals(
    stableStringify({ b: 1, a: { d: 2, c: 3 } }),
    stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
  );
  // L'ordre d'un tableau reste significatif : deux lots permutés ne sont pas
  // le même périmètre tant que la base n'a pas tranché.
  assertNotEquals(stableStringify([1, 2]), stableStringify([2, 1]));
  // Une chaîne ressemblant à du JSON reste une chaîne (sinon un rejeu passerait
  // pour un contenu identique).
  assertNotEquals(stableStringify('{"a":1}'), stableStringify({ a: 1 }));
});

Deno.test("l'empreinte est insensible à l'ordre des clés et des liens", async () => {
  const links = [
    {
      reserve_code: "MISSING_HS_CODE",
      open_point_key: "commodity_classification_unknown:lot-1",
    },
    { assumption_id: ASSUMPTION_ID, open_point_key: "packaging_unknown:lot-1" },
  ];
  const base = createPayload({
    scope_snapshot: shapeExportAirIncomplete(),
    title: "Périmètre aérien",
    links,
  });

  // Permutation : clés du snapshot inversées, liens inversés, clés du payload
  // dans un autre ordre. Même contenu ⇒ même empreinte.
  const snapshot = shapeExportAirIncomplete();
  const permutedSnapshot: Json = {};
  for (const key of Object.keys(snapshot).reverse()) {
    permutedSnapshot[key] = snapshot[key];
  }
  const permuted = {
    links: [...links].reverse(),
    title: "Périmètre aérien",
    idempotency_key: KEY,
    scope_snapshot: permutedSnapshot,
    operation: "create",
    case_id: CASE_ID,
  };

  const a = expectOk(base);
  const b = expectOk(permuted);
  assertEquals(
    await computeRequestFingerprint(a),
    await computeRequestFingerprint(b),
  );
  assertEquals(
    stableStringify(buildFingerprintInput(a)),
    stableStringify(buildFingerprintInput(b)),
  );

  // Sensibilité au contenu : un titre différent est une requête différente.
  const other = expectOk(createPayload({
    scope_snapshot: shapeExportAirIncomplete(),
    title: "Périmètre aérien bis",
    links,
  }));
  assertNotEquals(
    await computeRequestFingerprint(a),
    await computeRequestFingerprint(other),
  );

  // La clé d'idempotence NE fait PAS partie de l'empreinte : même contenu,
  // autre clé ⇒ même empreinte (c'est le couple qui décide rejeu vs conflit).
  const sameContent = expectOk(createPayload({
    scope_snapshot: shapeExportAirIncomplete(),
    title: "Périmètre aérien",
    links,
    idempotency_key: "idem-scenario-9999",
  }));
  assertEquals(
    await computeRequestFingerprint(a),
    await computeRequestFingerprint(sameContent),
  );
  assertEquals("idempotency_key" in buildFingerprintInput(a), false);
});

Deno.test("l'empreinte est un SHA-256 hexadécimal minuscule", async () => {
  const fingerprint = await computeRequestFingerprint(
    expectOk(createPayload()),
  );
  assert(/^[0-9a-f]{64}$/.test(fingerprint), fingerprint);
});

// ── 7. Promotion, propagation, identité forgée ─────────────────────────────

Deno.test("toute opération de promotion est refusée avec un code dédié", () => {
  for (const operation of PROMOTION_OPERATIONS) {
    const result = expectFail(createPayload({ operation }));
    assertEquals(result.code, "PROMOTION_NOT_ALLOWED", operation);
    assert(result.message.includes("quote_facts"), operation);
  }
});

Deno.test("toute propagation d'hypothèse est refusée avec un code dédié", () => {
  for (const operation of PROPAGATION_OPERATIONS) {
    const result = expectFail(createPayload({ operation }));
    assertEquals(result.code, "PROPAGATION_NOT_ALLOWED", operation);
  }
});

Deno.test("le refus de promotion précède toute autre analyse", () => {
  // Payload par ailleurs vide : le motif reste la promotion, pas la forme.
  assertEquals(
    expectFail({ operation: "promote_to_final" }).code,
    "PROMOTION_NOT_ALLOWED",
  );
});

Deno.test("identité, état et dérivés ne sont jamais acceptés depuis le payload", () => {
  for (const key of FORBIDDEN_PAYLOAD_KEYS) {
    const result = expectFail(createPayload({ [key]: "x" }));
    assertEquals(result.code, "VALIDATION_FAILED", key);
    assert(
      result.message.includes(key),
      `${key} absent du motif : ${result.message}`,
    );
  }
  // Y compris posés à null : c'est la PRÉSENCE de la clé qui est refusée.
  assert(
    !validateManageScenarioPayload(createPayload({ scope_hash: null })).ok,
  );
});

Deno.test("les points ouverts ne peuvent pas être déclarés par l'appelant", () => {
  const result = expectFail(
    createPayload({
      open_points: [{
        key: "packaging_unknown:lot-1",
        code: "packaging_unknown",
      }],
    }),
  );
  assert(result.message.includes("open_points"), result.message);
});

Deno.test("P1-A2 n'écrit que draft et blocked, et blocked n'est jamais muet", () => {
  assertEquals([...SCENARIO_WRITABLE_STATUSES], ["draft", "blocked"]);

  for (
    const status of [
      "provisional_estimated",
      "partial_scoped",
      "superseded",
      "promoted_to_final",
    ]
  ) {
    assert(
      !validateManageScenarioPayload(createPayload({ status })).ok,
      status,
    );
  }

  const blocked = expectOk(createPayload({
    status: "blocked",
    blocked_reason: "Attente de la position douanière du client",
  }));
  assertEquals(blocked.status, "blocked");
  assertEquals(
    blocked.blocked_reason,
    "Attente de la position douanière du client",
  );

  assert(
    !validateManageScenarioPayload(createPayload({ status: "blocked" })).ok,
  );
  assert(
    !validateManageScenarioPayload(
      createPayload({ status: "blocked", blocked_reason: "  " }),
    ).ok,
  );
  assert(
    !validateManageScenarioPayload(
      createPayload({ blocked_reason: "sans blocage" }),
    ).ok,
  );
});

Deno.test("liens : hypothèse XOR réserve, whitelist doctrinale, point ouvert réel", () => {
  const withSnapshot = (links: unknown) =>
    createPayload({ scope_snapshot: shapeExportAirIncomplete(), links });

  assertEquals([...RESERVE_CODES].length, 5);

  const ok = expectOk(withSnapshot([
    { assumption_id: ASSUMPTION_ID, open_point_key: "packaging_unknown:lot-1" },
    {
      reserve_code: "MISSING_HS_CODE",
      open_point_key: "commodity_classification_unknown:lot-1",
    },
    { reserve_code: "PARTNER_COST_PENDING" },
  ]));
  assertEquals(ok.links?.length, 3);

  // XOR : ni les deux, ni aucun.
  assert(
    !validateManageScenarioPayload(
      withSnapshot([{
        assumption_id: ASSUMPTION_ID,
        reserve_code: "MISSING_HS_CODE",
      }]),
    ).ok,
  );
  assert(
    !validateManageScenarioPayload(withSnapshot([{ open_point_key: null }])).ok,
  );

  // Réserve hors whitelist doctrinale.
  assert(
    !validateManageScenarioPayload(
      withSnapshot([{ reserve_code: "MISSING_MARGIN" }]),
    ).ok,
  );

  // Point ouvert inventé : les points ouverts sont dérivés, jamais déclarés.
  const invented = validateManageScenarioPayload(
    withSnapshot([{
      reserve_code: "MISSING_HS_CODE",
      open_point_key: "packaging_unknown:lot-9",
    }]),
  );
  assert(!invented.ok);
  assert(invented.message.includes("dérivés"), invented.message);

  // Doublon exact.
  assert(
    !validateManageScenarioPayload(withSnapshot([
      { reserve_code: "MISSING_HS_CODE" },
      { reserve_code: "MISSING_HS_CODE" },
    ])).ok,
  );

  // Identifiant d'hypothèse non UUID.
  assert(
    !validateManageScenarioPayload(withSnapshot([{ assumption_id: "lot-1" }]))
      .ok,
  );
});

Deno.test("révision et sélection : cible obligatoire, motif tracé, sélection nue", () => {
  // create ne désigne aucune cible.
  assert(
    !validateManageScenarioPayload(createPayload({ scenario_id: SCENARIO_ID }))
      .ok,
  );
  assert(
    !validateManageScenarioPayload(createPayload({ revision_reason: "motif" }))
      .ok,
  );

  // revise : cible + motif.
  const revise = expectOk(createPayload({
    operation: "revise",
    scenario_id: SCENARIO_ID,
    revision_reason: "Le client a confirmé le port de livraison",
  }));
  assertEquals(revise.scenario_id, SCENARIO_ID);
  assertEquals(
    revise.revision_reason,
    "Le client a confirmé le port de livraison",
  );

  assert(
    !validateManageScenarioPayload(createPayload({
      operation: "revise",
      scenario_id: SCENARIO_ID,
    })).ok,
  );
  assert(
    !validateManageScenarioPayload(createPayload({
      operation: "revise",
      revision_reason: "motif",
    })).ok,
  );

  // select : acte séparé, ne redéfinit RIEN.
  const select = expectOk({
    case_id: CASE_ID,
    operation: "select",
    idempotency_key: KEY,
    scenario_id: SCENARIO_ID,
  });
  assertEquals(select.scope_snapshot, null);
  assertEquals(select.title, null);
  assertEquals(select.open_points, null);

  for (
    const field of [
      "title",
      "scope_snapshot",
      "status",
      "links",
      "revision_reason",
    ]
  ) {
    const result = validateManageScenarioPayload({
      case_id: CASE_ID,
      operation: "select",
      idempotency_key: KEY,
      scenario_id: SCENARIO_ID,
      [field]: field === "scope_snapshot" ? shapeImportMaritimeClean() : "x",
    });
    assert(!result.ok, field);
  }
});

Deno.test("forme du payload : opération, dossier et clé d'idempotence", () => {
  assert(!validateManageScenarioPayload("create").ok);
  assert(
    !validateManageScenarioPayload(createPayload({ operation: "delete" })).ok,
  );
  assert(
    !validateManageScenarioPayload(createPayload({ case_id: "case-1" })).ok,
  );
  assert(
    !validateManageScenarioPayload(createPayload({ idempotency_key: "court" }))
      .ok,
  );
  assert(
    !validateManageScenarioPayload(
      createPayload({ idempotency_key: "x".repeat(129) }),
    ).ok,
  );
  assert(!validateManageScenarioPayload(createPayload({ title: "   " })).ok);
  assert(
    !validateManageScenarioPayload(createPayload({ title: "t".repeat(201) }))
      .ok,
  );
});

Deno.test("les arguments RPC portent l'acteur du JWT, jamais celui du payload", () => {
  const request = expectOk(createPayload());
  const args = buildRpcArgs(request, ACTOR_ID, "a".repeat(64));

  assertEquals(args.p_actor_user_id, ACTOR_ID);
  assertEquals(args.p_case_id, CASE_ID);
  assertEquals(args.p_operation, "create");
  assertEquals(args.p_request_fingerprint, "a".repeat(64));
  assertEquals(args.p_scenario_id, null);
  assertEquals(args.p_open_points, []);

  // Aucun argument d'identité, d'état ou de tarif n'existe dans le contrat RPC.
  const names = Object.keys(args);
  assertEquals(names.every((n) => n.startsWith("p_")), true);
  for (
    const forbidden of [
      "p_scope_hash",
      "p_created_by",
      "p_price",
      "p_amount",
      "p_promote",
    ]
  ) {
    assertEquals(names.includes(forbidden), false, forbidden);
  }
});

// ── 8. Traduction des erreurs de la RPC ────────────────────────────────────

Deno.test("chaque code d'erreur levé par la RPC est traduit explicitement", () => {
  const expected: Array<[string, string]> = [
    ["PROMOTION_NOT_ALLOWED: hors périmètre", "VALIDATION_FAILED"],
    ["PROPAGATION_NOT_ALLOWED: jamais", "VALIDATION_FAILED"],
    ["PRICING_NOT_ALLOWED: aucun prix", "VALIDATION_FAILED"],
    [
      "SNAPSHOT_REJECTED: périmètre non conforme (monetary_key:total)",
      "VALIDATION_FAILED",
    ],
    [
      "OPEN_POINTS_FORGED: les points ouverts sont dérivés du périmètre par la base (2 dérivé(s)), jamais déclarés par l'appelant (0 fourni(s))",
      "VALIDATION_FAILED",
    ],
    ["VALIDATION_FAILED: title est obligatoire", "VALIDATION_FAILED"],
    ["NOT_FOUND: scénario introuvable", "VALIDATION_FAILED"],
    ["FORBIDDEN_CROSS_CASE: autre dossier", "FORBIDDEN_OWNER"],
    ["FORBIDDEN_IDENTITY: utilisateur inconnu", "FORBIDDEN_OWNER"],
    ["IDEMPOTENCY_CONFLICT: contenu différent", "CONFLICT_INVALID_STATE"],
    ["CONFLICT_INVALID_STATE: scénario supersédé", "CONFLICT_INVALID_STATE"],
  ];
  for (const [message, code] of expected) {
    assertEquals(mapRpcErrorCode(message), code, message);
  }
  // Rien n'est deviné : un message inconnu reste une erreur base opaque.
  assertEquals(mapRpcErrorCode("deadlock detected"), "UPSTREAM_DB_ERROR");
  assertEquals(mapRpcErrorCode(""), "UPSTREAM_DB_ERROR");
});
