import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { proposalClient, proposalPlainBody } from "./scenario-source.ts";
import { proposalFingerprint, proposeGroups } from "./scenario-domain.ts";
const email = "client@example.invalid";
const text = "1.2 x 20HQ SOC (equipment): 10t/unit\n2.3 x 40HQ COC (parts): 8t/unit";
Deno.test("proposal identity: existing contact fallback, equality, contradictions and invalid facts", () => {
  const fact = { fact_key: "contacts.client_email", value_text: email };
  assertEquals(proposalClient(null,[fact]), { email, source: "case_contact_fact" });
  assertEquals(proposalClient(email.toUpperCase(),[fact]).source, "email_thread");
  assertEquals(proposalClient(null,[{ ...fact, value_json: { origin: "synthetic metadata" } }]).email, email);
  for (const [client, facts] of [["other@example.invalid",[fact]], [null,[fact,{ ...fact,value_text: "other@example.invalid" }]], [null,[{ fact_key: fact.fact_key,value_json: { email } }]]] as const)
    assertEquals(proposalClient(client,[...facts]).reason, "CLIENT_IDENTITY_CONFLICT");
});

const encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const legacy = (plain: string, html: string) => `${encode(plain)}\r\n--synthetic-boundary_42\r\n${encode(html)}`;
const html = `<div>${text.replaceAll("\n", "<br>")}</div>`;

Deno.test("proposal legacy: matching encoded alternatives, arbitrary sender and no source mutation", async () => {
  const raw = legacy(text, html);
  const source = [{ id: "synthetic-source", from_address: email, body_text: raw }];
  const before = await proposalFingerprint(email, source);
  assertEquals(proposalPlainBody(raw), text);
  assertEquals(proposeGroups(email, source).groups.map(g => g.quantity), [2, 3]);
  assertEquals(source[0].body_text, raw);
  assertEquals(await proposalFingerprint(email, source), before);
});

Deno.test("proposal legacy: UTF8, entities, decorated signature and duplicated rendered link", () => {
  const plain = `${text}\nMerci & à bientôt\nhttps://example.invalid <https://example.invalid >\n----------`;
  const rich = `<div>${html}<p>Merci &amp; &#224; bient&#xF4;t</p><a href="https://example.invalid">https://example.invalid</a><br>-----------</div>`;
  assertEquals(proposalPlainBody(legacy(plain, rich)), plain);
  const wrapped = legacy(text, html).split("\r\n").map(line => line.startsWith("--") ? line : line.match(/.{1,76}/g)!.join("\r\n")).join("\r\n");
  assertEquals(proposalPlainBody(wrapped), text);
  assertEquals(proposalPlainBody(legacy(text.replaceAll("\n", "\r\n"), html)), text.replaceAll("\n", "\r\n"));
});

for (const [name, raw] of [
  ["different quantity", legacy(text, html.replace("1.2", "1.9"))],
  ["HTML-only correction", legacy(text, html.replace("</div>", "<p>Cancel this request</p></div>"))],
  ["two text parts", legacy(text, text)],
  ["HTML first", legacy(html, html)],
  ["third part", legacy(text, html) + "\n--synthetic-boundary_42\n" + encode("Correction")],
  ["truncated HTML", legacy(text, html.slice(0, -6))],
  ["invalid base64", legacy(text, html) + "!"],
  ["noncanonical base64", "Zh==\n--synthetic-boundary_42\n" + encode("<p>f</p>")],
  ["invalid UTF8", "/w==\n--synthetic-boundary_42\n" + encode(html)],
  ["binary plain", legacy("\u0000" + text, html)],
  ["truncation marker", legacy(text + "[truncated]", html)],
  ["hidden HTML content", legacy(text, html.replace("</div>", "<span hidden>Correction</span></div>"))],
  ["script", legacy(text, html + "<script>cancel()</script>")],
  ["comment", legacy(text, html + "<!-- other cargo -->")],
  ["unknown entity", legacy(text, html.replace("equipment", "&unknown;"))],
  ["meaningful image alt", legacy(text, html + '<img alt="other cargo">')],
  ["remaining closing boundary", legacy(text, html) + "\n--synthetic-boundary_42--"],
  ["optional HTML closing tags", legacy("ab", "<div><ul><li>a<li>b</ul></div>")],
  ["doctype outside supported legacy shape", legacy(text, "<!DOCTYPE html>" + html)],
] as const) Deno.test(`proposal legacy refuses ${name}`, () => assertEquals(proposalPlainBody(raw), null));

Deno.test("proposal legacy: ordinary text and complete MIME remain on their existing path", () => {
  assertEquals(proposalPlainBody(`${text}\nBest regards\n----------\nOperator`), `${text}\nBest regards\n----------\nOperator`);
  assertEquals(proposalPlainBody(encode(text)), encode(text)); // no evidence of a paired alternative
  assertEquals(proposalPlainBody(`Content-Type: text/plain\n\n${text}`), text);
  assertEquals(proposalPlainBody(legacy(text, html).repeat(2000)), null);
  for (const separator of ["---", "----"]) {
    const ordinary = `Bonjour\n${separator}\n${text}`;
    assertEquals(proposalPlainBody(ordinary), ordinary);
    assertEquals(proposeGroups(email, [{ id: "source", from_address: email, body_text: ordinary }]).status, "proposed");
  }
});

Deno.test("proposal legacy: images are not interpreted, only the complete text alternative supplies groups", () => {
  for (const image of ['<img src="cid:signature.png">', '<img src="cid:unknown.png" alt="">']) {
    const raw = legacy(text, html + image);
    assertEquals(proposalPlainBody(raw), text);
    assertEquals(proposeGroups(email, [{ id: "source", from_address: email, body_text: raw }]).groups.map(g => g.quantity), [2, 3]);
  }
  assertEquals(proposalPlainBody(legacy(text, `<div>${"<b></b>".repeat(6000)}${html}</div>`)), text);
});

Deno.test("proposal legacy: decoded history, revisions and source attribution still fail closed", () => {
  for (const plain of [`From: Sender\n${text}`, `${text}\nPlease cancel this request`, `${text}\nUN3536`]) {
    const raw = legacy(plain, `<div>${plain.replaceAll("\n", "<br>")}</div>`);
    assertEquals(proposalPlainBody(raw), plain);
    assertEquals(proposeGroups(email, [{ id: "source", from_address: email, body_text: raw }]).status, "needs_review");
  }
  assertEquals(proposeGroups(email, [{ id: "source", from_address: "other@example.invalid", body_text: legacy(text, html) }]).status, "needs_review");
});
Deno.test("proposal MIME: complete base64 and quoted-printable text, no truncate, no attachment", () => {
  const base64 = `Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${btoa(text)}`;
  assertEquals(proposalPlainBody(base64), text);
  const multi = `Content-Type: multipart/mixed; boundary="test"\n\n--test\n${base64}\n--test\nContent-Type: text/plain\nContent-Disposition: attachment\n\nFAKE CARGO\n--test--`;
  assertEquals(proposalPlainBody(multi), text);
  assertEquals(proposeGroups(email,[{ id: "source", from_address: email, body_text: multi }]).status,"proposed");
  assertEquals(proposalPlainBody("Content-Type: text/plain\nContent-Transfer-Encoding: quoted-printable\n\npi=C3=A8ces"),"pièces");
  const long = "x".repeat(5000) + "\nPlease cancel";
  assertEquals(proposalPlainBody(`Content-Type: text/plain\n\n${long}`), long);
  for (const bad of [multi.replace("--test--",""), multi.replace("Content-Disposition: attachment", "Content-Disposition: inline"),
    base64.replace(btoa(text), "!!!"), base64.replace(btoa(text), btoa("[truncated]")),
    base64.replace("utf-8", "unsupported"), "Content-Type: text/html\n\n<html>cargo</html>"])
    assertEquals(proposalPlainBody(bad), null);
});
