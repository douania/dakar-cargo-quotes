-- P1-C3-B LOCAL candidate. Append-only, versioned, transactional PROOF artifact.
-- It exists for one reason: give P1-C3-C something it can audit. It projects
-- nothing into the pricing world and authorizes nothing.
--
-- Doctrine, restated so a later reader cannot soften it by accident:
--   * The artifact content is DERIVED HERE, from the P1-C2 tables already
--     persisted. No `fields`, no `value`, no `excerpt`, no hash and no
--     authorization ever crosses the browser boundary into this ledger. The
--     Edge supplies identity, dossier, idempotency key and CAS witnesses only.
--   * There is NO `targetFactKey` / `target_fact_key` anywhere: not a column,
--     not a JSON key, not a response field. A promotion map is P1-C3-C's
--     problem and must not be pre-decided by a storage schema.
--   * `pricingAuthorized` is a structural literal `false`, enforced by CHECK on
--     both the artifact and every stored response.
--   * `lot.in_scope` and the four `service.*` fields are EXCLUDED. They do not
--     get silently dropped: their presence REFUSES the artifact. Silence would
--     let a lot-scoped or service-override instruction disappear from the
--     proof while the rest of the request looks complete.
--   * The other twelve C1 fields are kept as EVIDENCE ONLY — provenance
--     preserved verbatim, no mapping, no promotion, no interpretation.
--   * Revocation appends a new version. Nothing is ever UPDATEd or DELETEd.
--
-- This migration writes nothing to quote_facts, cargo_lines, cargo_equipment,
-- quote_request_lines, request_lines, service overrides, gaps, pricing_runs,
-- quotation_versions, PDFs or email. It does not create, consume or advance
-- `final_request_heads.generation`, and it does not touch `frs_mutate`: the
-- P1-C2 ledger keeps its own life cycle and only lends its per-dossier
-- advisory lock and its read-only helpers.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'FRP_MIGRATION_OWNER_REQUIRED'; END IF;
  -- Fail-closed on a missing P1-C2 baseline: every invariant below is expressed
  -- in terms of those tables and helpers, never re-implemented here.
  IF to_regclass('public.final_request_heads') IS NULL
    OR to_regclass('public.final_request_commands') IS NULL
    OR to_regclass('public.final_request_revisions') IS NULL
    OR to_regclass('public.final_request_revision_sources') IS NULL
    OR to_regclass('public.final_request_source_versions') IS NULL
    OR to_regclass('public.final_request_review_events') IS NULL
    OR to_regclass('public.final_request_reviewer_grants') IS NULL
    OR to_regprocedure('public.frs_hash(jsonb)') IS NULL
    OR to_regprocedure('public.frs_keys(jsonb,text[],text[])') IS NULL
    OR to_regprocedure('public.frs_text(jsonb,integer)') IS NULL
    OR to_regprocedure('public.frs_instant(text)') IS NULL
    OR to_regprocedure('public.frs_value(text,jsonb)') IS NULL
    OR to_regprocedure('public.frs_target(jsonb)') IS NULL
    OR to_regprocedure('public.frs_assertions_valid(jsonb)') IS NULL
    OR to_regprocedure('public.frs_result_valid(jsonb,jsonb)') IS NULL
    OR to_regprocedure('public.frs_inventory(uuid)') IS NULL
    OR to_regprocedure('public.frs_mutate(uuid,uuid,text,text,uuid,bigint,jsonb)') IS NULL
  THEN RAISE EXCEPTION 'FRP_P1C2_BASELINE_REQUIRED'; END IF;
  -- A second application deliberately refuses rather than adopt a collided ledger.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE 'final\_request\_projection%')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'frp\_%')
  THEN RAISE EXCEPTION 'FRP_ALREADY_INSTALLED_OR_COLLISION_REVIEW_REQUIRED'; END IF;
END $guard$;

-- Structural, recursive refusal of the promotion vocabulary. A CHECK, not a
-- convention: no future writer can smuggle a mapping hint into the proof.
CREATE FUNCTION public.frp_no_promotion_key(j jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; v jsonb;
BEGIN
 IF j IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(j)='object' THEN
  FOR k IN SELECT jsonb_object_keys(j) LOOP
   IF lower(replace(k,'_','')) IN ('targetfactkey','factkey','readytoprice','pricingallowed') THEN RETURN false; END IF;
   IF NOT public.frp_no_promotion_key(j->k) THEN RETURN false; END IF;
  END LOOP;
 ELSIF jsonb_typeof(j)='array' THEN
  FOR v IN SELECT value FROM jsonb_array_elements(j) LOOP
   IF NOT public.frp_no_promotion_key(v) THEN RETURN false; END IF;
  END LOOP;
 END IF;
 RETURN true;
END $$;

CREATE TABLE public.final_request_projection_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 128),
  action text NOT NULL CHECK(action IN ('project','revoke')),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'
    AND response->'pricingAuthorized'='false'::jsonb
    AND public.frp_no_promotion_key(response)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(case_id,id), UNIQUE(case_id,request_key)
);

-- One append-only chain per dossier. The tip is max(version_number); it holds an
-- artifact only while its state is 'active'. A revocation is version N+1 whose
-- payload MIRRORS version N exactly (see frp_chain_guard) so the chain can never
-- be used to quietly rewrite what was once proven.
CREATE TABLE public.final_request_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE RESTRICT,
  version_number bigint NOT NULL CHECK(version_number BETWEEN 1 AND 9007199254740991),
  previous_id uuid,
  state text NOT NULL CHECK(state IN ('active','revoked')),
  revision_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  review_event_id uuid NOT NULL,
  command_id uuid NOT NULL,
  head_generation bigint NOT NULL CHECK(head_generation BETWEEN 1 AND 9007199254740991),
  inventory_hash text NOT NULL CHECK(inventory_hash ~ '^[0-9a-f]{64}$'),
  input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
  result_hash text NOT NULL CHECK(result_hash ~ '^[0-9a-f]{64}$'),
  artifact jsonb NOT NULL CHECK(jsonb_typeof(artifact)='object'
    AND artifact->'schemaVersion'='1'::jsonb
    AND artifact->'kind'='"evidence_only"'::jsonb
    AND artifact->'pricingAuthorized'='false'::jsonb
    AND jsonb_typeof(artifact->'evidence')='array'
    AND jsonb_array_length(artifact->'evidence') BETWEEN 1 AND 3000
    AND public.frp_no_promotion_key(artifact)),
  artifact_hash text NOT NULL CHECK(artifact_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(previous_id IS DISTINCT FROM id),
  CHECK((version_number=1)=(previous_id IS NULL)),
  -- Version 1 can never be a revocation: there would be nothing to revoke.
  CHECK(version_number>1 OR state='active'),
  CHECK(public.frs_hash(artifact)=artifact_hash),
  CHECK(artifact->>'caseId'=case_id::text AND artifact->>'revisionId'=revision_id::text
    AND artifact->>'captureId'=capture_id::text AND artifact->>'reviewEventId'=review_event_id::text
    AND artifact->>'headGeneration'=head_generation::text
    AND artifact->>'inventoryHash'=inventory_hash AND artifact->>'inputHash'=input_hash
    AND artifact->>'resultHash'=result_hash),
  UNIQUE(case_id,id), UNIQUE(case_id,version_number), UNIQUE(previous_id),
  FOREIGN KEY(case_id,previous_id) REFERENCES public.final_request_projections(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,revision_id) REFERENCES public.final_request_revisions(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,capture_id) REFERENCES public.final_request_commands(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,review_event_id) REFERENCES public.final_request_review_events(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,command_id) REFERENCES public.final_request_projection_commands(case_id,id) ON DELETE RESTRICT
);
-- `state` describes an append-only chain EVENT, not mutable row state. The
-- current state is therefore the chain tip; an older `active` event remains
-- immutable after a `revoked` event. Never use a partial unique index on the
-- historical rows to infer liveness: it would keep the old event "active" and
-- incorrectly prevent a later, explicitly reviewed re-projection.
CREATE INDEX final_request_projections_revision_idx
  ON public.final_request_projections(case_id,revision_id,version_number DESC);
CREATE INDEX final_request_projections_tip_idx
  ON public.final_request_projections(case_id,version_number DESC);

CREATE FUNCTION public.frp_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FRP_APPEND_ONLY' USING ERRCODE='42501'; END $$;

CREATE FUNCTION public.frp_chain_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.final_request_projections%ROWTYPE;
BEGIN
 IF NEW.previous_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.final_request_projections WHERE case_id=NEW.case_id)
  THEN RAISE EXCEPTION 'FRP_PROJECTION_CHAIN' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO p FROM public.final_request_projections WHERE case_id=NEW.case_id AND id=NEW.previous_id;
 IF NOT FOUND OR p.version_number+1<>NEW.version_number
 THEN RAISE EXCEPTION 'FRP_PROJECTION_CHAIN' USING ERRCODE='23514'; END IF;
 IF NEW.state='revoked' THEN
  IF p.state<>'active' OR NEW.revision_id<>p.revision_id OR NEW.capture_id<>p.capture_id
   OR NEW.review_event_id<>p.review_event_id OR NEW.head_generation<>p.head_generation
   OR NEW.inventory_hash<>p.inventory_hash OR NEW.input_hash<>p.input_hash
   OR NEW.result_hash<>p.result_hash OR NEW.artifact_hash<>p.artifact_hash OR NEW.artifact<>p.artifact
  THEN RAISE EXCEPTION 'FRP_REVOCATION_MUST_MIRROR' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER final_request_projection_chain BEFORE INSERT ON public.final_request_projections
  FOR EACH ROW EXECUTE FUNCTION public.frp_chain_guard();

-- Server-side derivation. Every value in the returned artifact is read from a
-- P1-C2 row; nothing is accepted from a caller. Any doubt raises instead of
-- degrading: an unprojectable revision has no partial artifact.
CREATE FUNCTION public.frp_build_artifact(p_case uuid,p_capture uuid,p_revision uuid,p_head_generation bigint,p_inventory_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE r public.final_request_revisions%ROWTYPE; reviewed public.final_request_review_events%ROWTYPE;
 decision public.final_request_review_events%ROWTYPE;
 v jsonb; a jsonb; s jsonb; grp jsonb; f text; evidence jsonb:='[]';
BEGIN
 SELECT * INTO r FROM public.final_request_revisions WHERE case_id=p_case AND id=p_revision;
 IF NOT FOUND OR r.capture_id<>p_capture THEN RAISE EXCEPTION 'FRP_REVISION_REQUIRED' USING ERRCODE='22023'; END IF;
 IF r.limitations<>'[]'::jsonb THEN RAISE EXCEPTION 'FRP_LIMITATIONS_PRESENT' USING ERRCODE='23514'; END IF;
 -- The ledger is append-only, but the proof re-derives its fingerprints instead
 -- of trusting the stored columns: a hash nobody recomputes is not evidence.
 IF public.frs_hash(r.input)<>r.input_hash OR public.frs_hash(r.raw_result)<>r.result_hash
 THEN RAISE EXCEPTION 'FRP_LEDGER_HASH_MISMATCH' USING ERRCODE='23514'; END IF;
 IF NOT public.frs_assertions_valid(r.input) OR NOT public.frs_result_valid(r.raw_result,r.input)
 THEN RAISE EXCEPTION 'FRP_CALCULATION_CONTRACT' USING ERRCODE='23514'; END IF;
 IF r.raw_result->>'kind'<>'consistent' OR r.raw_result#>>'{requestStatus,state}'<>'open'
 THEN RAISE EXCEPTION 'FRP_RESULT_NOT_PROJECTABLE' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(r.raw_result->'quoteResponses')<>'array' OR jsonb_array_length(r.raw_result->'quoteResponses')<>0
 THEN RAISE EXCEPTION 'FRP_QUOTE_RESPONSE_PRESENT' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(r.raw_result->'fields')<>'array' OR jsonb_array_length(r.raw_result->'fields')>3000
 THEN RAISE EXCEPTION 'FRP_RESULT_NOT_PROJECTABLE' USING ERRCODE='23514'; END IF;

 -- Active review of the capture. `final_request_heads.review_event_id` is NOT
 -- consulted: any non-review command resets it, so it proves nothing. The truth
 -- is the highest-generation decision on target ["capture"] for THIS revision,
 -- which a later revoke_decision correctly turns back into "not reviewed".
 SELECT * INTO reviewed FROM public.final_request_review_events
  WHERE case_id=p_case AND revision_id=r.id AND final_request_review_events.target='["capture"]'::jsonb
  ORDER BY generation DESC LIMIT 1;
 IF NOT FOUND OR reviewed.action<>'review_capture'
 THEN RAISE EXCEPTION 'FRP_CAPTURE_NOT_REVIEWED' USING ERRCODE='23514'; END IF;
 IF reviewed.needs_fact_reconciliation
 THEN RAISE EXCEPTION 'FRP_NEEDS_FACT_RECONCILIATION' USING ERRCODE='23514'; END IF;

 FOR grp IN SELECT DISTINCT public.frs_target(j) FROM jsonb_array_elements(r.raw_result->'journal') j
  WHERE j->>'outcome'='conflict' LOOP
  -- A conflict no decision can even address is fail-closed, never ignored.
  IF grp IS NULL THEN RAISE EXCEPTION 'FRP_UNRESOLVED_CONFLICT' USING ERRCODE='23514'; END IF;
  SELECT * INTO decision FROM public.final_request_review_events
   WHERE case_id=p_case AND revision_id=r.id AND final_request_review_events.target=grp
   ORDER BY generation DESC LIMIT 1;
  IF NOT FOUND OR decision.action NOT IN ('confirm_instruction','keep_protected_fact')
  THEN RAISE EXCEPTION 'FRP_UNRESOLVED_CONFLICT' USING ERRCODE='23514'; END IF;
  IF decision.needs_fact_reconciliation
  THEN RAISE EXCEPTION 'FRP_NEEDS_FACT_RECONCILIATION' USING ERRCODE='23514'; END IF;
 END LOOP;

 FOR v IN SELECT value FROM jsonb_array_elements(r.raw_result->'fields') LOOP
  f:=v->>'field';
  -- Excluded, never skipped: a lot perimeter or a service override inside the
  -- resolved request refuses the whole proof.
  IF f IS NULL OR f IN ('lot.in_scope','service.TRUCKING','service.DTHC','service.CUSTOMS_DAKAR','service.SEA_FREIGHT')
  THEN RAISE EXCEPTION 'FRP_FIELD_EXCLUDED' USING ERRCODE='23514'; END IF;
  IF f NOT IN ('cargo.description','cargo.weight_kg','cargo.volume_cbm','cargo.pieces_count','cargo.container_type',
   'routing.origin_port','routing.destination_port','routing.destination_city','routing.incoterm',
   'transport.mode','movement.direction','terminal.operation_mode')
  THEN RAISE EXCEPTION 'FRP_FIELD_UNKNOWN' USING ERRCODE='23514'; END IF;
  IF v->>'status' NOT IN ('set','removed')
  THEN RAISE EXCEPTION 'FRP_FIELD_STATUS_INVALID' USING ERRCODE='23514'; END IF;
  IF v->>'status'='set' AND NOT public.frs_value(f,v->'value')
  THEN RAISE EXCEPTION 'FRP_FIELD_VALUE_INVALID' USING ERRCODE='23514'; END IF;
  IF v->>'status'='removed' AND v ? 'value'
  THEN RAISE EXCEPTION 'FRP_FIELD_VALUE_INVALID' USING ERRCODE='23514'; END IF;

  SELECT value INTO a FROM jsonb_array_elements(r.input->'assertions') WHERE value->>'id'=v->>'assertionId';
  IF NOT FOUND OR a->'field' IS DISTINCT FROM v->'field'
   OR a->'scope' IS DISTINCT FROM v->'scope'
   OR (v->>'status'='set' AND (a->>'operation'<>'set' OR a->'value' IS DISTINCT FROM v->'value'))
   OR (v->>'status'='removed' AND (a->>'operation'<>'remove' OR a ? 'value'))
   OR a->'sourceId' IS DISTINCT FROM v->'sourceId' OR a->'excerpt' IS DISTINCT FROM v->'excerpt'
  THEN RAISE EXCEPTION 'FRP_ASSERTION_MISMATCH' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.raw_result->'journal') j
   WHERE j->>'assertionId'=a->>'id' AND j->>'outcome'='applied')
  THEN RAISE EXCEPTION 'FRP_ASSERTION_NOT_APPLIED' USING ERRCODE='23514'; END IF;

  SELECT value INTO s FROM jsonb_array_elements(r.input->'sources') WHERE value->>'id'=a->>'sourceId';
  IF NOT FOUND OR s->>'authorRole'<>'client' OR s->'roleVerified' IS DISTINCT FROM 'true'::jsonb
   OR s->>'contentClass'<>'current' OR NOT public.frs_instant(s->>'sentAt')
   OR v->'sentAt' IS DISTINCT FROM s->'sentAt'
  THEN RAISE EXCEPTION 'FRP_SOURCE_NOT_ATTESTED' USING ERRCODE='23514'; END IF;
  -- Same dossier, and the exact source version bound to THIS revision. The
  -- captured copy alone would not prove the persisted attestation still holds.
  IF NOT EXISTS(SELECT 1 FROM public.final_request_revision_sources rs
   JOIN public.final_request_source_versions sv ON sv.case_id=rs.case_id AND sv.id=rs.source_version_id
   WHERE rs.case_id=p_case AND rs.revision_id=r.id AND rs.source_version_id=(s->>'id')::uuid
    AND sv.attested_by IS NOT NULL AND sv.author_role='client' AND sv.content_class='current')
  THEN RAISE EXCEPTION 'FRP_SOURCE_NOT_ATTESTED' USING ERRCODE='23514'; END IF;

  evidence:=evidence||jsonb_build_array(jsonb_build_object(
   'scope',v->'scope','field',f,'status',v->>'status',
   'assertionId',v->>'assertionId','sourceId',v->>'sourceId','sentAt',v->'sentAt','excerpt',v->>'excerpt')
   ||CASE WHEN v->>'status'='set' THEN jsonb_build_object('value',v->'value') ELSE '{}'::jsonb END);
 END LOOP;
 -- An empty proof would be indistinguishable from "nothing was ever asked".
 IF jsonb_array_length(evidence)=0 THEN RAISE EXCEPTION 'FRP_NO_EVIDENCE' USING ERRCODE='23514'; END IF;

 RETURN jsonb_build_object('schemaVersion',1,'kind','evidence_only','caseId',p_case,
  'revisionId',r.id,'revisionNumber',r.version_number,'captureId',r.capture_id,
  'reviewEventId',reviewed.id,'reviewGeneration',reviewed.generation,'headGeneration',p_head_generation,
  'resolverVersion',r.resolver_version,'inventoryHash',p_inventory_hash,
  'inputHash',r.input_hash,'resultHash',r.result_hash,
  'evidence',evidence,'pricingAuthorized',false);
END $$;

-- The single write endpoint. Same per-dossier advisory lock as frs_mutate, so a
-- capture/commit/review and a projection can never interleave on one dossier.
CREATE FUNCTION public.frp_mutate(p_actor uuid,p_case uuid,p_key text,p_action text,
 p_expected_projection uuid,p_expected_revision uuid,p_expected_generation bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held public.final_request_reviewer_grants%ROWTYPE; fresh public.final_request_reviewer_grants%ROWTYPE;
 replay public.final_request_projection_commands%ROWTYPE; tip public.final_request_projections%ROWTYPE;
 head public.final_request_heads%ROWTYPE; rev public.final_request_revisions%ROWTYPE;
 cap public.final_request_commands%ROWTYPE; request jsonb; response jsonb; artifact jsonb; live_hash text;
 command_id uuid:=gen_random_uuid(); projection_id uuid:=gen_random_uuid(); version_no bigint;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor)
 THEN RAISE EXCEPTION 'FRP_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('project','revoke') OR p_case IS NULL
  OR p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 8 AND 128 OR p_key<>btrim(p_key)
  OR NOT public.frs_keys(p_payload,ARRAY['reason']) OR NOT public.frs_text(p_payload->'reason',1000)
 THEN RAISE EXCEPTION 'FRP_COMMAND_INVALID' USING ERRCODE='22023'; END IF;
 -- Producing AND revoking a proof are both reviewer acts.
 SELECT * INTO held FROM public.final_request_reviewer_grants WHERE user_id=p_actor FOR SHARE;
 IF NOT FOUND OR NOT held.active THEN RAISE EXCEPTION 'FRP_REVIEWER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.quote_cases WHERE id=p_case)
 THEN RAISE EXCEPTION 'FRP_CASE_REQUIRED' USING ERRCODE='22023'; END IF;
 -- Reviewer row lock BEFORE the dossier lock, exactly like P1-C2: a revocation
 -- must never have to wait behind a dossier lock held by the user it revokes.
 PERFORM pg_advisory_xact_lock(hashtextextended('frs:'||p_case::text,0));
 SELECT * INTO fresh FROM public.final_request_reviewer_grants WHERE user_id=p_actor;
 IF NOT FOUND OR NOT fresh.active OR fresh.generation<>held.generation
 THEN RAISE EXCEPTION 'FRP_REVIEWER_REQUIRED' USING ERRCODE='42501'; END IF;

 request:=jsonb_build_object('actor',p_actor,'action',p_action,'expectedProjection',p_expected_projection,
  'expectedRevision',p_expected_revision,'expectedGeneration',p_expected_generation,'payload',p_payload);
 SELECT * INTO replay FROM public.final_request_projection_commands WHERE case_id=p_case AND request_key=p_key;
 IF FOUND THEN
  -- Same key + different request must conflict BEFORE any row is written.
  IF replay.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'FRP_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN replay.response;
 END IF;

 SELECT * INTO tip FROM public.final_request_projections WHERE case_id=p_case ORDER BY version_number DESC LIMIT 1;
 IF tip.id IS DISTINCT FROM p_expected_projection THEN RAISE EXCEPTION 'FRP_STALE_PROJECTION' USING ERRCODE='40001'; END IF;
 version_no:=coalesce(tip.version_number,0)+1;

 IF p_action='project' THEN
  IF p_expected_revision IS NULL OR p_expected_generation IS NULL
   OR p_expected_generation NOT BETWEEN 1 AND 9007199254740991
  THEN RAISE EXCEPTION 'FRP_COMMAND_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO head FROM public.final_request_heads WHERE case_id=p_case FOR SHARE;
  IF NOT FOUND OR head.generation<>p_expected_generation OR head.revision_id IS DISTINCT FROM p_expected_revision
  THEN RAISE EXCEPTION 'FRP_STALE_HEAD' USING ERRCODE='40001'; END IF;
  IF head.revision_id IS NULL THEN RAISE EXCEPTION 'FRP_REVISION_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT * INTO rev FROM public.final_request_revisions WHERE case_id=p_case AND id=head.revision_id;
  IF NOT FOUND OR head.capture_id IS DISTINCT FROM rev.capture_id
  THEN RAISE EXCEPTION 'FRP_STALE_CAPTURE' USING ERRCODE='40001'; END IF;
  SELECT * INTO cap FROM public.final_request_commands
   WHERE case_id=p_case AND id=rev.capture_id AND action='capture';
  IF NOT FOUND THEN RAISE EXCEPTION 'FRP_STALE_CAPTURE' USING ERRCODE='40001'; END IF;
  IF cap.response#>'{capture,limitations}' IS DISTINCT FROM '[]'::jsonb
  THEN RAISE EXCEPTION 'FRP_LIMITATIONS_PRESENT' USING ERRCODE='23514'; END IF;
  -- Current PostgreSQL inventory, recomputed inside this transaction and under
  -- this lock. A browser or cached hash could not be trusted here.
  live_hash:=public.frs_hash(public.frs_inventory(p_case));
  IF live_hash IS DISTINCT FROM cap.response#>>'{capture,inventoryHash}'
  THEN RAISE EXCEPTION 'FRP_UPSTREAM_CHANGED' USING ERRCODE='40001'; END IF;
  -- One live proof per dossier, whatever its revision. Producing a second one
  -- would leave P1-C3-C choosing between two "current" proofs; the reviewer must
  -- revoke the previous artifact explicitly, and that revocation stays on record.
  IF tip.id IS NOT NULL AND tip.state='active'
  THEN RAISE EXCEPTION 'FRP_ALREADY_PROJECTED' USING ERRCODE='23505'; END IF;
  artifact:=public.frp_build_artifact(p_case,rev.capture_id,rev.id,head.generation,live_hash);
  response:=jsonb_build_object('projectionId',projection_id,'caseId',p_case,'version',version_no,
   'state','active','revisionId',rev.id,'captureId',rev.capture_id,
   'reviewEventId',artifact->>'reviewEventId','artifactHash',public.frs_hash(artifact),
   'artifact',artifact,'pricingAuthorized',false);
 ELSE
  -- Revocation is deliberately independent of the P1-C2 head: a proof must stay
  -- revocable even after the dossier moved on. Its CAS is the projection tip.
  IF p_expected_revision IS NOT NULL OR p_expected_generation IS NOT NULL
  THEN RAISE EXCEPTION 'FRP_COMMAND_INVALID' USING ERRCODE='22023'; END IF;
  IF tip.id IS NULL OR tip.state<>'active' THEN RAISE EXCEPTION 'FRP_NOTHING_TO_REVOKE' USING ERRCODE='23514'; END IF;
  artifact:=tip.artifact;
  response:=jsonb_build_object('projectionId',projection_id,'caseId',p_case,'version',version_no,
   'state','revoked','revokedProjectionId',tip.id,'revisionId',tip.revision_id,'captureId',tip.capture_id,
   'reviewEventId',tip.review_event_id,'artifactHash',tip.artifact_hash,
   'artifact',artifact,'pricingAuthorized',false);
 END IF;

 INSERT INTO public.final_request_projection_commands(id,case_id,actor_id,request_key,action,request,fingerprint,response)
 VALUES(command_id,p_case,p_actor,p_key,p_action,request,public.frs_hash(request),response);
 INSERT INTO public.final_request_projections(id,case_id,version_number,previous_id,state,revision_id,capture_id,
  review_event_id,command_id,head_generation,inventory_hash,input_hash,result_hash,artifact,artifact_hash,created_by)
 VALUES(projection_id,p_case,version_no,tip.id,
  CASE WHEN p_action='project' THEN 'active' ELSE 'revoked' END,
  (artifact->>'revisionId')::uuid,(artifact->>'captureId')::uuid,(artifact->>'reviewEventId')::uuid,
  command_id,(artifact->>'headGeneration')::bigint,artifact->>'inventoryHash',
  artifact->>'inputHash',artifact->>'resultHash',artifact,public.frs_hash(artifact),p_actor);
 RETURN response;
END $$;

-- Reviewer-only read. Same habilitation as the write path, and the answer can
-- never carry an authorization: pricingAuthorized is a literal false.
CREATE FUNCTION public.frp_read(p_actor uuid,p_case uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.final_request_reviewer_grants%ROWTYPE; tip public.final_request_projections%ROWTYPE; hist jsonb;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor)
 THEN RAISE EXCEPTION 'FRP_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO g FROM public.final_request_reviewer_grants WHERE user_id=p_actor;
 IF NOT FOUND OR NOT g.active THEN RAISE EXCEPTION 'FRP_REVIEWER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.quote_cases WHERE id=p_case)
 THEN RAISE EXCEPTION 'FRP_CASE_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT * INTO tip FROM public.final_request_projections WHERE case_id=p_case ORDER BY version_number DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(m ORDER BY (m->>'version')::bigint DESC),'[]'::jsonb) INTO hist FROM (
  SELECT jsonb_build_object('id',id,'version',version_number,'state',state,'revisionId',revision_id,
   'artifactHash',artifact_hash,'createdAt',created_at) m
  FROM public.final_request_projections WHERE case_id=p_case ORDER BY version_number DESC LIMIT 100) x;
 RETURN jsonb_build_object('caseId',p_case,
  'projection',CASE WHEN tip.id IS NULL THEN NULL ELSE jsonb_build_object('id',tip.id,'version',tip.version_number,
   'state',tip.state,'revisionId',tip.revision_id,'captureId',tip.capture_id,'reviewEventId',tip.review_event_id,
   'headGeneration',tip.head_generation,'inventoryHash',tip.inventory_hash,'inputHash',tip.input_hash,
   'resultHash',tip.result_hash,'artifactHash',tip.artifact_hash,'artifact',tip.artifact,'createdAt',tip.created_at) END,
  'history',hist,
  'historyTruncated',(SELECT count(*)>100 FROM public.final_request_projections WHERE case_id=p_case),
  'pricingAuthorized',false);
END $$;

-- Deny-all, including service_role, which holds BYPASSRLS in Supabase: the ACL
-- is the real gate and RLS is the second lock, never the only one.
DO $security$
DECLARE obj record;
BEGIN
 FOR obj IN SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'final\_request\_projection%' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',obj.relname);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',obj.relname);
  EXECUTE format('CREATE TRIGGER frp_no_rewrite BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.frp_immutable()',obj.relname);
  EXECUTE format('CREATE TRIGGER frp_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.frp_immutable()',obj.relname);
 END LOOP;
 FOR obj IN SELECT p.oid::regprocedure signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'frp\_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',obj.signature);
 END LOOP;
END $security$;
GRANT EXECUTE ON FUNCTION public.frp_mutate(uuid,uuid,text,text,uuid,uuid,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.frp_read(uuid,uuid) TO service_role;

DO $verify$
DECLARE obj record; forbidden text; exposed text[]:=ARRAY['frp_mutate','frp_read'];
BEGIN
 FOR obj IN SELECT c.oid,c.relname,c.relrowsecurity FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'final\_request\_projection%' LOOP
  IF NOT obj.relrowsecurity THEN RAISE EXCEPTION 'FRP_RLS_MISSING:%',obj.relname; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=obj.oid) THEN RAISE EXCEPTION 'FRP_POLICY_PRESENT:%',obj.relname; END IF;
  IF has_table_privilege('anon',obj.oid,'SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('authenticated',obj.oid,'SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('service_role',obj.oid,'SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'FRP_TABLE_PRIVILEGE_DRIFT:%',obj.relname; END IF;
 END LOOP;
 FOR obj IN SELECT p.oid,p.proname,p.prosecdef,p.proconfig,p.prosrc FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'frp\_%' LOOP
  IF NOT obj.proconfig @> ARRAY['search_path=pg_catalog'] THEN RAISE EXCEPTION 'FRP_SEARCH_PATH_LOST:%',obj.proname; END IF;
  IF obj.prosecdef <> (obj.proname=ANY(exposed)) THEN RAISE EXCEPTION 'FRP_SECURITY_DEFINER_DRIFT:%',obj.proname; END IF;
  IF has_function_privilege('anon',obj.oid,'EXECUTE') OR has_function_privilege('authenticated',obj.oid,'EXECUTE')
  THEN RAISE EXCEPTION 'FRP_USER_RPC_ESCAPE:%',obj.proname; END IF;
  IF has_function_privilege('service_role',obj.oid,'EXECUTE') <> (obj.proname=ANY(exposed))
  THEN RAISE EXCEPTION 'FRP_SERVICE_PRIVILEGE_DRIFT:%',obj.proname; END IF;
  -- Static proof of the write perimeter: no frp_ routine may mutate a P1-C2
  -- head, a fact, a lot, a request line, a gap, a pricing run or a quotation.
  FOREACH forbidden IN ARRAY ARRAY['quote_facts','cargo_lines','cargo_equipment','quote_request_lines',
   'request_lines','case_service_overrides','gaps','pricing_runs','quotation_versions',
   'final_request_heads','final_request_commands','final_request_revisions','final_request_review_events',
   'final_request_source_versions','final_request_revision_sources','final_request_reviewer_grants'] LOOP
   IF obj.prosrc ~* ('(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+public\.'||forbidden)
   THEN RAISE EXCEPTION 'FRP_WRITE_PERIMETER_BREACH:%:%',obj.proname,forbidden; END IF;
  END LOOP;
  -- frp_no_promotion_key is the one routine allowed to NAME the vocabulary: it
  -- is the guard that refuses it. Every other routine must not mention it.
  IF obj.proname<>'frp_no_promotion_key' AND obj.prosrc ~* 'target_fact_key|targetfactkey'
  THEN RAISE EXCEPTION 'FRP_PROMOTION_VOCABULARY:%',obj.proname; END IF;
 END LOOP;
END $verify$;
COMMIT;