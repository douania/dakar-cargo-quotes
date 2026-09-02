-- DCQ-P0-INTAKE-ATOMIC-BATCH — LOCAL candidate.
-- Chemin spécialisé Intake : UNE opération PostgreSQL atomique remplace, pour
-- l'écran Intake uniquement, l'enchaînement ensure-quote-case + N set-case-fact.
--
-- Doctrine, restée explicite pour un lecteur futur :
--   * TOUT OU RIEN : création/récupération du quote_case canonique, chaque
--     quote_fact (via public.supersede_fact, réutilisé tel quel), l'événement
--     de lot et l'enregistrement d'idempotence vivent dans la même transaction
--     RPC. Toute exception annule l'ensemble.
--   * set-case-fact, supersede_fact, ensure-quote-case ne sont NI modifiés NI
--     re-déclarés ici : ni leur code, ni leurs grants. Ce fichier n'ALTER
--     aucune table existante et ne touche aucune contrainte partagée.
--   * Provenance honnête : source_type est restreint à email_body /
--     attachment_extracted ; la confiance est DÉTERMINÉE ICI par source_type,
--     toujours < 1 ; manual_input/operator sont impossibles par ce chemin.
--   * Idempotence : clé obligatoire, bornée, namespacée ('intake:...').
--     Rejeu identique => réponse stockée, AUCUNE nouvelle supersession.
--     Même clé + payload différent => exception (fail-closed), rien n'est écrit.
--   * Concurrence : verrou advisory transactionnel par dossier, pris AVANT
--     toute lecture décisionnelle. Un double-clic ne duplique aucun fait.
--   * Auth : auth.uid() obligatoire ; nouveau dossier => created_by = auth.uid();
--     dossier existant => public.has_case_write_access(case_id) obligatoire.
--     EXECUTE accordé à authenticated UNIQUEMENT (ni PUBLIC, ni anon, ni
--     service_role) : l'appel se fait sous le JWT utilisateur.
--   * Allowlist FERMÉE : uniquement les 11 faits réellement produits par
--     l'écran Intake, chacun typé et validé. type:null, chaîne vide, nombre
--     non positif/non entier, tableau conteneurs incomplet, clé inconnue,
--     colonnes de valeur multiples et payload excessif sont refusés.
--   * Aucun pricing, puzzle, devis, email, upload ni donnée live : ce fichier
--     n'écrit que quote_cases, case_timeline_events, intake_fact_batches et,
--     via supersede_fact, quote_facts.
--
-- Hors transaction, assumé : l'appel Railway createIntake (analyse) et le
-- stockage best-effort du document restent en dehors de PostgreSQL et ne sont
-- pas couverts — le périmètre atomique est le monde canonique Lovable seul.
BEGIN;

DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'SIFB_MIGRATION_OWNER_REQUIRED';
  END IF;
  -- Fail-closed sur la baseline : chaque invariant ci-dessous s'exprime en
  -- termes de ces objets, jamais ré-implémenté ici.
  IF to_regclass('public.quote_cases') IS NULL
    OR to_regclass('public.quote_facts') IS NULL
    OR to_regclass('public.case_timeline_events') IS NULL
    OR to_regprocedure('public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)') IS NULL
    OR to_regprocedure('public.has_case_write_access(uuid)') IS NULL
  THEN RAISE EXCEPTION 'SIFB_BASELINE_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'quote_case_status' AND e.enumlabel = 'INTAKE')
  THEN RAISE EXCEPTION 'SIFB_STATUS_ENUM_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conname = 'quote_facts_source_type_check'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%email_body%'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%attachment_extracted%')
  THEN RAISE EXCEPTION 'SIFB_SOURCE_TYPE_CHECK_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conname = 'case_timeline_events_event_type_check'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%fact_added%'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%case_created%')
  THEN RAISE EXCEPTION 'SIFB_EVENT_TYPE_CHECK_REQUIRED'; END IF;
  -- Une seconde application refuse plutôt que d'adopter un état collisionné.
  IF to_regclass('public.intake_fact_batches') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'set_intake_facts_batch')
  THEN RAISE EXCEPTION 'SIFB_ALREADY_INSTALLED_OR_COLLISION_REVIEW_REQUIRED'; END IF;
END $guard$;

-- Registre d'idempotence du lot. La requête canonique complète est stockée et
-- comparée verbatim (IS DISTINCT FROM) : pas de hash à recalculer, pas de
-- dépendance pgcrypto, et le conflit détecte le moindre octet divergent.
CREATE TABLE public.intake_fact_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  batch_key text NOT NULL CHECK (
    batch_key ~ '^intake:[A-Za-z0-9._:-]{8,120}$'
    AND length(batch_key) BETWEEN 16 AND 128
  ),
  source_type text NOT NULL CHECK (source_type IN ('email_body', 'attachment_extracted')),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (case_id, batch_key)
);

COMMENT ON TABLE public.intake_fact_batches IS
  'DCQ-P0-INTAKE-ATOMIC-BATCH — registre d''idempotence des lots de faits Intake. Accès direct interdit (RLS deny-all, zéro privilège) : seule public.set_intake_facts_batch (SECURITY DEFINER) y écrit, dans la même transaction que le quote_case et ses quote_facts.';

CREATE FUNCTION public.set_intake_facts_batch(
  p_case_id uuid,
  p_batch_key text,
  p_source_type text,
  p_source_excerpt text,
  p_workflow_key text,
  p_facts jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_confidence numeric;
  v_request_type text := NULL;
  v_request jsonb;
  v_replay public.intake_fact_batches%ROWTYPE;
  v_case public.quote_cases%ROWTYPE;
  v_created boolean := false;
  v_fact jsonb;
  v_key text;
  v_keys text[] := ARRAY[]::text[];
  v_value_cols integer;
  v_num numeric;
  v_txt text;
  v_json jsonb;
  v_elem jsonb;
  v_elem_keys text[];
  v_qty numeric;
  v_type text;
  v_container_count numeric := NULL;
  v_containers_sum numeric := NULL;
  v_category text;
  v_fact_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_response jsonb;
BEGIN
  -- ── Auth fail-closed : jamais d'écriture anonyme ────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'SIFB_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- ── Paramètres de lot ───────────────────────────────────────────────────
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'SIFB_CASE_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_batch_key IS NULL
    OR p_batch_key <> btrim(p_batch_key)
    OR length(p_batch_key) NOT BETWEEN 16 AND 128
    OR p_batch_key !~ '^intake:[A-Za-z0-9._:-]{8,120}$'
  THEN
    RAISE EXCEPTION 'SIFB_BATCH_KEY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NULL OR p_source_type NOT IN ('email_body', 'attachment_extracted') THEN
    RAISE EXCEPTION 'SIFB_SOURCE_TYPE_INVALID' USING ERRCODE = '22023';
  END IF;
  -- Confiance serveur, déterministe par source_type, structurellement < 1 :
  -- aucune extraction automatique ne peut se faire passer pour une validation.
  v_confidence := CASE p_source_type WHEN 'attachment_extracted' THEN 0.80 ELSE 0.70 END;
  IF p_source_excerpt IS NOT NULL
    AND (length(btrim(p_source_excerpt)) = 0 OR length(p_source_excerpt) > 500)
  THEN
    RAISE EXCEPTION 'SIFB_SOURCE_EXCERPT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_workflow_key IS NOT NULL AND length(p_workflow_key) > 64 THEN
    RAISE EXCEPTION 'SIFB_WORKFLOW_KEY_INVALID' USING ERRCODE = '22023';
  END IF;
  -- Même règle que le chemin historique ensure-quote-case : un workflow_key
  -- hors des six types connus donne request_type NULL, jamais une erreur.
  IF p_workflow_key IN ('SEA_FCL_IMPORT','SEA_LCL_IMPORT','SEA_BREAKBULK_IMPORT',
                        'AIR_IMPORT','ROAD_IMPORT','MULTIMODAL_IMPORT') THEN
    v_request_type := p_workflow_key;
  END IF;

  -- ── Facts : allowlist fermée, typage exact, bornes ──────────────────────
  IF p_facts IS NULL OR jsonb_typeof(p_facts) <> 'array' THEN
    RAISE EXCEPTION 'SIFB_FACTS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_facts) > 20 THEN
    RAISE EXCEPTION 'SIFB_FACTS_TOO_MANY' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_facts) > 65536 THEN
    RAISE EXCEPTION 'SIFB_PAYLOAD_TOO_LARGE' USING ERRCODE = '22023';
  END IF;

  FOR v_fact IN SELECT value FROM jsonb_array_elements(p_facts) LOOP
    IF jsonb_typeof(v_fact) <> 'object' THEN
      RAISE EXCEPTION 'SIFB_FACT_SHAPE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_fact) k
               WHERE k NOT IN ('fact_key', 'value_text', 'value_number', 'value_json')) THEN
      RAISE EXCEPTION 'SIFB_FACT_SHAPE_INVALID' USING ERRCODE = '22023';
    END IF;
    v_key := v_fact ->> 'fact_key';
    IF v_key IS NULL THEN
      RAISE EXCEPTION 'SIFB_FACT_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF v_key = ANY (v_keys) THEN
      RAISE EXCEPTION 'SIFB_FACT_KEY_DUPLICATE: %', v_key USING ERRCODE = '22023';
    END IF;
    v_keys := v_keys || v_key;

    -- Exactement UNE colonne de valeur, jamais un null explicite.
    v_value_cols := 0;
    IF v_fact ? 'value_text' THEN
      IF jsonb_typeof(v_fact -> 'value_text') = 'null' THEN
        RAISE EXCEPTION 'SIFB_FACT_VALUE_NULL: %', v_key USING ERRCODE = '22023';
      END IF;
      v_value_cols := v_value_cols + 1;
    END IF;
    IF v_fact ? 'value_number' THEN
      IF jsonb_typeof(v_fact -> 'value_number') = 'null' THEN
        RAISE EXCEPTION 'SIFB_FACT_VALUE_NULL: %', v_key USING ERRCODE = '22023';
      END IF;
      v_value_cols := v_value_cols + 1;
    END IF;
    IF v_fact ? 'value_json' THEN
      IF jsonb_typeof(v_fact -> 'value_json') = 'null' THEN
        RAISE EXCEPTION 'SIFB_FACT_VALUE_NULL: %', v_key USING ERRCODE = '22023';
      END IF;
      v_value_cols := v_value_cols + 1;
    END IF;
    IF v_value_cols <> 1 THEN
      RAISE EXCEPTION 'SIFB_FACT_VALUE_COLUMNS: %', v_key USING ERRCODE = '22023';
    END IF;

    CASE v_key
      WHEN 'cargo.container_count' THEN
        IF jsonb_typeof(v_fact -> 'value_number') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'SIFB_FACT_TYPE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
        v_num := (v_fact ->> 'value_number')::numeric;
        IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 500 THEN
          RAISE EXCEPTION 'SIFB_FACT_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
        v_container_count := v_num;
      WHEN 'cargo.weight_kg' THEN
        IF jsonb_typeof(v_fact -> 'value_number') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'SIFB_FACT_TYPE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
        v_num := (v_fact ->> 'value_number')::numeric;
        IF v_num <= 0 OR v_num > 100000000 THEN
          RAISE EXCEPTION 'SIFB_FACT_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
      WHEN 'cargo.container_type' THEN
        IF jsonb_typeof(v_fact -> 'value_text') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'SIFB_FACT_TYPE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
        v_txt := v_fact ->> 'value_text';
        IF btrim(v_txt) = '' OR length(v_txt) > 32 THEN
          RAISE EXCEPTION 'SIFB_FACT_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
      WHEN 'cargo.description' THEN
        IF jsonb_typeof(v_fact -> 'value_text') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'SIFB_FACT_TYPE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
        v_txt := v_fact ->> 'value_text';
        IF btrim(v_txt) = '' OR length(v_txt) > 2000 THEN
          RAISE EXCEPTION 'SIFB_FACT_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
      WHEN 'service.mode' THEN
        IF jsonb_typeof(v_fact -> 'value_text') IS DISTINCT FROM 'string'
          OR (v_fact ->> 'value_text') NOT IN ('SEA_FCL_IMPORT','SEA_LCL_IMPORT',
            'SEA_BREAKBULK_IMPORT','AIR_IMPORT','ROAD_IMPORT','MULTIMODAL_IMPORT') THEN
          RAISE EXCEPTION 'SIFB_FACT_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
      WHEN 'routing.transport_mode' THEN
        IF jsonb_typeof(v_fact -> 'value_text') IS DISTINCT FROM 'string'
          OR (v_fact ->> 'value_text') NOT IN ('MARITIME','AIR','ROUTE','MULTIMODAL') THEN
          RAISE EXCEPTION 'SIFB_FACT_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
      WHEN 'routing.origin_port', 'routing.destination_port',
           'routing.destination_city', 'routing.destination_country' THEN
        IF jsonb_typeof(v_fact -> 'value_text') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'SIFB_FACT_TYPE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
        v_txt := v_fact ->> 'value_text';
        IF btrim(v_txt) = '' OR length(v_txt) > 120 THEN
          RAISE EXCEPTION 'SIFB_FACT_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
      WHEN 'cargo.containers' THEN
        IF jsonb_typeof(v_fact -> 'value_json') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'SIFB_FACT_TYPE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
        v_json := v_fact -> 'value_json';
        IF jsonb_array_length(v_json) NOT BETWEEN 1 AND 50 THEN
          RAISE EXCEPTION 'SIFB_FACT_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
        END IF;
        v_containers_sum := 0;
        FOR v_elem IN SELECT value FROM jsonb_array_elements(v_json) LOOP
          -- Fait canonique : chaque groupe porte EXACTEMENT {quantity, type}.
          -- Un groupe sans type (ou type null / vide) n'a pas sa place ici :
          -- le compte seul passe par cargo.container_count.
          IF jsonb_typeof(v_elem) <> 'object' THEN
            RAISE EXCEPTION 'SIFB_CONTAINER_SHAPE_INVALID' USING ERRCODE = '22023';
          END IF;
          SELECT array_agg(k ORDER BY k) INTO v_elem_keys FROM jsonb_object_keys(v_elem) k;
          IF v_elem_keys IS DISTINCT FROM ARRAY['quantity','type'] THEN
            RAISE EXCEPTION 'SIFB_CONTAINER_SHAPE_INVALID' USING ERRCODE = '22023';
          END IF;
          IF jsonb_typeof(v_elem -> 'quantity') <> 'number' THEN
            RAISE EXCEPTION 'SIFB_CONTAINER_QUANTITY_INVALID' USING ERRCODE = '22023';
          END IF;
          v_qty := (v_elem ->> 'quantity')::numeric;
          IF v_qty <> trunc(v_qty) OR v_qty < 1 OR v_qty > 500 THEN
            RAISE EXCEPTION 'SIFB_CONTAINER_QUANTITY_INVALID' USING ERRCODE = '22023';
          END IF;
          IF jsonb_typeof(v_elem -> 'type') <> 'string' THEN
            RAISE EXCEPTION 'SIFB_CONTAINER_TYPE_INVALID' USING ERRCODE = '22023';
          END IF;
          v_type := v_elem ->> 'type';
          IF btrim(v_type) = '' OR length(v_type) > 32 THEN
            RAISE EXCEPTION 'SIFB_CONTAINER_TYPE_INVALID' USING ERRCODE = '22023';
          END IF;
          v_containers_sum := v_containers_sum + v_qty;
        END LOOP;
      ELSE
        RAISE EXCEPTION 'SIFB_FACT_KEY_NOT_ALLOWED: %', v_key USING ERRCODE = '22023';
    END CASE;
  END LOOP;

  -- Cohérence interne du lot : un détail conteneurs qui contredit le compte
  -- annoncé signale une extraction incomplète — on refuse tout.
  IF v_container_count IS NOT NULL AND v_containers_sum IS NOT NULL
    AND v_container_count <> v_containers_sum THEN
    RAISE EXCEPTION 'SIFB_CONTAINER_COUNT_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- ── Verrou par dossier : sérialise lots concurrents et double-clics ─────
  PERFORM pg_advisory_xact_lock(hashtextextended('sifb:' || p_case_id::text, 0));

  v_request := jsonb_build_object(
    'actor', v_uid,
    'caseId', p_case_id,
    'sourceType', p_source_type,
    'sourceExcerpt', p_source_excerpt,
    'workflowKey', p_workflow_key,
    'facts', p_facts);

  -- ── Dossier canonique : contrôle d'accès AVANT toute lecture de replay ───
  -- Le registre d'idempotence contient des identifiants de faits. Il ne doit
  -- jamais être consulté sous SECURITY DEFINER avant d'avoir démontré le droit
  -- d'écriture du demandeur sur un dossier existant.
  SELECT * INTO v_case FROM public.quote_cases WHERE id = p_case_id;
  IF FOUND THEN
    IF NOT public.has_case_write_access(p_case_id) THEN
      RAISE EXCEPTION 'SIFB_CASE_ACCESS_DENIED' USING ERRCODE = '42501';
    END IF;
  ELSE
    INSERT INTO public.quote_cases (id, status, request_type, created_by, puzzle_completeness)
    VALUES (p_case_id, 'INTAKE'::public.quote_case_status,
            v_request_type::public.quote_request_type, v_uid, 0)
    RETURNING * INTO v_case;
    v_created := true;
    INSERT INTO public.case_timeline_events (case_id, event_type, event_data, actor_type, actor_user_id)
    VALUES (p_case_id, 'case_created',
            jsonb_build_object('source', 'set-intake-facts-batch', 'workflow_key', p_workflow_key),
            'user', v_uid);
  END IF;

  -- ── Idempotence : rejeu identique => réponse stockée, zéro écriture ─────
  SELECT * INTO v_replay FROM public.intake_fact_batches
   WHERE case_id = p_case_id AND batch_key = p_batch_key;
  IF FOUND THEN
    IF v_replay.request IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'SIFB_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    RETURN v_replay.response || jsonb_build_object('replayed', true);
  END IF;

  -- ── Faits : supersede_fact réutilisé tel quel, provenance serveur ───────
  FOR v_fact IN SELECT value FROM jsonb_array_elements(p_facts) LOOP
    v_key := v_fact ->> 'fact_key';
    v_category := CASE split_part(v_key, '.', 1)
      WHEN 'cargo' THEN 'cargo'
      WHEN 'routing' THEN 'routing'
      WHEN 'service' THEN 'service'
      ELSE 'other' END;
    v_fact_id := public.supersede_fact(
      p_case_id := p_case_id,
      p_fact_key := v_key,
      p_fact_category := v_category,
      p_value_text := v_fact ->> 'value_text',
      p_value_number := (v_fact ->> 'value_number')::numeric,
      p_value_json := v_fact -> 'value_json',
      p_value_date := NULL,
      p_source_type := p_source_type,
      p_source_email_id := NULL,
      p_source_attachment_id := NULL,
      p_source_excerpt := p_source_excerpt,
      p_confidence := v_confidence);
    v_results := v_results || jsonb_build_array(
      jsonb_build_object('fact_key', v_key, 'fact_id', v_fact_id));
  END LOOP;

  -- ── Événement de lot (uniquement si des faits ont été écrits) ───────────
  IF jsonb_array_length(v_results) > 0 THEN
    INSERT INTO public.case_timeline_events (case_id, event_type, actor_type, actor_user_id, event_data)
    VALUES (p_case_id, 'fact_added', 'user', v_uid,
      jsonb_build_object(
        'source', 'set-intake-facts-batch',
        'batch_key', p_batch_key,
        'source_type', p_source_type,
        'confidence', v_confidence,
        'fact_keys', to_jsonb(v_keys),
        'fact_count', jsonb_array_length(v_results),
        'created_case', v_created));
  END IF;

  v_response := jsonb_build_object(
    'case_id', p_case_id,
    'created_case', v_created,
    'status', v_case.status,
    'request_type', v_case.request_type,
    'source_type', p_source_type,
    'confidence', v_confidence,
    'facts', v_results,
    'replayed', false);

  INSERT INTO public.intake_fact_batches (case_id, batch_key, source_type, request, response, created_by)
  VALUES (p_case_id, p_batch_key, p_source_type, v_request, v_response, v_uid);

  RETURN v_response;
END $$;

COMMENT ON FUNCTION public.set_intake_facts_batch(uuid, text, text, text, text, jsonb) IS
  'DCQ-P0-INTAKE-ATOMIC-BATCH — écrit atomiquement le quote_case canonique Intake et tous ses quote_facts (via supersede_fact), avec idempotence par lot et verrou advisory par dossier. Appel sous JWT utilisateur uniquement (GRANT authenticated) ; provenance et confiance imposées côté serveur.';

-- Table deny-all : l'ACL est la vraie porte, la RLS le second verrou.
ALTER TABLE public.intake_fact_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.intake_fact_batches FROM PUBLIC, anon, authenticated, service_role;

-- RPC : authenticated UNIQUEMENT. Ni PUBLIC (grant implicite retiré), ni anon,
-- ni service_role — le frontend appelle sous le JWT utilisateur et rien d'autre.
REVOKE ALL ON FUNCTION public.set_intake_facts_batch(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_intake_facts_batch(uuid, text, text, text, text, jsonb)
  TO authenticated;

DO $verify$
DECLARE
  t oid := 'public.intake_fact_batches'::regclass;
  f record;
  forbidden text;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = t) THEN
    RAISE EXCEPTION 'SIFB_RLS_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = t) THEN
    RAISE EXCEPTION 'SIFB_POLICY_PRESENT';
  END IF;
  IF has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated', t, 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('service_role', t, 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'SIFB_TABLE_PRIVILEGE_DRIFT';
  END IF;

  SELECT p.oid AS fnoid, p.prosecdef, p.proconfig, p.prosrc INTO f
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_intake_facts_batch';
  IF NOT FOUND OR NOT f.prosecdef THEN
    RAISE EXCEPTION 'SIFB_SECURITY_DEFINER_REQUIRED';
  END IF;
  IF NOT f.proconfig @> ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'SIFB_SEARCH_PATH_LOST';
  END IF;
  IF NOT has_function_privilege('authenticated', f.fnoid, 'EXECUTE') THEN
    RAISE EXCEPTION 'SIFB_AUTHENTICATED_GRANT_MISSING';
  END IF;
  IF has_function_privilege('anon', f.fnoid, 'EXECUTE')
    OR has_function_privilege('service_role', f.fnoid, 'EXECUTE') THEN
    RAISE EXCEPTION 'SIFB_PRIVILEGE_DRIFT';
  END IF;

  -- Preuve statique du périmètre d'écriture : le wrapper n'écrit que
  -- quote_cases, case_timeline_events, intake_fact_batches (et quote_facts via
  -- supersede_fact, dont le code n'est pas dans ce prosrc).
  FOREACH forbidden IN ARRAY ARRAY[
    'quote_facts','pricing_runs','quotation_versions','quotations','case_documents',
    'emails','email_attachments','email_threads','cargo_lines','cargo_equipment',
    'quote_request_lines','request_lines','quote_gaps','client_gap_requests',
    'quote_scenarios','scenario_pricings','scenario_outputs','maritime_fee_decisions',
    'final_request_heads','final_request_commands','final_request_revisions',
    'final_request_projections','final_request_projection_commands'
  ] LOOP
    IF f.prosrc ~* ('(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+public\.' || forbidden || '\M') THEN
      RAISE EXCEPTION 'SIFB_WRITE_PERIMETER_BREACH:%', forbidden;
    END IF;
  END LOOP;
  -- Le wrapper lui-même n'UPDATE ni ne DELETE rien : la supersession vit
  -- exclusivement dans supersede_fact, réutilisé sans modification.
  IF f.prosrc ~* '\m(update|delete|truncate|drop|alter)\M' THEN
    RAISE EXCEPTION 'SIFB_MUTATION_STATEMENT_FORBIDDEN';
  END IF;
  -- Provenance : jamais manual_input/operator, confiance jamais 1.
  IF f.prosrc ~* 'manual_input|''operator''' THEN
    RAISE EXCEPTION 'SIFB_PROVENANCE_VOCABULARY_FORBIDDEN';
  END IF;
END $verify$;

COMMIT;
