/**
 * M17c — Validation DB-level des gardes temporelles de findExistingThread()
 *
 * PORTÉE LIMITÉE :
 *   Ce test ne valide PAS l'appel IMAP ni l'exécution complète de sync-emails.
 *   Il valide uniquement les prédicats DB (.eq / .gte / .order) et l'ordre de
 *   sélection utilisés par les branches heuristiques de findExistingThread().
 *
 * Scénarios :
 *   S1 — Thread récent (10j) → matché par sujet exact ET similarité
 *   S2 — Thread intermédiaire (45j) → matché par sujet exact (60j), exclu par similarité (30j)
 *   S3 — Thread ancien (90j) → exclu des deux branches heuristiques
 *
 * Exécution :
 *   deno test --allow-env --allow-net --allow-read supabase/functions/_tests/m17c_thread_temporal_guards.test.ts
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// ─── Test constants ──────────────────────────────────────────────────
const TEST_MARKER = `M17C_TEST_${Date.now()}`;
const SUBJECT = `Cotation maritime ${TEST_MARKER}`;
const CLIENT_EMAIL = `test-m17c-${Date.now()}@example.com`;

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const THREADS = [
  {
    subject_normalized: SUBJECT,
    client_email: CLIENT_EMAIL,
    root_message_id: `<thread-a-${TEST_MARKER}@test>`,
    last_message_at: daysAgo(10),
    status: "active",
  },
  {
    subject_normalized: SUBJECT,
    client_email: CLIENT_EMAIL,
    root_message_id: `<thread-b-${TEST_MARKER}@test>`,
    last_message_at: daysAgo(45),
    status: "active",
  },
  {
    subject_normalized: SUBJECT,
    client_email: CLIENT_EMAIL,
    root_message_id: `<thread-c-${TEST_MARKER}@test>`,
    last_message_at: daysAgo(90),
    status: "active",
  },
];

// ─── Cutoffs (same as sync-emails M17b) ──────────────────────────────
const SUBJECT_CUTOFF_DAYS = 60;
const SIMILARITY_CUTOFF_DAYS = 30;

const subjectCutoff = new Date(
  Date.now() - SUBJECT_CUTOFF_DAYS * 24 * 60 * 60 * 1000
).toISOString();

const similarityCutoff = new Date(
  Date.now() - SIMILARITY_CUTOFF_DAYS * 24 * 60 * 60 * 1000
).toISOString();

// ─── REST helpers ────────────────────────────────────────────────────

async function restQuery(params: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${REST}/email_threads?${params}`, {
    headers: { ...HEADERS, Prefer: "" },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Query failed: ${JSON.stringify(body)}`);
  return body;
}

async function seedThreads() {
  const res = await fetch(`${REST}/email_threads`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(THREADS),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Seed failed: ${body}`);
}

async function cleanupThreads() {
  const res = await fetch(
    `${REST}/email_threads?root_message_id=like.*${TEST_MARKER}*`,
    { method: "DELETE", headers: HEADERS }
  );
  await res.text();
}

// ─── Tests ───────────────────────────────────────────────────────────

Deno.test("M17c — setup: seed test threads", async () => {
  await cleanupThreads();
  await seedThreads();
});

Deno.test("S1 — Subject exact + 60d cutoff returns A and B, A first", async () => {
  const data = await restQuery(
    `subject_normalized=eq.${encodeURIComponent(SUBJECT)}` +
    `&last_message_at=gte.${subjectCutoff}` +
    `&order=last_message_at.desc` +
    `&select=root_message_id,last_message_at`
  );

  assertEquals(data.length, 2, `Expected 2 results, got ${data.length}`);

  // Thread A (10d) must be first — findExistingThread takes most recent
  assert(
    (data[0].root_message_id as string).includes("thread-a"),
    `First result should be thread-a, got ${data[0].root_message_id}`
  );
  assert(
    (data[1].root_message_id as string).includes("thread-b"),
    `Second result should be thread-b, got ${data[1].root_message_id}`
  );
});

Deno.test("S2 — Similarity branch + 30d cutoff returns only A", async () => {
  const data = await restQuery(
    `client_email=eq.${encodeURIComponent(CLIENT_EMAIL)}` +
    `&last_message_at=gte.${similarityCutoff}` +
    `&order=last_message_at.desc` +
    `&select=root_message_id,last_message_at`
  );

  assertEquals(data.length, 1, `Expected 1 result, got ${data.length}`);

  assert(
    (data[0].root_message_id as string).includes("thread-a"),
    `Only thread-a should pass 30d guard, got ${data[0].root_message_id}`
  );
});

Deno.test("S3 — Thread C (90d) excluded from both branches", async () => {
  // Subject exact branch
  const subjectData = await restQuery(
    `subject_normalized=eq.${encodeURIComponent(SUBJECT)}` +
    `&last_message_at=gte.${subjectCutoff}` +
    `&root_message_id=like.*${TEST_MARKER}*` +
    `&select=root_message_id`
  );

  assertEquals(
    subjectData.some((r) => (r.root_message_id as string).includes("thread-c")),
    false,
    "Thread C must NOT appear in subject exact branch"
  );

  // Similarity branch
  const simData = await restQuery(
    `client_email=eq.${encodeURIComponent(CLIENT_EMAIL)}` +
    `&last_message_at=gte.${similarityCutoff}` +
    `&root_message_id=like.*${TEST_MARKER}*` +
    `&select=root_message_id`
  );

  assertEquals(
    simData.some((r) => (r.root_message_id as string).includes("thread-c")),
    false,
    "Thread C must NOT appear in similarity branch"
  );
});

Deno.test("M17c — cleanup: remove test threads", async () => {
  await cleanupThreads();

  const remaining = await restQuery(
    `root_message_id=like.*${TEST_MARKER}*&select=id`
  );

  assertEquals(remaining.length, 0, "All test threads should be cleaned up");
});
