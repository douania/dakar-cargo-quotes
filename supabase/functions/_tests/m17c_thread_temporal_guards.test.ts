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
 *   deno test --allow-env --allow-net supabase/functions/_tests/m17c_thread_temporal_guards.test.ts
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

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
    last_message_at: daysAgo(10),  // Recent — 10 days ago
    status: "active",
  },
  {
    subject_normalized: SUBJECT,
    client_email: CLIENT_EMAIL,
    root_message_id: `<thread-b-${TEST_MARKER}@test>`,
    last_message_at: daysAgo(45),  // Intermediate — 45 days ago
    status: "active",
  },
  {
    subject_normalized: SUBJECT,
    client_email: CLIENT_EMAIL,
    root_message_id: `<thread-c-${TEST_MARKER}@test>`,
    last_message_at: daysAgo(90),  // Old — 90 days ago
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

// ─── Seed & Cleanup ──────────────────────────────────────────────────

async function seedThreads() {
  const { error } = await supabase.from("email_threads").insert(THREADS);
  if (error) throw new Error(`Seed failed: ${error.message}`);
}

async function cleanupThreads() {
  await supabase
    .from("email_threads")
    .delete()
    .like("root_message_id", `%${TEST_MARKER}%`);
}

// ─── Tests ───────────────────────────────────────────────────────────

Deno.test("M17c — setup: seed test threads", async () => {
  await cleanupThreads(); // idempotent pre-clean
  await seedThreads();
});

Deno.test("S1 — Subject exact + 60d cutoff returns A and B, ordered A first", async () => {
  const { data, error } = await supabase
    .from("email_threads")
    .select("root_message_id, last_message_at")
    .eq("subject_normalized", SUBJECT)
    .gte("last_message_at", subjectCutoff)
    .order("last_message_at", { ascending: false });

  assertEquals(error, null);
  assert(data !== null && data.length === 2, `Expected 2 results, got ${data?.length}`);

  // Thread A (10d) must be first
  assert(
    data[0].root_message_id.includes("thread-a"),
    `First result should be thread-a, got ${data[0].root_message_id}`
  );
  // Thread B (45d) second
  assert(
    data[1].root_message_id.includes("thread-b"),
    `Second result should be thread-b, got ${data[1].root_message_id}`
  );
  await (await fetch(SUPABASE_URL)).text().catch(() => {});
});

Deno.test("S2 — Similarity branch + 30d cutoff returns only A", async () => {
  const { data, error } = await supabase
    .from("email_threads")
    .select("root_message_id, last_message_at")
    .eq("client_email", CLIENT_EMAIL)
    .gte("last_message_at", similarityCutoff)
    .order("last_message_at", { ascending: false });

  assertEquals(error, null);
  assert(data !== null && data.length === 1, `Expected 1 result, got ${data?.length}`);

  assert(
    data[0].root_message_id.includes("thread-a"),
    `Only thread-a should pass 30d guard, got ${data[0].root_message_id}`
  );
  await (await fetch(SUPABASE_URL)).text().catch(() => {});
});

Deno.test("S3 — Thread C (90d) excluded from both branches", async () => {
  // Subject exact branch
  const { data: subjectData } = await supabase
    .from("email_threads")
    .select("root_message_id")
    .eq("subject_normalized", SUBJECT)
    .gte("last_message_at", subjectCutoff)
    .like("root_message_id", `%${TEST_MARKER}%`);

  const subjectIds = (subjectData ?? []).map((r: { root_message_id: string }) => r.root_message_id);
  assertEquals(
    subjectIds.some((id: string) => id.includes("thread-c")),
    false,
    "Thread C must NOT appear in subject exact branch"
  );

  // Similarity branch
  const { data: simData } = await supabase
    .from("email_threads")
    .select("root_message_id")
    .eq("client_email", CLIENT_EMAIL)
    .gte("last_message_at", similarityCutoff)
    .like("root_message_id", `%${TEST_MARKER}%`);

  const simIds = (simData ?? []).map((r: { root_message_id: string }) => r.root_message_id);
  assertEquals(
    simIds.some((id: string) => id.includes("thread-c")),
    false,
    "Thread C must NOT appear in similarity branch"
  );
  await (await fetch(SUPABASE_URL)).text().catch(() => {});
});

Deno.test("M17c — cleanup: remove test threads", async () => {
  await cleanupThreads();

  // Verify cleanup
  const { data } = await supabase
    .from("email_threads")
    .select("id")
    .like("root_message_id", `%${TEST_MARKER}%`);

  assertEquals(data?.length ?? 0, 0, "All test threads should be cleaned up");
});
