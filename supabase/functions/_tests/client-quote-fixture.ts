/**
 * Synthetic quotation version shaped like an operator-basis multi-lot import (3 lots, SOC and COC,
 * estimated transport, uncosted stay, franchise, client-side empty return). No customer data.
 * Shared by the client presentation tests of the PDF and e-mail functions and by review renders.
 */
const transportSource = (lot: string, quantity: number, size: string) => ({
  type: "CALCULATED", unit_ref: lot, reference: "SN_NORMAL_CONTAINER_KM_V1", distance_km: 480.9, billed_size: size,
  danger_status: "unknown",
  danger_reservation: "Statut dangereux inconnu : base de transport ordinaire uniquement, sous hypothèse explicite ; supplément et contraintes IMO non inclus, non supposés nuls.",
  distance_source: "TomTom Maps Routing v1, 2026-09-21 ; https://www.geopostcodes.com/container-terminals-code-list/",
  qualification: { quantity, unit_ref: lot, standard_estimate_only: true, ordinary_transport: false },
  supplier_vat_per_container: 96822, transport_ht_per_container: 537900,
});

export const clientQuoteLines = [
  { service_code: "DTHC", description: "THC IMPORT 20HQ", quantity: 39, unit_price: 232500, amount: 9067500, source: { type: "OFFICIAL", reference: "Arrêté ministériel n° 035532" } },
  { service_code: "DTHC", description: "THC IMPORT 20HQ — base hors supplément IMO", quantity: 13, unit_price: 155000, amount: 2015000, source: { type: "CALCULATED", reference: "Arrêté ministériel n° 035532" } },
  { service_code: "IMO", description: "Supplément IMO éventuel — lot-2", quantity: 1, unit_price: 0, amount: null, source: { type: "TO_CONFIRM", reference: "SCENARIO_DG_UNKNOWN" } },
  { service_code: "TRUCKING", description: "Transport 20hq → Ndioum — estimation kilométrique", quantity: 13, unit_price: 634722, amount: 8251386, source: transportSource("lot-2", 13, "20") },
  { service_code: "TRUCKING", description: "Transport 40hq → Ndioum — estimation kilométrique", quantity: 3, unit_price: 1217524, amount: 3652572, source: transportSource("lot-3", 3, "40") },
  { service_code: "TRUCKING", description: "Transport 20HQ → N'Dioum", quantity: 39, unit_price: 0, amount: null, source: { type: "TO_CONFIRM", reference: "TARIF_TRANSPORT_A_CONFIRMER — DESTINATION_UNKNOWN" } },
  { service_code: "STORAGE", category: "Magasinage", description: "Magasinage — lot lot-1 — à confirmer", quantity: 1, unit_price: 0, amount: null, source: { type: "TO_CONFIRM", reference: "SCENARIO_GROUP_STORAGE_CONFIRMATION" } },
  { service_code: "STORAGE", category: "Magasinage", description: "Magasinage — lot lot-2 — sortie supposée dans la franchise", quantity: 1, unit_price: 0, amount: 0, source: { type: "CALCULATED", reference: "SCENARIO_DPW_STORAGE_FRANCHISE_V1", firm_eligible: false } },
  { service_code: "DEMURRAGE", category: "Surestaries", description: "Surestaries armateur — lot COC lot-3", quantity: 1, unit_price: 0, amount: null, source: { type: "TO_CONFIRM", reference: "Armateur non détecté — sélection d’un barème de surestaries interdite" } },
  { service_code: "PAD", description: "Droit de passage PAD — lot-1 (T02)", quantity: 1, unit_price: 20759310, amount: 20759310, source: { type: "official", unit_ref: "lot-1", reference: "pdf_redevances_portuaires_2006" } },
  { service_code: "CUSTOMS", description: "Honoraires de dédouanement", quantity: 1, unit_price: 350000, amount: 350000, source: { type: "validated_internal", reference: "fee_rules:00000000-0000-4000-8000-000000000001" } },
  { service_code: "EMPTY_RETURN", description: "Retour vide armateur — lot-1 (SOC) — exclu de l’estimation", quantity: 1, unit_price: 0, amount: 0, source: { type: "EXCLUDED_BY_RULE", unit_ref: "lot-1", ownership: "SOC", reference: "SCENARIO_SOC_NO_CARRIER_RETURN" } },
  { service_code: "EMPTY_RETURN", description: "Retour vide armateur — lot-3 (COC) — exclu de l’estimation", quantity: 1, unit_price: 0, amount: 0, source: { type: "EXCLUDED_BY_RULE", unit_ref: "lot-3", ownership: "COC", reference: "EMPTY_RETURN_IMPORT_SN_CLIENT_OBLIGATION" } },
];

// Stay information as recorded by the engine (storage without assumption, franchise with tiers,
// demurrage with an informative carrier comparison and its exclusions).
const storageToConfirm = { notes: "Magasinage — à confirmer.", stay_information: { schema_version: 1, free_days: null,
  franchise_note: "Franchise applicable à confirmer : terminal, équipement et conditions IMO/température à vérifier.", tiers: [], example: null,
  reservations: ["Aucune hypothèse de séjour liée à ce scénario : terminal, désignation et durées à renseigner.",
    "Choisir et relier une hypothèse de séjour avec le terminal et la désignation magasinage (code 410–419) pour afficher les taux ; renseigner séparément les durées magasinage et armateur."],
  sources: ["https://dpw-prod-cd-1.dpworld.com/senegal/faqs"] } };
const stayRaw: Record<number, Record<string, unknown>> = {
  6: storageToConfirm,
  7: { notes: "Franchise de 10 jours. Source : https://dpw-prod-cd-1.dpworld.com/senegal/faqs", stay_information: { schema_version: 1, free_days: 10,
    franchise_note: "10 jours sous hypothèse DP World, conteneur sec, import local ; règle de décompte à confirmer.",
    tiers: [{ from: 11, to: 25, rate: 394, currency: "FCFA", unit: "tonne/jour", relative: false }, { from: 26, to: null, rate: 599, currency: "FCFA", unit: "tonne/jour", relative: false }],
    example: null, reservations: ["P1 estimé, à corroborer sur facture."], sources: [] } },
  8: { notes: "Armateur non détecté.", stay_information: { schema_version: 1, free_days: null,
    franchise_note: "Franchise applicable à confirmer : les franchises ci-dessous appartiennent aux barèmes de référence, pas à un armateur sélectionné.",
    tiers: [], example: null, reservations: [], sources: [],
    carrier_comparison: { schema_version: 1, consulted_on: "2026-09-21", equipment: "40HC", quantity: 3, conversion_source: "https://www.bceao.int/",
      references: [{ carrier: "CMA CGM", free_days: 10 }, { carrier: "Hapag-Lloyd", free_days: 10 }],
      reservations: [
        "Indicatif — armateur à confirmer. Comparaison limitée à ces deux références, pas une fourchette de tout le marché ni un plafond garanti.",
        "Barèmes publiés jusqu’à nouvel avis, aux dates indiquées. Actualité et conditions négociées à reconfirmer avant utilisation contractuelle.",
        "Jours calendaires, franchise comprise ; point de départ du décompte à confirmer. Magasinage DPW, détention après sortie et TVA fournisseur éventuelle exclus.",
      ] } } },
};

export const clientQuoteSnapshot = {
  meta: { version_number: 1, created_at: "2026-09-21T10:00:00Z",
    quoteQualification: { level: "partial", firmTotalPolicy: "all_included", reasons: [
      { code: "RATE_PENDING_CONFIRMATION", message: "Au moins un poste tarifaire est en attente de confirmation (TO_CONFIRM)." },
      { code: "OPERATOR_QUOTATION_BASIS", message: "Cotation sur bases opérateur explicites et révisables." },
    ] } },
  client: { company: "SYNTHETIC TEST — NOT FOR SENDING", email: "recette@example.invalid" },
  inputs: { origin: "Shanghai", destination: "N'Dioum", incoterm: "DAP" },
  lines: clientQuoteLines,
  // Qualification recorded by the engine: firm only when no assumption and a firm source.
  raw_lines: clientQuoteLines.map((line, i) => ({
    ...line,
    scenario_provenance: [0, 10].includes(i) ? { assumption_dependent: false, dependency_keys: [], firm_eligible: true }
      : { assumption_dependent: true, dependency_keys: ["cargo.weight_kg"], firm_eligible: false },
    ...(stayRaw[i] ?? (i === 3 || i === 4
      ? { notes: "Estimation kilométrique non ferme. Distance routière 480.9 km : https://example.invalid/routing. Retour vide, attente, manutention et prestations particulières non présumés inclus. Aucune TVA SODATRA supplémentaire." }
      : { notes: "Texte technique long. ".repeat(30) })),
  })),
  totals: { currency: "XOF", total_ht: 47925930, total_ttc: 48024930, subtotal_before_sodatra_vat: 47925930, honoraires_tva: 99000, total_payable: 48024930 },
  sources: [],
  operator_basis: {
    schema_version: 1, title: "TEST — 3 lots", revision_no: 2, calculated_at: "2026-09-21T10:00:00Z",
    source_run_id: "run-synthetic", scope_hash: "b".repeat(64), overlay: [],
    assumptions: [{ statement: "Séjour retenu", assumed_fact_key: "routing.stay_basis", assumed_value: { schema_version: 1, source: "Instruction opérateur", verified_on: "2026-09-21",
      groups: [{ unit_ref: "lot-1", storage_days: 15, demurrage_days: null }, { unit_ref: "lot-3", storage_days: 8, demurrage_days: 20 }] } }],
    scope: {
      transport_mode: "SEA", movement_direction: "IMPORT",
      origin: { location_code: "CNSHA" }, destination: { location_code: "SN-NDIOUM" },
      cargo_units: [
        { unit_ref: "lot-1", quantity: 39, equipment_code: "20hq", ownership: "SOC", gross_weight_kg: 55000, weight_basis: "per_unit", dangerous_goods: true, un_number: "3536", imo_class: "9" },
        { unit_ref: "lot-2", quantity: 13, equipment_code: "20hq", ownership: "SOC", gross_weight_kg: 18000, weight_basis: "per_unit", dangerous_goods: null },
        { unit_ref: "lot-3", quantity: 3, equipment_code: "40hq", ownership: "COC", gross_weight_kg: 15000, weight_basis: "per_unit", dangerous_goods: null },
      ],
    },
    reservations: [
      { code: "SCENARIO_DAP_SERVICES_ONLY", message: "Estimation des prestations DAP uniquement. Droits et taxes douaniers et calcul CAF exclus ; aucune valeur marchandise de remplacement." },
      { code: "SCENARIO_CONTAINER_THC_OPERATOR_INDEPENDENT", message: "Manutention conteneurs : barème homologué validé." },
      { code: "SCENARIO_TERMINAL_ANCILLARIES_TO_CONFIRM", message: "Frais annexes de terminal et magasinage à confirmer séparément." },
      { code: "SCENARIO_CARGO_GROUP_ASSUMPTION", unit_ref: "lot-1", message: "Lot lot-1 : hypothèse 39 × 20HQ SOC; danger oui; poids 55000 kg (per_unit)." },
      { code: "SCENARIO_DG_UNKNOWN", unit_ref: "lot-2", message: "Lot lot-2 : danger inconnu." },
      { code: "SCENARIO_EMPTY_RETURN_SCOPE", unit_ref: "lot-1", message: "Retour vide armateur — lot-1 (SOC) — exclu de l’estimation. Hypothèse SOC : pas de restitution." },
      { code: "SCENARIO_TRANSPORT_KM_ESTIMATE", message: "Statut dangereux inconnu : base de transport ordinaire uniquement… ".repeat(20) },
      { code: "SCENARIO_CONTAINER_STAY_ESTIMATE", message: "Surestaries armateur — lot COC lot-3. Armateur non détecté… ".repeat(30) },
      { code: "OPEN_POINT", reason: "commodity_classification_unknown", open_point_key: "commodity_classification_unknown:lot-1" },
      { code: "OPEN_POINT", reason: "packaging_unknown", open_point_key: "packaging_unknown:lot-2" },
      { code: "OPEN_POINT", reason: "customs_regime_unknown" },
      { code: "OPEN_POINT", reason: "port_to_propose", open_point_key: "port_to_propose:origin" },
    ],
    open_points: [],
  },
};

/** A version saved before line sources, codes and operator bases existed. */
export const historicalSnapshot = {
  meta: { version_number: 1, created_at: "2026-03-01T10:00:00Z", quoteQualification: { level: "provisional", firmTotalPolicy: "all_included", reasons: [
    { code: "LEGACY_FREE_TEXT", message: "Réserve historique conservée telle qu’enregistrée." },
  ] } },
  client: { company: "SYNTHETIC LEGACY" }, inputs: { origin: "Anvers", destination: "Dakar", incoterm: "CIF", cargo_weight: 10, containers: [{ type: "20GP", quantity: 1, coc_soc: "SOC" }] },
  lines: [{ service_code: "AGENCY", description: "Frais d'agence", quantity: 1, unit_price: 200000, amount: 200000 }],
  raw_lines: [{}],
  totals: { currency: "XOF", total_ht: 200000, total_ttc: 200000 },
};
