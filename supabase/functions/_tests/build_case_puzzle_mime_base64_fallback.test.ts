import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  extractPlainTextFromMime,
  extractExplicitBusTotalFromLatestInboundBody,
} = await import("../build-case-puzzle/index.ts");

// Latest GWC client body, as it is actually stored: raw base64, no MIME boundary.
const GWC_PLAIN =
  "C0 - Public\r\n\r\nDear Cherif,\r\n\r\nWe got an update from customer that now the total bus count is 15 and additionally 1x 20' and 1x 40' container has been added. Bus is increase to 15 Buses.";
const GWC_BASE64_BODY = btoa(GWC_PLAIN);

Deno.test("Test 1 — raw base64 body without boundary is decoded to readable text", () => {
  const out = extractPlainTextFromMime(GWC_BASE64_BODY);
  assert(out.includes("total bus count is 15"), `expected decoded text, got: ${out.slice(0, 80)}`);
  assert(out.includes("Dear Cherif"));
  // Must no longer be the raw base64 payload.
  assert(!out.startsWith("QzAg"));
});

Deno.test("Test 2 — raw non-base64 body without boundary is returned unchanged (fallback)", () => {
  const body = "Dear Cherif, please quote for 5 buses EXW Mumbai. Best regards, Abishek.";
  const out = extractPlainTextFromMime(body);
  assertEquals(out, body);
});

Deno.test("Test 3 — base64 HTML body without boundary is stripped to readable text", () => {
  const html =
    "<html><body><div>We got an update: total bus count is 15 buses.</div></body></html>";
  const out = extractPlainTextFromMime(btoa(html));
  assert(out.includes("total bus count is 15 buses"), `got: ${out}`);
  assert(!out.includes("<div"));
  assert(!out.includes("<html"));
});

Deno.test("Test 4 — MIME multipart with boundary keeps existing behaviour", () => {
  const mime = [
    'Content-Type: multipart/alternative; boundary="XYZ"',
    "",
    "--XYZ",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    "We got an update: total bus count is 15 buses.",
    "--XYZ--",
    "",
  ].join("\r\n");
  const out = extractPlainTextFromMime(mime);
  assert(out.includes("total bus count is 15 buses"), `got: ${out}`);
});

Deno.test("Test 5 — end-to-end: extractExplicitBusTotalFromLatestInboundBody(extractPlainTextFromMime(base64)) === 15", () => {
  assertEquals(extractExplicitBusTotalFromLatestInboundBody(GWC_BASE64_BODY), null, "sanity: raw base64 yields no total");
  const decoded = extractPlainTextFromMime(GWC_BASE64_BODY);
  assertEquals(extractExplicitBusTotalFromLatestInboundBody(decoded), 15);
});

Deno.test("Empty body → empty string (unchanged guard)", () => {
  assertEquals(extractPlainTextFromMime(""), "");
});
