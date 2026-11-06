import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deliveryZoneMetadata } from "../_shared/delivery-zone-resolution.ts";
import { OPTIONAL_ZONE_REPLY_CONTRACT } from "../_shared/zone-reply-contract.ts";
const saved = Deno.env.get("GENERATE_RESPONSE_DISABLE_SERVE");
Deno.env.set("GENERATE_RESPONSE_DISABLE_SERVE", "1");
const { handleRequest } = await import("./index.ts");
if (saved === undefined) Deno.env.delete("GENERATE_RESPONSE_DISABLE_SERVE");
else Deno.env.set("GENERATE_RESPONSE_DISABLE_SERVE", saved);
const zones = {
  DAKAR: {
    code: "DAKAR",
    name: "Dakar Centre",
    examples: ["Médina"],
    multiplier: 1,
    distanceKm: 0,
  },
};

Deno.test("actual generation: auth and OPTIONS precede any capability or generation work", async () => {
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = keys.map((k) => Deno.env.get(k));
  keys.forEach((k) =>
    Deno.env.set(
      k,
      k === "SUPABASE_URL"
        ? "https://generation-fixture.invalid"
        : "synthetic-key",
    )
  );
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("No request allowed");
  };
  try {
    assertEquals(
      (await handleRequest(
        new Request("https://generation-fixture.invalid", {
          method: "OPTIONS",
        }),
      )).status,
      200,
    );
    assertEquals(
      (await handleRequest(
        new Request("https://generation-fixture.invalid", {
          method: "POST",
          body: "{}",
        }),
      )).status,
      401,
    );
    assertEquals(calls, 0);
  } finally {
    globalThis.fetch = old;
    keys.forEach((k, i) =>
      previous[i] === undefined
        ? Deno.env.delete(k)
        : Deno.env.set(k, previous[i]!)
    );
  }
});

for (const contract of [undefined, OPTIONAL_ZONE_REPLY_CONTRACT]) {
  Deno.test(`actual generation: ambiguous zone explicit and no arbitrary factor, client=${contract}`, async () => {
    const r = await fixture({ ambiguous: true, contract });
    if (contract === undefined) {
      assertEquals(r.status, 409, JSON.stringify(r));
      assert(r.body.error.message.includes("ambiguë"));
      assertEquals(r.drafts, 0);
      assertEquals(r.finalAi, 0);
    } else {
      assertEquals(r.status, 200, JSON.stringify(r));
      assertEquals("complexity_factor" in r.body.data.sodatra_fees, false);
      assert(
        r.body.data.quotation_warnings.some((s: string) =>
          s.includes("ambiguë")
        ),
      );
      assertEquals(r.body.data.quotation_lines, r.engine.lines);
    }
  });
}
async function fixture(
  options: {
    contract?: unknown;
    unknown?: boolean;
    oldEngine?: boolean;
    failure?: boolean;
    infoOnly?: boolean;
    ambiguous?: boolean;
    missingDestination?: null | string;
  } = {},
) {
  const original = globalThis.fetch;
  const env = {
    SUPABASE_URL: "https://generation-fixture.invalid",
    SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    LOVABLE_API_KEY: "synthetic-ai",
  };
  const before = Object.keys(env).map((k) => Deno.env.get(k));
  Object.entries(env).forEach(([k, v]) => Deno.env.set(k, v));
  let finalAi = 0, extraction = 0, drafts = 0, engineCalls = 0;
  const writes: string[] = [];
  const destination = options.unknown ? "Ville inconnue" : "Dakar";
  const engine = {
    success: true,
    lines: [{
      id: "fixture-fee",
      bloc: "honoraires",
      description: "SYNTHETIC",
      amount: 120,
      currency: "XOF",
      source: { type: "CALCULATED", reference: "FIXTURE", confidence: 1 },
    }],
    totals: {
      operationnel: 0,
      honoraires: 120,
      debours: 0,
      dap: 120,
      ddp: 120,
    },
    metadata: options.oldEngine
      ? { zone: { multiplier: 1.3 } }
      : deliveryZoneMetadata(
        destination,
        options.ambiguous
          ? { ...zones, TEST: { ...zones.DAKAR, code: "TEST", examples: ["Dakar"] } }
          : zones,
        "delivery_zones",
      ),
    warnings: [],
  };
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init),
      url = new URL(req.url),
      name = url.pathname.split("/").pop();
    const json = (data: unknown, status = 200) =>
      Response.json(data, { status });
    if (url.hostname === "ai.gateway.lovable.dev") {
      const body = await req.json();
      if (body.tool_choice) {
        extraction++;
        return json({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: "extract_quotation_data",
                  arguments: JSON.stringify({
                    detected_language: "FR",
                    request_type: "QUOTATION_REQUEST",
                    can_quote_now: !options.infoOnly,
                    transport_mode: "maritime",
                    destination: "missingDestination" in options ? options.missingDestination : destination,
                    cargo_description: "SYNTHETIC",
                    services_requested: ["customs_clearance"],
                    missing_info: [],
                    questions_to_ask: [],
                    has_pi: false,
                  }),
                },
              }],
            },
          }],
        });
      }
      finalAi++;
      return json({
        choices: [{
          message: {
            content: JSON.stringify({
              greeting: "Bonjour",
              body_short: "Fixture",
              closing: "Fin",
              signature: "Test",
              attachment_needed: false,
            }),
          },
        }],
      });
    }
    assertEquals(
      url.hostname,
      "generation-fixture.invalid",
      "No external request permitted",
    );
    if (url.pathname === "/auth/v1/user") {
      return json({
        id: "11111111-1111-4111-8111-111111111111",
        email: "operator@example.invalid",
      });
    }
    if (name === "has_workspace_access") return json(true);
    // Reservation metadata is tested separately; this fixture counts business outputs.
    if (name === "begin_generation_email_lease") return json({kind:"started"});
    if (name === "finish_generation_email_lease") return json({kind:"retained"});
    if (url.pathname === "/functions/v1/quotation-engine") {
      engineCalls++;
      return options.failure ? json({ error: "synthetic" }, 503) : json(engine);
    }
    if (url.pathname.startsWith("/functions/v1/")) return json({});
    assert(url.pathname.startsWith("/rest/v1/"));
    if (req.method !== "GET") {
      writes.push(name!);
      if (name === "email_drafts") {
        drafts++;
        return json({ id: "88888888-8888-4888-8888-888888888888", body_text: "Fixture" });
      }
      assertEquals(
        name,
        "runtime_events",
        "Only draft/technical writes allowed in this synthetic fixture",
      );
      return json([]);
    }
    const single = req.headers.get("accept")?.includes("vnd.pgrst.object");
    return json(single ? null : []);
  };
  try {
    const result = await handleRequest(
      new Request("https://generation-fixture.invalid/generate-response", {
        method: "POST",
        headers: {
          Authorization: "Bearer synthetic-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quotationData: {},
          zone_reply_contract: options.contract,
        }),
      }),
    );
    return {
      status: result.status,
      body: await result.json(),
      finalAi,
      extraction,
      drafts,
      engineCalls,
      writes,
      engine,
    };
  } finally {
    globalThis.fetch = original;
    Object.keys(env).forEach((k, i) =>
      before[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, before[i]!)
    );
  }
}
for (const contract of [undefined, OPTIONAL_ZONE_REPLY_CONTRACT]) {
  Deno.test(`actual generation: recognized zone remains numeric, client=${contract}`, async () => {
    const r = await fixture({ contract });
    assertEquals(r.status, 200, JSON.stringify(r));
    assertEquals(r.drafts, 1);
    assertEquals(r.finalAi, 1);
    assertEquals(r.body.data.sodatra_fees.complexity_factor, 1);
    assertEquals(r.body.data.quotation_lines, r.engine.lines);
    assertEquals(r.body.data.quotation_totals, r.engine.totals);
  });
}
Deno.test("actual generation: old client unknown is refused before final AI and draft persistence", async () => {
  const r = await fixture({ unknown: true });
  assertEquals(r.status, 409, JSON.stringify(r));
  assertEquals(r.body.error.code, "ZONE_CONFIRMATION_REQUIRED");
  assert(r.body.error.message.includes("indéterminé"));
  assertEquals(r.extraction, 1);
  assertEquals(r.finalAi, 0);
  assertEquals(r.drafts, 0);
  assertEquals(r.writes.filter((x) => x !== "runtime_events"), []);
  assertEquals("data" in r.body, false);
});
Deno.test("actual generation: capable unknown receives no factor, unchanged services, explicit warning", async () => {
  const r = await fixture({
    unknown: true,
    contract: OPTIONAL_ZONE_REPLY_CONTRACT,
  });
  assertEquals(r.status, 200, JSON.stringify(r));
  assertEquals(r.drafts, 1);
  assertEquals("complexity_factor" in r.body.data.sodatra_fees, false);
  assert(
    r.body.data.sodatra_fees.complexity_reasons.some((s: string) =>
      s.includes("indéterminé")
    ),
  );
  assertEquals(r.body.data.quotation_lines, r.engine.lines);
  assertEquals(r.body.data.quotation_totals, r.engine.totals);
});
for (const contract of [undefined, OPTIONAL_ZONE_REPLY_CONTRACT]) {
  for (const failure of [false, true]) {
    Deno.test(`actual generation: mixed old/unavailable engine never reaches fee fallback, client=${contract}, failure=${failure}`, async () => {
      const r = await fixture({ oldEngine: true, failure, contract });
      assertEquals(r.status, 503, JSON.stringify(r));
      assertEquals(r.body.error.code, "ZONE_ENGINE_CONTRACT_NOT_READY");
      assertEquals(r.finalAi, 0);
      assertEquals(r.drafts, 0);
    });
  }
}
Deno.test("actual generation: information-only flow keeps its existing non-pricing path", async () => {
  const r = await fixture({ infoOnly: true });
  assertEquals(r.status, 200, JSON.stringify(r));
  assertEquals(r.engineCalls, 0);
  assertEquals(r.drafts, 1);
});

for (const contract of [undefined, OPTIONAL_ZONE_REPLY_CONTRACT]) {
  for (const missingDestination of [null, "", "   "]) {
    Deno.test(`actual generation: quotable but absent destination refuses before final AI/draft, client=${contract}, destination=${JSON.stringify(missingDestination)}`, async () => {
      const r = await fixture({contract,missingDestination});
      assertEquals(r.status,409,JSON.stringify(r));
      assertEquals(r.body.error.code,"ZONE_CONFIRMATION_REQUIRED");
      assert(r.body.error.message.includes("absente"));
      assertEquals(r.finalAi,0);assertEquals(r.drafts,0);
      assertEquals(r.writes.filter((x)=>x!=="runtime_events"),[]);
    });
  }
}
