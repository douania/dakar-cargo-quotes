import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ImapByteReader, readImapHeaders } from './imap-headers.ts';
import { imapAccountKey } from './imap-import-identity.ts';
Deno.env.set("MAIL_FUNCTION_DISABLE_SERVE", "1");
const { IMAPClient, handler } = await import("../import-thread/index.ts");
const { IMAPSearchClient } = await import("../search-emails/index.ts");
const headers = "From: Sender <sender@example.invalid>\r\nTo: Receiver <receiver@example.invalid>,\r\n\tOther <other@example.invalid>\r\nSubject: Cargo delivery\r\n continued subject\r\nMessage-ID:\r\n <message-1@example.invalid>\r\nReferences:\r\nIn-Reply-To: <root@example.invalid>\r\n\r\n";
function response() { return `* 1 FETCH (UID 101 BODY[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)] {${new TextEncoder().encode(headers).length}}\r\n${headers} BODYSTRUCTURE ("TEXT" "PLAIN" NIL NIL NIL "7BIT" 0 0))\r\nA1 OK done\r\n`; }

Deno.test("mail ingestion: real search and import readers agree on folded headers and stable IDs", async () => {
  const imported = new IMAPClient("fixture.invalid");
  const searched = new IMAPSearchClient("fixture.invalid", 143);
  const wire = (command: string) => Promise.resolve(command.includes("HEADER.FIELDS") ? response() : "A1 OK empty\r\n");
  Object.assign(imported, { sendCommand: wire }); Object.assign(searched, { sendCommand: wire });
  const first = await imported.fetchMessage(101);
  const list = await searched.fetchHeaders([101]);
  for (const actual of [first, list[0]]) {
    assertEquals(actual.subject, "Cargo delivery continued subject");
    assertEquals(actual.messageId, "<message-1@example.invalid>");
    assertEquals(actual.to, ["receiver@example.invalid", "other@example.invalid"]);
    assertEquals(actual.references, "<root@example.invalid>");
  }
  const replay = await imported.fetchMessage(101);
  assertEquals(replay.messageId, first.messageId, "Existing message_id dedup sees the same identifier");
});

Deno.test('mail import: two replays through the real handler reuse the existing email UUID without insertion', async () => {
  const keys = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
  const oldEnv = keys.map(key => Deno.env.get(key));
  Deno.env.set(keys[0], 'https://fixture.invalid'); Deno.env.set(keys[1], 'fixture-anon'); Deno.env.set(keys[2], 'fixture-service');
  const prototype = IMAPClient.prototype as unknown as Record<string, unknown>;
  const names = ['connect','login','select','logout','sendCommand'];
  const originals = names.map(name => prototype[name]);
  prototype.connect = () => Promise.resolve(); prototype.login = () => Promise.resolve(true);
  prototype.select = function(this: { uidValidity: number }) { this.uidValidity = 77; return Promise.resolve(); }; prototype.logout = () => Promise.resolve();
  prototype.sendCommand = (s: string) => Promise.resolve(s.includes('HEADER.FIELDS') ? response() : 'A1 OK empty\r\n');
  const originalFetch = globalThis.fetch;
  const lookups: string[] = [], mutations: string[] = [];
  const emailId = 'fixture-existing-email-uuid', threadRef = 'fixture-existing-thread-uuid';
  const config = { id: 'fixture-config', host: 'fixture.invalid', port: 143, use_ssl: true, username: 'mailbox@example.invalid', folder: 'INBOX' };
  const searchIdentity = { configId: config.id, mailbox: config.folder, uidValidity: 77, accountKey: await imapAccountKey(config),
    messages: [{ uid: 101, messageId: '<message-1@example.invalid>' }] };
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    if (url.pathname === '/auth/v1/user') return json({ id: 'fixture-user', email: 'operator@example.invalid' });
    if (url.pathname.endsWith('/rpc/has_workspace_access')) return json(true);
    if (url.pathname.endsWith('/rpc/read_mailbox_secret')) return json('fixture-only-secret');
    if (url.pathname.endsWith('/email_configs')) return json(config);
    if (url.pathname.endsWith('/rpc/persist_imap_import_batch')) {
      const payload = JSON.parse(String(init?.body)); lookups.push(payload.p_messages[0].message_id);
      return json({ emails: [{ id: emailId, uid: 101, created: false }], thread_id: '<root@example.invalid>', thread_ref: threadRef });
    }
    if (url.pathname.endsWith('/emails') && method === 'GET') {
      if (url.searchParams.has('message_id')) { lookups.push(url.searchParams.get('message_id')!); return json({ id: emailId }); }
      return json([{ id: emailId, thread_ref: threadRef, message_id: '<message-1@example.invalid>', subject: 'Cargo delivery continued subject' }]);
    }
    mutations.push(`${method} ${url.pathname}`);
    throw new Error('Unexpected fixture request');
  };
  try {
    for (let i=0; i<2; i++) {
      const actual = await handler(new Request('https://fixture.invalid/import-thread', { method: 'POST', headers: { Authorization: 'Bearer fixture-user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ configId: 'fixture-config', uids: [101], searchIdentity }) }));
      const body = await actual.json();
      assertEquals(actual.status, 200);
      assertEquals(body.imported, 0);
      assertEquals(body.alreadyExisted, 1);
      assertEquals(body.emails[0].id, emailId);
      assertEquals(body.emails[0].messageId, '<message-1@example.invalid>');
    }
    assertEquals(lookups, ['<message-1@example.invalid>','<message-1@example.invalid>']);
    assertEquals(mutations, []);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name,i) => { prototype[name] = originals[i]; });
    keys.forEach((key,i) => oldEnv[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, oldEnv[i]!));
  }
});

Deno.test('mail headers: bytes survive fragmented UTF8 and literal length excludes response metadata', async () => {
  const raw = 'Subject: Livraison à Dakar\r\nTo:\r\nIn-Reply-To: <parent@example.invalid>\r\nMessage-ID: <utf8@example.invalid>\r\n\r\n';
  const bytes = new TextEncoder().encode(`line\r\n${raw}next\r\n`); let cursor = 0;
  const reader = new ImapByteReader(buffer => { if (cursor >= bytes.length) return Promise.resolve(null);
    buffer[0] = bytes[cursor++]; return Promise.resolve(1); });
  assertEquals(await reader.readLine(), 'line');
  const literal = await reader.readBytes(new TextEncoder().encode(raw).length);
  assertEquals(new TextDecoder('utf-8', { fatal: true }).decode(literal), raw);
  assertEquals(await reader.readLine(), 'next');
  const wire = `BODY[HEADER.FIELDS (TO SUBJECT MESSAGE-ID IN-REPLY-TO)] {${literal.length}}\r\n${raw} BODYSTRUCTURE (Subject: incorrect)\r\n`;
  const parsed = readImapHeaders(wire, 102, s => s);
  assertEquals(parsed.subject, 'Livraison à Dakar');
  assertEquals(parsed.to, []);
  assertEquals(parsed.references, '<parent@example.invalid>');
  assertEquals(parsed.messageId, '<utf8@example.invalid>');
  await assertRejects(() => reader.readBytes(1), Error, 'Truncated');
});

Deno.test('mail headers: encoded subject, missing ID fallback and exact field names agree in both readers', async () => {
  const raw = 'Subject: =?UTF-8?B?TGl2cmFpc29uIMOgIERha2Fy?=\r\nIn-Reply-To: <parent@example.invalid>\r\nX-To: fake@example.invalid\r\n\r\n';
  const wire = `* 1 FETCH (UID 102 BODY[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)] {${new TextEncoder().encode(raw).length}}\r\n${raw})\r\nA1 OK done\r\n`;
  const imported = new IMAPClient('fixture.invalid'), searched = new IMAPSearchClient('fixture.invalid',143);
  Object.assign(imported, { sendCommand: (s: string) => Promise.resolve(s.includes('HEADER.FIELDS') ? wire : 'A1 OK empty\r\n') });
  Object.assign(searched, { sendCommand: () => Promise.resolve(wire) });
  const first = await imported.fetchMessage(102), results = await searched.fetchHeaders([102]);
  for (const message of [first, results[0]]) {
    assertEquals(message.subject, 'Livraison à Dakar');
    assertEquals(message.messageId, '<102@imported>');
    assertEquals(message.to, []);
  }
});
