/**
 * Phase P1-A2 — Contrat front des scénarios de périmètre.
 *
 * Tests purs : aucun mock Supabase, aucun appel réseau, aucun DOM. Ils
 * verrouillent ce que l'UI a le droit d'envoyer et ce qu'elle affiche ;
 * l'autorité reste `manage-quote-scenario/domain.ts`, la RPC service_role-only
 * et les CHECK de la table (migration 20260828200000).
 *
 * Couvre : création / révision / sélection, champs interdits, LoLo/RoRo/ConRo,
 * comparaison par `unit_ref` (permutation sans faux écart, écart réel),
 * bornes et entiers, motif de blocage, liens, références anonymes.
 */

import { describe, expect, it } from "vitest";
import {
  buildScenarioRequestBody,
  buildScopeSnapshot,
  canReviseScenario,
  canSelectScenario,
  compareOpenPoints,
  compareScenarioScopes,
  deriveScenarioOpenPoints,
  draftFromScenario,
  emptyCargoUnitDraft,
  emptyScenarioDraft,
  FORBIDDEN_PAYLOAD_KEYS,
  formatOpenPoint,
  jsonbTextByteLength,
  MAX_CARGO_UNITS,
  readStoredOpenPoints,
  RESERVE_CODES,
  scenarioMutationSignature,
  TERMINAL_MODE_UNSPECIFIED,
  type CargoUnitDraft,
  type ScenarioDraft,
  type ScenarioOpenPoint,
} from "./quoteScenarios";

const CASE_ID = "11111111-1111-1111-1111-111111111111";
const SCENARIO_ID = "22222222-2222-2222-2222-222222222222";
const ASSUMPTION_ID = "33333333-3333-3333-3333-333333333333";
const KEY = "idem-scenario-0001";

/** Lot entièrement renseigné : aucune ambiguïté, donc aucun point ouvert. */
function cleanUnit(ref: string, overrides: Partial<CargoUnitDraft> = {}): CargoUnitDraft {
  return {
    ...emptyCargoUnitDraft(1),
    unitRef: ref,
    unitKind: "CONTAINER",
    equipmentKnown: true,
    equipmentCode: "eq-40hc",
    packaging: "palletized",
    quantity: "1",
    grossWeightKg: "18000",
    chargeableWeightKg: "18000",
    volumeDm3: "60000",
    temperatureControlRequired: false,
    temperatureSetpointCelsius: "",
    classificationStatus: "confirmed",
    destinationRef: "dest-main",
    dangerousGoods: false,
    requiredAttachmentStatus: "not_required",
    ...overrides,
  };
}

/** Périmètre net : import maritime conteneurisé entièrement confirmé. */
function cleanDraft(overrides: Partial<ScenarioDraft> = {}): ScenarioDraft {
  return {
    ...emptyScenarioDraft(),
    title: "Périmètre import conteneurisé",
    transportMode: "MARITIME",
    movementDirection: "IMPORT",
    terminalOperationMode: "LOLO",
    origin: {
      locationKind: "PORT",
      locationStatus: "confirmed",
      locationCode: "port-a",
      alternatives: "",
    },
    destination: {
      locationKind: "PORT",
      locationStatus: "confirmed",
      locationCode: "port-b",
      alternatives: "",
    },
    cargoUnits: [cleanUnit("lot-1")],
    customsRegimeStatus: "known",
    customsRegimeCode: "reg-c400",
    customsSplitDeclarations: false,
    bookingStage: "booked",
    bookingCarrierRef: "carrier-x",
    documentsSplitRequired: false,
    documentsSetsCount: "1",
    partiesPayerIsShipper: true,
    partiesPayerRef: "party-1",
    partiesConsigneeRef: "party-2",
    constraintsMultiDestination: false,
    constraintsTransitCountryRefs: "",
    ...overrides,
  };
}

function snapshotOf(draft: ScenarioDraft): Record<string, unknown> {
  const built = buildScopeSnapshot(draft);
  if (!built.ok) throw new Error(`snapshot invalide : ${built.message}`);
  return built.snapshot;
}

function bodyOf(
  draft: ScenarioDraft | null,
  operation: "create" | "revise" | "select" = "create",
  scenarioId?: string,
): Record<string, unknown> {
  const built = buildScenarioRequestBody(CASE_ID, operation, KEY, draft, scenarioId);
  if (!built.ok) throw new Error(`payload invalide : ${built.message}`);
  return built.body;
}

const keysOf = (points: ScenarioOpenPoint[]) => points.map((p) => p.key);

describe("identité locale d'une mutation logique", () => {
  it("reste stable pour un rejeu strictement identique", () => {
    const draft = cleanDraft();
    expect(scenarioMutationSignature(CASE_ID, "create", draft)).toBe(
      scenarioMutationSignature(CASE_ID, "create", draft),
    );
  });

  it("change quand le contenu, l'opération ou la cible change", () => {
    const draft = cleanDraft();
    const base = scenarioMutationSignature(CASE_ID, "create", draft);

    expect(scenarioMutationSignature(CASE_ID, "create", { ...draft, title: "Autre" })).not.toBe(base);
    expect(scenarioMutationSignature(CASE_ID, "revise", draft, SCENARIO_ID)).not.toBe(base);
    expect(scenarioMutationSignature(CASE_ID, "select", null, SCENARIO_ID)).not.toBe(
      scenarioMutationSignature(
        CASE_ID,
        "select",
        null,
        "44444444-4444-4444-8444-444444444444",
      ),
    );
  });
});

// ── 1. Création, révision, sélection ───────────────────────────────────────

describe("buildScenarioRequestBody", () => {
  it("construit une création complète et rien de plus", () => {
    const body = bodyOf(cleanDraft());
    expect(Object.keys(body).sort()).toEqual([
      "case_id",
      "idempotency_key",
      "links",
      "operation",
      "scope_snapshot",
      "status",
      "title",
    ]);
    expect(body.case_id).toBe(CASE_ID);
    expect(body.operation).toBe("create");
    expect(body.status).toBe("draft");
    expect(body.title).toBe("Périmètre import conteneurisé");
    expect(body.links).toEqual([]);
  });

  it("refuse une création qui désigne un scénario existant", () => {
    const result = buildScenarioRequestBody(CASE_ID, "create", KEY, cleanDraft(), SCENARIO_ID);
    expect(result.ok).toBe(false);
  });

  it("une révision exige sa cible et son motif", () => {
    const draft = cleanDraft({ revisionReason: "Le client a confirmé le port de livraison" });
    const body = bodyOf(draft, "revise", SCENARIO_ID);
    expect(body.scenario_id).toBe(SCENARIO_ID);
    expect(body.revision_reason).toBe("Le client a confirmé le port de livraison");

    expect(buildScenarioRequestBody(CASE_ID, "revise", KEY, draft).ok).toBe(false);
    expect(
      buildScenarioRequestBody(CASE_ID, "revise", KEY, cleanDraft(), SCENARIO_ID).ok,
    ).toBe(false);
    expect(
      buildScenarioRequestBody(
        CASE_ID,
        "revise",
        KEY,
        cleanDraft({ revisionReason: "   " }),
        SCENARIO_ID,
      ).ok,
    ).toBe(false);
    expect(
      buildScenarioRequestBody(
        CASE_ID,
        "revise",
        KEY,
        cleanDraft({ revisionReason: "x".repeat(501) }),
        SCENARIO_ID,
      ).ok,
    ).toBe(false);
  });

  it("une création n'émet jamais de motif de révision", () => {
    const body = bodyOf(cleanDraft({ revisionReason: "motif saisi puis abandonné" }));
    expect("revision_reason" in body).toBe(false);
  });

  it("sélectionner est un acte SÉPARÉ qui ne redéfinit rien", () => {
    const body = bodyOf(null, "select", SCENARIO_ID);
    expect(Object.keys(body).sort()).toEqual([
      "case_id",
      "idempotency_key",
      "operation",
      "scenario_id",
    ]);
    for (const field of ["title", "scope_snapshot", "status", "links", "revision_reason"]) {
      expect(field in body).toBe(false);
    }
    expect(buildScenarioRequestBody(CASE_ID, "select", KEY, null).ok).toBe(false);
    expect(buildScenarioRequestBody(CASE_ID, "select", KEY, null, "lot-1").ok).toBe(false);
  });

  it("dossier et clé d'idempotence sont contrôlés avant tout", () => {
    expect(buildScenarioRequestBody("case-1", "create", KEY, cleanDraft()).ok).toBe(false);
    expect(buildScenarioRequestBody(CASE_ID, "create", "court", cleanDraft()).ok).toBe(false);
    expect(
      buildScenarioRequestBody(CASE_ID, "create", "x".repeat(129), cleanDraft()).ok,
    ).toBe(false);
    expect(buildScenarioRequestBody(CASE_ID, "create", KEY, null).ok).toBe(false);
  });

  it("le titre est obligatoire et borné", () => {
    expect(buildScenarioRequestBody(CASE_ID, "create", KEY, cleanDraft({ title: "  " })).ok).toBe(
      false,
    );
    expect(
      buildScenarioRequestBody(CASE_ID, "create", KEY, cleanDraft({ title: "t".repeat(201) })).ok,
    ).toBe(false);
    expect(bodyOf(cleanDraft({ title: "  Titre entouré d'espaces  " })).title).toBe(
      "Titre entouré d'espaces",
    );
  });
});

// ── 2. Champs interdits : identité, état, dérivés ──────────────────────────

describe("champs interdits", () => {
  it("aucun payload ne porte d'identité, d'état dérivé, de hash ni de points ouverts", () => {
    const bodies = [
      bodyOf(cleanDraft()),
      bodyOf(cleanDraft({ revisionReason: "motif" }), "revise", SCENARIO_ID),
      bodyOf(null, "select", SCENARIO_ID),
      bodyOf(cleanDraft({ status: "blocked", blockedReason: "Attente position douanière" })),
    ];
    for (const body of bodies) {
      for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
        expect(forbidden in body).toBe(false);
      }
    }
  });

  it("le périmètre ne porte aucune clé monétaire ni aucun identifiant technique", () => {
    const monetary = new Set([
      "price",
      "pricing",
      "tarif",
      "rate",
      "amount",
      "total",
      "cost",
      "fee",
      "charge",
      "currency",
      "vat",
      "tva",
      "xof",
    ]);
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          expect(key).toMatch(/^[a-z][a-z0-9_]{0,48}$/);
          for (const token of key.split("_")) expect(monetary.has(token)).toBe(false);
          walk(value);
        }
        return;
      }
      if (typeof node === "number") expect(Number.isInteger(node)).toBe(true);
      if (typeof node === "string") {
        expect(node).not.toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    };
    walk(snapshotOf(cleanDraft()));
    walk(snapshotOf(emptyScenarioDraft()));
  });

  it("le périmètre est un vocabulaire FERMÉ v1", () => {
    const snapshot = snapshotOf(cleanDraft());
    expect(snapshot.schema_version).toBe(1);
    expect(Object.keys(snapshot).sort()).toEqual([
      "booking",
      "cargo_units",
      "constraints",
      "customs",
      "destination",
      "documents",
      "movement_direction",
      "origin",
      "parties",
      "schema_version",
      "terminal_operation_mode",
      "transport_mode",
    ]);
    const unit = (snapshot.cargo_units as Record<string, unknown>[])[0];
    expect(Object.keys(unit).sort()).toEqual([
      "chargeable_weight_kg",
      "classification_status",
      "dangerous_goods",
      "destination_ref",
      "equipment_code",
      "gross_weight_kg",
      "packaging",
      "quantity",
      "required_attachment_status",
      "temperature_control_required",
      "temperature_setpoint_celsius",
      "unit_kind",
      "unit_ref",
      "volume_dm3",
    ]);
  });
});

// ── 3. LoLo / RoRo / ConRo : descriptifs, légitimes, sans tarif ────────────

describe("mode d'opération terminal", () => {
  it("LoLo, RoRo et ConRo sont des périmètres légitimes et n'ouvrent aucun point", () => {
    for (const mode of ["LOLO", "RORO", "CONRO"] as const) {
      const snapshot = snapshotOf(cleanDraft({ terminalOperationMode: mode }));
      expect(snapshot.terminal_operation_mode).toBe(mode);
      expect(deriveScenarioOpenPoints(snapshot)).toEqual([]);
    }
  });

  it("un réexport RoRo de véhicules est accepté tel quel", () => {
    const snapshot = snapshotOf(
      cleanDraft({
        movementDirection: "REEXPORT",
        terminalOperationMode: "RORO",
        destination: {
          locationKind: "PORT",
          locationStatus: "confirmed",
          locationCode: "port-c",
          alternatives: "",
        },
        cargoUnits: [
          cleanUnit("lot-1", {
            unitKind: "VEHICLE",
            equipmentCode: "eq-self-propelled",
            packaging: "unpacked",
            quantity: "3",
            grossWeightKg: "4200",
            chargeableWeightKg: "4200",
            volumeDm3: "24000",
            destinationRef: "dest-c",
          }),
        ],
      }),
    );
    expect(deriveScenarioOpenPoints(snapshot)).toEqual([]);
    expect((snapshot.cargo_units as Record<string, unknown>[])[0].unit_kind).toBe("VEHICLE");
  });

  it("« non renseigné » se dit explicitement et n'ouvre un point qu'en maritime", () => {
    const maritime = snapshotOf(
      cleanDraft({ terminalOperationMode: TERMINAL_MODE_UNSPECIFIED }),
    );
    expect(maritime.terminal_operation_mode).toBeNull();
    expect(keysOf(deriveScenarioOpenPoints(maritime))).toEqual([
      "terminal_operation_mode_unknown",
    ]);

    for (const mode of ["AIR", "ROUTE", "MULTIMODAL"] as const) {
      const other = snapshotOf(
        cleanDraft({
          transportMode: mode,
          terminalOperationMode: TERMINAL_MODE_UNSPECIFIED,
          cargoUnits: [cleanUnit("lot-1")],
        }),
      );
      expect(keysOf(deriveScenarioOpenPoints(other))).not.toContain(
        "terminal_operation_mode_unknown",
      );
    }
  });
});

// ── 4. Points ouverts : dérivés, triés, jamais des contraintes connues ─────

describe("aperçu des points ouverts", () => {
  it("un périmètre net n'ouvre rien", () => {
    expect(deriveScenarioOpenPoints(snapshotOf(cleanDraft()))).toEqual([]);
  });

  it("un export aérien incomplet ouvre exactement ses manques", () => {
    const snapshot = snapshotOf(
      cleanDraft({
        transportMode: "AIR",
        movementDirection: "EXPORT",
        terminalOperationMode: TERMINAL_MODE_UNSPECIFIED,
        origin: {
          locationKind: "AIRPORT",
          locationStatus: "confirmed",
          locationCode: "apt-a",
          alternatives: "",
        },
        destination: {
          locationKind: "AIRPORT",
          locationStatus: "confirmed",
          locationCode: "apt-b",
          alternatives: "",
        },
        cargoUnits: [
          cleanUnit("lot-1", {
            unitKind: "PALLET",
            equipmentKnown: false,
            equipmentCode: "",
            packaging: "unknown",
            quantity: "4",
            grossWeightKg: "850",
            chargeableWeightKg: "",
            volumeDm3: "3200",
            classificationStatus: "unknown",
            // Marchandise dangereuse DÉCLARÉE : contrainte connue, pas une ambiguïté.
            dangerousGoods: true,
            requiredAttachmentStatus: "missing",
          }),
        ],
        customsRegimeStatus: "unknown",
        customsRegimeCode: "",
        bookingStage: "none",
        bookingCarrierRef: "",
      }),
    );
    expect(keysOf(deriveScenarioOpenPoints(snapshot))).toEqual([
      "attachment_required:lot-1",
      "chargeable_basis_unconfirmed:lot-1",
      "commodity_classification_unknown:lot-1",
      "customs_regime_unknown",
      "equipment_unknown:lot-1",
      "packaging_unknown:lot-1",
    ]);
  });

  it("les contraintes CONNUES n'ouvrent aucun point", () => {
    // DG + transit + payeur distinct + jeux documentaires séparés + déclarations
    // scindées + multi-destination entièrement affectée + ConRo.
    const snapshot = snapshotOf(
      cleanDraft({
        movementDirection: "CROSS_TRADE",
        terminalOperationMode: "CONRO",
        cargoUnits: [
          cleanUnit("lot-1", { destinationRef: "dest-a", dangerousGoods: true }),
          cleanUnit("lot-2", { destinationRef: "dest-b", unitKind: "VEHICLE" }),
        ],
        customsSplitDeclarations: true,
        documentsSplitRequired: true,
        documentsSetsCount: "3",
        partiesPayerIsShipper: false,
        partiesPayerRef: "party-9",
        partiesConsigneeRef: "party-8",
        constraintsMultiDestination: true,
        constraintsTransitCountryRefs: "ctry-1, ctry-2",
      }),
    );
    expect(deriveScenarioOpenPoints(snapshot)).toEqual([]);
  });

  it("seule une répartition multi-destination incomplète ouvre un point", () => {
    const partial = snapshotOf(
      cleanDraft({
        cargoUnits: [cleanUnit("lot-1"), cleanUnit("lot-2", { destinationRef: "" })],
        constraintsMultiDestination: true,
      }),
    );
    expect(keysOf(deriveScenarioOpenPoints(partial))).toEqual(["destination_split_unknown"]);

    const single = snapshotOf(
      cleanDraft({
        cargoUnits: [cleanUnit("lot-1"), cleanUnit("lot-2", { destinationRef: "" })],
        constraintsMultiDestination: false,
      }),
    );
    expect(deriveScenarioOpenPoints(single)).toEqual([]);
  });

  it("un périmètre vierge n'invente rien : il dit ce qu'il ignore", () => {
    const snapshot = snapshotOf(emptyScenarioDraft());
    expect(keysOf(deriveScenarioOpenPoints(snapshot))).toEqual([
      "commodity_classification_unknown:lot-1",
      "customs_regime_unknown",
      "equipment_unknown:lot-1",
      "packaging_unknown:lot-1",
      "port_to_propose:destination",
      "port_to_propose:origin",
      "terminal_operation_mode_unknown",
    ]);
  });

  it("la dérivation est pure, triée et ne mute pas le périmètre", () => {
    const snapshot = snapshotOf(emptyScenarioDraft());
    const copy = JSON.parse(JSON.stringify(snapshot));
    const first = deriveScenarioOpenPoints(snapshot);
    expect(deriveScenarioOpenPoints(snapshot)).toEqual(first);
    expect(snapshot).toEqual(copy);
    expect(keysOf(first)).toEqual([...keysOf(first)].sort());
  });

  it("un point ouvert est rendu lisible, jamais opaque", () => {
    expect(formatOpenPoint({ key: "packaging_unknown:lot-1", code: "packaging_unknown", ref: "lot-1" })).toBe(
      "Emballage inconnu — lot-1",
    );
    expect(
      formatOpenPoint({ key: "port_to_propose:origin", code: "port_to_propose", ref: "origin" }),
    ).toBe("Lieu à proposer — origine");
    expect(
      formatOpenPoint({
        key: "customs_regime_unknown",
        code: "customs_regime_unknown",
        ref: null,
      }),
    ).toBe("Régime douanier inconnu");
  });

  it("les points ouverts PERSISTÉS sont lus tels quels, le bruit est ignoré", () => {
    expect(
      readStoredOpenPoints([
        { key: "packaging_unknown:lot-1", code: "packaging_unknown", ref: "lot-1" },
        { key: "customs_regime_unknown", code: "customs_regime_unknown", ref: null },
        "bruit",
        { code: "sans_cle" },
      ]),
    ).toEqual([
      { key: "packaging_unknown:lot-1", code: "packaging_unknown", ref: "lot-1" },
      { key: "customs_regime_unknown", code: "customs_regime_unknown", ref: null },
    ]);
    expect(readStoredOpenPoints(null)).toEqual([]);
  });
});

// ── 5. Bornes, entiers, motif de blocage ───────────────────────────────────

describe("bornes du périmètre", () => {
  it("un périmètre décrit entre 1 et 12 lots", () => {
    expect(buildScopeSnapshot(cleanDraft({ cargoUnits: [] })).ok).toBe(false);

    const full = cleanDraft({
      cargoUnits: Array.from({ length: MAX_CARGO_UNITS }, (_, i) => cleanUnit(`lot-${i + 1}`)),
    });
    expect(buildScopeSnapshot(full).ok).toBe(true);

    const tooMany = cleanDraft({
      cargoUnits: Array.from({ length: MAX_CARGO_UNITS + 1 }, (_, i) => cleanUnit(`lot-${i + 1}`)),
    });
    expect(buildScopeSnapshot(tooMany).ok).toBe(false);
  });

  it("deux lots ne partagent jamais la même référence", () => {
    const result = buildScopeSnapshot(
      cleanDraft({ cargoUnits: [cleanUnit("lot-1"), cleanUnit("lot-1")] }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("lot-1");
  });

  it("aucun nombre décimal, aucune notation exotique", () => {
    for (const quantity of ["1.5", "1e3", "", "deux", "-1", "0", " 2 3 "]) {
      expect(buildScopeSnapshot(cleanDraft({ cargoUnits: [cleanUnit("lot-1", { quantity })] })).ok).toBe(
        false,
      );
    }
    expect(
      buildScopeSnapshot(cleanDraft({ cargoUnits: [cleanUnit("lot-1", { grossWeightKg: "18000.5" })] }))
        .ok,
    ).toBe(false);
    expect(
      buildScopeSnapshot(cleanDraft({ cargoUnits: [cleanUnit("lot-1", { grossWeightKg: "-1" })] })).ok,
    ).toBe(false);
  });

  it("un poids, un volume ou une consigne peut être INCONNU sans être faux", () => {
    const snapshot = snapshotOf(
      cleanDraft({
        cargoUnits: [
          cleanUnit("lot-1", { grossWeightKg: "", chargeableWeightKg: "", volumeDm3: "" }),
        ],
      }),
    );
    const unit = (snapshot.cargo_units as Record<string, unknown>[])[0];
    expect(unit.gross_weight_kg).toBeNull();
    expect(unit.chargeable_weight_kg).toBeNull();
    expect(unit.volume_dm3).toBeNull();
    // Un poids inconnu n'ouvre rien en maritime : la base taxable n'y est pas
    // une dimension du périmètre.
    expect(deriveScenarioOpenPoints(snapshot)).toEqual([]);
  });

  it("la consigne de température est un entier borné", () => {
    const withSetpoint = (temperatureSetpointCelsius: string) =>
      buildScopeSnapshot(
        cleanDraft({
          cargoUnits: [
            cleanUnit("lot-1", { temperatureControlRequired: true, temperatureSetpointCelsius }),
          ],
        }),
      );
    expect(withSetpoint("-18").ok).toBe(true);
    expect(withSetpoint("-18.5").ok).toBe(false);
    expect(withSetpoint("-61").ok).toBe(false);
    expect(withSetpoint("61").ok).toBe(false);

    // Température dirigée sans consigne : manque réel, pas une erreur de saisie.
    const missing = withSetpoint("");
    expect(missing.ok).toBe(true);
    expect(keysOf(deriveScenarioOpenPoints(missing.ok ? missing.snapshot : {}))).toEqual([
      "temperature_setpoint_missing:lot-1",
    ]);
  });

  it("les alternatives de lieu et les pays de transit sont bornés", () => {
    const alternatives = Array.from({ length: 9 }, (_, i) => `alt-${i}`).join(", ");
    expect(
      buildScopeSnapshot(
        cleanDraft({
          destination: {
            locationKind: "PORT",
            locationStatus: "alternatives_open",
            locationCode: "",
            alternatives,
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      buildScopeSnapshot(cleanDraft({ constraintsTransitCountryRefs: alternatives })).ok,
    ).toBe(false);
  });

  it("le nombre de jeux documentaires est un entier >= 1", () => {
    expect(buildScopeSnapshot(cleanDraft({ documentsSetsCount: "0" })).ok).toBe(false);
    expect(buildScopeSnapshot(cleanDraft({ documentsSetsCount: "" })).ok).toBe(false);
    expect(buildScopeSnapshot(cleanDraft({ documentsSetsCount: "3" })).ok).toBe(true);
  });

  it("la taille du périmètre est mesurée comme PostgreSQL rend le jsonb", () => {
    expect(jsonbTextByteLength({ a: 1, b: [1, 2] })).toBe('{"a": 1, "b": [1, 2]}'.length);
    expect(jsonbTextByteLength({})).toBe(2);
    expect(jsonbTextByteLength(snapshotOf(cleanDraft()))).toBeLessThan(16 * 1024);
  });

  it("un scénario bloqué n'est jamais muet", () => {
    expect(
      buildScenarioRequestBody(CASE_ID, "create", KEY, cleanDraft({ status: "blocked" })).ok,
    ).toBe(false);
    expect(
      buildScenarioRequestBody(
        CASE_ID,
        "create",
        KEY,
        cleanDraft({ status: "blocked", blockedReason: "   " }),
      ).ok,
    ).toBe(false);

    const body = bodyOf(
      cleanDraft({ status: "blocked", blockedReason: "Attente de la position douanière du client" }),
    );
    expect(body.status).toBe("blocked");
    expect(body.blocked_reason).toBe("Attente de la position douanière du client");

    // Un motif saisi puis abandonné ne part pas avec un brouillon.
    const draftBody = bodyOf(cleanDraft({ blockedReason: "motif orphelin" }));
    expect("blocked_reason" in draftBody).toBe(false);
  });
});

// ── 6. Références anonymes ─────────────────────────────────────────────────

describe("références anonymes", () => {
  it("aucune donnée client réelle, aucun identifiant technique", () => {
    const badRefs = [
      "Port Autonome de Dakar",
      "PORT-A",
      "client@exemple.com",
      "-port",
      "x".repeat(65),
      ASSUMPTION_ID,
    ];
    for (const ref of badRefs) {
      expect(
        buildScopeSnapshot(
          cleanDraft({
            origin: {
              locationKind: "PORT",
              locationStatus: "confirmed",
              locationCode: ref,
              alternatives: "",
            },
          }),
        ).ok,
      ).toBe(false);
      expect(
        buildScopeSnapshot(cleanDraft({ cargoUnits: [cleanUnit("lot-1", { destinationRef: ref })] }))
          .ok,
      ).toBe(false);
    }
  });

  it("un lieu non arrêté vaut null, jamais une chaîne vide", () => {
    const snapshot = snapshotOf(
      cleanDraft({
        origin: {
          locationKind: "PORT",
          locationStatus: "to_propose",
          locationCode: "",
          alternatives: "",
        },
      }),
    );
    expect((snapshot.origin as Record<string, unknown>).location_code).toBeNull();
    expect("alternatives" in (snapshot.origin as Record<string, unknown>)).toBe(false);
  });

  it("les alternatives sont normalisées, dédupliquées et ordonnées comme saisies", () => {
    const snapshot = snapshotOf(
      cleanDraft({
        destination: {
          locationKind: "INLAND_POINT",
          locationStatus: "alternatives_open",
          locationCode: "",
          alternatives: " inland-b ,inland-c;inland-b ",
        },
      }),
    );
    expect((snapshot.destination as Record<string, unknown>).alternatives).toEqual([
      "inland-b",
      "inland-c",
    ]);
    expect(keysOf(deriveScenarioOpenPoints(snapshot))).toEqual([
      "port_alternatives_open:destination",
    ]);
  });

  it("un équipement déclaré connu doit être nommé", () => {
    expect(
      buildScopeSnapshot(
        cleanDraft({ cargoUnits: [cleanUnit("lot-1", { equipmentKnown: true, equipmentCode: "" })] }),
      ).ok,
    ).toBe(false);

    const snapshot = snapshotOf(
      cleanDraft({
        cargoUnits: [cleanUnit("lot-1", { equipmentKnown: false, equipmentCode: "eq-40hc" })],
      }),
    );
    // « Inconnu » l'emporte sur une saisie résiduelle : l'intention est explicite.
    expect((snapshot.cargo_units as Record<string, unknown>[])[0].equipment_code).toBeNull();
  });
});

// ── 7. Liens : hypothèse XOR réserve, point ouvert réel ────────────────────

describe("liens vers hypothèses et réserves", () => {
  const airDraft = (links: ScenarioDraft["links"]) =>
    cleanDraft({
      transportMode: "AIR",
      terminalOperationMode: TERMINAL_MODE_UNSPECIFIED,
      cargoUnits: [
        cleanUnit("lot-1", {
          packaging: "unknown",
          classificationStatus: "unknown",
          chargeableWeightKg: "",
        }),
      ],
      links,
    });

  it("un lien porte une hypothèse OU une réserve, jamais les deux", () => {
    const body = bodyOf(
      airDraft([
        {
          target: "assumption",
          assumptionId: ASSUMPTION_ID,
          reserveCode: "MISSING_HS_CODE",
          openPointKey: "packaging_unknown:lot-1",
        },
        {
          target: "reserve",
          assumptionId: ASSUMPTION_ID,
          reserveCode: "MISSING_HS_CODE",
          openPointKey: "commodity_classification_unknown:lot-1",
        },
        { target: "reserve", assumptionId: "", reserveCode: "PARTNER_COST_PENDING", openPointKey: "" },
      ]),
    );
    const links = body.links as Record<string, unknown>[];
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(("assumption_id" in link) !== ("reserve_code" in link)).toBe(true);
    }
    // Le jeu de liens est un ENSEMBLE : l'ordre d'envoi est canonique.
    expect(links.map((l) => l.assumption_id ?? l.reserve_code)).toEqual([
      ASSUMPTION_ID,
      "MISSING_HS_CODE",
      "PARTNER_COST_PENDING",
    ]);
  });

  it("une hypothèse liée est désignée par son identifiant, jamais devinée", () => {
    expect(
      buildScenarioRequestBody(
        CASE_ID,
        "create",
        KEY,
        airDraft([
          { target: "assumption", assumptionId: "", reserveCode: "MISSING_HS_CODE", openPointKey: "" },
        ]),
      ).ok,
    ).toBe(false);
    expect(
      buildScenarioRequestBody(
        CASE_ID,
        "create",
        KEY,
        airDraft([
          {
            target: "assumption",
            assumptionId: "lot-1",
            reserveCode: "MISSING_HS_CODE",
            openPointKey: "",
          },
        ]),
      ).ok,
    ).toBe(false);
  });

  it("une réserve reste dans la whitelist doctrinale", () => {
    expect(RESERVE_CODES).toHaveLength(5);
    const result = buildScenarioRequestBody(
      CASE_ID,
      "create",
      KEY,
      airDraft([
        {
          target: "reserve",
          assumptionId: "",
          reserveCode: "MISSING_MARGIN" as never,
          openPointKey: "",
        },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it("un lien ne couvre qu'un point ouvert RÉEL de ce périmètre", () => {
    const result = buildScenarioRequestBody(
      CASE_ID,
      "create",
      KEY,
      airDraft([
        {
          target: "reserve",
          assumptionId: "",
          reserveCode: "MISSING_HS_CODE",
          openPointKey: "packaging_unknown:lot-9",
        },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("dérivés");
  });

  it("un doublon exact est refusé", () => {
    const link = {
      target: "reserve" as const,
      assumptionId: "",
      reserveCode: "MISSING_HS_CODE" as const,
      openPointKey: "",
    };
    expect(buildScenarioRequestBody(CASE_ID, "create", KEY, airDraft([link, link])).ok).toBe(false);
  });

  it("un lien sans couverture de point ouvert reste légitime", () => {
    const body = bodyOf(
      cleanDraft({
        links: [
          {
            target: "reserve",
            assumptionId: "",
            reserveCode: "RATE_PENDING_CONFIRMATION",
            openPointKey: "",
          },
        ],
      }),
    );
    expect(body.links).toEqual([{ reserve_code: "RATE_PENDING_CONFIRMATION" }]);
  });
});

// ── 8. Comparaison : appariement par unit_ref ──────────────────────────────

describe("comparaison de deux périmètres", () => {
  it("permuter les lots ne produit AUCUN écart", () => {
    const a = snapshotOf(
      cleanDraft({
        cargoUnits: [
          cleanUnit("lot-1", { destinationRef: "dest-a" }),
          cleanUnit("lot-2", { destinationRef: "dest-b", unitKind: "VEHICLE" }),
          cleanUnit("lot-3", { destinationRef: "dest-c", quantity: "5" }),
        ],
      }),
    );
    const b = snapshotOf(
      cleanDraft({
        cargoUnits: [
          cleanUnit("lot-3", { destinationRef: "dest-c", quantity: "5" }),
          cleanUnit("lot-1", { destinationRef: "dest-a" }),
          cleanUnit("lot-2", { destinationRef: "dest-b", unitKind: "VEHICLE" }),
        ],
      }),
    );
    const comparison = compareScenarioScopes(a, b);
    expect(comparison.differences).toEqual([]);
    expect(comparison.identical).toBe(true);
    expect(comparison.commonUnitRefs).toEqual(["lot-1", "lot-2", "lot-3"]);
  });

  it("un vrai écart est nommé, lisible et attribué au bon lot", () => {
    const a = snapshotOf(
      cleanDraft({ cargoUnits: [cleanUnit("lot-1"), cleanUnit("lot-2", { quantity: "2" })] }),
    );
    const b = snapshotOf(
      cleanDraft({
        terminalOperationMode: "RORO",
        cargoUnits: [
          cleanUnit("lot-1"),
          cleanUnit("lot-2", { quantity: "7", packaging: "crated" }),
        ],
      }),
    );
    const comparison = compareScenarioScopes(a, b);
    expect(comparison.identical).toBe(false);
    expect(comparison.differences).toEqual([
      {
        path: "terminal_operation_mode",
        label: "Mode d'opération terminal",
        kind: "changed",
        before: "LoLo (levage)",
        after: "RoRo (roulage)",
      },
      {
        path: "cargo_units[lot-2].packaging",
        label: "Lot lot-2 · Emballage",
        kind: "changed",
        before: "Palettisé",
        after: "Caissé",
      },
      {
        path: "cargo_units[lot-2].quantity",
        label: "Lot lot-2 · Quantité",
        kind: "changed",
        before: "2",
        after: "7",
      },
    ]);
  });

  it("un lot ajouté ou retiré est un ajout ou un retrait, pas une avalanche", () => {
    const a = snapshotOf(cleanDraft({ cargoUnits: [cleanUnit("lot-1"), cleanUnit("lot-2")] }));
    const b = snapshotOf(
      cleanDraft({ cargoUnits: [cleanUnit("lot-1"), cleanUnit("lot-3", { unitKind: "PALLET" })] }),
    );
    const comparison = compareScenarioScopes(a, b);
    expect(comparison.removedUnitRefs).toEqual(["lot-2"]);
    expect(comparison.addedUnitRefs).toEqual(["lot-3"]);
    expect(comparison.commonUnitRefs).toEqual(["lot-1"]);
    expect(comparison.differences).toEqual([
      {
        path: "cargo_units[lot-2]",
        label: "Lot lot-2",
        kind: "removed",
        before: "Conteneur · 1 · Palettisé",
        after: null,
      },
      {
        path: "cargo_units[lot-3]",
        label: "Lot lot-3",
        kind: "added",
        before: null,
        after: "Palette · 1 · Palettisé",
      },
    ]);
  });

  it("la comparaison est stable et ne dépend pas de l'ordre des clés", () => {
    const a = snapshotOf(cleanDraft());
    const permuted: Record<string, unknown> = {};
    for (const key of Object.keys(a).reverse()) permuted[key] = a[key];
    expect(compareScenarioScopes(a, permuted).differences).toEqual([]);

    const b = snapshotOf(cleanDraft({ movementDirection: "EXPORT" }));
    const first = compareScenarioScopes(a, b);
    const second = compareScenarioScopes(a, b);
    expect(second).toEqual(first);
  });

  it("aucun dump JSON : chaque écart est un couple de valeurs lisibles", () => {
    const a = snapshotOf(cleanDraft());
    const b = snapshotOf(
      cleanDraft({
        cargoUnits: [cleanUnit("lot-1", { grossWeightKg: "", destinationRef: "" })],
      }),
    );
    const comparison = compareScenarioScopes(a, b);
    expect(comparison.differences).toEqual([
      {
        path: "cargo_units[lot-1].gross_weight_kg",
        label: "Lot lot-1 · Poids brut",
        kind: "changed",
        before: "18000 kg",
        after: "Inconnu",
      },
      {
        path: "cargo_units[lot-1].destination_ref",
        label: "Lot lot-1 · Destination du lot",
        kind: "changed",
        before: "dest-main",
        after: "Non affectée",
      },
    ]);
    for (const diff of comparison.differences) {
      expect(diff.before ?? "").not.toContain("{");
      expect(diff.after ?? "").not.toContain("{");
    }
  });

  it("l'écart de points ouverts distingue ce qui est levé de ce qui s'ouvre", () => {
    const before = deriveScenarioOpenPoints(snapshotOf(emptyScenarioDraft()));
    const after = deriveScenarioOpenPoints(
      snapshotOf(
        cleanDraft({
          cargoUnits: [cleanUnit("lot-1", { temperatureControlRequired: true })],
        }),
      ),
    );
    const { resolved, opened } = compareOpenPoints(before, after);
    expect(keysOf(resolved)).toEqual([
      "commodity_classification_unknown:lot-1",
      "customs_regime_unknown",
      "equipment_unknown:lot-1",
      "packaging_unknown:lot-1",
      "port_to_propose:destination",
      "port_to_propose:origin",
      "terminal_operation_mode_unknown",
    ]);
    expect(keysOf(opened)).toEqual(["temperature_setpoint_missing:lot-1"]);
  });
});

// ── 9. Révision : préremplissage sans altération de l'ancienne version ─────

describe("préremplissage d'une révision", () => {
  const stored = {
    title: "Périmètre import conteneurisé",
    status: "blocked",
    blocked_reason: "Attente de la position douanière",
    scope_snapshot: snapshotOf(
      cleanDraft({
        terminalOperationMode: "CONRO",
        cargoUnits: [
          cleanUnit("lot-1", { temperatureControlRequired: true, temperatureSetpointCelsius: "-18" }),
          cleanUnit("lot-2", { equipmentKnown: false, packaging: "unknown" }),
        ],
        constraintsTransitCountryRefs: "ctry-1, ctry-2",
      }),
    ),
  };

  it("réviser produit un NOUVEAU brouillon fidèle au périmètre source", () => {
    const draft = draftFromScenario(stored);
    expect(draft.title).toBe("Périmètre import conteneurisé");
    expect(draft.status).toBe("blocked");
    expect(draft.blockedReason).toBe("Attente de la position douanière");
    expect(draft.terminalOperationMode).toBe("CONRO");
    expect(draft.cargoUnits).toHaveLength(2);
    expect(draft.cargoUnits[0].temperatureSetpointCelsius).toBe("-18");
    expect(draft.cargoUnits[1].equipmentKnown).toBe(false);
    expect(draft.constraintsTransitCountryRefs).toBe("ctry-1, ctry-2");

    // Un aller-retour ne dérive pas : le périmètre reconstruit est identique.
    expect(snapshotOf(draft)).toEqual(stored.scope_snapshot);
  });

  it("le motif de révision n'est jamais recopié : chaque révision dit le sien", () => {
    const draft = draftFromScenario({ ...stored, status: "draft", blocked_reason: null });
    expect(draft.revisionReason).toBe("");
    expect(draft.blockedReason).toBe("");
    expect(
      buildScenarioRequestBody(CASE_ID, "revise", KEY, draft, SCENARIO_ID).ok,
    ).toBe(false);
  });

  it("les liens sont recopiés dans le brouillon : une révision REDÉCLARE son jeu", () => {
    const draft = draftFromScenario(stored, [
      { assumption_id: ASSUMPTION_ID, reserve_code: null, open_point_key: "packaging_unknown:lot-2" },
      { assumption_id: null, reserve_code: "MISSING_HS_CODE", open_point_key: null },
    ]);
    expect(draft.links).toEqual([
      {
        target: "assumption",
        assumptionId: ASSUMPTION_ID,
        reserveCode: "MISSING_HS_CODE",
        openPointKey: "packaging_unknown:lot-2",
      },
      {
        target: "reserve",
        assumptionId: "",
        reserveCode: "MISSING_HS_CODE",
        openPointKey: "",
      },
    ]);

    const body = bodyOf(
      { ...draft, revisionReason: "Reprise du périmètre" },
      "revise",
      SCENARIO_ID,
    );
    expect(body.links).toHaveLength(2);
  });

  it("réviser ne modifie jamais le scénario source", () => {
    const before = JSON.parse(JSON.stringify(stored));
    const draft = draftFromScenario(stored);
    draft.title = "Autre titre";
    draft.cargoUnits[0].quantity = "9";
    expect(stored).toEqual(before);
  });

  it("un périmètre illisible retombe sur des valeurs par défaut valides", () => {
    const draft = draftFromScenario({
      title: "Sans périmètre",
      status: "superseded",
      blocked_reason: null,
      scope_snapshot: null,
    });
    // `superseded` n'est pas un statut écrivable : le brouillon repart en draft.
    expect(draft.status).toBe("draft");
    expect(draft.cargoUnits).toHaveLength(1);
    expect(buildScopeSnapshot(draft).ok).toBe(true);
  });
});

// ── 10. État : ce que l'UI a le droit de proposer ──────────────────────────

describe("actions proposables", () => {
  it("P1-A2 ne révise que draft et blocked, jamais une version remplacée", () => {
    expect(canReviseScenario({ status: "draft", superseded_by_scenario_id: null })).toBe(true);
    expect(canReviseScenario({ status: "blocked", superseded_by_scenario_id: null })).toBe(true);
    expect(canReviseScenario({ status: "superseded", superseded_by_scenario_id: SCENARIO_ID })).toBe(
      false,
    );
    expect(canReviseScenario({ status: "draft", superseded_by_scenario_id: SCENARIO_ID })).toBe(
      false,
    );
    expect(
      canReviseScenario({ status: "provisional_estimated", superseded_by_scenario_id: null }),
    ).toBe(false);
  });

  it("un scénario remplacé n'est jamais sélectionnable", () => {
    expect(canSelectScenario({ status: "draft", superseded_by_scenario_id: null })).toBe(true);
    expect(canSelectScenario({ status: "blocked", superseded_by_scenario_id: null })).toBe(true);
    expect(
      canSelectScenario({ status: "superseded", superseded_by_scenario_id: SCENARIO_ID }),
    ).toBe(false);
  });
});
