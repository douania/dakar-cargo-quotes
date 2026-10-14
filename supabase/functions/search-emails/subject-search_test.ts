import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  boundedSearchLimit, decodeSearchHeader, findDecodedSubjectUids, normalizedSearchSubject,
  parseSearchUids, qSubjectCriteria, requireImapCommandOk, subjectMatches,
} from "../_shared/imap-subject-search.ts";
Deno.env.set("MAIL_FUNCTION_DISABLE_SERVE", "1");
const { IMAPSearchClient, handler } = await import(Deno.env.get("SEARCH_EMAILS_MODULE_URL") ?? "./index.ts");

const decoderCases: Array<[string, string, string]> = [
  ["Q utf8 octets", "=?UTF-8?Q?Livraison_=C3=A0_Lom=C3=A9?=", "Livraison à Lomé"],
  ["Q legacy charset", "=?ISO-8859-1?Q?Caf=E9_=E0_port?=", "Café à port"],
  ["Q windows charset", "=?windows-1256?Q?Caf=E9_=E0_port?=", "Café à port"],
  ["B utf8", "=?UTF-8?B?TGl2cmFpc29uIMOgIExvbcOp?=", "Livraison à Lomé"],
  ["Q folded without invented space", "=?UTF-8?Q?PORT_DEL?=\r\n\t=?UTF-8?Q?IVERY_NOTICE?=", "PORT DELIVERY NOTICE"],
  ["B adjacent folded words", "=?UTF-8?B?UE9SVCA=?=\r\n =?UTF-8?B?REVMSVZFUlk=?=", "PORT DELIVERY"],
  ["mixed Q B", "=?UTF-8?Q?PORT_?=\t=?UTF-8?B?REVMSVZFUlk=?=", "PORT DELIVERY"],
  ["plain underscore", "CLIENT_A delivery", "CLIENT_A delivery"],
  ["encoded real underscore", "=?UTF-8?Q?CLIENT=5FA_delivery?=", "CLIENT_A delivery"],
  ["plain text between words", "=?UTF-8?Q?PORT?= - =?UTF-8?Q?NOTICE?=", "PORT - NOTICE"],
  ["malformed Q preserved", "=?UTF-8?Q?broken=XX_subject?=", "=?UTF-8?Q?broken=XX_subject?="],
  ["unknown charset preserved", "=?made-up?Q?PORT_DELIVERY?=", "=?made-up?Q?PORT_DELIVERY?="],
  ["malformed B preserved", "=?UTF-8?B?%%%?=", "=?UTF-8?B?%%%?="],
];
for (const [name, encoded, decoded] of decoderCases) {
  Deno.test("subject decoder: " + name, () => assertEquals(decodeSearchHeader(encoded), decoded));
}

Deno.test("subject matching: case, NFC and whitespace; accents and underscores remain meaningful", () => {
  assertEquals(normalizedSearchSubject("  LIVRAISON\t à\nLomé  "), "livraison à lomé");
  assertEquals(subjectMatches("Re: Livraison à Lome\u0301", "livraison   à\tLomé"), true);
  assertEquals(subjectMatches("Livraison à Lomé", "Livraison a Lome"), false);
  assertEquals(subjectMatches("CLIENT_A delivery", "client a delivery"), false);
  assertEquals(subjectMatches("CLIENT_A delivery", "client_a DELIVERY"), true);
  assertEquals(subjectMatches("anything", " \t "), false);
});

Deno.test("Q hints: underscores are escaped, spaces have two spellings, UTF8 octets and quotes are safe", () => {
  assertEquals(qSubjectCriteria("CLIENT_A   delivery"), 'OR SUBJECT "CLIENT=5FA_delivery" SUBJECT "CLIENT=5FA=20delivery"');
  assertEquals(qSubjectCriteria("Café delivery"), 'OR SUBJECT "Caf=C3=A9_delivery" SUBJECT "Caf=C3=A9=20delivery"');
  assertEquals(qSubjectCriteria("Cargo"), null);
  assertEquals(qSubjectCriteria('Cargo "a"'), String.raw`OR SUBJECT "Cargo_\"a\"" SUBJECT "Cargo=20\"a\""`);
});

Deno.test("search bounds: reject invalid limits and cap explicit large limits", () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, "200", null]) assertThrows(() => boundedSearchLimit(value));
  assertEquals(boundedSearchLimit(1), 1);
  assertEquals(boundedSearchLimit(999999), 200);
});

Deno.test("IMAP status: NO/BAD/untagged OK cannot become a successful empty search", () => {
  for (const response of ["* SEARCH\r\nA1 NO not OK\r\n", "* SEARCH 101\r\nA1 BAD invalid\r\n", "* OK ready\r\n", "* SEARCH\r\n"]) {
    assertThrows(() => parseSearchUids(response));
    assertThrows(() => requireImapCommandOk(response, "EXAMINE"));
  }
  assertEquals(parseSearchUids("* SEARCH\r\nA1 OK done\r\n"), []);
  assertEquals(parseSearchUids("* SEARCH 202 101 202\r\na1 ok done\r\n"), [101, 202]);
  for (const line of ["* SEARCH -1", "* SEARCH 0", "* SEARCH 1 garbage", "* SEARCH 9007199254740992"]) {
    assertThrows(() => parseSearchUids(line + "\r\nA1 OK done\r\n"));
  }
});

function transport(normal: number[], q: number[], recent: number[], subjects: Map<number, string>) {
  const searches: string[] = [], fetched: number[][] = [];
  return {
    searches, fetched,
    async search(criteria: string): Promise<number[]> {
      searches.push(criteria);
      return searches.length === 1 ? normal : /^\d+:\d+$/.test(criteria) ? recent : q;
    },
    async fetchSubjects(uids: number[]) {
      fetched.push(uids);
      return uids.map(uid => ({ uid, subject: decodeSearchHeader(subjects.get(uid) ?? "unrelated") }));
    },
  };
}

Deno.test("subject fallback: existing reply does not hide older Q original; raw false positives are rejected", async () => {
  const t = transport([303], [101, 202, 303], [404], new Map([
    [101, "=?windows-1256?Q?Request_for_PORT_DELIVERY_NOTICE_-_LOCAL_TERMS?="],
    [202, "PORT_DELIVERY_NOTICE"],
    [303, "Re: PORT DELIVERY NOTICE"],
    [404, "other recent message"],
  ]));
  const result = await findDecodedSubjectUids(t, "port   delivery notice", 900, 200);
  assertEquals(result.uids, [101, 303]);
  assertEquals(result.totalFound, 2);
  assertEquals(t.searches[2], "701:900");
  assertEquals(result.coverage.exhaustive, false);
  assertEquals(result.coverage.recentWindowCoversSelectedMailbox, false);
});

Deno.test("subject fallback: B, split Q and accents are confirmed inside the recent window", async () => {
  const t = transport([], [], [101, 202], new Map([
    [101, "=?UTF-8?B?TGl2cmFpc29uIMOgIExvbcOp?="],
    [202, "=?UTF-8?Q?Livrai?=\r\n\t=?UTF-8?Q?son_=C3=A0_Lom=C3=A9?="],
  ]));
  const result = await findDecodedSubjectUids(t, "Livraison à Lomé", 2, 200);
  assertEquals(result.uids, [101, 202]);
  assertEquals(result.coverage.recentWindowCoversSelectedMailbox, true);
});

Deno.test("subject fallback: B outside the window is not promised exhaustive", async () => {
  const t = transport([], [], [202], new Map([[101, "=?UTF-8?B?UE9SVCBERUxJVkVSWQ==?="], [202, "other"]]));
  const result = await findDecodedSubjectUids(t, "PORT DELIVERY", 1000, 200);
  assertEquals(result.uids, []);
  assertEquals(result.coverage.exhaustive, false);
  assertEquals(result.coverage.totalFoundIsLowerBound, true);
  assertEquals(result.coverage.recentWindowCoversSelectedMailbox, false);
});

Deno.test("subject fallback: unique UIDs survive duplicates and unrelated fetched identities cannot enter", async () => {
  const t = transport([101, 101], [101, 202, 202], [101, 202], new Map([[101, "PORT DELIVERY"], [202, "PORT DELIVERY"]]));
  const realFetch = t.fetchSubjects.bind(t);
  t.fetchSubjects = async uids => [...await realFetch(uids), { uid: 101, subject: "PORT DELIVERY" }, { uid: 999, subject: "PORT DELIVERY" }];
  const result = await findDecodedSubjectUids(t, "PORT DELIVERY", 2, 200);
  assertEquals(result.uids, [101, 202]);
  assertEquals(t.fetched[0].length, 2);
});

Deno.test("subject fallback: fixed 600 candidate budget and result cap survive huge server responses", async () => {
  const range = (start: number) => Array.from({ length: 400 }, (_, i) => start + i);
  const normal = range(1), q = range(1001), recent = range(2001);
  const subjects = new Map([...normal, ...q, ...recent].map(uid => [uid, "PORT DELIVERY"]));
  const t = transport(normal, q, recent, subjects);
  const result = await findDecodedSubjectUids(t, "PORT DELIVERY", 1000, 10);
  assertEquals(t.fetched[0].length, 600);
  assertEquals(result.uids, range(2001).slice(-10));
  assertEquals(result.totalFound, 600);
  assertEquals(result.coverage.normalCandidatesTruncated, true);
  assertEquals(result.coverage.qCandidatesTruncated, true);
  assertEquals(result.coverage.recentCandidatesTruncated, true);
  assertEquals(result.coverage.resultsTruncated, true);
});

Deno.test("subject fallback: preserve normal deep-search body/from semantics, confirm every added subject", async () => {
  const t = transport([101], [202, 303], [], new Map([[101, "unrelated subject"], [202, "PORT DELIVERY"], [303, "PORT_DELIVERY"]]));
  const result = await findDecodedSubjectUids(t, "PORT DELIVERY", 0, 200, true);
  assertEquals(result.uids, [101, 202]);
  assertEquals(t.searches[0], 'OR OR SUBJECT "PORT DELIVERY" BODY "PORT DELIVERY" FROM "PORT DELIVERY"');
});

Deno.test("subject fallback: command injection and empty/oversized subjects stop before any SEARCH", async () => {
  for (const query of ["", " ", "a".repeat(257), "PORT\u0000DELIVERY"]) {
    const t = transport([], [], [], new Map());
    await assertRejects(() => findDecodedSubjectUids(t, query, 2, 200));
    assertEquals(t.searches.length, 0);
  }
});

Deno.test("actual IMAP client: EXAMINE read-only, UID searches, UTF8 charset and tagged statuses", async () => {
  const client = new IMAPSearchClient("fixture.invalid", 143);
  const commands: string[] = [];
  let response = "* 2 EXISTS\r\n* OK [UIDVALIDITY 42] valid\r\nA1 OK [READ-ONLY] done\r\n";
  Object.assign(client, { sendCommand: (command: string) => { commands.push(command); return Promise.resolve(response); } });
  assertEquals(await client.select('Archive "quotes"'), 2);
  assertEquals(commands[0], 'EXAMINE "Archive \\"quotes\\""');
  assertEquals(client.uidValidity, 42);
  response = "* SEARCH 202 101\r\nA1 OK done\r\n";
  assertEquals(await client.search('SUBJECT "Café"'), [101, 202]);
  assertEquals(commands[1], 'UID SEARCH CHARSET UTF-8 SUBJECT "Café"');
  for (const status of ["NO", "BAD"]) {
    response = "* 2 EXISTS\r\n* SEARCH\r\nA1 " + status + " rejected OK\r\n";
    await assertRejects(() => client.select("INBOX"));
    await assertRejects(() => client.search('SUBJECT "PORT DELIVERY"'));
    await assertRejects(() => client.searchByMessageId('<test@example.invalid>'));
    await assertRejects(() => client.fetchHeaders([101]));
    await assertRejects(() => client.login("fixture", "fixture-only"));
  }
});

type FixtureOptions = { normal?: number[]; status?: "NO" | "BAD"; reconstruct?: boolean; limit?: number; droppedReferences?: boolean };

Deno.test("FETCH notifications: unsolicited FLAGS with/without UID before and after headers are ignored", async () => {
  const raw = "Subject: PORT DELIVERY\r\n\r\n", size = new TextEncoder().encode(raw).length;
  const wire = "* 2 FETCH (FLAGS (\\Seen))\r\n* 1 FETCH (UID 101 BODY[HEADER.FIELDS (SUBJECT)] {" + size + "}\r\n" + raw +
    ")\r\n* 3 FETCH (UID 303 FLAGS (\\Answered))\r\nA1 OK done\r\n";
  const client = new IMAPSearchClient("fixture.invalid", 143);
  Object.assign(client, { sendCommand: () => Promise.resolve(wire) });
  assertEquals((await client.fetchHeaders([101, 303], true)).map((m: { uid: number }) => m.uid), [101]);
});

Deno.test("subject candidates: missing Subject never matches the display placeholder", async () => {
  const raw = "From: sender@example.invalid\r\n\r\n", size = new TextEncoder().encode(raw).length;
  const wire = "* 1 FETCH (UID 101 BODY[HEADER.FIELDS (SUBJECT)] {" + size + "}\r\n" + raw + ")\r\nA1 OK done\r\n";
  const client = new IMAPSearchClient("fixture.invalid", 143);
  Object.assign(client, { sendCommand: () => Promise.resolve(wire) });
  const candidates = await client.fetchSubjects([101]);
  assertEquals(candidates, [{ uid: 101, subject: "" }]);
  assertEquals(subjectMatches(candidates[0].subject, "(Sans sujet)"), false);
});


Deno.test("FETCH identity ignores UID and fake FETCH text inside header literals", async () => {
  const raw = "Subject: PORT DELIVERY UID 202\r\nX-Fixture: embedded\r\n* 999 FETCH (UID 202)\r\n\r\n";
  const wire = "* 1 FETCH (BODY[HEADER.FIELDS (SUBJECT)] {" + new TextEncoder().encode(raw).length + "}\r\n" + raw + " UID 101)\r\nA1 OK done\r\n";
  const client = new IMAPSearchClient("fixture.invalid", 143);
  Object.assign(client, { sendCommand: () => Promise.resolve(wire) });
  const messages = await client.fetchHeaders([101, 202], true);
  assertEquals(messages.map((m: { uid: number }) => m.uid), [101]);
  assertEquals(messages[0].subject, "PORT DELIVERY UID 202");
});

Deno.test("FETCH identity: UID before/after literal, UTF8 byte lengths, quoted and nested UID values", async () => {
  const raw = "Subject: Café delivery UID 202\r\n\r\n", size = new TextEncoder().encode(raw).length;
  const block = (seq: number, uid: number, after: boolean) => "* " + seq + " FETCH (" +
    (after ? "" : "UID " + uid + " ") + "BODY[HEADER.FIELDS (SUBJECT)] {" + size + "}\r\n" + raw +
    (after ? " UID " + uid : "") + ' BODYSTRUCTURE ("TEXT" "PLAIN" ("NAME" "UID 999") NIL NIL "7BIT" 0 0 ("UID" 888)))\r\n';
  const wire = block(1, 101, false) + block(2, 202, true) + "A1 OK done\r\n";
  const client = new IMAPSearchClient("fixture.invalid", 143);
  Object.assign(client, { sendCommand: () => Promise.resolve(wire) });
  const messages = await client.fetchHeaders([101, 202], true);
  assertEquals(messages.map((m: { uid: number }) => m.uid), [101, 202]);
  assertEquals(messages.map((m: { subject: string }) => m.subject), ["Café delivery UID 202", "Café delivery UID 202"]);
});

Deno.test("FETCH identity: absent or ambiguous UID and truncated literal fail instead of guessing from subject", async () => {
  const raw = "Subject: PORT DELIVERY UID 101\r\n\r\n", size = new TextEncoder().encode(raw).length;
  const client = new IMAPSearchClient("fixture.invalid", 143);
  for (const wire of [
    "* 1 FETCH (BODY[HEADER.FIELDS (SUBJECT)] {" + size + "}\r\n" + raw + ")\r\nA1 OK done\r\n",
    "* 1 FETCH (UID 101 BODY[HEADER.FIELDS (SUBJECT)] {" + size + "}\r\n" + raw + " UID 202)\r\nA1 OK done\r\n",
    "* 1 FETCH (UID 101 BODY[HEADER.FIELDS (SUBJECT)] {999999}\r\n" + raw + ")\r\nA1 OK done\r\n",
  ]) {
    Object.assign(client, { sendCommand: () => Promise.resolve(wire) });
    await assertRejects(() => client.fetchHeaders([101, 202], true));
  }
});

async function handlerFixture(options: FixtureOptions = {}) {
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = keys.map(key => Deno.env.get(key));
  keys.forEach((key, i) => Deno.env.set(key, ["https://fixture.invalid", "fixture-anon", "fixture-service"][i]));
  const prototype = IMAPSearchClient.prototype as unknown as Record<string, unknown>;
  const names = ["connect", "logout", "sendCommand"];
  const originalMethods = names.map(name => prototype[name]), originalFetch = globalThis.fetch;
  const commands: string[] = [], mutations: string[] = [];
  const subjects = new Map([
    [101, "Spam:***, =?windows-1256?Q?Request_for_PORT_DELIVERY_NOTICE_-_LOCAL_TERMS_=28_Quart?=\r\n\t=?windows-1256?Q?ier_du_Caf=E9_=29?="],
    [202, "=?UTF-8?B?UE9SVCBERUxJVkVSWSBOT1RJQ0U=?="],
    [303, options.normal ? "Re: PORT DELIVERY NOTICE" : "Re: unrelated follow-up"],
  ]);
  prototype.connect = () => Promise.resolve();
  prototype.logout = () => Promise.resolve();
  prototype.sendCommand = (command: string) => {
    commands.push(command);
    if (/^LOGIN /.test(command)) return Promise.resolve("A1 OK authenticated\r\n");
    if (/^(EXAMINE|SELECT) /.test(command)) return Promise.resolve("* 3 EXISTS\r\n* OK [UIDVALIDITY 42] valid\r\nA1 OK [READ-ONLY] done\r\n");
    if (/(?:^| )SEARCH /.test(command)) {
      if (options.status) return Promise.resolve("* SEARCH\r\nA1 " + options.status + " rejected\r\n");
      const ids = /(?:^| )SEARCH 1:3$/.test(command) ? [101, 202, 303]
        : command.includes('HEADER Message-ID') ? options.droppedReferences ? [404] : [101, 101]
        : command.includes("PORT_DELIVERY_NOTICE") ? [101]
        : options.normal ?? [];
      return Promise.resolve("* SEARCH " + ids.join(" ") + "\r\nA1 OK search done\r\n");
    }
    if (/(?:^| )FETCH /.test(command)) {
      const ids = command.match(/FETCH ([\d,]+)/)![1].split(",").map(Number);
      if (options.droppedReferences && ids.includes(404)) return Promise.resolve("A1 OK vanished UID\r\n");
      const subjectOnly = command.includes("(SUBJECT)");
      const blocks = ids.map((uid, i) => {
        const raw = "Subject: " + subjects.get(uid) + "\r\n" + (subjectOnly ? "" :
          "From: Sender <sender@example.invalid>\r\nTo: Receiver <receiver@example.invalid>\r\nDate: Fri, 2 Jan 2026 12:00:00 +0000\r\nMessage-ID: <same-message@example.invalid>\r\n" +
          (uid !== 101 ? "References: " + (options.droppedReferences
            ? Array.from({ length: 60 }, (_, n) => "<ref-" + n + "@example.invalid>").join(" ")
            : "<root@example.invalid>") + "\r\n" : "")) + "\r\n";
        const fields = subjectOnly ? "SUBJECT" : "FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO";
        return "* " + (i + 1) + " FETCH (UID " + uid + " BODY[HEADER.FIELDS (" + fields + ")] {" + new TextEncoder().encode(raw).length + "}\r\n" + raw + ")\r\n";
      });
      return Promise.resolve(blocks.join("") + "A1 OK fetch done\r\n");
    }
    throw new Error("Unexpected fixture IMAP command");
  };
  globalThis.fetch = (input, init) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req?.url ?? String(input)), method = init?.method ?? req?.method ?? "GET";
    const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
    if (url.pathname === "/auth/v1/user") return json({ id: "fixture-user", email: "operator@example.invalid" });
    if (url.pathname.endsWith("/rpc/has_workspace_access")) return json(true);
    if (url.pathname.endsWith("/rpc/read_mailbox_secret")) return json("fixture-only-secret");
    if (url.pathname.endsWith("/email_configs")) return json({ id: "fixture-config", host: "fixture.invalid", username: "mailbox@example.invalid", folder: "INBOX", port: 143 });
    mutations.push(method + " " + url.pathname);
    throw new Error("Unexpected fixture HTTP request");
  };
  try {
    const response = await handler(new Request("https://fixture.invalid/search-emails", {
      method: "POST", headers: { Authorization: "Bearer fixture-token", "Content-Type": "application/json" },
      body: JSON.stringify({ configId: "fixture-config", searchType: "subject", query: "PORT DELIVERY NOTICE", reconstructThread: options.reconstruct ?? false, limit: options.limit ?? 200 }),
    }));
    return { status: response.status, body: await response.json(), commands, mutations };
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => { prototype[name] = originalMethods[i]; });
    keys.forEach((key, i) => previous[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[i]!));
  }
}

Deno.test("handler natural subject includes Q original and B message when normal SEARCH is empty", async () => {
  const result = await handlerFixture();
  assertEquals(result.status, 200);
  assertEquals(result.body.threads.flatMap((t: { messages: Array<{ uid: number }> }) => t.messages.map(m => m.uid)).sort(), [101, 202]);
  assertEquals(result.body.totalFound, 2);
  assertEquals(result.mutations, []);
  assertEquals(result.commands.some(c => /BODY(?:\.PEEK)?\[TEXT\]|STORE |^SELECT |^FETCH /.test(c)), false);
});

Deno.test("handler: normal replies plus Q/window matches deduplicate by mailbox UID, not shared Message-ID", async () => {
  const result = await handlerFixture({ normal: [101, 303, 303] });
  assertEquals(result.status, 200);
  const messages = result.body.threads.flatMap((t: { messages: Array<{ uid: number }> }) => t.messages);
  assertEquals(messages.length, 3);
  assertEquals(result.body.mailbox, "INBOX");
  assertEquals(result.body.uidValidity, 42);
  assertEquals(result.body.searchCoverage.exhaustive, false);
  assertEquals(result.body.searchCoverage.totalFoundIsLowerBound, true);
});

Deno.test("handler: failing SEARCH is HTTP500 without successful empty result", async () => {
  for (const status of ["NO", "BAD"] as const) {
    const result = await handlerFixture({ status });
    assertEquals(result.status, 500);
    assertEquals(result.body.success, undefined);
    assertEquals(result.commands.some(c => /(?:^| )FETCH /.test(c)), false);
    assertEquals(result.mutations, []);
  }
});

Deno.test("handler: disappeared referenced UID consumes header budget even when FETCH returns no message", async () => {
  const result = await handlerFixture({ reconstruct: true, limit: 3, droppedReferences: true });
  assertEquals(result.status, 200);
  assertEquals(result.body.threads.flatMap((t: { messages: Array<{ uid: number }> }) => t.messages).length, 2);
  assertEquals(result.commands.filter(c => c.includes("HEADER Message-ID")).length, 1);
  const fullHeaderRequests = result.commands.filter(c => /(?:^| )FETCH /.test(c) && c.includes("(FROM TO SUBJECT"))
    .flatMap(c => c.match(/FETCH ([\d,]+)/)![1].split(","));
  assertEquals(fullHeaderRequests.length, 3);
  assertEquals(result.body.reconstructionTruncated, true);
});

Deno.test("handler: reconstruction and caller limit remain bounded, without duplicate identities", async () => {
  const result = await handlerFixture({ reconstruct: true, limit: 1 });
  assertEquals(result.status, 200);
  assertEquals(result.body.threads.flatMap((t: { messages: Array<{ uid: number }> }) => t.messages).length, 1);
  assertEquals(result.body.reconstructionTruncated, true);
  assertEquals(result.body.searchCoverage.resultsTruncated, true);
  assertEquals(result.commands.some(c => c.includes("HEADER Message-ID")), false);
});
