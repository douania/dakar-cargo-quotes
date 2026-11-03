import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deliveryZoneMetadata,
  zoneComplexityFactor,
} from "./delivery-zone-resolution.ts";
import {
  decideZoneReply as decideZoneTransition,
  OPTIONAL_ZONE_REPLY_CONTRACT as OPTIONAL_ZONE_CONTRACT,
  type ZoneReplyDecision,
  zoneReplyRefusal,
} from "./zone-reply-contract.ts";
async function afterZoneGate(
  decision: ZoneReplyDecision,
  callback: (
    factor: number | undefined,
    clarification: string | null,
  ) => Promise<unknown>,
) {
  if (!decision.allowed) return zoneReplyRefusal(decision, "synthetic", {});
  return Response.json({
    ok: true,
    data: await callback(decision.factor, decision.clarification),
  });
}

const zones = {
  DAKAR: {
    code: "DAKAR",
    name: "Dakar Centre",
    examples: ["Médina"],
    multiplier: 1,
    distanceKm: 0,
  },
  THIES_REGION: {
    code: "THIES_REGION",
    name: "Région Thiès",
    examples: ["Thiès"],
    multiplier: 1.3,
    distanceKm: 70,
  },
};
function engine(destination = "Dakar", ambiguous = false) {
  const catalogue = ambiguous
    ? {
      ...zones,
      TEST: { ...zones.THIES_REGION, code: "TEST", examples: ["Dakar"] },
    }
    : zones;
  return {
    success: true,
    metadata: deliveryZoneMetadata(destination, catalogue, "delivery_zones"),
    lines: [{ id: "synthetic-fee", amount: 120, currency: "XOF" }, {
      id: "stay",
      amount: null,
      currency: "USD",
    }],
    totals: { indicative: 120, firm: 0 },
    warnings: [],
  };
}
for (
  const client of [undefined, "", "wrong_contract", OPTIONAL_ZONE_CONTRACT]
) {
  for (const destination of ["Dakar", "Médina", "Thiès"]) {
    Deno.test(`recognized zone remains numeric, client=${String(client)}, destination=${destination}`, async () => {
      const reply = engine(destination), before = JSON.stringify(reply);
      const decision = decideZoneTransition(client, reply);
      assert(decision.allowed);
      assertEquals(decision.factor, destination === "Thiès" ? 1.3 : 1);
      const response = await afterZoneGate(
        decision,
        async (factor) => ({
          sodatra_fees: { complexity_factor: factor },
          ...reply,
        }),
      );
      assertEquals(response.status, 200);
      assertEquals(JSON.stringify(reply), before);
      const data = (await response.json()).data;
      assertEquals(data.lines, reply.lines);
      assertEquals(data.totals, reply.totals);
      assertEquals(typeof data.sodatra_fees.complexity_factor, "number");
    });
  }
}
for (const ambiguous of [false, true]) {
  for (const client of [undefined, "wrong_contract", OPTIONAL_ZONE_CONTRACT]) {
    Deno.test(`unresolved zone is not replaced by a number, ambiguous=${ambiguous}, client=${String(client)}`, async () => {
      const reply = engine(ambiguous ? "Dakar" : "Ville inconnue", ambiguous);
      const before = JSON.stringify(reply),
        decision = decideZoneTransition(client, reply);
      let finalDraftCalls = 0;
      const response = await afterZoneGate(
        decision,
        async (factor, clarification) => {
          finalDraftCalls++;
          return {
            sodatra_fees: { complexity_factor: factor },
            clarification,
            lines: reply.lines,
            totals: reply.totals,
          };
        },
      );
      const body = await response.json();
      assertEquals(JSON.stringify(reply), before);
      if (client === OPTIONAL_ZONE_CONTRACT) {
        assertEquals(response.status, 200);
        assertEquals(finalDraftCalls, 1);
        assertEquals("complexity_factor" in body.data.sodatra_fees, false);
        assert(body.data.clarification.includes("indéterminé"));
        assertEquals(body.data.lines, reply.lines);
        assertEquals(body.data.totals, reply.totals);
      } else {
        assertEquals(response.status, 409);
        assertEquals(finalDraftCalls, 0);
        assertEquals(body.ok, false);
        assertEquals(body.error.code, "ZONE_CONFIRMATION_REQUIRED");
        assert(body.error.message.includes("indéterminé"));
        assertEquals("data" in body, false);
        assertEquals("draft" in body, false);
        assertEquals("sodatra_fees" in body, false);
      }
    });
  }
}
for (const client of [undefined, OPTIONAL_ZONE_CONTRACT]) {
  for (
    const metadata of [null, {}, { zone: { multiplier: 1.3 } }, {
      zone: { multiplier: 1.3 },
      zone_resolution: { status: "matched", source: "unknown" },
    }]
  ) {
    Deno.test(`new consumer before corrected engine rejects unverifiable fresh metadata, client=${String(client)}, metadata=${JSON.stringify(metadata)}`, async () => {
      const decision = decideZoneTransition(client, {
        success: true,
        metadata,
      });
      assertEquals(decision.allowed, false);
      let writes = 0;
      const response = await afterZoneGate(decision, async () => {
        writes++;
        return {};
      });
      assertEquals(response.status, 503);
      assertEquals(writes, 0);
    });
  }
}
Deno.test("matched zone with invalid factor is not defaulted", () => {
  const reply = engine();
  reply.metadata.zone!.multiplier = null;
  const old = decideZoneTransition(undefined, reply);
  assertEquals(old.allowed, false);
  const modern = decideZoneTransition(OPTIONAL_ZONE_CONTRACT, reply);
  assert(modern.allowed);
  assertEquals(modern.factor, undefined);
  assert(modern.clarification?.includes("indéterminé"));
});
Deno.test("read-only historical values remain unchanged and are distinct from fresh-generation contract", () => {
  const historical = { zone: { code: "THIES_REGION", multiplier: 1.3 } },
    before = JSON.stringify(historical);
  assertEquals(zoneComplexityFactor(historical), 1.3);
  assertEquals(
    decideZoneTransition(undefined, { success: true, metadata: historical })
      .allowed,
    false,
  );
  assertEquals(JSON.stringify(historical), before);
});
Deno.test("counterexample: old consumer after new engine remains unsafe; rollout order is mandatory", () => {
  const corrected = engine("Ville inconnue");
  const oldConsumerFactor = corrected.metadata.zone?.multiplier || 1.0;
  assertEquals(
    oldConsumerFactor,
    1,
    "Witness of unchanged old server fallback, not accepted transition behavior",
  );
  assertEquals(zoneComplexityFactor(corrected.metadata), undefined);
});
