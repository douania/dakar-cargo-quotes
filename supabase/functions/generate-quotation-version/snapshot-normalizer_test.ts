/**
 * P0-E — Tests du normaliseur pricing_run → VersionSnapshot (helper pur).
 *
 * Couvre :
 * - la fixture exacte P0-E (facts_snapshot TABLEAU, inputs_json camelCase,
 *   outputs_json client/routing, lignes unitPrice camelCase) ;
 * - la rétrocompatibilité des anciennes formes snake_case (inputs_json et
 *   facts_snapshot objet) dans l'ordre exact de l'ancien writer ;
 * - la priorité explicite des sources (outputs > inputs camelCase > facts
 *   tableau > legacy) ;
 * - unitPrice / unit_price / rate / fallback amount/quantity ;
 * - la préservation des zéros valides (quantity=0, unitPrice=0, amount=0)
 *   sans division par zéro ni écrasement par ||.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeLinePricing,
  resolveSnapshotClient,
  resolveSnapshotInputs,
} from "./snapshot-normalizer.ts";

// ═══ Fixture exacte P0-E : formes réellement produites par run-pricing ═══

const p0eFactsSnapshot = [
  {
    id: "f1",
    key: "routing.origin_port",
    category: "routing",
    value_text: "Shanghai",
    value_number: null,
    value_json: null,
  },
  {
    id: "f2",
    key: "routing.destination_city",
    category: "routing",
    value_text: "Bamako",
    value_number: null,
    value_json: null,
  },
  {
    id: "f3",
    key: "routing.incoterm",
    category: "routing",
    value_text: "CIF",
    value_number: null,
    value_json: null,
  },
  {
    id: "f4",
    key: "cargo.weight_kg",
    category: "cargo",
    value_text: null,
    value_number: 24000,
    value_json: null,
  },
  {
    id: "f5",
    key: "cargo.volume_cbm",
    category: "cargo",
    value_text: null,
    value_number: 28,
    value_json: null,
  },
  {
    id: "f6",
    key: "cargo.containers",
    category: "cargo",
    value_text: null,
    value_number: null,
    value_json: [{ type: "40HC", quantity: 1 }],
  },
  {
    id: "f7",
    key: "contacts.client_email",
    category: "contacts",
    value_text: "ops@acme.sn",
    value_number: null,
    value_json: null,
  },
  {
    id: "f8",
    key: "contacts.client_company",
    category: "contacts",
    value_text: "ACME Sarl",
    value_number: null,
    value_json: null,
  },
];

const p0eInputsJson = {
  originPort: "Shanghai",
  finalDestination: "Bamako",
  incoterm: "CIF",
  containers: [{ type: "40HC", quantity: 1 }],
  cargoWeight: 24, // tonnes (run-pricing convertit kg → tonnes)
  cargoVolume: 28,
  clientEmail: "ops@acme.sn",
  clientCompany: "ACME Sarl",
};

const p0eOutputsJson = {
  client: { email: "ops@acme.sn", company: "ACME Sarl" },
  routing: {
    origin: "Shanghai",
    destination: "Bamako",
    incoterm: "CIF",
    normalized_incoterm: "CIF",
  },
};

Deno.test("P0-E: fixture exacte — client, route, poids/volume/conteneurs résolus", () => {
  const inputs = resolveSnapshotInputs(
    p0eInputsJson,
    p0eFactsSnapshot,
    p0eOutputsJson,
  );
  assertEquals(inputs.origin, "Shanghai");
  assertEquals(inputs.destination, "Bamako");
  assertEquals(inputs.incoterm, "CIF");
  assertEquals(inputs.containers, [{ type: "40HC", quantity: 1 }]);
  assertEquals(inputs.cargo_weight, 24);
  assertEquals(inputs.cargo_volume, 28);

  const client = resolveSnapshotClient(
    p0eInputsJson,
    p0eFactsSnapshot,
    p0eOutputsJson,
  );
  assertEquals(client.email, "ops@acme.sn");
  assertEquals(client.company, "ACME Sarl");
});

Deno.test("P0-E: ligne enrichment unitPrice camelCase — prix conservé, pas de zéro", () => {
  const r = normalizeLinePricing({
    category: "PAD_DROIT_PASSAGE",
    amount: 21600,
    currency: "FCFA",
    unit: "tonne",
    quantity: 24,
    unitPrice: 900,
    source: { type: "OFFICIAL", reference: "Barème 2006", confidence: 1.0 },
  });
  assertEquals(r.unit_price, 900);
  assertEquals(r.quantity, 24);
  assertEquals(r.amount, 21600);
});

Deno.test("P0-E: outputs_json seul (inputs/facts vides) suffit pour client + route", () => {
  const inputs = resolveSnapshotInputs({}, [], p0eOutputsJson);
  assertEquals(inputs.origin, "Shanghai");
  assertEquals(inputs.destination, "Bamako");
  assertEquals(inputs.incoterm, "CIF");
  const client = resolveSnapshotClient({}, [], p0eOutputsJson);
  assertEquals(client.email, "ops@acme.sn");
  assertEquals(client.company, "ACME Sarl");
});

Deno.test("P0-E: facts_snapshot tableau seul — miroir buildPricingInputs (kg → tonnes)", () => {
  const inputs = resolveSnapshotInputs({}, p0eFactsSnapshot, null);
  assertEquals(inputs.origin, "Shanghai");
  assertEquals(inputs.destination, "Bamako");
  assertEquals(inputs.incoterm, "CIF");
  assertEquals(inputs.containers, [{ type: "40HC", quantity: 1 }]);
  assertEquals(inputs.cargo_weight, 24); // 24000 kg → 24 t
  assertEquals(inputs.cargo_volume, 28);
  const client = resolveSnapshotClient({}, p0eFactsSnapshot, null);
  assertEquals(client.email, "ops@acme.sn");
  assertEquals(client.company, "ACME Sarl");
});

Deno.test("P0-E: fallback P8 facts tableau — destination_port si destination_city absent", () => {
  const facts = [
    {
      key: "routing.destination_port",
      value_text: "Anvers",
      value_number: null,
      value_json: null,
    },
  ];
  const inputs = resolveSnapshotInputs({}, facts, null);
  assertEquals(inputs.destination, "Anvers");
});

Deno.test("P0-E: containers double-encodés JSON (V4.1.5) parsés", () => {
  const inputs = resolveSnapshotInputs(
    { containers: '[{"type":"20GP","quantity":2}]' },
    [],
    null,
  );
  assertEquals(inputs.containers, [{ type: "20GP", quantity: 2 }]);
});

// ═══ Rétrocompatibilité anciennes formes snake_case ═══

Deno.test("legacy: inputs_json + facts_snapshot objet snake_case — comportement ancien writer préservé", () => {
  const legacyInputs = {
    origin: "Rotterdam",
    destination: "Dakar",
    incoterm: "FOB",
    containers: [{ type: "20GP", quantity: 2 }],
    cargo_weight: 12000,
    cargo_volume: 15,
    client_email: "inputs@legacy.sn",
  };
  const legacyFacts = {
    client_email: "facts@legacy.sn",
    client_company: "Legacy SA",
  };
  const inputs = resolveSnapshotInputs(legacyInputs, legacyFacts, {});
  assertEquals(inputs.origin, "Rotterdam");
  assertEquals(inputs.destination, "Dakar");
  assertEquals(inputs.incoterm, "FOB");
  assertEquals(inputs.containers, [{ type: "20GP", quantity: 2 }]);
  assertEquals(inputs.cargo_weight, 12000);
  assertEquals(inputs.cargo_volume, 15);

  // Ancien writer : factsSnapshot.client_email || inputs.client_email
  const client = resolveSnapshotClient(legacyInputs, legacyFacts, {});
  assertEquals(client.email, "facts@legacy.sn");
  assertEquals(client.company, "Legacy SA");
});

Deno.test("legacy: routing objet facts en dernier recours si inputs vides", () => {
  const inputs = resolveSnapshotInputs({}, {
    origin: "Le Havre",
    destination: "Dakar",
    incoterm: "CFR",
  }, null);
  assertEquals(inputs.origin, "Le Havre");
  assertEquals(inputs.destination, "Dakar");
  assertEquals(inputs.incoterm, "CFR");
});

Deno.test("legacy: tout absent — nulls et tableau vide, jamais undefined", () => {
  const inputs = resolveSnapshotInputs(null, null, null);
  assertEquals(inputs, {
    origin: null,
    destination: null,
    incoterm: null,
    containers: [],
    cargo_weight: null,
    cargo_volume: null,
  });
  assertEquals(resolveSnapshotClient(null, null, null), {
    email: null,
    company: null,
  });
});

// ═══ Priorité explicite des sources ═══

Deno.test("priorité: outputs_json.routing > inputs camelCase > facts tableau > legacy", () => {
  const inputs = resolveSnapshotInputs(
    { originPort: "B-inputs", origin: "D-legacy" },
    [{
      key: "routing.origin_port",
      value_text: "C-facts",
      value_number: null,
      value_json: null,
    }],
    { routing: { origin: "A-outputs" } },
  );
  assertEquals(inputs.origin, "A-outputs");

  const sansOutputs = resolveSnapshotInputs(
    { originPort: "B-inputs", origin: "D-legacy" },
    [{
      key: "routing.origin_port",
      value_text: "C-facts",
      value_number: null,
      value_json: null,
    }],
    {},
  );
  assertEquals(sansOutputs.origin, "B-inputs");

  const sansInputsCamel = resolveSnapshotInputs(
    { origin: "D-legacy" },
    [{
      key: "routing.origin_port",
      value_text: "C-facts",
      value_number: null,
      value_json: null,
    }],
    {},
  );
  assertEquals(sansInputsCamel.origin, "C-facts");
});

Deno.test("priorité: outputs_json.client > inputs.clientEmail > fact contacts.client_email", () => {
  const facts = [{
    key: "contacts.client_email",
    value_text: "c@facts.sn",
    value_number: null,
    value_json: null,
  }];
  assertEquals(
    resolveSnapshotClient({ clientEmail: "b@inputs.sn" }, facts, {
      client: { email: "a@outputs.sn" },
    }).email,
    "a@outputs.sn",
  );
  assertEquals(
    resolveSnapshotClient({ clientEmail: "b@inputs.sn" }, facts, {}).email,
    "b@inputs.sn",
  );
  assertEquals(resolveSnapshotClient({}, facts, {}).email, "c@facts.sn");
});

Deno.test("priorité: cargoWeight camelCase (tonnes) devant fact kg et legacy", () => {
  const inputs = resolveSnapshotInputs(
    { cargoWeight: 24, cargo_weight: 99999 },
    [{
      key: "cargo.weight_kg",
      value_text: null,
      value_number: 24000,
      value_json: null,
    }],
    null,
  );
  assertEquals(inputs.cargo_weight, 24);
});

// ═══ Prix unitaires des lignes ═══

Deno.test("lignes: unit_price snake_case legacy conservé", () => {
  const r = normalizeLinePricing({
    unit_price: 1200,
    quantity: 2,
    amount: 2400,
  });
  assertEquals(r.unit_price, 1200);
});

Deno.test("lignes: rate legacy conservé", () => {
  const r = normalizeLinePricing({ rate: 800, quantity: 3, amount: 2400 });
  assertEquals(r.unit_price, 800);
});

Deno.test("lignes: priorité unitPrice > unit_price > rate", () => {
  assertEquals(
    normalizeLinePricing({ unitPrice: 100, unit_price: 200, rate: 300 })
      .unit_price,
    100,
  );
  assertEquals(
    normalizeLinePricing({ unit_price: 200, rate: 300 }).unit_price,
    200,
  );
});

Deno.test("lignes: fallback amount/quantity seulement sans prix explicite et quantity > 0", () => {
  assertEquals(
    normalizeLinePricing({ amount: 3000, quantity: 3 }).unit_price,
    1000,
  );
  // quantity absente → défaut 1 → fallback amount/1
  assertEquals(normalizeLinePricing({ amount: 3000 }).unit_price, 3000);
});

Deno.test("lignes: quantity=0 — pas de division, quantité 0 préservée (pas de || 1)", () => {
  const r = normalizeLinePricing({ amount: 3000, quantity: 0 });
  assertEquals(r.unit_price, 0);
  assertEquals(r.quantity, 0);
  assertEquals(r.amount, 3000);
});

Deno.test("lignes: unitPrice=0 explicite préservé — pas de fallback amount/quantity", () => {
  const r = normalizeLinePricing({ unitPrice: 0, quantity: 5, amount: 500 });
  assertEquals(r.unit_price, 0);
  assertEquals(r.amount, 500);
});

Deno.test("lignes: placeholder PAD TO_CONFIRM (tout à 0) — zéros conservés sans NaN", () => {
  const r = normalizeLinePricing({ unitPrice: 0, quantity: 0, amount: 0 });
  assertEquals(r, { quantity: 0, unit_price: 0, amount: 0 });
});

Deno.test("lignes: amount=0 explicite non écrasé par total legacy", () => {
  const r = normalizeLinePricing({ amount: 0, total: 100 });
  assertEquals(r.amount, 0);
});

Deno.test("lignes: total legacy utilisé si amount absent", () => {
  const r = normalizeLinePricing({ total: 4500, quantity: 1 });
  assertEquals(r.amount, 4500);
  assertEquals(r.unit_price, 4500);
});

Deno.test("lignes: ligne vide — défauts legacy (quantity 1, prix 0, amount 0)", () => {
  assertEquals(normalizeLinePricing({}), {
    quantity: 1,
    unit_price: 0,
    amount: 0,
  });
  assertEquals(normalizeLinePricing(null), {
    quantity: 1,
    unit_price: 0,
    amount: 0,
  });
});

Deno.test("lignes: valeurs non finies (NaN/Infinity/string non numérique) ignorées", () => {
  const r = normalizeLinePricing({
    unitPrice: Number.NaN,
    unit_price: "abc",
    rate: 750,
    quantity: Infinity,
    amount: 1500,
  });
  assertEquals(r.unit_price, 750);
  assertEquals(r.quantity, 1);
  assertEquals(r.amount, 1500);
});
