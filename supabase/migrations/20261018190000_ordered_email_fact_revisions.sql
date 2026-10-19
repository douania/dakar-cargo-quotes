-- Ordered, unvalidated email corrections. Historical values and quotations stay saved.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.email_imap_identities') IS NULL THEN RAISE EXCEPTION 'Server email identity prerequisite is missing'; END IF;
END $$;
CREATE TABLE public.quote_email_fact_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES public.quote_cases(id), fact_key text NOT NULL,
 command_key text NOT NULL, batch_hash text NOT NULL, request jsonb NOT NULL,
 status text NOT NULL CHECK(status IN('applied','confirmed','unchanged','ignored','conflict','protected','resolved')),
 reason text NOT NULL, old_fact jsonb, new_fact_id uuid REFERENCES public.quote_facts(id),
 source_evidence jsonb NOT NULL, response jsonb NOT NULL,
 resolves_revision_id uuid REFERENCES public.quote_email_fact_revisions(id),
 actor_user_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(case_id,command_key,fact_key)
);
ALTER TABLE public.quote_email_fact_revisions ENABLE ROW LEVEL SECURITY;
CREATE INDEX quote_email_fact_revisions_case_key ON public.quote_email_fact_revisions(case_id,fact_key,status);
CREATE INDEX quote_email_fact_revisions_resolution ON public.quote_email_fact_revisions(resolves_revision_id) WHERE resolves_revision_id IS NOT NULL;
REVOKE ALL ON public.quote_email_fact_revisions FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.quote_facts ADD COLUMN source_revision_id uuid REFERENCES public.quote_email_fact_revisions(id);

CREATE FUNCTION public.assert_case_source_revisions_resolved(p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.quote_email_fact_revisions r WHERE r.case_id=p_case AND r.status IN('conflict','protected')
  AND NOT EXISTS(SELECT 1 FROM public.quote_email_fact_revisions x WHERE x.resolves_revision_id=r.id AND x.status='resolved'))
 THEN RAISE EXCEPTION 'Conflicting source corrections require an explicit operator decision' USING ERRCODE='PT409'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.assert_case_source_revisions_resolved(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_case_source_revisions_resolved(uuid) TO service_role;

CREATE FUNCTION public.email_revision_value_key(p_type text,p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 RETURN jsonb_build_object('type',p_type,'value',CASE p_type
  WHEN 'text' THEN to_jsonb(lower(btrim(regexp_replace(p_value#>>'{}','\s+',' ','g'))))
  WHEN 'number' THEN to_jsonb((p_value#>>'{}')::numeric)
  WHEN 'date' THEN to_jsonb((p_value#>>'{}')::timestamptz)
  ELSE p_value END);
END; $$;
REVOKE ALL ON FUNCTION public.email_revision_value_key(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- A sender Date alone never orders two declarations. Both server identities and dates must agree.
CREATE FUNCTION public.email_revision_source_order(p_new uuid,p_old uuid,p_sources jsonb)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n jsonb; o jsonb; ni jsonb; oi jsonb;
BEGIN
 IF p_new IS NULL OR p_old IS NULL THEN RETURN NULL; END IF;
 IF p_new=p_old THEN RETURN 0; END IF;
 SELECT value INTO n FROM jsonb_array_elements(p_sources) WHERE value->>'id'=p_new::text;
 SELECT value INTO o FROM jsonb_array_elements(p_sources) WHERE value->>'id'=p_old::text;
 IF n IS NULL OR o IS NULL OR n->>'sent_at' IS NULL OR o->>'sent_at' IS NULL
  OR COALESCE(btrim(n->>'from_address'),'')='' OR COALESCE(btrim(o->>'from_address'),'')=''
  OR lower(btrim(n->>'from_address')) IS DISTINCT FROM lower(btrim(o->>'from_address'))
  OR jsonb_array_length(n->'imap')<>1 OR jsonb_array_length(o->'imap')<>1 THEN RETURN NULL; END IF;
 ni:=n->'imap'->0; oi:=o->'imap'->0;
 IF ni->'config_id' IS DISTINCT FROM oi->'config_id' OR ni->'account' IS DISTINCT FROM oi->'account'
  OR ni->'mailbox' IS DISTINCT FROM oi->'mailbox' OR ni->'uid_validity' IS DISTINCT FROM oi->'uid_validity' THEN RETURN NULL; END IF;
 IF (ni->>'imap_uid')::bigint>(oi->>'imap_uid')::bigint AND (n->>'sent_at')::timestamptz>(o->>'sent_at')::timestamptz THEN RETURN 1; END IF;
 IF (ni->>'imap_uid')::bigint<(oi->>'imap_uid')::bigint AND (n->>'sent_at')::timestamptz<(o->>'sent_at')::timestamptz THEN RETURN -1; END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.email_revision_source_order(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_email_revision_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Email fact revision history is append-only' USING ERRCODE='42501'; END; $$;
CREATE TRIGGER quote_email_fact_revisions_append_only BEFORE UPDATE OR DELETE ON public.quote_email_fact_revisions
 FOR EACH ROW EXECUTE FUNCTION public.guard_email_revision_history();
REVOKE ALL ON FUNCTION public.guard_email_revision_history() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_ordered_email_fact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.source_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Use the ordered fact writer' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.source_revision_id IS DISTINCT FROM NEW.source_revision_id
  AND current_setting('dcq.email_revision_target',true) IS DISTINCT FROM (OLD.case_id::text||'/'||OLD.fact_key)
 THEN RAISE EXCEPTION 'Ordered source marker cannot be changed directly' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.source_revision_id IS NOT NULL AND
  (to_jsonb(NEW)-'source_revision_id'-'is_current'-'updated_at'-'is_validated') IS DISTINCT FROM
  (to_jsonb(OLD)-'source_revision_id'-'is_current'-'updated_at'-'is_validated')
 THEN RAISE EXCEPTION 'Ordered source values require a successor' USING ERRCODE='PT409'; END IF;
 IF OLD.source_revision_id IS NOT NULL AND (TG_OP='DELETE'  OR (OLD.is_current AND NOT NEW.is_current))
  AND current_setting('dcq.fact_supersede_target',true) IS DISTINCT FROM OLD.id::text
 THEN RAISE EXCEPTION 'Ordered source fact requires an explicit or ordered successor' USING ERRCODE='PT409'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER quote_facts_ordered_source_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quote_facts
 FOR EACH ROW EXECUTE FUNCTION public.guard_ordered_email_fact();
REVOKE ALL ON FUNCTION public.guard_ordered_email_fact() FROM PUBLIC,anon,authenticated,service_role;

-- Only guards and explicit resolution are added to the verified core writer.
DO $core_patch$
DECLARE target regprocedure:='public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)'::regprocedure;
 definition text; anchor text; addition text;
BEGIN
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF md5(definition)<>'ea4b94fd48780536ebcad7bd7f685967' THEN RAISE EXCEPTION 'Unexpected supersede_fact baseline'; END IF;
 IF has_function_privilege('anon',target,'execute') OR has_function_privilege('authenticated',target,'execute')
  OR NOT has_function_privilege('service_role',target,'execute') THEN RAISE EXCEPTION 'Unexpected supersede_fact ACL'; END IF;
 definition:=replace(definition,'  old_fact_validated BOOLEAN;',E'  old_fact_validated BOOLEAN;\n  old_fact_revision UUID;\n  revision_row record;\n  prior_target text;');
 definition:=replace(definition,'SELECT id, source_type, is_validated','SELECT id, source_type, is_validated, source_revision_id');
 definition:=replace(definition,'INTO old_fact_id, old_fact_source_type, old_fact_validated','INTO old_fact_id, old_fact_source_type, old_fact_validated, old_fact_revision');
 anchor:='  IF old_fact_id IS NOT NULL THEN';
 addition:=$addition$
  -- STRUCTURAL_PATCH_ALLOWED: an old extraction cannot cancel an ordered decision.
  IF COALESCE(p_source_type,'') NOT IN ('operator','manual_input','operator_correction') AND (
    old_fact_revision IS NOT NULL OR EXISTS(SELECT 1 FROM public.quote_email_fact_revisions r
      WHERE r.case_id=p_case_id AND r.fact_key=p_fact_key AND r.status IN('conflict','protected')
      AND NOT EXISTS(SELECT 1 FROM public.quote_email_fact_revisions x WHERE x.resolves_revision_id=r.id AND x.status='resolved')))
    AND current_setting('dcq.email_revision_target',true) IS DISTINCT FROM (p_case_id::text||'/'||p_fact_key)
  THEN RAISE EXCEPTION 'Automatic source revision requires the ordered writer' USING ERRCODE='PT409'; END IF;
  prior_target:=current_setting('dcq.fact_supersede_target',true);
  PERFORM set_config('dcq.fact_supersede_target',COALESCE(old_fact_id::text,''),true);
$addition$;
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Core anchor mismatch'; END IF;
 definition:=replace(definition,anchor,addition||anchor);
 anchor:='  RETURN new_fact_id;';
 addition:=$addition$
  PERFORM set_config('dcq.fact_supersede_target',COALESCE(prior_target,''),true);
  IF p_source_type IN ('operator','manual_input','operator_correction') THEN
    FOR revision_row IN SELECT r.* FROM public.quote_email_fact_revisions r WHERE r.case_id=p_case_id AND r.fact_key=p_fact_key
      AND r.status IN('conflict','protected') AND NOT EXISTS(SELECT 1 FROM public.quote_email_fact_revisions x
        WHERE x.resolves_revision_id=r.id AND x.status='resolved') LOOP
      INSERT INTO public.quote_email_fact_revisions(case_id,fact_key,command_key,batch_hash,request,status,reason,old_fact,new_fact_id,source_evidence,response,resolves_revision_id)
      VALUES(p_case_id,p_fact_key,'manual:'||new_fact_id::text||':'||revision_row.id::text,md5(new_fact_id::text),
        jsonb_build_object('manual_fact_id',new_fact_id),'resolved','explicit_manual_successor',revision_row.old_fact,new_fact_id,
        jsonb_build_object('source_type',p_source_type,'excerpt',p_source_excerpt),jsonb_build_object('fact_id',new_fact_id),revision_row.id);
      INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,related_fact_id,created_at)
      VALUES(p_case_id,'fact_updated',jsonb_build_object('source','email-fact-revision','status','resolved',
        'revision_id',revision_row.id,'fact_key',p_fact_key,'reason','explicit_manual_successor','old_fact',revision_row.old_fact,
        'source_evidence',jsonb_build_object('manual',jsonb_build_object('source_type',p_source_type,'excerpt',p_source_excerpt,'fact_id',new_fact_id)),
        'new_value',COALESCE(to_jsonb(p_value_text),to_jsonb(p_value_number),p_value_json,to_jsonb(p_value_date))), 'system',new_fact_id,clock_timestamp());
    END LOOP;
    UPDATE public.quote_gaps SET status='resolved',resolved_by_fact_id=new_fact_id,resolved_at=now(),updated_at=now()
      WHERE case_id=p_case_id AND gap_key='source_revision.'||p_fact_key AND status IN('open','pending_response');
  END IF;
$addition$;
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Core return mismatch'; END IF;
 EXECUTE replace(definition,anchor,addition||anchor);
END $core_patch$;

CREATE FUNCTION public.apply_case_email_fact_revisions(p_case uuid,p_actor uuid,p_command text,p_groups jsonb,p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.quote_cases; f public.quote_facts; g jsonb; candidate jsonb; other jsonb; selected jsonb;
 prior public.quote_email_fact_revisions; revision_id uuid; next_id uuid; source_id uuid; relation integer;
 batch text; state text; reason text; response jsonb; decisions jsonb:='[]'; category text; old_value jsonb;
 selected_key jsonb; source_snapshot jsonb; matches_all boolean; evidence jsonb; source_row public.emails; prior_target text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor IS NULL THEN RAISE EXCEPTION 'Fact revision forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.quote_cases WHERE id=p_case FOR UPDATE;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_roles a JOIN auth.users u ON u.id=a.user_id
  WHERE a.user_id=p_actor AND a.role IN('workspace_operator','role_admin') AND (u.banned_until IS NULL OR u.banned_until<=now()))
 THEN RAISE EXCEPTION 'Fact revision forbidden' USING ERRCODE='42501'; END IF;
 IF p_command IS NULL OR length(p_command)>128 OR length(p_command)<8 OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_groups)>64 OR pg_column_size(p_groups)>524288 OR jsonb_typeof(p_manifest) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Invalid fact revision command' USING ERRCODE='22023'; END IF;
 batch:=encode(sha256(convert_to(jsonb_build_object('groups',p_groups,'manifest',p_manifest)::text,'UTF8')),'hex');
 IF EXISTS(SELECT 1 FROM public.quote_email_fact_revisions WHERE case_id=p_case AND command_key=p_command AND batch_hash<>batch)
 THEN RAISE EXCEPTION 'Fact revision idempotency conflict' USING ERRCODE='23505'; END IF;
 -- A completed command is an immutable receipt, even if new sources have since arrived.
 IF (SELECT count(*) FROM public.quote_email_fact_revisions WHERE case_id=p_case AND command_key=p_command)=jsonb_array_length(p_groups)
  AND jsonb_array_length(p_groups)>0 THEN
  RETURN jsonb_build_object('command_key',p_command,'decisions',(
   SELECT jsonb_agg(r.response||jsonb_build_object('replay',true,'changed',false) ORDER BY r.fact_key)
   FROM public.quote_email_fact_revisions r WHERE r.case_id=p_case AND r.command_key=p_command));
 END IF;
 -- Bind proposals to the complete source view read by the analyser, not an old body of the same ID.
 PERFORM 1 FROM public.emails WHERE thread_ref=c.thread_id ORDER BY id FOR SHARE;
 IF jsonb_array_length(p_manifest)<>(SELECT count(*) FROM public.emails WHERE thread_ref=c.thread_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest) x GROUP BY x->>'id' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest) x LEFT JOIN public.emails e ON e.id::text=x->>'id'
    WHERE e.id IS NULL OR e.thread_ref IS DISTINCT FROM c.thread_id
      OR encode(sha256(convert_to(COALESCE(e.body_text,''),'UTF8')),'hex') IS DISTINCT FROM x->>'sha256'
      OR e.from_address IS DISTINCT FROM x->>'from_address' OR e.sent_at IS DISTINCT FROM (x->>'sent_at')::timestamptz)
 THEN RAISE EXCEPTION 'Source collection changed; analyse again' USING ERRCODE='PT409'; END IF;
 -- One MVCC snapshot is used for all ordering and the recorded proof. No mixed identity reads.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'sent_at',e.sent_at,'received_at',e.received_at,'created_at',e.created_at,
  'from_address',e.from_address,'message_id',e.message_id,'body_sha256',encode(sha256(convert_to(COALESCE(e.body_text,''),'UTF8')),'hex'),
  'imap',(SELECT COALESCE(jsonb_agg(to_jsonb(i)),'[]') FROM public.email_imap_identities i WHERE i.email_id=e.id)) ORDER BY e.id),'[]')
 INTO source_snapshot FROM public.emails e WHERE e.thread_ref=c.thread_id;
 IF jsonb_array_length(source_snapshot)<>jsonb_array_length(p_manifest)
 THEN RAISE EXCEPTION 'Source collection changed; analyse again' USING ERRCODE='PT409'; END IF;
 IF EXISTS(SELECT 1 FROM public.quote_email_fact_revisions WHERE case_id=p_case AND command_key=p_command AND batch_hash<>batch)
 THEN RAISE EXCEPTION 'Fact revision idempotency conflict' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_groups) x GROUP BY x->>'key' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Duplicate fact revision group' USING ERRCODE='22023'; END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(p_groups) ORDER BY value->>'key' LOOP
  IF g->>'key' IS NULL OR g->>'key' !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' OR length(g->>'key')>128
    OR jsonb_typeof(g->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'candidates') NOT BETWEEN 1 AND 128
  THEN RAISE EXCEPTION 'Invalid revision group' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_case::text||(g->>'key')));
  SELECT * INTO prior FROM public.quote_email_fact_revisions WHERE case_id=p_case AND command_key=p_command AND fact_key=g->>'key';
  IF prior.id IS NOT NULL THEN decisions:=decisions||jsonb_build_array(prior.response||jsonb_build_object('replay',true,'changed',false)); CONTINUE; END IF;
  SELECT * INTO f FROM public.quote_facts WHERE case_id=p_case AND fact_key=g->>'key' AND is_current FOR UPDATE;
  revision_id:=gen_random_uuid(); next_id:=NULL; state:=NULL; reason:=NULL; selected:=NULL;
  FOR candidate IN SELECT value FROM jsonb_array_elements(g->'candidates') LOOP
   IF candidate->>'value_type' IS NULL OR candidate->>'value_type' NOT IN('text','number','json','date')
     OR candidate->'value' IS NULL OR candidate->'value'='null'::jsonb
     OR candidate->>'source_type' IS NULL OR candidate->>'source_type' NOT IN('email_body','ai_extraction')
     OR (candidate->>'value_type' IN('text','date') AND jsonb_typeof(candidate->'value') IS DISTINCT FROM 'string')
     OR (candidate->>'value_type'='number' AND jsonb_typeof(candidate->'value') IS DISTINCT FROM 'number')
     OR (candidate->>'value_type'='json' AND jsonb_typeof(candidate->'value') NOT IN('object','array'))
     OR jsonb_typeof(candidate->'confidence') IS DISTINCT FROM 'number'
     OR (candidate->>'confidence')::numeric NOT BETWEEN 0 AND 1
   THEN RAISE EXCEPTION 'Invalid candidate value or source' USING ERRCODE='22023'; END IF;
   IF candidate->>'evidence_error' IS NOT NULL OR candidate->>'email_id' IS NULL OR nullif(btrim(candidate->>'excerpt'),'') IS NULL THEN
    state:='conflict'; reason:='own_source_not_proven'; EXIT;
   END IF;
   SELECT * INTO source_row FROM public.emails WHERE id=(candidate->>'email_id')::uuid;
   IF source_row.id IS NULL OR source_row.thread_ref IS DISTINCT FROM c.thread_id
     OR encode(sha256(convert_to(COALESCE(source_row.body_text,''),'UTF8')),'hex') IS DISTINCT FROM candidate->>'body_sha256'
   THEN RAISE EXCEPTION 'Candidate source changed; analyse again' USING ERRCODE='PT409'; END IF;
   -- Find a declaration whose server identity and sender date dominate every other source.
   matches_all:=true;
   FOR other IN SELECT value FROM jsonb_array_elements(g->'candidates') LOOP
    relation:=public.email_revision_source_order((candidate->>'email_id')::uuid,(other->>'email_id')::uuid,source_snapshot);
    IF relation IS NULL OR relation<0 OR (relation=0 AND public.email_revision_value_key(candidate->>'value_type',candidate->'value')
      IS DISTINCT FROM public.email_revision_value_key(other->>'value_type',other->'value')) THEN matches_all:=false; EXIT; END IF;
   END LOOP;
   IF matches_all AND selected IS NULL THEN selected:=candidate; END IF;
  END LOOP;
  IF state IS NULL AND selected IS NULL THEN state:='conflict'; reason:='sources_or_values_incomparable'; END IF;
  old_value:=CASE WHEN f.value_json IS NOT NULL THEN public.email_revision_value_key('json',f.value_json)
    WHEN f.value_number IS NOT NULL THEN public.email_revision_value_key('number',to_jsonb(f.value_number))
    WHEN f.value_date IS NOT NULL THEN public.email_revision_value_key('date',to_jsonb(f.value_date))
    ELSE public.email_revision_value_key('text',to_jsonb(f.value_text)) END;
  IF f.id IS NOT NULL AND (f.is_validated IS TRUE OR f.source_type IN('operator','manual_input','operator_correction')) THEN
   IF (selected IS NOT NULL AND public.email_revision_value_key(selected->>'value_type',selected->'value')=old_value) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(g->'candidates') x
      WHERE public.email_revision_value_key(x->>'value_type',x->'value') IS DISTINCT FROM old_value) THEN
    state:='unchanged'; reason:='protected_value_unchanged';
   ELSE state:='protected'; reason:='manual_or_validated_fact'; END IF;
  ELSIF EXISTS(SELECT 1 FROM public.quote_email_fact_revisions r WHERE r.case_id=p_case AND r.fact_key=g->>'key'
    AND r.status IN('conflict','protected') AND NOT EXISTS(SELECT 1 FROM public.quote_email_fact_revisions x WHERE x.resolves_revision_id=r.id AND x.status='resolved')) THEN
   state:='conflict'; reason:='unresolved_prior_source_conflict';
  END IF;
  IF state IS NULL THEN
   source_id:=(selected->>'email_id')::uuid; selected_key:=public.email_revision_value_key(selected->>'value_type',selected->'value');
   relation:=public.email_revision_source_order(source_id,f.source_email_id,source_snapshot);
   IF num_nonnulls(f.value_text,f.value_number,f.value_json,f.value_date)>1 THEN state:='conflict'; reason:='current_value_not_comparable';
   ELSIF f.id IS NULL OR f.source_type='ai_assumption' OR num_nonnulls(f.value_text,f.value_number,f.value_json,f.value_date)=0 THEN state:='applied'; reason:='explicit_own_source';
   ELSIF relation=0 AND f.source_revision_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.quote_email_fact_revisions WHERE id=f.source_revision_id;
    IF prior.source_evidence->'selected'->>'body_sha256' IS DISTINCT FROM selected->>'body_sha256' THEN
     state:='conflict'; reason:='same_message_body_changed';
    ELSIF selected_key=old_value THEN state:='unchanged'; reason:='same_source_and_value';
    ELSE state:='conflict'; reason:='same_source_contradictory_values'; END IF;
   ELSIF relation=0 AND selected_key=old_value THEN state:='confirmed'; reason:='initial_source_attestation';
   ELSIF relation>0 THEN state:=CASE WHEN selected_key=old_value THEN 'confirmed' ELSE 'applied' END; reason:='newer_verified_declaration';
   ELSIF relation<0 THEN state:='ignored'; reason:='older_verified_declaration';
   ELSE state:='conflict'; reason:='current_source_not_orderable'; END IF;
  END IF;
  evidence:=jsonb_build_object('candidates',g->'candidates','selected',selected,'manifest',p_manifest,'sources',(
   SELECT COALESCE(jsonb_agg(e||jsonb_build_object('imap',(
    SELECT COALESCE(jsonb_agg(i-'account'),'[]') FROM jsonb_array_elements(e->'imap') i))),'[]')
   FROM jsonb_array_elements(source_snapshot) e WHERE e->>'id'=f.source_email_id::text
    OR e->>'id' IN(SELECT x->>'email_id' FROM jsonb_array_elements(g->'candidates') x)));
  category:=CASE WHEN g->>'category' IN('cargo','routing','timing','pricing','documents','contacts') THEN g->>'category' ELSE 'other' END;
  prior_target:=current_setting('dcq.email_revision_target',true);
  PERFORM set_config('dcq.email_revision_target',p_case::text||'/'||(g->>'key'),true);
  IF state IN('applied','confirmed') THEN
   next_id:=public.supersede_fact(p_case,g->>'key',CASE WHEN split_part(g->>'key','.',1) IN('cargo','routing','timing','pricing','documents','contacts','other','service','regulatory','carrier','survey','customs','transport') THEN split_part(g->>'key','.',1) ELSE 'other' END,
    CASE WHEN selected->>'value_type'='text' THEN selected->>'value' END,
    CASE WHEN selected->>'value_type'='number' THEN (selected->>'value')::numeric END,
    CASE WHEN selected->>'value_type'='json' THEN selected->'value' END,
    CASE WHEN selected->>'value_type'='date' THEN (selected->>'value')::timestamptz END,
    selected->>'source_type',source_id,NULL,selected->>'excerpt',(selected->>'confidence')::numeric);
  ELSE next_id:=f.id; END IF;
  response:=jsonb_build_object('revision_id',revision_id,'key',g->>'key','status',state,'reason',reason,'fact_id',next_id,
    'changed',state IN('applied','confirmed'),'had_current',f.id IS NOT NULL,'replay',false);
  INSERT INTO public.quote_email_fact_revisions(id,case_id,fact_key,command_key,batch_hash,request,status,reason,old_fact,new_fact_id,source_evidence,response,actor_user_id)
  VALUES(revision_id,p_case,g->>'key',p_command,batch,g,state,reason,to_jsonb(f),next_id,evidence,response,p_actor);
  IF state IN('applied','confirmed') THEN
   UPDATE public.quote_facts SET source_revision_id=revision_id,is_validated=false WHERE id=next_id;
  ELSIF state='conflict' AND f.id IS NOT NULL THEN
   UPDATE public.quote_facts SET source_revision_id=revision_id WHERE id=f.id;
  END IF;
  PERFORM set_config('dcq.email_revision_target',COALESCE(prior_target,''),true);
  IF state IN('conflict','protected') THEN
   IF NOT EXISTS(SELECT 1 FROM public.quote_gaps WHERE case_id=p_case AND gap_key='source_revision.'||(g->>'key') AND status IN('open','pending_response')) THEN
    INSERT INTO public.quote_gaps(case_id,gap_key,gap_category,is_blocking,priority,question_fr,question_en,status)
    VALUES(p_case,'source_revision.'||(g->>'key'),category,true,'critical',
      'Des sources contradictoires ou non ordonnables concernent '||(g->>'key')||'. Confirmez explicitement ce fait avant un nouveau calcul.',
      'Review conflicting source declarations before a new calculation.','open');
   END IF;
  END IF;
  INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,actor_user_id,related_fact_id,created_at)
  VALUES(p_case,'fact_updated',jsonb_build_object('source','email-fact-revision','revision_id',revision_id,'fact_key',g->>'key',
    'status',state,'reason',reason,'old_fact',to_jsonb(f),'new_value',selected->'value','source_evidence',evidence), 'system',p_actor,next_id,clock_timestamp());
  decisions:=decisions||jsonb_build_array(response);
 END LOOP;
 RETURN jsonb_build_object('decisions',decisions,'command_key',p_command);
END; $$;
REVOKE ALL ON FUNCTION public.apply_case_email_fact_revisions(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_case_email_fact_revisions(uuid,uuid,text,jsonb,jsonb) TO service_role;

DO $version_guard$
DECLARE definition text; target regprocedure:='public.assert_quotation_run_facts_current(uuid,uuid)'::regprocedure;
BEGIN
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF md5(definition)<>'ee6a49751968438f4a189fea439ad624' THEN RAISE EXCEPTION 'Unexpected quotation freshness guard'; END IF;
 EXECUTE replace(definition,E'BEGIN\n',E'BEGIN\n PERFORM public.assert_case_source_revisions_resolved(p_case);\n');
END $version_guard$;
COMMIT;
