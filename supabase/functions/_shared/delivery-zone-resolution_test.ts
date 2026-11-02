import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deliveryZoneMetadata,
  deliveryZoneWarnings,
  resolveDeliveryZone,
  zoneComplexityFactor,
} from "./delivery-zone-resolution.ts";

const dakar = Object.freeze({
  code: "DAKAR",
  name: "Dakar Centre",
  examples: Object.freeze(["Plateau", "Médina", "Point E"]),
  multiplier: 1,
  distanceKm: 0,
});
const thies = Object.freeze({
  code: "THIES_REGION",
  name: "Région Thiès",
  examples: Object.freeze(["Thiès"]),
  multiplier: 1.3,
  distanceKm: 70,
});
const zones = Object.freeze({ DAKAR: dakar, THIES_REGION: thies });

for (
  const destination of [
    "Dakar",
    "DAKAR",
    "  dakar  ",
    "Dakar Centre",
    "Plateau",
    "Médina",
    "Me\u0301dina",
    "Medina",
    "Point-E",
  ]
) {
  Deno.test(`zone descriptive exacte : ${destination}`, () => {
    const resolved = resolveDeliveryZone(destination, zones);
    assertEquals(resolved.status, "matched");
    assertEquals(resolved.zone, dakar);
  });
}
for (
  const destination of [
    "THIES_REGION",
    "Région Thiès",
    "Region Thies",
    "Thie\u0300s",
  ]
) {
  Deno.test(`zone descriptive accent/code : ${destination}`, () => {
    assertEquals(resolveDeliveryZone(destination, zones).zone, thies);
  });
}
for (
  const destination of [
    "",
    "  ",
    "Ville synthétique inconnue",
    "XplateauX",
    "Dakar / Thiès",
    null,
    42,
  ]
) {
  Deno.test(`zone descriptive inconnue sans repli : ${String(destination)}`, () => {
    assertEquals(resolveDeliveryZone(destination, zones), {
      status: "unknown",
      zone: null,
      candidate_codes: [],
    });
    assertEquals(resolveDeliveryZone(destination, { DAKAR: dakar }).zone, null);
  });
}
Deno.test("catalogue vide ne produit aucune zone ni distance", () => {
  const metadata = deliveryZoneMetadata("Dakar", {}, "static_fallback");
  assertEquals(metadata.zone, null);
  assertEquals(metadata.zone_resolution.status, "unknown");
});
Deno.test("collisions nom/code/exemple ambiguës, invariantes à l’ordre", () => {
  const other = { ...thies, examples: ["Plateau", "Dakar"] };
  for (const destination of ["Plateau", "Dakar"]) {
    const first = resolveDeliveryZone(destination, {
      DAKAR: dakar,
      THIES_REGION: other,
    });
    const second = resolveDeliveryZone(destination, {
      THIES_REGION: other,
      DAKAR: dakar,
    });
    assertEquals(first, second);
    assertEquals(first.status, "ambiguous");
    assertEquals(first.candidate_codes, ["DAKAR", "THIES_REGION"]);
  }
});
Deno.test("répéter un alias dans la même zone ne crée pas d’ambiguïté", () => {
  assertEquals(
    resolveDeliveryZone("Dakar", {
      DAKAR: { ...dakar, examples: ["Dakar", "DAKAR"] },
    }).status,
    "matched",
  );
});
Deno.test("deux enregistrements du même code ne sont pas départagés arbitrairement", () => {
  assertEquals(
    resolveDeliveryZone("Dakar", { a: dakar, b: { ...dakar, multiplier: 9 } })
      .status,
    "ambiguous",
  );
});
Deno.test("métadonnée connue conserve le contrat numérique et explicite la provenance", () => {
  const before = JSON.stringify(zones);
  assertEquals(deliveryZoneMetadata("Dakar", zones, "delivery_zones"), {
    zone: {
      code: "DAKAR",
      name: "Dakar Centre",
      multiplier: 1,
      distanceKm: 0,
      country: undefined,
    },
    zone_resolution: {
      status: "matched",
      source: "delivery_zones",
      candidate_codes: ["DAKAR"],
    },
  });
  assertEquals(JSON.stringify(zones), before);
  assertEquals(
    deliveryZoneMetadata("Thiès", zones, "static_fallback", "SN").zone?.country,
    "SN",
  );
});
Deno.test("valeurs numériques invalides du catalogue ne deviennent ni zéro ni 1", () => {
  const value = deliveryZoneMetadata("Dakar", {
    DAKAR: { ...dakar, multiplier: NaN, distanceKm: -1 },
  }, "delivery_zones");
  assertEquals(value.zone?.multiplier, null);
  assertEquals(value.zone?.distanceKm, null);
  assertEquals(zoneComplexityFactor(value), undefined);
});
Deno.test("facteurs legacy connus et snapshots historiques restent lisibles et immuables", () => {
  const legacy = { zone: { code: "THIES_REGION", multiplier: 1.3 } };
  const before = JSON.stringify(legacy);
  assertEquals(zoneComplexityFactor(legacy), 1.3);
  assertEquals(JSON.stringify(legacy), before);
  assertEquals(
    zoneComplexityFactor(
      deliveryZoneMetadata("Dakar", zones, "delivery_zones"),
    ),
    1,
  );
});
for (
  const metadata of [
    null,
    {},
    { zone: null },
    { zone: { multiplier: NaN } },
    { zone: { multiplier: 0 } },
    { zone: { multiplier: "1.3" } },
    { zone: { multiplier: Infinity } },
    { zone: { multiplier: 1.3 }, zone_resolution: { status: "ambiguous" } },
    { zone: { multiplier: 1.3 }, zone_resolution: { status: "unknown" } },
  ]
) {
  Deno.test(`facteur indéterminé sans repli : ${JSON.stringify(metadata)}`, () =>
    assertEquals(zoneComplexityFactor(metadata), undefined));
}
Deno.test("messages de zone inconnue/ambiguë explicites sans changer les tarifs", () => {
  assertEquals(deliveryZoneWarnings("matched"), []);
  assert(
    deliveryZoneWarnings("unknown")[0].includes(
      "Zone de livraison à confirmer",
    ),
  );
  assert(
    deliveryZoneWarnings("ambiguous")[0].includes("Zone de livraison ambiguë"),
  );
});
