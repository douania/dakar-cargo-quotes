/**
 * DTHC-1 — Régression du sélecteur DTHC DP World.
 *
 * Les fixtures reproduisent l'état live vérifié le 2026-08-25 : cinq lignes
 * canoniques (source_document aligné par la migration
 * 20260825170000_reconcile_dpw_dthc_canonical_grid) et les trois lignes actives
 * parasites issues du même PDF, qui ne doivent jamais être sélectionnées.
 *
 * Les montants ne vivent que dans ces fixtures : le module runtime n'en connaît aucun.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DPW_DTHC_SOURCE_DOCUMENT,
  DPW_DTHC_TO_CONFIRM_CODE,
  type DpwDthcFamily,
  type DpwDthcResolutionInput,
  type DpwDthcTariffRow,
  normalizeDthcContainerType,
  normalizeDthcLabel,
  resolveDpwDthcTariff,
  resolveDthcContainerBasis,
} from "./dpw-dthc-tariff.ts";

const AS_OF = "2026-08-25";

/** Seule désignation sèche explicitement validée par le métier. */
const VALIDATED_DESC = "PIÈCES DÉTACHÉES DE MACHINES ET APPAREILS";

function row(overrides: Partial<DpwDthcTariffRow> = {}): DpwDthcTariffRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    provider: "DPW",
    category: "THC",
    operation_type: "IMPORT",
    classification: "Produits standards",
    cargo_type: "STANDARD",
    amount: 155000,
    unit: "EVP",
    surcharge_percent: 0,
    source_document: DPW_DTHC_SOURCE_DOCUMENT,
    effective_date: "2025-01-01",
    expiry_date: null,
    is_active: true,
    evidence_level: "official",
    ...overrides,
  };
}

/** Les cinq lignes canoniques, libellés et cargo_type exactement comme en base. */
const CANONICAL: DpwDthcTariffRow[] = [
  row({
    id: "basic-01",
    cargo_type: "BASIC",
    classification: "Produits de base (huile, pharma, riz, sucre, lait)",
    amount: 70000,
  }),
  row({ id: "std-01", cargo_type: "STANDARD", classification: "Produits standards", amount: 155000 }),
  row({
    id: "reefer-01",
    cargo_type: "REEFER",
    classification: "Conteneurs frigorifiques",
    amount: 170500,
  }),
  row({
    id: "danger-01",
    cargo_type: "DANGEROUS",
    classification: "Produits dangereux (IMDG classe 1-9)",
    amount: 155000,
    surcharge_percent: 50,
  }),
  row({
    id: "special-01",
    cargo_type: "SPECIAL",
    classification: "Conteneurs spéciaux (OOG, flat, open top, tank)",
    amount: 310000,
  }),
];

/** Les trois lignes actives parasites, placées EN TÊTE : l'ordre ne doit rien changer. */
const PARASITES: DpwDthcTariffRow[] = [
  row({ id: "para-40", cargo_type: "CONTENEUR_40", classification: "Standard 40 pieds", amount: 232500 }),
  row({ id: "para-tb", cargo_type: "CONTENEUR_20", classification: "Transbordement", amount: 75000 }),
  row({ id: "para-vide", cargo_type: "CONTENEUR_VIDE", classification: "Vide", amount: 75000 }),
];

const LIVE: DpwDthcTariffRow[] = [...PARASITES, ...CANONICAL];

function resolve(
  rows: DpwDthcTariffRow[],
  containers: Array<{ type: string; quantity: number }>,
  extra: Partial<DpwDthcResolutionInput> = {},
) {
  return resolveDpwDthcTariff(rows, {
    scope: "import",
    containers,
    cargoDescription: VALIDATED_DESC,
    asOfDate: AS_OF,
    ...extra,
  });
}

// ═══ Grille canonique ═══

Deno.test("DTHC: désignation validée, 20 pieds = 155 000 FCFA", () => {
  const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }]);
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals([r.family, r.evpQuantity, r.baseUnitAmount, r.amount, r.tariff.id], [
    "STANDARD",
    1,
    155000,
    155000,
    "std-01",
  ]);
});

Deno.test("DTHC: aliases intake secs explicites résolvent sans heuristique", () => {
  const cases = [
    ["20' Dry", "20DV", 1, 155000],
    ["40' Dry", "40DV", 2, 310000],
    ["20' Dry Van (20 DV)", "20DV", 1, 155000],
  ] as const;

  for (const [input, canonical, evpQuantity, amount] of cases) {
    assertEquals(normalizeDthcContainerType(input), canonical, input);
    const r = resolve(LIVE, [{ type: input, quantity: 1 }]);
    assertEquals(r.status, "RESOLVED", input);
    if (r.status !== "RESOLVED") continue;
    assertEquals([r.evpQuantity, r.amount], [evpQuantity, amount], input);
  }
});

Deno.test("DTHC: tailles seules et lookalikes restent fail-closed", () => {
  for (const type of ["20'", "40'", "20' Dry Cargo", "40' Dry Cargo", "20DRYVAN20GP"]) {
    const r = resolve(LIVE, [{ type, quantity: 1 }]);
    assertEquals(r.status, "TO_CONFIRM", type);
    if (r.status !== "TO_CONFIRM") continue;
    assertEquals([r.reason, r.amount], ["CONTAINER_TYPE_UNSUPPORTED", null], type);
  }
});

Deno.test("DTHC: désignation validée, 40 pieds = 310 000 FCFA (2 EVP)", () => {
  const r = resolve(LIVE, [{ type: "40HC", quantity: 1 }]);
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals([r.evpQuantity, r.amount, r.tariff.id], [2, 310000, "std-01"]);
});

Deno.test("DTHC: désignation validée, 45 pieds = 348 750 FCFA (2,25 EVP)", () => {
  const r = resolve(LIVE, [{ type: "45HC", quantity: 1 }]);
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals([r.evpQuantity, r.amount], [2.25, 348750]);
});

Deno.test("DTHC: produits de base 20 pieds = 70 000 FCFA", () => {
  const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }], { family: "BASIC" });
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals([r.amount, r.tariff.id], [70000, "basic-01"]);
});

Deno.test("DTHC: reefer 40 pieds = 341 000 FCFA (170 500 × 2 EVP)", () => {
  const r = resolve(LIVE, [{ type: "40RF", quantity: 1 }]);
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals([r.family, r.baseUnitAmount, r.amount], ["REEFER", 170500, 341000]);
});

Deno.test("DTHC: conteneur spécial 20 pieds = 310 000 FCFA", () => {
  const r = resolve(LIVE, [{ type: "20OT", quantity: 1 }]);
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals([r.family, r.amount, r.tariff.id], ["SPECIAL", 310000, "special-01"]);
});

Deno.test("DTHC: produits dangereux = 155 000 + 50 % lus sur la ligne", () => {
  const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }], { family: "DANGEROUS" });
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals([r.tariff.id, r.baseUnitAmount, r.surchargePercent, r.amount], [
    "danger-01",
    155000,
    50,
    232500,
  ]);

  const forty = resolve(LIVE, [{ type: "40DV", quantity: 1 }], { family: "DANGEROUS" });
  assertEquals(forty.status, "RESOLVED");
  if (forty.status !== "RESOLVED") return;
  assertEquals(forty.amount, 465000);
});

// ═══ Anti-détournement ═══

Deno.test("DTHC: les trois lignes parasites actives ne détournent aucune des cinq familles", () => {
  assertEquals(LIVE.slice(0, 3).map((p) => p.amount), [232500, 75000, 75000]);
  const expected: Array<[DpwDthcFamily, number, string]> = [
    ["BASIC", 70000, "basic-01"],
    ["STANDARD", 155000, "std-01"],
    ["REEFER", 170500, "reefer-01"],
    ["DANGEROUS", 232500, "danger-01"],
    ["SPECIAL", 310000, "special-01"],
  ];
  for (const [family, amount, id] of expected) {
    const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }], { family });
    assertEquals(r.status, "RESOLVED", family);
    if (r.status !== "RESOLVED") continue;
    assertEquals([r.amount, r.tariff.id], [amount, id], family);
  }
});

Deno.test("DTHC: la sélection est indépendante de l'ordre du tableau", () => {
  const direct = resolve(LIVE, [{ type: "20DV", quantity: 1 }]);
  const reversed = resolve([...LIVE].reverse(), [{ type: "20DV", quantity: 1 }]);
  assertEquals(direct.status, "RESOLVED");
  assertEquals(reversed.status, "RESOLVED");
  if (direct.status !== "RESOLVED" || reversed.status !== "RESOLVED") return;
  assertEquals([direct.amount, direct.tariff.id], [reversed.amount, reversed.tariff.id]);
});

Deno.test("DTHC: seules les lignes parasites présentes ⇒ rien n'est servi", () => {
  const r = resolve(PARASITES, [{ type: "20DV", quantity: 1 }]);
  assertEquals(r.status, "TO_CONFIRM");
  if (r.status !== "TO_CONFIRM") return;
  assertEquals([r.code, r.reason, r.amount, r.matchCount], [
    DPW_DTHC_TO_CONFIRM_CODE,
    "NO_MATCHING_TARIFF",
    null,
    0,
  ]);
});

Deno.test("DTHC: un cargo_type de famille avec un libellé étranger est rejeté", () => {
  for (const classification of ["Transbordement", "Vide", "Standard 40 pieds", "", null]) {
    assertEquals(
      resolve([row({ classification, amount: 75000 })], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      `classification=${String(classification)}`,
    );
  }
});

Deno.test("DTHC: un libellé de famille avec un cargo_type étranger est rejeté", () => {
  for (const cargo_type of ["CONTENEUR_20", "CONTENEUR_40", "CONTENEUR_VIDE", "", null]) {
    assertEquals(
      resolve([row({ cargo_type })], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      `cargo_type=${String(cargo_type)}`,
    );
  }
});

Deno.test("DTHC: aucune ligne to_confirm / observed / historical n'est servie", () => {
  for (const level of ["to_confirm", "observed", "historical_only", "", null]) {
    assertEquals(
      resolve([row({ evidence_level: level, amount: 250000 })], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      `evidence_level=${String(level)}`,
    );
  }
  const cards = [250000, 350000, 450000].map((amount) => row({ amount, evidence_level: "to_confirm" }));
  assertEquals(resolve(cards, [{ type: "20DV", quantity: 1 }]).status, "TO_CONFIRM");
});

Deno.test("DTHC: seul le document canonique DP World fait foi", () => {
  for (const doc of ["Arrêté DPW 2025", "DPW_TARIFS_2015.pdf", "", null]) {
    assertEquals(
      resolve([row({ source_document: doc, amount: 133500 })], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      `source_document=${String(doc)}`,
    );
  }
  // Une localisation dans le document reste le même document.
  assertEquals(
    resolve([row({ source_document: "DPW_TARIFS_2025_0001.pdf, Page 4" })], [
      { type: "20DV", quantity: 1 },
    ]).status,
    "RESOLVED",
  );
});

Deno.test("DTHC: provider, category et operation_type sont lus strictement", () => {
  for (const provider of ["DPW", "DP_WORLD"]) {
    assertEquals(resolve([row({ provider })], [{ type: "20DV", quantity: 1 }]).status, "RESOLVED", provider);
  }
  assertEquals(resolve([row({ provider: "PAD" })], [{ type: "20DV", quantity: 1 }]).status, "TO_CONFIRM");
  for (const category of ["THD", "THC_EXPORT", "RELEVAGE"]) {
    assertEquals(resolve([row({ category })], [{ type: "20DV", quantity: 1 }]).status, "TO_CONFIRM", category);
  }
  for (const operation_type of ["EXPORT", "TRANSIT"]) {
    assertEquals(
      resolve([row({ operation_type })], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      operation_type,
    );
  }
});

Deno.test("DTHC: le scope export n'atteint jamais la grille import", () => {
  const r = resolveDpwDthcTariff(CANONICAL, {
    scope: "export",
    containers: [{ type: "20DV", quantity: 1 }],
    asOfDate: AS_OF,
  });
  assertEquals(r.status, "TO_CONFIRM");
  if (r.status !== "TO_CONFIRM") return;
  assertEquals(r.reason, "OPERATION_NOT_SUPPORTED");
});

// ═══ Fail-closed ═══

Deno.test("DTHC: équipements incompatibles sur un même lot bloquent", () => {
  const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }, { type: "40RF", quantity: 1 }]);
  assertEquals(r.status, "TO_CONFIRM");
  if (r.status !== "TO_CONFIRM") return;
  assertEquals([r.reason, r.amount], ["FAMILY_AMBIGUOUS", null]);
});

// ═══ Détermination de la famille depuis la marchandise ═══

Deno.test("DTHC: un conteneur sec sans description ne conclut rien", () => {
  for (const cargoDescription of [undefined, null, "", "   "]) {
    const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }], { cargoDescription });
    assertEquals(r.status, "TO_CONFIRM", String(cargoDescription));
    if (r.status !== "TO_CONFIRM") continue;
    assertEquals([r.reason, r.amount], ["FAMILY_UNDETERMINED", null]);
  }
});

Deno.test("DTHC: une désignation sèche non validée ne conclut rien", () => {
  for (const cargoDescription of ["RIZ EN SACS", "MARCHANDISES DIVERSES", "PIECES DETACHEES"]) {
    const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }], { cargoDescription });
    assertEquals(r.status, "TO_CONFIRM", cargoDescription);
    if (r.status !== "TO_CONFIRM") continue;
    assertEquals(r.reason, "FAMILY_UNDETERMINED");
  }
});

Deno.test("DTHC: un token DG autonome rend la marchandise dangereuse", () => {
  for (const cargoDescription of [
    "PEINTURES DG",
    "CARGO IMO 3",
    "IMDG CLASSE 8",
    "HAZMAT LIQUIDE",
    "DANGEROUS GOODS",
  ]) {
    const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }], { cargoDescription });
    assertEquals(r.status, "RESOLVED", cargoDescription);
    if (r.status !== "RESOLVED") continue;
    assertEquals([r.family, r.amount], ["DANGEROUS", 232500], cargoDescription);
  }
});

Deno.test("DTHC: un mot contenant les lettres DG ne déclenche pas dangereux", () => {
  for (const cargoDescription of ["BUDGET MATERIEL", "WIDGETS INDUSTRIELS", "EDGE BANDING"]) {
    const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }], { cargoDescription });
    // Ni dangereux, ni validé standard : la famille reste indéterminée.
    assertEquals(r.status, "TO_CONFIRM", cargoDescription);
    if (r.status !== "TO_CONFIRM") continue;
    assertEquals(r.reason, "FAMILY_UNDETERMINED");
  }
});

Deno.test("DTHC: le marqueur isDangerous structuré suffit", () => {
  const r = resolve(LIVE, [{ type: "20DV", quantity: 1 }], { isDangerous: true });
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals([r.family, r.amount, r.tariff.id], ["DANGEROUS", 232500, "danger-01"]);
});

Deno.test("DTHC: dangereux sur équipement reefer ou spécial bloque", () => {
  for (const type of ["20RF", "40RF", "20OT", "40FR"]) {
    for (const extra of [{ isDangerous: true }, { cargoDescription: "CARGO DG" }]) {
      const r = resolve(LIVE, [{ type, quantity: 1 }], extra);
      assertEquals(r.status, "TO_CONFIRM", `${type}/${JSON.stringify(extra)}`);
      if (r.status !== "TO_CONFIRM") continue;
      assertEquals(r.reason, "FAMILY_AMBIGUOUS");
    }
  }
});

Deno.test("DTHC: deux lignes canoniques concurrentes bloquent", () => {
  const r = resolve([...CANONICAL, row({ id: "std-02", amount: 160000 })], [
    { type: "20DV", quantity: 1 },
  ]);
  assertEquals(r.status, "TO_CONFIRM");
  if (r.status !== "TO_CONFIRM") return;
  assertEquals([r.reason, r.matchCount], ["AMBIGUOUS_TARIFF", 2]);
});

Deno.test("DTHC: conteneur absent, inconnu ou quantité invalide bloque", () => {
  const cases: Array<[unknown, string]> = [
    [[], "CONTAINERS_MISSING"],
    [null, "CONTAINERS_MISSING"],
    [[{ type: "", quantity: 1 }], "CONTAINERS_MISSING"],
    [[{ type: "20TROLLEY", quantity: 1 }], "CONTAINER_TYPE_UNSUPPORTED"],
    [[{ type: "LCL", quantity: 1 }], "CONTAINER_TYPE_UNSUPPORTED"],
    [[{ type: "20DV", quantity: 0 }], "CONTAINER_QUANTITY_INVALID"],
    [[{ type: "20DV", quantity: -2 }], "CONTAINER_QUANTITY_INVALID"],
    [[{ type: "20DV", quantity: "abc" }], "CONTAINER_QUANTITY_INVALID"],
  ];
  for (const [containers, reason] of cases) {
    const r = resolveDpwDthcTariff(LIVE, {
      scope: "import",
      containers: containers as DpwDthcResolutionInput["containers"],
      asOfDate: AS_OF,
    });
    assertEquals(r.status, "TO_CONFIRM", JSON.stringify(containers));
    if (r.status !== "TO_CONFIRM") continue;
    assertEquals([r.reason, r.amount], [reason, null]);
  }
});

Deno.test("DTHC: une unité qui n'est pas l'EVP est rejetée (anti double comptage)", () => {
  for (const unit of ["FCFA/TONNE", "XOF/unité", "forfait", "", null]) {
    assertEquals(
      resolve([row({ unit })], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      `unit=${String(unit)}`,
    );
  }
});

Deno.test("DTHC: montant ou surcharge inexploitable bloque", () => {
  for (const amount of [0, -1, null, "abc"]) {
    assertEquals(
      resolve([row({ amount })], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      `amount=${String(amount)}`,
    );
  }
  for (const surcharge_percent of [-10, "abc"]) {
    assertEquals(
      resolve([row({ surcharge_percent })], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      `surcharge=${String(surcharge_percent)}`,
    );
  }
});

Deno.test("DTHC: ligne inactive, non datée ou hors fenêtre de validité écartée", () => {
  for (const patch of [
    { is_active: false },
    { effective_date: "2027-01-01" },
    { effective_date: null },
    { expiry_date: "2026-01-01" },
  ]) {
    assertEquals(
      resolve([row(patch)], [{ type: "20DV", quantity: 1 }]).status,
      "TO_CONFIRM",
      JSON.stringify(patch),
    );
  }
});

Deno.test("DTHC: date d'évaluation absente ou invalide bloque", () => {
  for (const asOfDate of [null, "", "25/08/2026", "hier"]) {
    const r = resolveDpwDthcTariff(LIVE, {
      scope: "import",
      containers: [{ type: "20DV", quantity: 1 }],
      cargoDescription: VALIDATED_DESC,
      asOfDate,
    });
    assertEquals(r.status, "TO_CONFIRM", String(asOfDate));
    if (r.status !== "TO_CONFIRM") continue;
    assertEquals(r.reason, "AS_OF_DATE_MISSING");
  }
});

// ═══ Multiplicateur EVP ═══

Deno.test("DTHC: le multiplicateur EVP est appliqué exactement une fois", () => {
  const r = resolve(LIVE, [{ type: "20DV", quantity: 3 }, { type: "40HC", quantity: 2 }]);
  assertEquals(r.status, "RESOLVED");
  if (r.status !== "RESOLVED") return;
  assertEquals(r.evpQuantity, 7); // 3×1 + 2×2
  assertEquals(r.amount, 155000 * 7);
  assertEquals(r.amount / r.effectiveUnitAmount, r.evpQuantity);
});

Deno.test("DTHC: la base conteneur est le seul lieu du facteur EVP", () => {
  const basis = resolveDthcContainerBasis([
    { type: "20' DV", quantity: 1 },
    { type: "40 HC", quantity: 1 },
    { type: "45HC", quantity: 1 },
  ]);
  assertEquals(basis.status, "OK");
  if (basis.status !== "OK") return;
  assertEquals(basis.evpQuantity, 5.25);
  assertEquals(basis.equipments, ["DRY"]);
  assertEquals(basis.detail, "1x20DV(1)+1x40HC(2)+1x45HC(2.25)");
});

Deno.test("DTHC: normalisation des libellés", () => {
  assertEquals(normalizeDthcLabel("Produits de base (huile, pharma, riz)"), "PRODUITS DE BASE");
  assertEquals(normalizeDthcLabel("Conteneurs spéciaux (OOG, flat)"), "CONTENEURS SPECIAUX");
  assertEquals(normalizeDthcLabel("  Produits   Dangereux "), "PRODUITS DANGEREUX");
  assertEquals(normalizeDthcLabel(42), "");
});
