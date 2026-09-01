-- P1-C2-H1 LOCAL candidate. Strictly additive hardening of the P1-C2-A ledger.
-- No new table, endpoint, grant, fact, pricing projection or quotation write.
-- Problem solved: frs_inventory legitimately lists attachments and documents, but
-- frs_build_capture stamped SOURCE_TRUNCATED on EVERY non-email source, and
-- review_capture refuses any limitation. A capture containing one attachment or one
-- document was therefore structurally impossible to review, forever.
-- Doctrine: SOURCE_TRUNCATED is never removed nor globally relaxed. A non-email
-- source only becomes complete through an explicit human attestation by a
-- habilitated P1-C2 reviewer, who states that the ORIGINAL document was consulted
-- and that the captured text carries the useful instructions in full.
-- Closed value: complete | partial. 'complete' is never deduced: a legacy NULL and
-- an explicit 'partial' both stay fail-closed, exactly like today.
-- Emails keep their historical captureMode='full_sanitized' rule untouched; the new
-- attribute is REFUSED on an email attestation so it can never become an implicit
-- email bypass, and the storage CHECK enforces that independently of any function.
-- Empty text, >10000 characters, unknown date, unattested source and unknown role
-- keep their own limitations: this migration removes exactly one systematic cause.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'FRS_MIGRATION_OWNER_REQUIRED'; END IF;
  IF to_regclass('public.final_request_source_versions') IS NULL
    OR to_regprocedure('public.frs_build_capture(uuid,uuid,uuid,uuid,bigint,jsonb)') IS NULL
    OR to_regprocedure('public.frs_mutate(uuid,uuid,text,text,uuid,bigint,jsonb)') IS NULL
  THEN RAISE EXCEPTION 'FRS_P1C2A_BASELINE_REQUIRED'; END IF;
  -- Never silently adopt a pre-existing completeness attribute of unknown semantics.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.final_request_source_versions'::regclass AND attname='completeness' AND NOT attisdropped)
  THEN RAISE EXCEPTION 'FRS_COMPLETENESS_ALREADY_INSTALLED_REVIEW_REQUIRED'; END IF;
END $guard$;

-- Nullable on purpose: every row captured before this migration keeps NULL and stays
-- fail-closed. Append-only is preserved; no historical row is rewritten here.
ALTER TABLE public.final_request_source_versions ADD COLUMN completeness text;
ALTER TABLE public.final_request_source_versions
  ADD CONSTRAINT final_request_source_versions_completeness_check
  CHECK(completeness IS NULL OR (completeness IN ('complete','partial')
    AND origin_kind<>'email' AND attested_by IS NOT NULL));

-- Surgical replacement. Identical to P1-C2-A except the non-email truncation rule,
-- which now honours an explicit human completeness attestation. Signature, volatility,
-- search_path and every other limitation are unchanged.
CREATE OR REPLACE FUNCTION public.frs_build_capture(p_actor uuid,p_case uuid,p_capture uuid,p_head uuid,p_generation bigint,p_inventory jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE raw jsonb; sv public.final_request_source_versions%ROWTYPE; h text; text_value text; source_inputs jsonb:='[]';
 lots jsonb:='[]'; quotes jsonb:='[]'; protected jsonb:='[]'; limits jsonb:='[]'; f text; val jsonb; n integer; fid text;
BEGIN
 IF p_inventory IS NULL OR jsonb_array_length(p_inventory->'sources')>500
  OR jsonb_array_length(p_inventory->'cargoLines')+jsonb_array_length(p_inventory->'requestLines')>200
  OR jsonb_array_length(p_inventory->'quotations')>200 OR jsonb_array_length(p_inventory->'protectedFacts')>500
  OR length(p_inventory::text)>4000000 THEN RAISE EXCEPTION 'FRS_INVENTORY_LIMIT' USING ERRCODE='22023'; END IF;
 FOR raw IN SELECT value FROM jsonb_array_elements(p_inventory->'sources') LOOP
  h:=public.frs_hash(raw);
  SELECT * INTO sv FROM public.final_request_source_versions WHERE case_id=p_case AND origin_kind=raw->>'kind' AND origin_id=(raw->>'id')::uuid ORDER BY version_number DESC LIMIT 1;
  IF NOT FOUND OR sv.source_hash<>h THEN
   INSERT INTO public.final_request_source_versions(case_id,origin_kind,origin_id,version_number,previous_id,source_data,source_hash,sent_at,created_by)
    VALUES(p_case,raw->>'kind',(raw->>'id')::uuid,coalesce(sv.version_number,0)+1,sv.id,raw,h,(raw->>'sentAt')::timestamptz,p_actor) RETURNING * INTO sv;
  END IF;
  text_value:=coalesce(raw->>'text','');
  -- Conservative 10k PostgreSQL characters <=20k UTF-16 code units, including astral Unicode.
  IF length(text_value)>10000 THEN limits:=limits||jsonb_build_array('SOURCE_TRUNCATED:'||sv.id); END IF;
  IF raw->>'kind'='email' AND raw->>'captureMode' IS DISTINCT FROM 'full_sanitized' THEN limits:=limits||jsonb_build_array('SOURCE_TRUNCATED:'||sv.id); END IF;
  -- An attachment/document extraction is presumed partial. Only the human attestation
  -- stored on THIS exact source version lifts the presumption; any upstream content
  -- change creates a new version with completeness NULL and blocks again.
  IF raw->>'kind'<>'email' AND sv.completeness IS DISTINCT FROM 'complete' THEN limits:=limits||jsonb_build_array('SOURCE_TRUNCATED:'||sv.id); END IF;
  IF btrim(text_value)='' THEN limits:=limits||jsonb_build_array('SOURCE_EMPTY:'||sv.id); END IF;
  IF sv.attested_by IS NULL OR sv.author_role='unknown' THEN limits:=limits||jsonb_build_array('SOURCE_UNATTESTED:'||sv.id); END IF;
  -- C1 only represents millisecond precision. Preserve the original in source_data,
  -- never round two distinct instants into a false chronological winner.
  IF NOT public.frs_instant(to_jsonb(sv.sent_at)#>>'{}') THEN limits:=limits||jsonb_build_array('SOURCE_DATE_UNKNOWN:'||sv.id); END IF;
  source_inputs:=source_inputs||jsonb_build_array(jsonb_build_object('id',sv.id,'caseId',p_case,'kind',CASE WHEN sv.origin_kind='email' THEN 'email' ELSE 'document' END,
   'authorRole',sv.author_role,'roleVerified',sv.attested_by IS NOT NULL AND sv.author_role<>'unknown','contentClass',sv.content_class,
   'sentAt',CASE WHEN public.frs_instant(to_jsonb(sv.sent_at)#>>'{}') THEN sv.sent_at ELSE NULL END,'text',left(text_value,10000)));
 END LOOP;
 IF (SELECT coalesce(sum(length(value->>'text')),0) FROM jsonb_array_elements(source_inputs))>500000 THEN RAISE EXCEPTION 'FRS_INVENTORY_LIMIT' USING ERRCODE='22023'; END IF;
 FOR raw IN SELECT value FROM jsonb_array_elements(p_inventory->'cargoLines') LOOP
  lots:=lots||jsonb_build_array('cargo_line:'||(raw->>'id'));
  IF raw->>'source_quote_request_line_id' IS NOT NULL THEN limits:=limits||jsonb_build_array('LOT_MAPPING_AMBIGUOUS:'||(raw->>'id')); END IF;
  IF raw->>'status'='confirmed' THEN limits:=limits||jsonb_build_array('PROTECTED_FACT_AMBIGUOUS:'||(raw->>'id')); END IF;
 END LOOP;
 FOR raw IN SELECT value FROM jsonb_array_elements(p_inventory->'requestLines') LOOP lots:=lots||jsonb_build_array('request_line:'||(raw->>'id')); END LOOP;
 FOR raw IN SELECT value FROM jsonb_array_elements(p_inventory->'quotations') LOOP IF raw->>'sourceKind'='canonical' THEN quotes:=quotes||jsonb_build_array(raw->>'id'); END IF; END LOOP;
 FOR raw IN SELECT value FROM jsonb_array_elements(p_inventory->'protectedFacts') LOOP
  fid:=raw->>'id'; f:=CASE raw->>'key' WHEN 'routing.transport_mode' THEN 'transport.mode' WHEN 'routing.terminal_operation_mode' THEN 'terminal.operation_mode' ELSE raw->>'key' END;
  n:=0; val:=NULL;
  IF raw->'text' IS DISTINCT FROM 'null'::jsonb THEN n:=n+1; val:=raw->'text'; END IF;
  IF raw->'number' IS DISTINCT FROM 'null'::jsonb THEN n:=n+1; val:=raw->'number'; END IF;
  IF raw->'json' IS DISTINCT FROM 'null'::jsonb THEN n:=n+1; val:=raw->'json'; END IF;
  IF raw->'date' IS DISTINCT FROM 'null'::jsonb THEN n:=n+1; val:=raw->'date'; END IF;
  IF n<>1 OR raw->>'validatedBy' IS NULL OR (raw->>'validated') IS DISTINCT FROM 'true' THEN
   limits:=limits||jsonb_build_array('PROTECTED_FACT_AMBIGUOUS:'||fid); CONTINUE;
  END IF;
  IF f='lot.in_scope' OR NOT public.frs_value(f,val) THEN limits:=limits||jsonb_build_array('PROTECTED_FACT_UNMAPPED:'||fid); CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(protected) p WHERE p->>'field'=f) THEN limits:=limits||jsonb_build_array('PROTECTED_FACT_AMBIGUOUS:'||fid); CONTINUE; END IF;
  protected:=protected||jsonb_build_array(jsonb_build_object('scope','case','field',f,'value',val,'reference',fid,'validatedBy',raw->>'validatedBy'));
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) INTO limits FROM (SELECT DISTINCT value x FROM jsonb_array_elements(limits)) d;
 RETURN jsonb_build_object('schemaVersion',1,'captureId',p_capture,'caseId',p_case,'headRevisionId',p_head,'generation',p_generation,
  'inventoryHash',public.frs_hash(p_inventory),'resolverVersion','p1c1-adfe04101c18aa63a6f2c5df3d79a5b44575a41cd0fa66ab0ba3c3012268fb0c',
  'baseInput',jsonb_build_object('caseId',p_case,'lotIds',lots,'quotationVersionIds',quotes,'sources',source_inputs,'protectedFacts',protected),'limitations',limits);
END $$;

-- Surgical replacement. Identical to P1-C2-A except the attest_source branch, which
-- now demands an explicit completeness for a non-email source and refuses the field
-- entirely on an email. Idempotency replay, advisory lock, head CAS, append-only
-- ledger writes and every existing response shape are byte-identical.
CREATE OR REPLACE FUNCTION public.frs_mutate(p_actor uuid,p_case uuid,p_key text,p_action text,p_expected_revision uuid,p_expected_generation bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE grant_row public.final_request_reviewer_grants%ROWTYPE; head public.final_request_heads%ROWTYPE;
 replay public.final_request_commands%ROWTYPE; cap_cmd public.final_request_commands%ROWTYPE; prior public.final_request_source_versions%ROWTYPE;
 request jsonb; response jsonb; inventory jsonb; cap jsonb; raw jsonb; h text; source_id uuid; sent timestamptz;
 command_id uuid:=gen_random_uuid(); v_revision_id uuid; revision_no bigint; next_gen bigint; input jsonb; result jsonb;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor) THEN RAISE EXCEPTION 'FRS_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('capture','attest_source','commit','review') OR p_case IS NULL
  OR p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 8 AND 128 OR p_key<>btrim(p_key)
  OR p_expected_generation IS NULL OR p_expected_generation NOT BETWEEN 0 AND 9007199254740990
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR length(p_payload::text)>8000000
 THEN RAISE EXCEPTION 'FRS_COMMAND_INVALID' USING ERRCODE='22023'; END IF;
 IF p_action IN ('attest_source','review') THEN
  SELECT * INTO grant_row FROM public.final_request_reviewer_grants WHERE user_id=p_actor FOR SHARE;
  IF NOT FOUND OR NOT grant_row.active THEN RAISE EXCEPTION 'FRS_REVIEWER_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.quote_cases WHERE id=p_case) THEN RAISE EXCEPTION 'FRS_CASE_REQUIRED' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('frs:'||p_case::text,0));
 request:=jsonb_build_object('actor',p_actor,'action',p_action,'expectedRevision',p_expected_revision,'expectedGeneration',p_expected_generation,'payload',p_payload);
 SELECT * INTO replay FROM public.final_request_commands WHERE case_id=p_case AND request_key=p_key;
 IF FOUND THEN
  IF replay.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'FRS_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN replay.response;
 END IF;
 INSERT INTO public.final_request_heads(case_id) VALUES(p_case) ON CONFLICT(case_id) DO NOTHING;
 SELECT * INTO head FROM public.final_request_heads WHERE case_id=p_case FOR UPDATE;
 IF head.generation<>p_expected_generation OR head.revision_id IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'FRS_STALE_HEAD' USING ERRCODE='40001'; END IF;
 next_gen:=head.generation+1;
 inventory:=public.frs_inventory(p_case);
 IF p_action='capture' THEN
  IF NOT public.frs_keys(p_payload,'{}') THEN RAISE EXCEPTION 'FRS_CAPTURE_PAYLOAD' USING ERRCODE='22023'; END IF;
  cap:=public.frs_build_capture(p_actor,p_case,command_id,head.revision_id,next_gen,inventory);
  -- The source hash is PostgreSQL-jsonb specific (`1` and `1.0` intentionally
  -- differ in this contract). Expose only bounded attestation references so a
  -- trusted Edge can bind a human attestation to the exact captured source;
  -- never ask TypeScript or the browser to approximate `frs_hash`.
  response:=jsonb_build_object(
   'capture',cap,
   'inventory',inventory,
   'sourceAttestationRefs',(
    SELECT coalesce(jsonb_agg(jsonb_build_object(
     'originKind',s.value->>'kind',
     'originId',s.value->>'id',
     'sourceHash',public.frs_hash(s.value)
    ) ORDER BY s.value->>'kind',s.value->>'id'),'[]'::jsonb)
    FROM jsonb_array_elements(inventory->'sources') s(value)
   ),
   'generation',next_gen,'revisionId',head.revision_id,'pricingAuthorized',false
  );
 ELSIF p_action='attest_source' THEN
  IF NOT public.frs_keys(p_payload,ARRAY['originKind','originId','expectedSourceHash','authorRole','contentClass','reason'],ARRAY['sentAt','completeness'])
   OR coalesce(p_payload->>'originKind','') NOT IN ('email','attachment','document')
   OR coalesce(p_payload->>'authorRole','') NOT IN ('client','operator','partner','unknown')
   OR coalesce(p_payload->>'contentClass','') NOT IN ('current','quoted','historical','hypothesis')
   OR NOT public.frs_text(p_payload->'reason',1000) THEN RAISE EXCEPTION 'FRS_ATTESTATION_INVALID' USING ERRCODE='22023'; END IF;
  -- An email never carries this attribute: its completeness contract stays
  -- captureMode='full_sanitized', decided upstream, never by a human here.
  -- A non-email source must state complete or partial; nothing is deduced.
  IF p_payload->>'originKind'='email' THEN
   IF p_payload ? 'completeness' THEN RAISE EXCEPTION 'FRS_ATTESTATION_INVALID' USING ERRCODE='22023'; END IF;
  ELSIF coalesce(p_payload->>'completeness','') NOT IN ('complete','partial')
  THEN RAISE EXCEPTION 'FRS_ATTESTATION_INVALID' USING ERRCODE='22023'; END IF;
  SELECT value INTO raw FROM jsonb_array_elements(inventory->'sources') WHERE value->>'kind'=p_payload->>'originKind' AND value->>'id'=p_payload->>'originId';
  IF NOT FOUND THEN RAISE EXCEPTION 'FRS_SOURCE_NOT_IN_CASE' USING ERRCODE='23514'; END IF;
  h:=public.frs_hash(raw);
  IF h IS DISTINCT FROM p_payload->>'expectedSourceHash' THEN RAISE EXCEPTION 'FRS_STALE_SOURCE' USING ERRCODE='40001'; END IF;
  IF p_payload ? 'sentAt' THEN
   IF p_payload->'sentAt'<>'null'::jsonb AND (jsonb_typeof(p_payload->'sentAt')<>'string' OR NOT public.frs_instant(p_payload->>'sentAt'))
   THEN RAISE EXCEPTION 'FRS_ATTESTED_DATE_INVALID' USING ERRCODE='22023'; END IF;
   sent:=(p_payload->>'sentAt')::timestamptz;
  ELSE sent:=(raw->>'sentAt')::timestamptz; END IF;
  SELECT * INTO prior FROM public.final_request_source_versions WHERE case_id=p_case AND origin_kind=raw->>'kind' AND origin_id=(raw->>'id')::uuid ORDER BY version_number DESC LIMIT 1;
  INSERT INTO public.final_request_source_versions(case_id,origin_kind,origin_id,version_number,previous_id,source_data,source_hash,author_role,content_class,sent_at,attested_by,reason,created_by,completeness)
  VALUES(p_case,raw->>'kind',(raw->>'id')::uuid,coalesce(prior.version_number,0)+1,prior.id,raw,h,p_payload->>'authorRole',p_payload->>'contentClass',sent,p_actor,p_payload->>'reason',p_actor,
   CASE WHEN raw->>'kind'='email' THEN NULL ELSE p_payload->>'completeness' END) RETURNING id INTO source_id;
  response:=jsonb_build_object('sourceVersionId',source_id,'generation',next_gen,'revisionId',head.revision_id,'pricingAuthorized',false);
 ELSIF p_action='commit' THEN
  IF NOT public.frs_keys(p_payload,ARRAY['captureId','assertions','result','resolverVersion']) THEN RAISE EXCEPTION 'FRS_COMMIT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO cap_cmd FROM public.final_request_commands WHERE case_id=p_case AND id=(p_payload->>'captureId')::uuid AND action='capture';
  IF NOT FOUND OR head.capture_id IS DISTINCT FROM cap_cmd.id THEN RAISE EXCEPTION 'FRS_STALE_CAPTURE' USING ERRCODE='40001'; END IF;
  cap:=cap_cmd.response->'capture';
  IF public.frs_hash(inventory) IS DISTINCT FROM cap->>'inventoryHash' THEN RAISE EXCEPTION 'FRS_UPSTREAM_CHANGED' USING ERRCODE='40001'; END IF;
  IF p_payload->'resolverVersion' IS DISTINCT FROM cap->'resolverVersion' THEN RAISE EXCEPTION 'FRS_RESOLVER_VERSION' USING ERRCODE='22023'; END IF;
  input:=cap->'baseInput'||jsonb_build_object('assertions',p_payload->'assertions'); result:=p_payload->'result';
  IF NOT public.frs_assertions_valid(input) OR NOT public.frs_result_valid(result,input) THEN RAISE EXCEPTION 'FRS_CALCULATION_CONTRACT' USING ERRCODE='22023'; END IF;
  SELECT coalesce(max(version_number),0)+1 INTO revision_no FROM public.final_request_revisions WHERE case_id=p_case;
  INSERT INTO public.final_request_revisions(case_id,version_number,parent_id,capture_id,resolver_version,input,raw_result,input_hash,result_hash,limitations,created_by)
  VALUES(p_case,revision_no,head.revision_id,cap_cmd.id,cap->>'resolverVersion',input,result,public.frs_hash(input),public.frs_hash(result),cap->'limitations',p_actor) RETURNING id INTO v_revision_id;
  INSERT INTO public.final_request_revision_sources(case_id,revision_id,source_version_id)
   SELECT p_case,v_revision_id,(value->>'id')::uuid FROM jsonb_array_elements(input->'sources');
  response:=jsonb_build_object('revisionId',v_revision_id,'generation',next_gen,'reviewState','pending','pricingAuthorized',false);
 ELSE
  SELECT c.* INTO cap_cmd FROM public.final_request_revisions r JOIN public.final_request_commands c ON c.id=r.capture_id AND c.case_id=r.case_id WHERE r.id=head.revision_id AND r.case_id=p_case;
  IF NOT FOUND OR head.capture_id IS DISTINCT FROM cap_cmd.id THEN RAISE EXCEPTION 'FRS_STALE_CAPTURE' USING ERRCODE='40001'; END IF;
  IF public.frs_hash(inventory) IS DISTINCT FROM cap_cmd.response#>>'{capture,inventoryHash}' THEN RAISE EXCEPTION 'FRS_UPSTREAM_CHANGED' USING ERRCODE='40001'; END IF;
  response:=public.frs_apply_review(p_actor,p_case,head.revision_id,next_gen,p_payload)||jsonb_build_object('generation',next_gen);
 END IF;
 INSERT INTO public.final_request_commands(id,case_id,actor_id,request_key,action,request,fingerprint,response)
 VALUES(command_id,p_case,p_actor,p_key,p_action,request,public.frs_hash(request),response);
 UPDATE public.final_request_heads SET generation=next_gen,
  capture_id=CASE WHEN p_action='capture' THEN command_id WHEN p_action='attest_source' THEN NULL ELSE head.capture_id END,
  revision_id=CASE WHEN p_action='commit' THEN v_revision_id ELSE head.revision_id END,
  review_event_id=CASE WHEN p_action='review' THEN (response->>'eventId')::uuid ELSE NULL END WHERE case_id=p_case;
 RETURN response;
END $$;

-- CREATE OR REPLACE keeps the previous ACL, but the minimal-privilege contract is
-- re-affirmed explicitly rather than inherited by assumption, then asserted.
REVOKE ALL ON FUNCTION public.frs_build_capture(uuid,uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.frs_mutate(uuid,uuid,text,text,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.frs_mutate(uuid,uuid,text,text,uuid,bigint,jsonb) TO service_role;
DO $verify$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid,p.proname,p.prosecdef,p.proconfig FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('frs_build_capture','frs_mutate') LOOP
    IF NOT f.proconfig @> ARRAY['search_path=pg_catalog'] THEN RAISE EXCEPTION 'FRS_SEARCH_PATH_LOST'; END IF;
    IF f.prosecdef <> (f.proname='frs_mutate') THEN RAISE EXCEPTION 'FRS_SECURITY_DEFINER_DRIFT'; END IF;
    IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE')
    THEN RAISE EXCEPTION 'FRS_USER_RPC_ESCAPE'; END IF;
    IF has_function_privilege('service_role',f.oid,'EXECUTE') <> (f.proname='frs_mutate')
    THEN RAISE EXCEPTION 'FRS_SERVICE_PRIVILEGE_DRIFT'; END IF;
  END LOOP;
END $verify$;
COMMIT;
