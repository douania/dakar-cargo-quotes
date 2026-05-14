import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !ANON) { console.error("Missing env URL/ANON"); process.exit(2); }

const email = `map6-sec-test-${Date.now()}@example.test`;
const password = `Pw_${Math.random().toString(36).slice(2)}_${Date.now()}!Aa1`;
let userId = null;
const results = [];

async function call(label, path, headers, body) {
  const r = await fetch(`${URL}/rest/v1/rpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  const line = `${label}: status=${r.status} body=${txt.slice(0,300)}`;
  console.log(line);
  results.push({ label, status: r.status, body: txt });
  return { status: r.status, body: txt };
}

const userClient = createClient(URL, ANON, { auth: { persistSession: false } });

// 1. Try signup
const { data: sUp, error: uErr } = await userClient.auth.signUp({ email, password });
if (uErr) { console.error("signUp error:", uErr.message); process.exit(3); }
userId = sUp.user?.id || null;
console.log(`signUp user_id=${userId} session=${sUp.session ? "yes" : "no"}`);

let jwt = sUp.session?.access_token || null;

if (!jwt) {
  // try signInWithPassword (works if auto-confirm)
  const { data: si, error: siErr } = await userClient.auth.signInWithPassword({ email, password });
  if (siErr) {
    console.error("signIn error (likely email confirmation required):", siErr.message);
    console.log("RESULT_SUMMARY:", JSON.stringify({ blocked: "email_confirm_required", user_id: userId }));
    process.exit(4);
  }
  jwt = si.session.access_token;
}
console.log(`got jwt len=${jwt.length}`);

const fakeCandidate = "00000000-0000-0000-0000-000000000000";
const fakeIdem = "test-idem-key-1234567890";

await call("P1 anon /supersede_fact", "supersede_fact",
  { apikey: ANON },
  { p_case_id: fakeCandidate, p_fact_key: "x", p_fact_category: "y" });

await call("P2 auth /supersede_fact", "supersede_fact",
  { apikey: ANON, Authorization: `Bearer ${jwt}` },
  { p_case_id: fakeCandidate, p_fact_key: "x", p_fact_category: "y" });

await call("P3 anon /wrapper", "propagate_classification_candidate_to_fact",
  { apikey: ANON },
  { p_candidate_id: fakeCandidate, p_idempotency_key: fakeIdem });

await call("P4 auth /wrapper", "propagate_classification_candidate_to_fact",
  { apikey: ANON, Authorization: `Bearer ${jwt}` },
  { p_candidate_id: fakeCandidate, p_idempotency_key: fakeIdem });

console.log("USER_ID_TO_CLEANUP=", userId);
console.log("RESULT_SUMMARY:", JSON.stringify(results));
