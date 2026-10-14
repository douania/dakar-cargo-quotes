import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createMailboxConfig, quoteImapString, readMailboxSecret, replaceMailboxSecret } from "./mailbox-secret.ts";

Deno.test("Vault: credential is resolved by config id, with no plaintext fallback", async () => {
  const calls: unknown[] = [];
  const client = { rpc(name: string, args: Record<string, unknown>) {
    calls.push([name, args]);
    return Promise.resolve({ data: " synthetic credential ", error: null });
  } };
  assertEquals(await readMailboxSecret(client, "fixture-config"), " synthetic credential ");
  assertEquals(calls, [["read_mailbox_secret", { p_config_id: "fixture-config" }]]);
});

for (const data of [null, "", {}, 1]) {
  Deno.test(`Vault: invalid credential result fails closed (${JSON.stringify(data)})`, async () => {
    await assertRejects(() => readMailboxSecret({ rpc: () => Promise.resolve({ data, error: null }) }, "fixture"), Error,
      "Secret IMAP indisponible");
  });
}

Deno.test("Vault: RPC errors and rejected promises never reveal backend details", async () => {
  for (const rpc of [
    () => Promise.resolve({ data: null, error: { message: "synthetic-sensitive-detail" } }),
    () => Promise.reject(new Error("synthetic-sensitive-detail")),
  ]) {
    const error = await assertRejects(() => readMailboxSecret({ rpc }, "fixture"), Error);
    assertEquals(error.message.includes("synthetic-sensitive-detail"), false);
    const createError = await assertRejects(() => createMailboxConfig({ rpc }, { name: "fixture" }, "dummy-value"), Error);
    assertEquals(createError.message.includes("synthetic-sensitive-detail"), false);
  }
});

Deno.test("Vault: new config and password use one atomic RPC", async () => {
  const calls: unknown[] = [];
  const config = { name: "fixture", host: "imap.invalid", username: "fixture@example.invalid" };
  const result = { id: "fixture", password_encrypted: "********" };
  const client = { rpc(name: string, args: Record<string, unknown>) {
    calls.push([name, args]); return Promise.resolve({ data: result, error: null });
  } };
  assertEquals(await createMailboxConfig(client, config, "dummy-value"), result);
  assertEquals(calls, [["create_mailbox_config", { p_config: config, p_password: "dummy-value" }]]);
});

Deno.test("IMAP LOGIN: quoted credentials preserve literal quotes/backslashes and reject command injection", () => {
  assertEquals(quoteImapString('a"b\\c'), '"a\\"b\\\\c"');
  for (const value of ["bad\rLOGIN", "bad\nLOGIN", "bad\0LOGIN"]) {
    assertThrows(() => quoteImapString(value), Error, "Identifiant IMAP invalide");
  }
});

Deno.test("Recovery uses only one write RPC and preserves literal credential whitespace", async () => {
  const calls: unknown[] = [];
  const id = "11111111-1111-4111-8111-111111111111";
  await replaceMailboxSecret({ rpc: (name, args) => {
    calls.push([name, args]); return Promise.resolve({ data: null, error: null });
  } }, id, ' synthetic "credential\\ ');
  assertEquals(calls, [["replace_mailbox_secret", { p_config_id: id, p_password: ' synthetic "credential\\ ' }]]);
});

Deno.test("Recovery rejects malformed ids/credentials before any RPC", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  for (const [configId, password] of [[null, "fake"], ["bad-id", "fake"], [id, null], [id, {}], [id, ""],
    [id, "x".repeat(1025)], [id, "fake\rINJECT"], [id, "fake\nINJECT"], [id, "fake\0INJECT"]]) {
    let calls = 0;
    await assertRejects(() => replaceMailboxSecret({ rpc: () => { calls++; throw Error(); } }, configId, password));
    assertEquals(calls, 0);
  }
});

Deno.test("Recovery neutralizes backend errors and never returns a secret", async () => {
  for (const rpc of [() => Promise.resolve({ data: null, error: { message: "synthetic-private-password" } }),
    () => Promise.reject(new Error("synthetic-private-password"))]) {
    const error = await assertRejects(() => replaceMailboxSecret({ rpc }, "11111111-1111-4111-8111-111111111111", "fake"), Error);
    assertEquals(error.message.includes("synthetic-private-password"), false);
  }
});
