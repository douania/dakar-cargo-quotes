/** Synthetic HTTP boundary only: no socket, secret, AI, real record or real tariff. */
export type FixtureRow = Record<string, unknown>;
type Handler = (request: Request) => Promise<Response>;
export const fixtureZones: FixtureRow[] = [
  {
    zone_code: "DAKAR",
    zone_name: "Dakar Centre",
    multiplier: 1,
    distance_from_port_km: 0,
    example_cities: ["Plateau", "Médina"],
    is_active: true,
  },
  {
    zone_code: "THIES_REGION",
    zone_name: "Région Thiès",
    multiplier: 1.3,
    distance_from_port_km: 70,
    example_cities: ["Thiès"],
    is_active: true,
  },
];
export const fixtureRates = ["20' Dry", "40' Dry"].map((
  container_type,
  index,
) => ({
  id: `synthetic-rate-${index}`,
  origin: "Dakar Port",
  destination: "FORFAIT ZONE 1 <18 KM",
  container_type,
  cargo_category: "Dry",
  rate_amount: index ? 456 : 123,
  rate_currency: "XOF",
  is_active: true,
  evidence_level: "validated_internal",
  validity_start: null,
  validity_end: null,
  client_code: null,
  source_document: "TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS",
  provider: null,
}));
export const fixtureRequest = {
  finalDestination: "Dakar",
  transportMode: "maritime",
  incoterm: "DAP",
  cargoType: "GENERAL_CARGO",
  cargoDescription: "SYNTHETIC NON COMMERCIAL GOODS",
  cargoValue: 100000,
  cargoCurrency: "XOF",
  cargoWeight: 84,
  weightPerContainerKg: 28000,
  containers: [{ type: "20GP", quantity: 3 }],
  includeLocalTransport: true,
  includeCustomsClearance: true,
};

export async function captureEngine(handler: Handler, options: {
  request?: FixtureRow;
  zones?: FixtureRow[];
  zoneError?: boolean;
} = {}) {
  const originalFetch = globalThis.fetch;
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const old = keys.map((key) => Deno.env.get(key));
  keys.forEach((key, index) =>
    Deno.env.set(key, index ? "synthetic-key" : "https://zone-fixture.invalid")
  );
  const calls: { path: string; method: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "zone-fixture.invalid") {
      throw new Error(`Unexpected external request: ${url.hostname}`);
    }
    const method = init?.method ??
      (input instanceof Request ? input.method : "GET");
    calls.push({ path: url.pathname, method });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
    }
    if (url.pathname.endsWith("/rpc/has_workspace_access")) {
      return Response.json(true);
    }
    if (url.pathname === "/functions/v1/suggest-historical-lines") {
      return Response.json({ suggested_lines: [], based_on_quotations: 0 });
    }
    if (url.pathname === "/rest/v1/runtime_events" && method === "POST") {
      return Response.json([]);
    }
    if (method !== "GET" && method !== "HEAD") {
      throw new Error(`Unexpected business write ${method} ${url.pathname}`);
    }
    if (!url.pathname.startsWith("/rest/v1/")) {
      throw new Error(`Unexpected request ${url.pathname}`);
    }
    const table = url.pathname.split("/").pop()!;
    if (table === "delivery_zones" && options.zoneError) {
      return Response.json({ message: "Synthetic catalogue read failure" }, {
        status: 500,
      });
    }
    const tables: Record<string, FixtureRow[]> = {
      delivery_zones: options.zones ?? fixtureZones,
      local_transport_rates: fixtureRates,
    };
    let rows = [...(tables[table] ?? [])];
    for (const [key, expression] of url.searchParams) {
      if (expression.startsWith("eq.")) {
        rows = rows.filter((row) => String(row[key]) === expression.slice(3));
      }
      if (expression.startsWith("in.(")) {
        const values = expression.slice(4, -1).split(",").map((value) =>
          value.replace(/^"|"$/g, "")
        );
        rows = rows.filter((row) => values.includes(String(row[key])));
      }
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    return Response.json(
      headers.get("accept")?.includes("vnd.pgrst.object")
        ? rows[0] ?? null
        : rows,
    );
  };
  try {
    const response = await handler(
      new Request("https://zone-fixture.invalid/quotation-engine", {
        method: "POST",
        headers: {
          Authorization: "Bearer synthetic-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "generate",
          params: { ...fixtureRequest, ...options.request },
        }),
      }),
    );
    return { status: response.status, body: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) =>
      old[index] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, old[index]!)
    );
  }
}
