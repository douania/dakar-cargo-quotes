import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { proposalClient, proposalPlainBody } from "./scenario-source.ts";
import { proposeGroups } from "./scenario-domain.ts";
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
