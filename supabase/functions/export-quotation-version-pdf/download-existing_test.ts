import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePdfExportRequest } from "./index.ts";

// All clients terminate in this in-process fake fetch; no real credentials/network.
const VERSION = "215e9450-f023-4f99-ab41-fbd0ba678eb4";
const CASE = "1d6202e8-0adc-4a7b-9433-b064a6378643";
const PDF = "96cbce2b-26a4-4e46-af77-7eaea9ebc737";
type Options = { missing?: boolean; readError?: boolean; signError?: boolean; admitted?: boolean; status?: string; versionStatus?: string };

async function exercise(body: Record<string, unknown>, options: Options = {}, authorized = true) {
  Deno.env.set("SUPABASE_URL", "https://synthetic.invalid");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service");
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    assertEquals(url.origin, "https://synthetic.invalid", "no real network target");
    const requestBody = req.method === "POST" ? await req.json() : null;
    calls.push({ method: req.method, path: url.pathname, body: requestBody });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/auth/v1/user") return json({ id: VERSION, aud: "authenticated", role: "authenticated", email: "operator@example.test", created_at: "2026-10-15T00:00:00Z" });
    if (url.pathname === "/rest/v1/rpc/has_workspace_access") return json(options.admitted !== false);
    if (url.pathname === "/rest/v1/quotation_versions") return json([{ id: VERSION, case_id: CASE, version_number: 3, status: options.versionStatus ?? "draft", source_kind: "canonical", snapshot: { meta: {}, totals: { total_payable: 649000 }, lines: [] } }]);
    if (url.pathname === "/rest/v1/quote_cases") return json([{ status: options.status ?? "QUOTED_VERSIONED" }]);
    if (url.pathname === "/rest/v1/quotation_documents") {
      assertEquals(req.method, "GET", "documents never written by download");
      assertEquals(url.searchParams.get("quotation_version_id"), `eq.${VERSION}`);
      if (options.readError) return json({ message: "synthetic read failure" }, 500);
      return json(options.missing ? [] : [{ id: PDF, file_path: "QC-SYNTHETIC/v3/source.pdf", file_hash: "recorded-hash", file_size: 4126 }]);
    }
    if (url.pathname === "/storage/v1/object/sign/quotation-attachments/QC-SYNTHETIC/v3/source.pdf") {
      assertEquals(req.method, "POST");
      assertEquals(requestBody?.expiresIn, 3600);
      return options.signError ? json({ message: "synthetic signing failure" }, 400) : json({ signedURL: "/object/sign/quotation-attachments/QC-SYNTHETIC/v3/source.pdf?synthetic=1" });
    }
    if (url.pathname === "/rest/v1/runtime_events") return new Response(null, { status: 201 });
    throw new Error(`Unexpected synthetic request ${req.method} ${url.pathname}`);
  };
  try {
    const response = await handlePdfExportRequest(new Request("https://synthetic.invalid/functions/v1/export-quotation-version-pdf", {
      method: "POST", headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: "Bearer synthetic-user" } : {}) }, body: JSON.stringify(body),
    }));
    const payload = await response.json();
    assert(!calls.some(c => c.path.startsWith("/storage/v1/object/") && !c.path.startsWith("/storage/v1/object/sign/")), "no upload/delete/download request");
    assert(!calls.some(c => c.path === "/rest/v1/quotation_documents" && c.method !== "GET"), "no document write");
    assert(!calls.some(c => /pricing_runs|quotation_version_lines|quote_facts/.test(c.path)), "no pricing/version/fact activity");
    for (const call of calls.filter(c => c.path === "/rest/v1/runtime_events")) {
      assert(!JSON.stringify(call.body).includes("synthetic=1"), "signed URLs never logged");
    }
    return { response, payload, calls };
  } finally {
    globalThis.fetch = realFetch;
    // Values are synthetic and confined to this test worker; never read prior env secrets.
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) Deno.env.delete(key);
  }
}

Deno.test("download existing PDF: fresh signed attachment preserves document identity/hash/size and never generates", async () => {
  const { response, payload, calls } = await exercise({ version_id: VERSION, download_existing: true });
  assertEquals(response.status, 200);
  assertEquals(payload.data.document_id, PDF);
  assertEquals(payload.data.file_hash, "recorded-hash");
  assertEquals(payload.data.file_size, 4126);
  assertEquals(payload.data.idempotent, true);
  assertEquals(payload.data.delivery, "attachment");
  assertEquals(new URL(payload.data.url).searchParams.get("download"), "devis-v3.pdf");
  assertEquals(calls.filter(c => c.path.includes("/object/sign/")).length, 1);
});

for (const [name, options] of Object.entries({ missing: { missing: true }, read_error: { readError: true }, signing_error: { signError: true } })) {
  Deno.test(`download existing PDF fails closed on ${name}, without generating`, async () => {
    const { response, payload, calls } = await exercise({ version_id: VERSION, download_existing: true }, options);
    assert(response.status >= 400);
    assertEquals(payload.ok, false);
    assert(!payload.data?.url);
    if (name !== "signing_error") assert(!calls.some(c => c.path.includes("/object/sign/")));
  });
}

for (const [name, options, authorized] of [
  ["missing auth", {}, false], ["non-admitted user", { admitted: false }, true],
  ["invalid case state", { status: "NEED_INFO" }, true], ["non-draft version", { versionStatus: "approved" }, true],
] as const) {
  Deno.test(`download existing PDF preserves guard: ${name}`, async () => {
    const { response, calls } = await exercise({ version_id: VERSION, download_existing: true }, options, authorized);
    assert(response.status >= 400);
    assert(!calls.some(c => c.path.includes("/object/sign/") || c.path === "/rest/v1/quotation_documents"));
  });
}

Deno.test("download existing PDF rejects ambiguous non-boolean intent", async () => {
  const { response, calls } = await exercise({ version_id: VERSION, download_existing: "true" });
  assertEquals(response.status, 400);
  assert(!calls.some(c => c.path === "/rest/v1/quotation_documents"));
});

Deno.test("historical export request still reuses its existing PDF with inline delivery", async () => {
  const { response, payload } = await exercise({ version_id: VERSION });
  assertEquals(response.status, 200);
  assertEquals(payload.data.idempotent, true);
  assertEquals(payload.data.delivery, "inline");
  assertEquals(new URL(payload.data.url).searchParams.get("download"), null);
});
