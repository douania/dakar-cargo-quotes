import { handler as handler0 } from "../calculate-duties/handler.ts";
import { handler as handler1 } from "../learn-from-contact/handler.ts";
import { handler as handler2 } from "../suggest-regime/handler.ts";
import { handler as handler3 } from "../generate-case-outputs/handler.ts";
import { handler as handler4 } from "../get-active-exchange-rate/handler.ts";

const handlers: Array<[string, (req: Request) => Response]> = [
  ["calculate-duties", handler0],
  ["learn-from-contact", handler1],
  ["suggest-regime", handler2],
  ["generate-case-outputs", handler3],
  ["get-active-exchange-rate", handler4],
];
const release = "legacy-shutdown-20261009-v1";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

for (const [name, handler] of handlers) {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "CUSTOM"]) {
    Deno.test(name + " refuses " + method + " without reading input or making requests", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => { throw new Error("Outbound request forbidden"); };
      try {
        const req = new Request("https://synthetic.invalid/any-path?case_id=synthetic", {
          method,
          headers: { authorization: "Bearer synthetic-invalid", "content-type": "application/json" },
          ...(["GET", "HEAD"].includes(method) ? {} : { body: "{invalid-json" }),
        });
        Object.defineProperty(req, "headers", { get() { throw new Error("Identity read forbidden"); } });
        Object.defineProperty(req, "body", { get() { throw new Error("Body read forbidden"); } });
        Object.defineProperty(req, "json", { value() { throw new Error("JSON read forbidden"); } });
        const response = handler(req);
        assert(response.status === 410, "Expected unconditional 410");
        assert(response.headers.get("X-Legacy-Shutdown-Release") === release, "Missing reviewed release marker");
        assert(response.headers.get("X-Retired-Function") === name, "Wrong function identity");
        assert(response.headers.get("Cache-Control") === "no-store", "Refusal must not be cached");
        const payload = await response.json();
        assert(JSON.stringify(payload) === JSON.stringify({ ok: false, error: "FUNCTION_RETIRED", function: name, release }), "Unexpected payload or data disclosure");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  Deno.test(name + " refuses anonymous POST", () => {
    assert(handler(new Request("https://synthetic.invalid", { method: "POST" })).status === 410, "Anonymous request must be refused");
  });

  Deno.test(name + " permits only an empty CORS preflight", async () => {
    const response = handler(new Request("https://synthetic.invalid", { method: "OPTIONS" }));
    assert(response.status === 204, "Expected empty preflight");
    assert(await response.text() === "", "Preflight must contain no data");
    assert(response.headers.get("X-Legacy-Shutdown-Release") === release, "Missing preflight release marker");
  });
}
