import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captureEngine, fixtureZones } from "./zone-fixture.ts";
const oldFlag = Deno.env.get("QUOTATION_ENGINE_DISABLE_SERVE");
Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", "1");
const { handleRequest } = await import("./index.ts");
if (oldFlag === undefined) Deno.env.delete("QUOTATION_ENGINE_DISABLE_SERVE");
else Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", oldFlag);

Deno.test("moteur HTTP réel : Dakar exact, tarif indépendant, aucun effet métier", async () => {
  const result = await captureEngine(handleRequest);
  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.metadata.zone, {
    code: "DAKAR",
    name: "Dakar Centre",
    multiplier: 1,
    distanceKm: 0,
  });
  assertEquals(result.body.metadata.zone_resolution, {
    status: "matched",
    source: "delivery_zones",
    candidate_codes: ["DAKAR"],
  });
  const transport = result.body.lines.find((line: Record<string, unknown>) =>
    line.category === "Transport"
  );
  assert(transport);
  assertEquals(transport.amount, 1368); // 3 × synthetic 40-foot rate, unchanged weight rule.
  assert(
    !result.calls.some((call) =>
      call.method !== "GET" && call.path.startsWith("/rest/v1/") &&
      call.path !== "/rest/v1/runtime_events"
    ),
  );
});
Deno.test("moteur HTTP : accents reconnus sans inventer un tarif de livraison", async () => {
  const result = await captureEngine(handleRequest, {
    request: { finalDestination: "Médina" },
  });
  assertEquals(result.status, 200);
  assertEquals(result.body.metadata.zone.code, "DAKAR");
  const transport = result.body.lines.find((line: Record<string, unknown>) =>
    line.category === "Transport"
  );
  assertEquals(transport.amount, null);
  assertEquals(transport.source.type, "TO_CONFIRM");
});
for (const ambiguous of [false, true]) {
  Deno.test(`moteur HTTP : zone ${ambiguous ? "ambiguë" : "inconnue"} sans Thiès ni facteur`, async () => {
    const options = ambiguous
      ? {
        zones: [...fixtureZones, {
          ...fixtureZones[1],
          zone_code: "TEST",
          example_cities: ["Dakar"],
        }],
      }
      : { request: { finalDestination: "Ville synthétique inconnue" } };
    const result = await captureEngine(handleRequest, options);
    assertEquals(result.status, 200);
    assertEquals(result.body.metadata.zone, null);
    assertEquals(
      result.body.metadata.zone_resolution.status,
      ambiguous ? "ambiguous" : "unknown",
    );
    assert(
      result.body.warnings.some((warning: string) =>
        warning.includes(
          ambiguous
            ? "Zone de livraison ambiguë"
            : "Zone de livraison à confirmer",
        )
      ),
    );
    if (ambiguous) {
      // Descriptive ambiguity must not disable the independently proven exact tariff.
      assertEquals(
        result.body.lines.find((line: Record<string, unknown>) =>
          line.category === "Transport"
        ).amount,
        1368,
      );
    }
  });
}
for (const zoneError of [false, true]) {
  Deno.test(`moteur HTTP : provenance du catalogue fallback (${zoneError ? "échec" : "vide"})`, async () => {
    const result = await captureEngine(handleRequest, { zones: [], zoneError });
    assertEquals(result.status, 200);
    assertEquals(result.body.metadata.zone.code, "DAKAR");
    assertEquals(
      result.body.metadata.zone_resolution.source,
      "static_fallback",
    );
    assertEquals(
      result.body.lines.find((line: Record<string, unknown>) =>
        line.category === "Transport"
      ).amount,
      1368,
    );
  });
}
Deno.test("moteur HTTP : échec de catalogue + destination inconnue ne choisit pas sa première ligne", async () => {
  const result = await captureEngine(handleRequest, {
    zoneError: true,
    request: { finalDestination: "Ville synthétique inconnue" },
  });
  assertEquals(result.body.metadata.zone, null);
  assertEquals(result.body.metadata.zone_resolution.source, "static_fallback");
});
Deno.test("moteur HTTP : destination absente conserve le refus contractuel existant", async () => {
  const result = await captureEngine(handleRequest, {
    request: { finalDestination: "" },
  });
  assertEquals(result.status, 400);
  assertEquals(result.body.error, "Destination finale requise");
});
