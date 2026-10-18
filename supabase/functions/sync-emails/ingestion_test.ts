import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_EMAILS_DISABLE_SERVE", "1");
const { handler } = await import(Deno.env.get("SYNC_EMAILS_MODULE_URL") ?? "./index.ts");
type Row = Record<string, unknown>;
const config = { id: "fixture-config", host: "fixture.invalid", port: 143, use_ssl: false,
  username: "ops@sodatra.sn", folder: "INBOX", is_active: true, last_sync_at: "2026-01-01T00:00:00Z" };
const oldDate = "2026-10-10T09:00:00.000Z", newDate = "2026-10-18T10:00:00.000Z";
const rootA = "<a@example.invalid>", rootB = "<b@example.invalid>";
const subject = "Cargo dossier identique";
const oldEmail = (extra: Row = {}): Row => ({ id: "old-email", email_config_id: config.id,
  message_id: rootA, thread_id: rootA, thread_ref: "thread-a", subject,
  from_address: "alice@client.invalid", to_addresses: [config.username], cc_addresses: [],
  sent_at: oldDate, body_text: "Demande de cotation freight Dakar port", ...extra });
const oldThread = (extra: Row = {}): Row => ({ id: "thread-a", root_message_id: rootA,
  subject_normalized: subject.toLowerCase(), status: "operator-reviewed", email_count: 1,
  first_message_at: oldDate, last_message_at: oldDate, project_name: "", ...extra });

interface Scenario {
  root?: string; subject?: string; rawHeaders?: string; uidAfter?: boolean; fragment?: boolean;
  emails?: Row[]; threads?: Row[]; reject?: string; dbFailure?: string; cases?: Row[];
  emptyHeaders?: boolean; badStatus?: boolean;
}

// Real handler + SDK + IMAP reader; only socket and HTTP transports are fictitious.
// No network permission, real token, account or external mailbox is needed.
async function run(s: Scenario = {}) {
  const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previousEnv = envKeys.map(k => Deno.env.get(k));
  ["https://fixture.invalid", "fixture-anon", "fixture-service"].forEach((v, i) => Deno.env.set(envKeys[i], v));
  const db: Record<string, Row[]> = { emails: structuredClone(s.emails ?? [oldEmail()]),
    email_threads: structuredClone(s.threads ?? [oldThread()]), email_configs: [{ ...config }],
    known_business_contacts: [], contacts: [], quote_cases: structuredClone(s.cases ?? []), case_timeline_events: [] };
  const requests: string[] = [], commands: string[] = [];
  const root = s.root ?? rootB;
  const headers = s.rawHeaders ?? `From: Bob <bob@other.invalid>\r\nTo: ${config.username}\r\nSubject: ${s.subject ?? subject}\r\nDate: ${newDate}\r\nMessage-ID: <reply@example.invalid>\r\nReferences: ${root}\r\n\r\n`;
  const encode = (v: string) => new TextEncoder().encode(v);
  let pending = encode("* OK fixture ready\r\n"), cursor = 0;
  const literal = (label: string, value: string) => `${label} {${encode(value).length}}\r\n${value}`;
  const socket = {
    async read(buffer: Uint8Array) {
      if (cursor === pending.length) return null;
      const n = Math.min(buffer.length, pending.length - cursor, s.fragment ? 1 : 4096);
      buffer.set(pending.subarray(cursor, cursor + n)); cursor += n; return n;
    },
    async write(bytes: Uint8Array) {
      const wire = new TextDecoder().decode(bytes).trimEnd(), space = wire.indexOf(" ");
      const tag = wire.slice(0, space), command = wire.slice(space + 1); commands.push(command);
      let result = `${tag} OK done\r\n`;
      if (s.reject && command.startsWith(s.reject)) result = `* OK unsolicited\r\n${tag} ${s.badStatus ? "BAD" : "NO"} unavailable\r\n`;
      else if (command.startsWith("SELECT")) result = `* 1 EXISTS\r\n* OK [UIDVALIDITY 77] valid\r\n${tag} OK selected\r\n`;
      else if (command.startsWith("FETCH")) result = s.emptyHeaders ? `${tag} OK done\r\n` : `* 1 FETCH (${s.uidAfter ? "" : "UID 101 "}${literal("BODY[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)]", headers)}${s.uidAfter ? " UID 101" : ""})\r\n${tag} OK done\r\n`;
      else if (command.includes("BODY.PEEK[TEXT]")) result = `* 1 FETCH (UID 101 ${literal("BODY[TEXT]", "Suivi du dossier, documents à Dakar.")})\r\n${tag} OK done\r\n`;
      else if (command.includes("BODYSTRUCTURE")) result = `* 1 FETCH (UID 101 BODYSTRUCTURE ("TEXT" "PLAIN" NIL NIL NIL "7BIT" 0 0))\r\n${tag} OK done\r\n`;
      pending = encode(result); cursor = 0; return bytes.length;
    }, close() {},
  };
  const oldConnect = Deno.connect, oldFetch = globalThis.fetch;
  Deno.connect = (() => Promise.resolve(socket)) as unknown as typeof Deno.connect;
  const matches = (row: Row, key: string, filter: string) => {
    const dot = filter.indexOf("."), op = filter.slice(0, dot), value = filter.slice(dot + 1);
    if (op === "eq") return String(row[key]) === value;
    if (op === "neq") return String(row[key]) !== value;
    if (op === "gte") return String(row[key]) >= value;
    if (op === "ilike") return String(row[key] ?? "").toLowerCase().includes(value.replaceAll("%", "").toLowerCase());
    throw new Error(`Unhandled fixture filter ${key}=${filter}`);
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(url.hostname, "fixture.invalid");
    const method = init?.method ?? "GET", table = url.pathname.split("/").at(-1)!;
    requests.push(`${method} ${table} ${url.search}`);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (table === "user") return json({ id: "fixture-operator", email: "operator@example.invalid" });
    if (table === "has_workspace_access") return json(true);
    if (table === "read_mailbox_secret") return json("fixture-only-secret");
    assert(table in db, `Unexpected fixture table ${table}`);
    if (`${method} ${table}` === s.dbFailure ||
      (s.dbFailure === "GET emails context" && table === "emails" && url.searchParams.has("thread_ref"))) {
      return json({ code: "XX001", message: "fixture failure" }, 400);
    }
    let rows = db[table].filter(row => [...url.searchParams].every(([key, value]) => {
      if (["select", "order", "limit", "offset"].includes(key)) return true;
      if (key === "or") return value.slice(1, -1).split(",").some(part => {
        const dot = part.indexOf("."); return matches(row, part.slice(0, dot), part.slice(dot + 1));
      });
      return matches(row, key, value);
    }));
    if (method === "PATCH") { const patch = JSON.parse(String(init?.body)); rows.forEach(row => Object.assign(row, patch)); return json(rows); }
    if (method === "POST") {
      const row = { id: `new-${table}`, ...JSON.parse(String(init?.body)) }; db[table].push(row); return json(row);
    }
    const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? rows.length);
    rows = rows.slice(offset, offset + limit);
    const accept = new Headers(init?.headers).get("accept") ?? "";
    return json(accept.includes("vnd.pgrst.object") ? rows[0] ?? null : rows);
  };
  try {
    const response = await handler(new Request("https://fixture.invalid/sync", { method: "POST",
      headers: { Authorization: "Bearer fixture-token", "Content-Type": "application/json" },
      body: JSON.stringify({ configId: config.id, limit: 1 }) }));
    return { status: response.status, body: await response.json(), db, requests, commands };
  } finally {
    Deno.connect = oldConnect; globalThis.fetch = oldFetch;
    envKeys.forEach((key, i) => previousEnv[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previousEnv[i]!));
  }
}

Deno.test("sync handler: same subject cannot contaminate a different root's participants, dates or RFQ", async () => {
  const result = await run();
  assertEquals(result.body.success, true);
  const fresh = result.db.email_threads.find(t => t.id !== "thread-a")!;
  assertEquals(fresh.email_count, 1);
  assertEquals(fresh.first_message_at, newDate);
  assertEquals(fresh.client_email, "bob@other.invalid");
  assertEquals(fresh.is_quotation_thread, false);
  assertEquals(result.db.email_threads[0], oldThread());
  assertEquals(result.db.emails[0], oldEmail());
});

Deno.test("sync handler: changed subject with the same root keeps UUID, status, history and complete context", async () => {
  const result = await run({ root: rootA, subject: "Re: Documents maintenant disponibles" });
  assertEquals(result.body.success, true);
  assertEquals(result.db.email_threads.length, 1);
  const thread = result.db.email_threads[0];
  assertEquals(thread.id, "thread-a"); assertEquals(thread.status, "operator-reviewed");
  assertEquals(thread.email_count, 2); assertEquals(thread.first_message_at, oldDate);
  assertEquals(thread.client_email, "alice@client.invalid");
  assertEquals(result.db.emails[0], oldEmail());
  assertEquals(result.db.emails[1].thread_ref, "thread-a");
});

Deno.test("sync handler: subject likeness cannot adopt a thread with an unknown root", async () => {
  const legacy = oldThread({ root_message_id: null });
  const result = await run({ threads: [legacy] });
  assertEquals(result.body.success, true);
  assertEquals(result.db.email_threads[0], legacy);
  assert(result.db.emails[1].thread_ref !== "thread-a");
});

Deno.test("sync handler: folded References and Message-ID text in Subject do not change identity", async () => {
  const rawHeaders = `From: bob@other.invalid\r\nTo: ${config.username}\r\nSubject: Cargo Message-ID: <fake@example.invalid>\r\nMessage-ID: <real@example.invalid>\r\nDate: ${newDate}\r\nReferences:\r\n ${rootA}\r\n <parent@example.invalid>\r\nIn-Reply-To: <parent@example.invalid>\r\n\r\n`;
  const result = await run({ rawHeaders });
  assertEquals(result.body.success, true);
  assertEquals(result.db.emails[1].message_id, "<real@example.invalid>");
  assertEquals(result.db.emails[1].thread_id, rootA);
  assertEquals(result.db.emails[1].thread_ref, "thread-a");
});

Deno.test("sync handler: UID after literal and fragmented UTF8 preserve subject and body bytes", async () => {
  const result = await run({ uidAfter: true, fragment: true, subject: "Dossier à Dakar" });
  assertEquals(result.body.synced, 1);
  assertEquals(result.db.emails[1].subject, "Dossier à Dakar");
  assertEquals(result.db.emails[1].body_text, "Suivi du dossier, documents à Dakar.");
});

for (const command of ["LOGIN", "SELECT", "FETCH", "UID FETCH 101 BODY.PEEK[TEXT]"]) {
  for (const status of ["NO", "BAD"]) Deno.test(`sync handler: ${command} ${status} cannot become success or advance last_sync_at`, async () => {
    const result = await run({ reject: command, badStatus: status === "BAD" });
    assert(result.status >= 400); assert(result.body.success !== true);
    assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
    assertEquals(result.db.emails.length, 1);
  });
}

for (const dbFailure of ["GET known_business_contacts", "GET emails", "GET emails context", "GET email_threads", "POST emails", "PATCH email_threads", "POST contacts", "PATCH email_configs"]) {
  Deno.test(`sync handler: ${dbFailure} failure remains visible without advancing last_sync_at`, async () => {
    const result = await run({ root: rootA, dbFailure });
    assert(result.body.success !== true);
    assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
  });
}

Deno.test("sync handler: another configuration's root is rejected before changing its thread", async () => {
  const foreign = oldEmail({ email_config_id: "other-config" });
  const result = await run({ root: rootA, emails: [foreign] });
  assert(result.body.success !== true);
  assertEquals(result.db.email_threads[0], oldThread());
  assertEquals(result.db.emails, [foreign]);
});

Deno.test("sync handler: linked history is paged beyond 1000 messages without truncating count or losing oldest sender", async () => {
  const emails = Array.from({ length: 1001 }, (_, i) => oldEmail({ id: `old-${i}`, message_id: `<old-${i}@example.invalid>` }));
  const result = await run({ root: rootA, emails });
  assertEquals(result.body.success, true);
  assertEquals(result.db.email_threads[0].email_count, 1002);
  assertEquals(result.db.email_threads[0].first_message_at, oldDate);
  assertEquals(result.requests.filter(r => r.includes("thread_ref=eq.thread-a")).length, 3);
});

Deno.test("sync handler: insertion failure records partial writes, no complete-success timestamp, no invented rollback", async () => {
  const result = await run({ root: rootA, dbFailure: "POST emails" });
  assertEquals(result.status, 503); assertEquals(result.body.partial, true);
  assertEquals(result.body.synced, 0); assertEquals(result.body.failed, 1);
  assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
  assertEquals(result.db.emails, [oldEmail()]);
  // Existing non-atomic ordering is explicit: the summary was updated before insertion failed.
  assertEquals(result.db.email_threads[0].email_count, 2);
  assertEquals(result.db.email_threads[0].last_message_at, newDate);
});

Deno.test("sync handler: no headers in a non-empty requested window is incomplete, not an empty success", async () => {
  const result = await run({ emptyHeaders: true });
  assert(result.status >= 400); assert(result.body.success !== true);
  assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
});

Deno.test("sync handler: missing Message-ID cannot silently adopt an old UID placeholder", async () => {
  const legacy = oldEmail({ message_id: "<101@imported>" });
  const rawHeaders = `From: bob@other.invalid\r\nSubject: Cargo Message-ID: <fake@example.invalid>\r\n\r\n`;
  const result = await run({ emails: [legacy], rawHeaders });
  assertEquals(result.status, 503); assertEquals(result.body.skipped, 0);
  assertEquals(result.db.emails, [legacy]);
  assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
});

Deno.test("sync handler: exact replay retains UUID, original body and links without writing thread or contact", async () => {
  const replay = oldEmail({ message_id: "<reply@example.invalid>" });
  const result = await run({ root: rootA, emails: [replay] });
  assertEquals(result.body.success, true); assertEquals(result.body.skipped, 1);
  assertEquals(result.db.emails, [replay]); assertEquals(result.db.email_threads, [oldThread()]);
  assertEquals(result.db.contacts, []);
  assertEquals(result.commands.some(c => c.startsWith("UID FETCH")), false);
});

for (const dbFailure of ["GET quote_cases", "PATCH quote_cases", "POST case_timeline_events"]) {
  Deno.test(`sync handler: ${dbFailure} reports stored email plus incomplete case notification`, async () => {
    const result = await run({ root: rootA, dbFailure, cases: [{ id: "fixture-case", thread_id: "thread-a", status: "NEED_INFO" }] });
    assertEquals(result.status, 503); assertEquals(result.body.partial, true);
    assertEquals(result.body.synced, 1); assertEquals(result.body.failed, 1);
    assertEquals(result.body.failures[0].stage, "case_notification");
    assertEquals(result.db.emails.length, 2);
    assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
  });
}

Deno.test("sync handler: attachment refusal keeps stored email but reports incomplete import", async () => {
  const result = await run({ reject: "UID FETCH 101 BODYSTRUCTURE" });
  assertEquals(result.status, 503); assertEquals(result.body.synced, 1);
  assertEquals(result.body.failures[0].stage, "attachments");
  assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
});

Deno.test("sync handler: timestamp failure retains the stored email receipt and uses a global failure stage", async () => {
  const result = await run({ root: rootA, dbFailure: "PATCH email_configs" });
  assertEquals(result.status, 503); assertEquals(result.body.success, false);
  assertEquals(result.body.partial, true); assertEquals(result.body.synced, 1);
  assertEquals(result.body.emails[0].id, result.db.emails[1].id);
  assertEquals(result.body.failures, [{ uid: null, stage: "sync_timestamp" }]);
  assertEquals(result.body.failed, 0);
  assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
});

Deno.test("sync handler: a duplicate ID in another configuration is a conflict, not an already-present success", async () => {
  const foreign = oldEmail({ message_id: "<reply@example.invalid>", email_config_id: "other-config" });
  const result = await run({ root: rootA, emails: [foreign] });
  assertEquals(result.status, 503); assertEquals(result.body.skipped, 0);
  assertEquals(result.db.emails, [foreign]); assertEquals(result.db.email_threads, [oldThread()]);
  assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
});

Deno.test("sync handler: a synthetic root in References cannot be adopted as proven identity", async () => {
  const result = await run({ root: "<88@imported>" });
  assertEquals(result.status, 503);
  assertEquals(result.db.emails, [oldEmail()]); assertEquals(result.db.email_threads, [oldThread()]);
  assertEquals(result.db.email_configs[0].last_sync_at, config.last_sync_at);
});
