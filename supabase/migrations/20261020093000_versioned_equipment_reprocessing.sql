-- Authorized technical supersession, not a client amendment or operator fact.
-- Existing receipts, manual decisions, business formulas and table policies remain intact.
BEGIN;
DO $preflight$ DECLARE signature text; BEGIN
 IF md5(replace(pg_get_functiondef('public.apply_case_email_fact_revisions(uuid,uuid,text,jsonb,jsonb)'::regprocedure),chr(13),''))<>'0360da83479e26f3f02e7572c707ac8f'
 OR md5(replace(pg_get_functiondef('public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)'::regprocedure),chr(13),''))<>'32339199c0b89d9536910f75e4641a95'
 THEN RAISE EXCEPTION 'Unexpected ordered writer baseline'; END IF;
 FOREACH signature IN ARRAY ARRAY['public.apply_case_email_fact_revisions(uuid,uuid,text,jsonb,jsonb)',
  'public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)'] LOOP
  IF has_function_privilege('anon',signature,'execute') OR has_function_privilege('authenticated',signature,'execute')
   OR NOT has_function_privilege('service_role',signature,'execute') THEN RAISE EXCEPTION 'Unexpected ordered writer grants'; END IF;
 END LOOP;
END $preflight$;

-- First registered repair is deliberately narrow: one explicit Unicode HC/HQ row.
-- Parse an immutable own-text receipt, never a value supplied by the browser.
CREATE FUNCTION public.unicode_equipment_inventory(p_excerpt text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE m text[]; result jsonb:='[]';
BEGIN
 IF p_excerpt IS NULL OR p_excerpt ~* '(^|[\r\n])[[:space:]]*(>|On .+wrote:|Le .+écrit|From:|De:)' THEN RETURN NULL; END IF;
 FOR m IN SELECT regexp_matches(p_excerpt,'(?<![[:alnum:]])([0-9]+)[[:space:]]*x?[[:space:]]*(20|40)[[:space:]]*[’‘′ʼ＇][[:space:]]*(HC|HQ)(?![[:alnum:]])','gi') LOOP
  IF length(m[1])>6 OR m[1]::integer<1 THEN RETURN NULL; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('quantity',m[1]::integer,'type',m[2]||upper(m[3])));
 END LOOP;
 IF jsonb_array_length(result)<>1 THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM regexp_matches(p_excerpt,'(?<![[:alnum:]])[0-9]+[[:space:]]*x?[[:space:]]*(20|40|45)(?![0-9])[[:space:]]*([''’‘′ʼ＇]|ft|feet|foot)?[[:space:]]*(HC|HQ|GP|DV|FR|OT|RF)?(?![[:alnum:]])','gi'))<>1
  OR (SELECT count(*) FROM regexp_matches(p_excerpt,'(?<![0-9])(20|40|45)[[:space:]]*[''’‘′ʼ＇]?[[:space:]]*(HC|HQ|GP|DV|FR|OT|RF|FT|FEET|FOOT)(?![[:alnum:]])','gi'))<>1
 THEN RETURN NULL; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.unicode_equipment_inventory(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.retired_equipment_candidate(p_fact uuid,p_candidate jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.quote_facts f JOIN public.quote_email_fact_revisions r ON r.id=f.source_revision_id
  WHERE f.id=p_fact AND f.is_current AND f.source_type='email_body'
   AND f.fact_key='cargo.containers' AND r.new_fact_id=f.id AND r.status='applied' AND r.reason='parser_correction'
   AND r.source_evidence->'processing'->>'rule'='equipment-unicode-suffix/2'
   AND f.value_json=r.source_evidence->'processing'->'new_inventory'
   AND p_candidate->>'source_type'='email_body' AND p_candidate->>'value_type'='json'
   AND p_candidate->>'evidence_error' IS NULL
   AND p_candidate->>'email_id'=r.source_evidence->'selected'->>'email_id'
   AND p_candidate->>'body_sha256'=r.source_evidence->'selected'->>'body_sha256'
   AND p_candidate->'value'=r.source_evidence->'processing'->'old_inventory'
 );
$$;
REVOKE ALL ON FUNCTION public.retired_equipment_candidate(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Keep original command replay byte-stable. Only a proven retired output can be ignored.
DO $patch$ DECLARE definition text; anchor text; replacement text; BEGIN
 definition:=replace(pg_get_functiondef('public.apply_case_email_fact_revisions(uuid,uuid,text,jsonb,jsonb)'::regprocedure),chr(13),'');
 anchor:='   -- Find a declaration whose server identity and sender date dominate every other source.';
 replacement:=E'   IF public.retired_equipment_candidate(f.id,candidate) THEN CONTINUE; END IF;\n'||anchor;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Retirement candidate anchor missing'; END IF;
 definition:=replace(definition,anchor,replacement);
 anchor:='   FOR other IN SELECT value FROM jsonb_array_elements(g->''candidates'') LOOP';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Retirement comparison anchor missing'; END IF;
 definition:=replace(definition,anchor,anchor||E'\n    IF public.retired_equipment_candidate(f.id,other) THEN CONTINUE; END IF;');
 anchor:='  IF f.id IS NOT NULL AND (f.is_validated IS TRUE OR f.source_type IN(''operator'',''manual_input'',''operator_correction'')) THEN';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Retirement protected-state anchor missing'; END IF;
 definition:=replace(definition,anchor,replace(anchor,'IF f.id','IF state IS DISTINCT FROM ''ignored'' AND f.id'));
 anchor:='  IF state IS NULL AND selected IS NULL THEN state:=''conflict''; reason:=''sources_or_values_incomparable''; END IF;';
 replacement:=E'  IF state IS NULL AND selected IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(g->''candidates'') x WHERE NOT public.retired_equipment_candidate(f.id,x)) THEN\n   state:=''ignored''; reason:=''retired_parser_output'';\n  END IF;\n'||anchor;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Retirement final anchor missing'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END $patch$;

CREATE FUNCTION public.reprocess_case_equipment(
 p_case uuid,p_actor uuid,p_command text,p_expected_fact uuid,p_expected_revision uuid,p_groups jsonb,p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.quote_cases; f public.quote_facts; att public.quote_email_fact_revisions; r public.quote_email_fact_revisions;
 source public.emails; candidate jsonb; inventory jsonb; legacy jsonb; processing jsonb; evidence jsonb; response jsonb;
 batch text; revision uuid:=gen_random_uuid(); successor uuid; conflict_ids uuid[]; saved public.quote_email_fact_revisions; previous_target text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor IS NULL THEN RAISE EXCEPTION 'Equipment reprocessing forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.quote_cases WHERE id=p_case FOR NO KEY UPDATE;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_roles a JOIN auth.users u ON u.id=a.user_id
  WHERE a.user_id=p_actor AND a.role IN('workspace_operator','role_admin') AND (u.banned_until IS NULL OR u.banned_until<=now()))
 THEN RAISE EXCEPTION 'Equipment reprocessing forbidden' USING ERRCODE='42501'; END IF;
 IF p_command IS NULL OR p_command !~ '^equipment-v2:[a-f0-9]{64}$' OR p_expected_fact IS NULL OR p_expected_revision IS NULL
  OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array' OR jsonb_array_length(p_groups)<>1
  OR p_groups->0->>'key' IS DISTINCT FROM 'cargo.containers' OR jsonb_typeof(p_groups->0->'candidates') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_groups->0->'candidates') NOT BETWEEN 1 AND 128 OR pg_column_size(p_groups)>524288
  OR jsonb_typeof(p_manifest) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid equipment command' USING ERRCODE='22023'; END IF;
 batch:=encode(sha256(convert_to(jsonb_build_object('groups',p_groups,'manifest',p_manifest,'fact',p_expected_fact,'revision',p_expected_revision)::text,'UTF8')),'hex');
 SELECT * INTO saved FROM public.quote_email_fact_revisions WHERE case_id=p_case AND command_key=p_command AND fact_key='cargo.containers';
 IF saved.id IS NOT NULL THEN
  IF saved.batch_hash IS DISTINCT FROM batch THEN RAISE EXCEPTION 'Equipment idempotency conflict' USING ERRCODE='23505'; END IF;
  RETURN saved.response||jsonb_build_object('replay',true,'changed',false);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_case::text||'cargo.containers'));
 SELECT * INTO f FROM public.quote_facts WHERE case_id=p_case AND fact_key='cargo.containers' AND is_current FOR UPDATE;
 IF f.id IS DISTINCT FROM p_expected_fact OR f.source_revision_id IS DISTINCT FROM p_expected_revision
  OR f.is_validated IS TRUE OR f.source_type IS DISTINCT FROM 'email_body' OR f.source_email_id IS NULL
  OR f.value_text IS NOT NULL OR f.value_number IS NOT NULL OR f.value_date IS NOT NULL
 THEN RAISE EXCEPTION 'Equipment state changed or protected' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM public.emails WHERE thread_ref=c.thread_id ORDER BY id FOR SHARE;
 IF jsonb_array_length(p_manifest)<>(SELECT count(*) FROM public.emails WHERE thread_ref=c.thread_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest) x GROUP BY x->>'id' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest) x LEFT JOIN public.emails e ON e.id::text=x->>'id'
   WHERE e.id IS NULL OR e.thread_ref IS DISTINCT FROM c.thread_id
    OR encode(sha256(convert_to(COALESCE(e.body_text,''),'UTF8')),'hex') IS DISTINCT FROM x->>'sha256'
    OR e.from_address IS DISTINCT FROM x->>'from_address' OR e.sent_at IS DISTINCT FROM (x->>'sent_at')::timestamptz)
 THEN RAISE EXCEPTION 'Equipment source collection changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO source FROM public.emails WHERE id=f.source_email_id AND thread_ref=c.thread_id;
 SELECT * INTO att FROM public.quote_email_fact_revisions
  WHERE case_id=p_case AND fact_key=f.fact_key AND new_fact_id=f.id AND status IN('applied','confirmed')
   AND source_evidence->'selected'->>'email_id'=f.source_email_id::text
   AND source_evidence->'selected'->'value'=f.value_json ORDER BY created_at LIMIT 1;
 IF att.id IS NULL OR source.id IS NULL OR att.source_evidence->'selected'->>'body_sha256'
  IS DISTINCT FROM encode(sha256(convert_to(COALESCE(source.body_text,''),'UTF8')),'hex')
 THEN RETURN jsonb_build_object('status','not_eligible','rule','equipment-unicode-suffix/2','reason','legacy_attestation_unavailable'); END IF;
 IF att.source_evidence->'selected'->>'source_type' IS DISTINCT FROM 'email_body'
  OR att.source_evidence->'selected'->>'value_type' IS DISTINCT FROM 'json'
  OR att.source_evidence->'selected'->>'evidence_error' IS NOT NULL
  OR att.source_evidence->'selected'->>'excerpt' IS DISTINCT FROM f.source_excerpt
 THEN RETURN jsonb_build_object('status','not_eligible','rule','equipment-unicode-suffix/2','reason','own_attestation_unavailable'); END IF;
 inventory:=public.unicode_equipment_inventory(att.source_evidence->'selected'->>'excerpt');
 IF inventory IS NULL THEN RETURN jsonb_build_object('status','not_eligible','rule','equipment-unicode-suffix/2','reason','defect_not_proven'); END IF;
 legacy:=jsonb_build_array(jsonb_build_object('quantity',inventory->0->'quantity','type',left(inventory->0->>'type',2)||'GP'));
 IF f.value_json IS DISTINCT FROM legacy THEN RETURN jsonb_build_object('status','not_eligible','rule','equipment-unicode-suffix/2','reason','legacy_value_mismatch'); END IF;
 FOR candidate IN SELECT value FROM jsonb_array_elements(p_groups->0->'candidates') LOOP
  IF candidate->>'email_id' IS DISTINCT FROM source.id::text
   OR candidate->>'body_sha256' IS DISTINCT FROM att.source_evidence->'selected'->>'body_sha256'
   OR candidate->>'value_type' IS DISTINCT FROM 'json' OR candidate->'value' IS DISTINCT FROM inventory
   OR candidate->>'source_type' NOT IN('email_body','ai_extraction') OR candidate->>'source_type' IS NULL
   OR candidate->>'evidence_error' IS NOT NULL
   OR public.unicode_equipment_inventory(candidate->>'excerpt') IS DISTINCT FROM inventory
  THEN RETURN jsonb_build_object('status','not_eligible','rule','equipment-unicode-suffix/2','reason','not_unique_same_source'); END IF;
 END LOOP;
 SELECT COALESCE(array_agg(x.id ORDER BY x.id),'{}') INTO conflict_ids
 FROM public.quote_email_fact_revisions x WHERE x.case_id=p_case AND x.fact_key=f.fact_key AND x.status IN('conflict','protected')
  AND NOT EXISTS(SELECT 1 FROM public.quote_email_fact_revisions y WHERE y.resolves_revision_id=x.id AND y.status='resolved');
 FOR r IN SELECT * FROM public.quote_email_fact_revisions WHERE id=ANY(conflict_ids) LOOP
  IF r.status IS DISTINCT FROM 'conflict' OR r.reason NOT IN('same_source_contradictory_values','unresolved_prior_source_conflict')
   OR r.old_fact->>'id' IS DISTINCT FROM f.id::text OR r.old_fact->'is_validated'='true'::jsonb
   OR r.old_fact->'value_json' IS DISTINCT FROM legacy
   OR r.source_evidence->'selected'->>'email_id' IS DISTINCT FROM source.id::text
   OR r.source_evidence->'selected'->>'body_sha256' IS DISTINCT FROM att.source_evidence->'selected'->>'body_sha256'
   OR r.source_evidence->'selected'->'value' IS DISTINCT FROM inventory
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.source_evidence->'candidates') x
    WHERE x->>'email_id' IS DISTINCT FROM source.id::text OR x->>'body_sha256' IS DISTINCT FROM att.source_evidence->'selected'->>'body_sha256'
     OR x->'value' IS DISTINCT FROM inventory OR x->>'evidence_error' IS NOT NULL)
  THEN RETURN jsonb_build_object('status','not_eligible','rule','equipment-unicode-suffix/2','reason','unrelated_conflict'); END IF;
 END LOOP;
 IF p_expected_revision IS DISTINCT FROM att.id AND NOT (p_expected_revision=ANY(conflict_ids))
 THEN RAISE EXCEPTION 'Equipment revision chain changed' USING ERRCODE='PT409'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_roles a JOIN auth.users u ON u.id=a.user_id WHERE a.user_id=p_actor
  AND a.role IN('workspace_operator','role_admin') AND (u.banned_until IS NULL OR u.banned_until<=now()))
 THEN RAISE EXCEPTION 'Equipment reprocessing forbidden' USING ERRCODE='42501'; END IF;
 processing:=jsonb_build_object('kind','parser_correction','rule','equipment-unicode-suffix/2','from_version','legacy-unversioned-reproduced',
  'to_version','equipment-basic/2','attestation_revision_id',att.id,'expected_revision_id',p_expected_revision,
  'resolved_revision_ids',to_jsonb(conflict_ids),'old_inventory',legacy,'new_inventory',inventory,
  'own_excerpt_sha256',encode(sha256(convert_to(att.source_evidence->'selected'->>'excerpt','UTF8')),'hex'));
 evidence:=att.source_evidence||jsonb_build_object('processing',processing,'manifest',p_manifest,'candidates',p_groups->0->'candidates',
  'selected',att.source_evidence->'selected'||jsonb_build_object('value',inventory));
 previous_target:=current_setting('dcq.email_revision_target',true);
 PERFORM set_config('dcq.email_revision_target',p_case::text||'/cargo.containers',true);
 successor:=public.supersede_fact(p_case,'cargo.containers','cargo',NULL,NULL,inventory,NULL,'email_body',source.id,NULL,att.source_evidence->'selected'->>'excerpt',.95);
 response:=jsonb_build_object('key','cargo.containers','status','applied','reason','parser_correction','revision_id',revision,'fact_id',successor,'changed',true,'replay',false,'had_current',true);
 INSERT INTO public.quote_email_fact_revisions(id,case_id,fact_key,command_key,batch_hash,request,status,reason,old_fact,new_fact_id,source_evidence,response,actor_user_id)
 VALUES(revision,p_case,f.fact_key,p_command,batch,jsonb_build_object('groups',p_groups,'manifest',p_manifest,'expected_fact',p_expected_fact,'expected_revision',p_expected_revision),
  'applied','parser_correction',to_jsonb(f),successor,evidence,response,p_actor);
 UPDATE public.quote_facts SET source_revision_id=revision,is_validated=false WHERE id=successor;
 INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,actor_user_id,related_fact_id,created_at)
 VALUES(p_case,'fact_updated',jsonb_build_object('source','email-fact-revision','revision_id',revision,'fact_key',f.fact_key,'status','applied',
  'reason','parser_correction','old_fact',to_jsonb(f),'new_value',inventory,'source_evidence',evidence),'system',p_actor,successor,clock_timestamp());
 FOR r IN SELECT * FROM public.quote_email_fact_revisions WHERE id=ANY(conflict_ids) LOOP
  INSERT INTO public.quote_email_fact_revisions(case_id,fact_key,command_key,batch_hash,request,status,reason,old_fact,new_fact_id,source_evidence,response,resolves_revision_id,actor_user_id)
  VALUES(p_case,f.fact_key,'parser-resolve:'||revision::text||':'||r.id::text,batch,jsonb_build_object('repair_revision',revision),
   'resolved','parser_correction',r.old_fact,successor,evidence,response,r.id,p_actor);
  INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,actor_user_id,related_fact_id,created_at)
  VALUES(p_case,'fact_updated',jsonb_build_object('source','email-fact-revision','revision_id',r.id,'fact_key',f.fact_key,'status','resolved',
   'reason','parser_correction','old_fact',r.old_fact,'new_value',inventory,'source_evidence',evidence),'system',p_actor,successor,clock_timestamp());
 END LOOP;
 UPDATE public.quote_gaps SET status='resolved',resolved_by_fact_id=successor,resolved_at=now(),updated_at=now()
  WHERE case_id=p_case AND gap_key='source_revision.cargo.containers' AND status IN('open','pending_response');
 PERFORM set_config('dcq.email_revision_target',COALESCE(previous_target,''),true);
 RETURN response;
END; $$;
REVOKE ALL ON FUNCTION public.reprocess_case_equipment(uuid,uuid,text,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reprocess_case_equipment(uuid,uuid,text,uuid,uuid,jsonb,jsonb) TO service_role;
COMMIT;
