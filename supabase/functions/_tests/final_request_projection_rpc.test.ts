/**
 * P1-C3-B — garde hermétique du contrat SQL de l'artefact de projection.
 *
 * Ces tests ne parlent pas à PostgreSQL : ils lisent la migration candidate et
 * vérifient les invariants qu'une relecture humaine laisse le plus facilement
 * filer — périmètre d'écriture, vocabulaire de promotion, verrou partagé avec
 * P1-C2, posture de privilèges. Une preuve dont le schéma autorise une
 * promotion n'est plus une preuve.
 */
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";

const MIGRATIONS = fromFileUrl(new URL("../../migrations/", import.meta.url));
const PROJECTION_MIGRATION =
  "20260901180000_create_final_request_projection_p1c3b.sql";
const LEDGER_MIGRATION = "20260831120000_create_final_request_state_p1c2a.sql";

const sql = await Deno.readTextFile(MIGRATIONS + PROJECTION_MIGRATION);
const ledgerSql = await Deno.readTextFile(MIGRATIONS + LEDGER_MIGRATION);

/** Tables que ce chantier ne doit jamais écrire, directement ou non. */
const FORBIDDEN_WRITE_TARGETS = [
  "quote_facts",
  "cargo_lines",
  "cargo_equipment",
  "quote_request_lines",
  "request_lines",
  "case_service_overrides",
  "gaps",
  "pricing_runs",
  "quotation_versions",
  "quotations",
  "case_documents",
  "emails",
  "email_attachments",
  "final_request_heads",
  "final_request_commands",
  "final_request_revisions",
  "final_request_revision_sources",
  "final_request_source_versions",
  "final_request_review_events",
  "final_request_reviewer_grants",
];

const EXCLUDED_FIELDS = [
  "lot.in_scope",
  "service.TRUCKING",
  "service.DTHC",
  "service.CUSTOMS_DAKAR",
  "service.SEA_FREIGHT",
];

const EVIDENCE_FIELDS = [
  "cargo.description",
  "cargo.weight_kg",
  "cargo.volume_cbm",
  "cargo.pieces_count",
  "cargo.container_type",
  "routing.origin_port",
  "routing.destination_port",
  "routing.destination_city",
  "routing.incoterm",
  "transport.mode",
  "movement.direction",
  "terminal.operation_mode",
];

const PROVENANCE_KEYS = [
  "'scope'",
  "'field'",
  "'status'",
  "'value'",
  "'assertionId'",
  "'sourceId'",
  "'sentAt'",
  "'excerpt'",
];

const NEW_ROUTINES = [
  "frp_build_artifact",
  "frp_chain_guard",
  "frp_immutable",
  "frp_mutate",
  "frp_no_promotion_key",
  "frp_read",
];

function captured(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of sql.matchAll(pattern)) found.push(match[1]);
  return found;
}

Deno.test("the migration is transactional and alters no P1-C2 object", () => {
  assertMatch(sql, /^(?:--[^\n]*\n)*BEGIN;/);
  assertMatch(sql, /COMMIT;\s*$/);
  assertEquals(/\bDROP\s+/i.test(sql), false, "no DROP");
  assertEquals(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.frs_/i.test(sql),
    false,
    "frs_* functions are never redefined here",
  );
  assertEquals(
    /ALTER\s+TABLE\s+public\.final_request_[a-z_]*(heads|commands|revisions|sources|events|grants)/i
      .test(sql),
    false,
    "no P1-C2 table is altered",
  );
});

Deno.test("no statement writes outside the two new projection tables", () => {
  for (const table of FORBIDDEN_WRITE_TARGETS) {
    const write = new RegExp(
      `(insert\\s+into|update|delete\\s+from)\\s+public\\.${table}\\b`,
      "i",
    );
    assertEquals(write.test(sql), false, `writes public.${table}`);
  }
  const inserted = captured(/insert\s+into\s+public\.(\w+)/gi);
  assertEquals([...new Set(inserted)].sort(), [
    "final_request_projection_commands",
    "final_request_projections",
  ]);
});

Deno.test("the promotion vocabulary is refused by a CHECK", () => {
  const guardStart = sql.indexOf("CREATE FUNCTION public.frp_no_promotion_key");
  const guardEnd = sql.indexOf("CREATE TABLE public.final_request_projection");
  assert(guardStart > 0 && guardEnd > guardStart);
  const guard = sql.slice(guardStart, guardEnd);
  const elsewhere = sql.slice(0, guardStart) + sql.slice(guardEnd);
  assertMatch(guard, /'targetfactkey'/);
  assertMatch(sql, /public\.frp_no_promotion_key\(artifact\)/);
  assertMatch(sql, /public\.frp_no_promotion_key\(response\)/);
  assertMatch(sql, /FRP_PROMOTION_VOCABULARY/);
  // Hors du garde lui-même, aucun littéral SQL ne nomme la promotion : ni
  // colonne, ni clé de `jsonb_build_object`.
  assertEquals(
    /'target_?fact_?key'/i.test(elsewhere),
    false,
    "a SQL literal outside the guard names a promotion key",
  );
  assertEquals(
    /target_fact_key\s+(text|uuid|jsonb|boolean)/i.test(sql),
    false,
    "a column carries a promotion key",
  );
});

Deno.test("pricing authorization is a structural literal false", () => {
  assertEquals(
    /'pricingAuthorized',\s*(?!false\b)/.test(sql),
    false,
    "every jsonb_build_object emits false",
  );
  assertMatch(sql, /response->'pricingAuthorized'='false'::jsonb/);
  assertMatch(sql, /artifact->'pricingAuthorized'='false'::jsonb/);
});

Deno.test("the projection takes the P1-C2 per-case advisory lock", () => {
  const lock =
    "pg_advisory_xact_lock(hashtextextended('frs:'||p_case::text,0))";
  assert(ledgerSql.includes(lock), "P1-C2 lock expression changed");
  assert(sql.includes(lock), "P1-C3-B must share the P1-C2 lock");
  assertEquals(sql.split("pg_advisory").length - 1, 1, "one acquisition");
});

Deno.test("head generation is read for CAS but never advanced", () => {
  assertMatch(
    sql,
    /SELECT \* INTO head FROM public\.final_request_heads WHERE case_id=p_case FOR SHARE/,
  );
  assertEquals(
    /UPDATE\s+public\.final_request_heads/i.test(sql),
    false,
    "the P1-C2 head is never written",
  );
  assertMatch(sql, /head\.generation<>p_expected_generation/);
  assertMatch(sql, /head\.revision_id IS DISTINCT FROM p_expected_revision/);
});

Deno.test("idempotency replays before any write", () => {
  const body = sql.slice(sql.indexOf("CREATE FUNCTION public.frp_mutate"));
  const replayAt = body.indexOf("FRP_IDEMPOTENCY_CONFLICT");
  const firstInsert = body.indexOf(
    "INSERT INTO public.final_request_projection",
  );
  assert(replayAt > 0 && firstInsert > 0);
  assert(replayAt < firstInsert, "replay check must precede every INSERT");
  assertMatch(body, /IF replay\.request IS DISTINCT FROM request THEN RAISE/);
});

Deno.test("the five excluded fields refuse the artifact", () => {
  const raise = sql.indexOf("FRP_FIELD_EXCLUDED");
  assert(raise > 400);
  const guard = sql.slice(raise - 400, raise + 40);
  for (const field of EXCLUDED_FIELDS) {
    assert(guard.includes(`'${field}'`), `${field} must refuse the artifact`);
  }
  assertMatch(sql, /RAISE EXCEPTION 'FRP_FIELD_EXCLUDED'/);
});

Deno.test("exactly the twelve evidence fields are accepted", () => {
  const start = sql.indexOf("IF f NOT IN (");
  assert(start > 0);
  const accepted = sql.slice(start, sql.indexOf("FRP_FIELD_UNKNOWN", start));
  for (const field of EVIDENCE_FIELDS) {
    assert(accepted.includes(`'${field}'`), `${field} must be evidence`);
  }
  for (const field of EXCLUDED_FIELDS) {
    assertEquals(
      accepted.includes(`'${field}'`),
      false,
      `${field} must not be evidence`,
    );
  }
  const quoted = accepted.match(/'[a-z]+\.[a-zA-Z_]+'/g) ?? [];
  assertEquals(quoted.length, EVIDENCE_FIELDS.length);
});

Deno.test("evidence keeps the C1 provenance verbatim", () => {
  const start = sql.indexOf("evidence:=evidence||");
  assert(start > 0);
  const build = sql.slice(start, sql.indexOf("END LOOP;", start));
  for (const key of PROVENANCE_KEYS) {
    assert(build.includes(key), `provenance key ${key} missing`);
  }
  assertMatch(build, /'scope',v->'scope'/);
  assertMatch(build, /'status',v->>'status'/);
  assertMatch(build, /v->>'status'='set'/);
  assertMatch(sql, /v->>'status' NOT IN \('set','removed'\)/);
});

Deno.test("liveness is derived from the append-only chain tip", () => {
  assertEquals(
    /CREATE UNIQUE INDEX[^;]+WHERE state='active'/is.test(sql),
    false,
    "historical active events cannot model current liveness",
  );
  assertMatch(sql, /ORDER BY version_number DESC LIMIT 1/);
  assertMatch(sql, /tip\.state='active'/);
});

Deno.test("the persisted C1 calculation contract is revalidated", () => {
  assertMatch(sql, /public\.frs_assertions_valid\(r\.input\)/);
  assertMatch(sql, /public\.frs_result_valid\(r\.raw_result,r\.input\)/);
  assertMatch(sql, /FRP_CALCULATION_CONTRACT/);
});

Deno.test("sources must be attested client/current for the revision", () => {
  assertMatch(sql, /s->>'authorRole'<>'client'/);
  assertMatch(sql, /s->>'contentClass'<>'current'/);
  assertMatch(sql, /s->'roleVerified' IS DISTINCT FROM 'true'::jsonb/);
  assertMatch(sql, /public\.final_request_revision_sources rs/);
  assertMatch(sql, /sv\.attested_by IS NOT NULL AND sv\.author_role='client'/);
});

Deno.test("revocation is append-only and mirrors the revoked version", () => {
  assertMatch(sql, /CREATE TRIGGER frp_no_rewrite BEFORE UPDATE OR DELETE/);
  assertMatch(sql, /CREATE TRIGGER frp_no_truncate BEFORE TRUNCATE/);
  assertMatch(sql, /FRP_REVOCATION_MUST_MIRROR/);
  assertMatch(sql, /state IN \('active','revoked'\)/);
  assertEquals(
    /UPDATE\s+public\.final_request_projections/i.test(sql),
    false,
    "a revocation never rewrites a row",
  );
});

Deno.test("new tables are deny-all and only two RPCs are granted", () => {
  assertMatch(sql, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
  assertMatch(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC,anon/);
  assertMatch(sql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon/);
  const granted = captured(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g);
  assertEquals(granted.sort(), ["frp_mutate", "frp_read"]);
  assertEquals(/GRANT\s+(SELECT|INSERT|ALL)\s+ON\s+TABLE/i.test(sql), false);
  assertEquals(/CREATE\s+POLICY/i.test(sql), false, "deny-all means no policy");
});

Deno.test("every new routine pins search_path", () => {
  const routines = captured(/CREATE FUNCTION public\.(frp_\w+)/g);
  assertEquals(routines.sort(), NEW_ROUTINES);
  const pinned = sql.match(/SET search_path=pg_catalog/g) ?? [];
  assertEquals(pinned.length, routines.length);
  const definers = sql.match(/SECURITY DEFINER SET search_path/g) ?? [];
  assertEquals(definers.length, 2, "only the two RPCs are definers");
  assertMatch(sql, /FRP_SEARCH_PATH_LOST/);
  assertMatch(sql, /FRP_SERVICE_PRIVILEGE_DRIFT/);
  assertMatch(sql, /FRP_TABLE_PRIVILEGE_DRIFT/);
});

Deno.test("installation is fail-closed on baseline or collision", () => {
  assertMatch(sql, /FRP_MIGRATION_OWNER_REQUIRED/);
  assertMatch(sql, /FRP_P1C2_BASELINE_REQUIRED/);
  assertMatch(sql, /FRP_ALREADY_INSTALLED_OR_COLLISION_REVIEW_REQUIRED/);
});
