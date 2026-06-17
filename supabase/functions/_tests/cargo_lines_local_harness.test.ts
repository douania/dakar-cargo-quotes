/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-H : Local harness skeleton
 * (cargo_lines / cargo_equipment)
 *
 * NON-DESTRUCTIF / LOCAL-ONLY.
 * Cette phase ne crée AUCUN RPC, n'effectue AUCUNE écriture DB, et n'appelle
 * AUCUN RPC inexistant en exécution active. Les tests DB/RPC futurs sont
 * présents mais SKIPPED (`ignore: true`) tant que les RPC cargo n'existent pas.
 * Seuls les tests du GARDE ANTI-LIVE sont actifs : ils sont purs (aucun réseau,
 * aucune DB).
 *
 * ── Prérequis d'exécution FUTURE (hors de cette phase) ──
 *   - Docker Desktop UP
 *   - Stack Supabase LOCALE démarrée MANUELLEMENT (ex. `supabase start`) — JAMAIS le Cloud/live
 *   - Variables d'env pointant UNIQUEMENT vers le local :
 *       SUPABASE_URL=http://127.0.0.1:54321
 *       SUPABASE_SERVICE_ROLE_KEY=<clé service-role LOCALE émise par `supabase start`>
 *
 * ── Commande FUTURE (Phase 2-I, une fois les RPC créés) ──
 *   deno test --allow-env --allow-net supabase/functions/_tests/cargo_lines_local_harness.test.ts
 *
 * ── Vérification statique (cette phase) ──
 *   deno check supabase/functions/_tests/cargo_lines_local_harness.test.ts
 *
 * INTERDICTION ABSOLUE : ne jamais pointer SUPABASE_URL vers Supabase Cloud/live
 * (projet `snjewofqxfsdmaszapux`). Le garde anti-live ci-dessous refuse
 * l'exécution dans ce cas.
 */

// NB: spécifieur esm.sh (bundlé) aligné sur la convention des tests existants
// (pad_alias_smoke / pad_nom3_runtime_smoke). Évite la résolution npm transitive
// (@supabase/realtime-js) requise par le spécifieur `jsr:` côté runtime _shared,
// pour rester vérifiable via `deno check` en local sans `deno install`.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── Constantes de test (préfixées PHASE_2H / cargo_harness) ──
const PHASE_2H_PREFIX = "PHASE_2H";
const CARGO_HARNESS_TAG = "cargo_harness";
const PHASE_2H_CARGO_HARNESS_SOURCE = `${PHASE_2H_PREFIX}:${CARGO_HARNESS_TAG}`;

// project_id LIVE — interdit comme cible d'un harness local.
const LIVE_PROJECT_ID = "snjewofqxfsdmaszapux";

// Drapeau de sûreté : les RPC cargo n'existent pas encore (Phase 2-A = tables seules).
// Tant que `true`, TOUS les tests DB/RPC restent SKIPPED → aucune écriture DB,
// aucun appel à un RPC inexistant. À passer à `false` en Phase 2-I UNIQUEMENT
// après création des RPC ET démarrage manuel de la stack Supabase LOCALE.
const CARGO_RPCS_NOT_YET_CREATED = true;

// ════════════════════════════════════════════════════════════════════════
// GARDE ANTI-LIVE — helpers
// ════════════════════════════════════════════════════════════════════════

/**
 * Prédicat PUR : `true` uniquement si l'URL cible un Supabase LOCAL
 * (localhost / 127.0.0.1 / ::1) et ne contient pas le project_id live.
 * Aucune I/O.
 */
export function isLocalSupabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.includes(LIVE_PROJECT_ID)) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Garde stricte : lève une erreur si l'environnement n'est pas un Supabase
 * LOCAL sûr. N'effectue AUCUNE connexion réseau.
 *   - SUPABASE_URL présente et localhost/127.0.0.1
 *   - SUPABASE_URL ne contient pas le project_id live
 *   - SUPABASE_SERVICE_ROLE_KEY présente
 */
export function assertLocalSupabaseOnly(): void {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url) {
    throw new Error("[anti-live] SUPABASE_URL absente — harness local refusé.");
  }
  if (url.includes(LIVE_PROJECT_ID)) {
    throw new Error(
      `[anti-live] SUPABASE_URL contient le project_id live (${LIVE_PROJECT_ID}) — harness local refusé.`,
    );
  }
  if (!isLocalSupabaseUrl(url)) {
    throw new Error(
      `[anti-live] SUPABASE_URL non locale (${url}) — seuls localhost/127.0.0.1 sont autorisés.`,
    );
  }
  if (!serviceKey) {
    throw new Error(
      "[anti-live] SUPABASE_SERVICE_ROLE_KEY absente — harness local refusé.",
    );
  }
}

/**
 * Client service-role LOCAL uniquement. Appelle d'abord la garde anti-live,
 * puis construit le client avec EXCLUSIVEMENT SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY. Jamais utilisé en exécution active dans cette phase
 * (uniquement par les tests futurs SKIPPED).
 */
export function createLocalServiceRoleClient(): SupabaseClient {
  assertLocalSupabaseOnly();
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ── Cleanup LOCAL (utilisation future, non exécuté cette phase) ──
// Stratégie : supprimer le quote_cases synthétique purge cargo_lines +
// cargo_equipment via ON DELETE CASCADE. Ordre LIFO pour sûreté FK.
type CleanupFn = () => Promise<void>;
function makeCleanupStack() {
  const stack: CleanupFn[] = [];
  return {
    push: (fn: CleanupFn) => stack.unshift(fn),
    run: async () => {
      for (const fn of stack) {
        try {
          await fn();
        } catch (e) {
          console.warn(`[cleanup] ${(e as Error).message}`);
        }
      }
    },
  };
}

// ── Helper interne : sauvegarde/restauration d'une variable d'env ──
function restoreEnv(name: string, prev: string | undefined): void {
  if (prev === undefined) Deno.env.delete(name);
  else Deno.env.set(name, prev);
}

// ════════════════════════════════════════════════════════════════════════
// TESTS ACTIFS — hermétiques (aucun réseau, aucune DB). Valident le garde anti-live.
// ════════════════════════════════════════════════════════════════════════

Deno.test(
  `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — isLocalSupabaseUrl: local accepté, live/cloud refusé`,
  () => {
    // Local accepté
    assert(isLocalSupabaseUrl("http://127.0.0.1:54321"));
    assert(isLocalSupabaseUrl("http://localhost:54321"));
    // Live / cloud refusé
    assertEquals(isLocalSupabaseUrl(`https://${LIVE_PROJECT_ID}.supabase.co`), false);
    assertEquals(isLocalSupabaseUrl("https://example.supabase.co"), false);
    assertEquals(isLocalSupabaseUrl(undefined), false);
    assertEquals(isLocalSupabaseUrl(null), false);
    assertEquals(isLocalSupabaseUrl(""), false);
    assertEquals(isLocalSupabaseUrl("not-a-url"), false);
    // URL d'apparence locale mais contenant le project_id live → refusé
    assertEquals(isLocalSupabaseUrl(`http://127.0.0.1/${LIVE_PROJECT_ID}`), false);
  },
);

Deno.test(
  `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — assertLocalSupabaseOnly: lève si SUPABASE_URL live`,
  () => {
    const prevUrl = Deno.env.get("SUPABASE_URL");
    const prevKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    try {
      Deno.env.set("SUPABASE_URL", `https://${LIVE_PROJECT_ID}.supabase.co`);
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "dummy-not-used");
      assertThrows(() => assertLocalSupabaseOnly(), Error, "project_id live");
    } finally {
      restoreEnv("SUPABASE_URL", prevUrl);
      restoreEnv("SUPABASE_SERVICE_ROLE_KEY", prevKey);
    }
  },
);

Deno.test(
  `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — assertLocalSupabaseOnly: lève si service-role absente`,
  () => {
    const prevUrl = Deno.env.get("SUPABASE_URL");
    const prevKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    try {
      Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
      assertThrows(() => assertLocalSupabaseOnly(), Error, "SERVICE_ROLE_KEY");
    } finally {
      restoreEnv("SUPABASE_URL", prevUrl);
      restoreEnv("SUPABASE_SERVICE_ROLE_KEY", prevKey);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════
// TESTS FUTURS — SKIPPED (`ignore: CARGO_RPCS_NOT_YET_CREATED`).
// Aucune exécution active → aucune écriture DB, aucun appel à un RPC inexistant.
// Squelette prêt pour Phase 2-I (créer les RPC, démarrer la stack LOCALE, puis
// passer CARGO_RPCS_NOT_YET_CREATED à false). Chaque corps lève un "TODO 2-I"
// explicite pour échouer bruyamment si activé avant implémentation.
// ════════════════════════════════════════════════════════════════════════

Deno.test({
  name: `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — [TODO 2-I] insert cargo_lines via RPC (upsert_cargo_line)`,
  ignore: CARGO_RPCS_NOT_YET_CREATED,
  fn: async () => {
    const cleanup = makeCleanupStack();
    const client = createLocalServiceRoleClient();
    const caseId = crypto.randomUUID(); // TODO 2-I: créer un quote_cases synthétique réel
    cleanup.push(async () => {
      await client.from("quote_cases").delete().eq("id", caseId);
    });
    try {
      // TODO 2-I:
      //   const { data, error } = await client.rpc("upsert_cargo_line", {
      //     p_case_id: caseId, p_line_index: 1, p_status: "to_confirm",
      //     p_description: `${PHASE_2H_CARGO_HARNESS_SOURCE} line 1`,
      //   });
      //   assertEquals(error, null);
      //   assert(data); // id de la ligne canonique
      throw new Error("TODO 2-I: RPC upsert_cargo_line non encore créé");
    } finally {
      await cleanup.run();
    }
  },
});

Deno.test({
  name: `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — [TODO 2-I] insert cargo_equipment via RPC (upsert_cargo_equipment)`,
  ignore: CARGO_RPCS_NOT_YET_CREATED,
  fn: async () => {
    const cleanup = makeCleanupStack();
    const client = createLocalServiceRoleClient();
    const caseId = crypto.randomUUID();
    cleanup.push(async () => {
      await client.from("quote_cases").delete().eq("id", caseId);
    });
    try {
      // TODO 2-I: upsert_cargo_equipment(p_case_id, p_cargo_line_id NULLABLE,
      //   p_equipment_type, p_quantity > 0, p_status). cargo_line_id NULL =
      //   équipement de dossier / partagé non alloué.
      throw new Error("TODO 2-I: RPC upsert_cargo_equipment non encore créé");
    } finally {
      await cleanup.run();
    }
  },
});

Deno.test({
  name: `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — [TODO 2-I] idempotence: ré-exécution sans doublon de ligne`,
  ignore: CARGO_RPCS_NOT_YET_CREATED,
  fn: async () => {
    const cleanup = makeCleanupStack();
    const client = createLocalServiceRoleClient();
    const caseId = crypto.randomUUID();
    cleanup.push(async () => {
      await client.from("quote_cases").delete().eq("id", caseId);
    });
    try {
      // TODO 2-I: appeler upsert_cargo_line deux fois avec le même
      //   (case_id, line_index) et contenu inchangé → 1 seule ligne is_current
      //   (cf. uq_cargo_lines_current_line). Aucun doublon.
      throw new Error("TODO 2-I: idempotence non testable avant création RPC");
    } finally {
      await cleanup.run();
    }
  },
});

Deno.test({
  name: `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — [TODO 2-I] supersession: ancienne ligne is_current=false + historique`,
  ignore: CARGO_RPCS_NOT_YET_CREATED,
  fn: async () => {
    const cleanup = makeCleanupStack();
    const client = createLocalServiceRoleClient();
    const caseId = crypto.randomUUID();
    cleanup.push(async () => {
      await client.from("quote_cases").delete().eq("id", caseId);
    });
    try {
      // TODO 2-I: supersede_cargo_line → ancienne ligne status='superseded' &
      //   is_current=false (respecte le CHECK cargo_lines_superseded_not_current),
      //   nouvelle ligne is_current=true avec supersedes_cargo_line_id renseigné.
      //   L'historique n'est jamais supprimé.
      throw new Error("TODO 2-I: supersession non testable avant création RPC");
    } finally {
      await cleanup.run();
    }
  },
});

Deno.test({
  name: `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — [TODO 2-I] relation cargo_line_id + case_id (FK composite same-case)`,
  ignore: CARGO_RPCS_NOT_YET_CREATED,
  fn: async () => {
    const cleanup = makeCleanupStack();
    const client = createLocalServiceRoleClient();
    const caseA = crypto.randomUUID();
    const caseB = crypto.randomUUID();
    cleanup.push(async () => {
      await client.from("quote_cases").delete().in("id", [caseA, caseB]);
    });
    try {
      // TODO 2-I: équipement rattaché à une cargo_line d'un AUTRE case_id doit
      //   être REJETÉ par cargo_equipment_line_case_fk. Même case_id → accepté.
      //   cargo_line_id NULL → accepté (équipement partagé).
      throw new Error("TODO 2-I: FK composite non testable avant création RPC");
    } finally {
      await cleanup.run();
    }
  },
});

Deno.test({
  name: `${PHASE_2H_PREFIX} ${CARGO_HARNESS_TAG} — [TODO 2-I] cleanup local par cascade (quote_cases → cargo_*)`,
  ignore: CARGO_RPCS_NOT_YET_CREATED,
  fn: async () => {
    const client = createLocalServiceRoleClient();
    const caseId = crypto.randomUUID();
    try {
      // TODO 2-I: après création de lignes/équipements, supprimer le quote_cases
      //   synthétique doit purger cargo_lines + cargo_equipment via ON DELETE
      //   CASCADE (vérifier count=0 ensuite).
      throw new Error("TODO 2-I: cleanup cascade non testable avant création RPC");
    } finally {
      await client.from("quote_cases").delete().eq("id", caseId);
    }
  },
});
