-- P1-C2-A LOCAL candidate. No application endpoint, pricing projection or grants to real users.
-- A review attests an identified capture only; historical writers do NOT participate in our locks.
-- Trust boundary: a later authenticated Edge derives actor from JWT and computes C1 itself.
-- An existing auth.users UUID is NOT authentication. service_role is trusted server authority.
-- Installation is atomic and fail-closed on ANY pre-existing object in this reserved namespace.
-- A second application deliberately refuses; never silently adopts/overwrites a collided ledger.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'FRS_MIGRATION_OWNER_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE 'final_request_%')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'frs_%')
  THEN RAISE EXCEPTION 'FRS_ALREADY_INSTALLED_OR_COLLISION_REVIEW_REQUIRED'; END IF;
END $guard$;

CREATE TABLE public.final_request_reviewer_grants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  active boolean NOT NULL,
  generation bigint NOT NULL CHECK(generation>0),
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000)
);
CREATE TABLE public.final_request_grant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.final_request_reviewer_grants(user_id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK(generation>0),
  active boolean NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_id,generation)
);
CREATE TABLE public.final_request_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 128),
  action text NOT NULL CHECK(action IN ('capture','attest_source','commit','review')),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(case_id,id), UNIQUE(case_id,request_key)
);
CREATE TABLE public.final_request_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE RESTRICT,
  origin_kind text NOT NULL CHECK(origin_kind IN ('email','attachment','document')),
  origin_id uuid NOT NULL,
  version_number bigint NOT NULL CHECK(version_number>0),
  previous_id uuid,
  source_data jsonb NOT NULL CHECK(jsonb_typeof(source_data)='object'),
  source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
  author_role text NOT NULL DEFAULT 'unknown' CHECK(author_role IN ('client','partner','operator','unknown')),
  content_class text NOT NULL DEFAULT 'current' CHECK(content_class IN ('current','quoted','historical','hypothesis')),
  sent_at timestamptz,
  attested_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((attested_by IS NULL AND author_role='unknown' AND reason IS NULL) OR
    (attested_by IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 1000)),
  CHECK(previous_id IS DISTINCT FROM id),
  CHECK((version_number=1)=(previous_id IS NULL)),
  UNIQUE(case_id,id), UNIQUE(case_id,origin_kind,origin_id,version_number),
  FOREIGN KEY(case_id,previous_id) REFERENCES public.final_request_source_versions(case_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.final_request_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE RESTRICT,
  version_number bigint NOT NULL CHECK(version_number>0),
  parent_id uuid,
  capture_id uuid NOT NULL,
  resolver_version text NOT NULL CHECK(resolver_version='p1c1-adfe04101c18aa63a6f2c5df3d79a5b44575a41cd0fa66ab0ba3c3012268fb0c'),
  input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),
  raw_result jsonb NOT NULL CHECK(jsonb_typeof(raw_result)='object'),
  input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
  result_hash text NOT NULL CHECK(result_hash ~ '^[0-9a-f]{64}$'),
  limitations jsonb NOT NULL CHECK(jsonb_typeof(limitations)='array'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(parent_id IS DISTINCT FROM id), CHECK((version_number=1)=(parent_id IS NULL)),
  UNIQUE(case_id,id), UNIQUE(case_id,version_number), UNIQUE(capture_id),
  FOREIGN KEY(case_id,parent_id) REFERENCES public.final_request_revisions(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,capture_id) REFERENCES public.final_request_commands(case_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.final_request_revision_sources (
  case_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  PRIMARY KEY(case_id,revision_id,source_version_id),
  FOREIGN KEY(case_id,revision_id) REFERENCES public.final_request_revisions(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,source_version_id) REFERENCES public.final_request_source_versions(case_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.final_request_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  target jsonb NOT NULL CHECK(jsonb_typeof(target)='array'),
  action text NOT NULL CHECK(action IN ('confirm_instruction','keep_protected_fact','request_clarification','revoke_decision','review_capture')),
  candidate_ref text,
  previous_id uuid,
  needs_fact_reconciliation boolean NOT NULL DEFAULT false,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK(generation>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(previous_id IS DISTINCT FROM id),
  UNIQUE(case_id,id), UNIQUE(case_id,generation),
  FOREIGN KEY(case_id,revision_id) REFERENCES public.final_request_revisions(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,previous_id) REFERENCES public.final_request_review_events(case_id,id) ON DELETE RESTRICT
);
CREATE INDEX final_request_review_target_idx ON public.final_request_review_events(case_id,revision_id,target,generation DESC);
CREATE TABLE public.final_request_heads (
  case_id uuid PRIMARY KEY REFERENCES public.quote_cases(id) ON DELETE RESTRICT,
  generation bigint NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 9007199254740991),
  revision_id uuid,
  capture_id uuid,
  review_event_id uuid,
  FOREIGN KEY(case_id,revision_id) REFERENCES public.final_request_revisions(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,capture_id) REFERENCES public.final_request_commands(case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(case_id,review_event_id) REFERENCES public.final_request_review_events(case_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION public.frs_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FRS_APPEND_ONLY' USING ERRCODE='42501'; END $$;
CREATE FUNCTION public.frs_chain_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p record;
BEGIN
  IF TG_TABLE_NAME='final_request_source_versions' THEN
    IF NEW.previous_id IS NOT NULL THEN
      SELECT * INTO p FROM public.final_request_source_versions WHERE id=NEW.previous_id AND case_id=NEW.case_id;
      IF NOT FOUND OR p.version_number+1<>NEW.version_number OR p.origin_kind<>NEW.origin_kind OR p.origin_id<>NEW.origin_id
      THEN RAISE EXCEPTION 'FRS_SOURCE_CHAIN' USING ERRCODE='23514'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='final_request_revisions' THEN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT * INTO p FROM public.final_request_revisions WHERE id=NEW.parent_id AND case_id=NEW.case_id;
      IF NOT FOUND OR p.version_number+1<>NEW.version_number THEN RAISE EXCEPTION 'FRS_REVISION_CHAIN' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER final_request_source_chain BEFORE INSERT ON public.final_request_source_versions FOR EACH ROW EXECUTE FUNCTION public.frs_chain_guard();
CREATE TRIGGER final_request_revision_chain BEFORE INSERT ON public.final_request_revisions FOR EACH ROW EXECUTE FUNCTION public.frs_chain_guard();

CREATE FUNCTION public.frs_hash(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT encode(sha256(convert_to(j::text,'UTF8')),'hex')
$$;
-- Opaque DB fingerprint, NOT a JSON.stringify hash. For command replay compare jsonb structurally
-- as well: PostgreSQL considers 1 and 1.0 equal even though their textual SHA256 can differ.
CREATE FUNCTION public.frs_keys(j jsonb, required text[], optional text[] DEFAULT '{}') RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(j) IS DISTINCT FROM 'object' THEN false ELSE
   j ?& required AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(j) k WHERE NOT(k=ANY(required||optional))) END
$$;
CREATE FUNCTION public.frs_utf16_length(s text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(CASE WHEN ch='' THEN 0 WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0)::integer
 FROM regexp_split_to_table(s,'') ch
$$;
CREATE FUNCTION public.frs_text(j jsonb, max_len integer DEFAULT 500) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(j) IS DISTINCT FROM 'string' OR length(btrim(j#>>'{}'))=0 THEN false
  WHEN length(j#>>'{}')>max_len THEN false WHEN octet_length(j#>>'{}')<=max_len THEN true
  ELSE public.frs_utf16_length(j#>>'{}')<=max_len END
$$;
CREATE FUNCTION public.frs_instant(s text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE m text[]; tz text;
BEGIN
 IF s IS NULL THEN RETURN false; END IF;
 m:=regexp_match(s,'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$');
 -- PostgreSQL has no year zero. C1 can represent it in memory, but this storage
 -- boundary intentionally narrows to real PostgreSQL dates (years 0001..9999).
 IF m IS NULL OR m[1]::int<1 OR m[4]::int>23 OR m[5]::int>59 OR m[6]::int>59 THEN RETURN false; END IF;
 PERFORM make_date(m[1]::int,m[2]::int,m[3]::int);
 tz:=m[8];
 IF tz<>'Z' AND (substring(tz,2,2)::int>14 OR substring(tz,5,2)::int>59 OR
  (substring(tz,2,2)::int=14 AND substring(tz,5,2)::int<>0)) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value THEN RETURN false;
END $$;
CREATE FUNCTION public.frs_value(field text, j jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE s text := j#>>'{}';
BEGIN
 IF field IN ('cargo.description','routing.origin_port','routing.destination_port','routing.destination_city') THEN RETURN public.frs_text(j,500);
 ELSIF field IN ('cargo.weight_kg','cargo.volume_cbm','cargo.pieces_count') THEN
  IF jsonb_typeof(j) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  RETURN s::numeric>0 AND s::numeric<='1.7976931348623157e308'::numeric AND
   (field<>'cargo.pieces_count' OR (s::numeric=trunc(s::numeric) AND s::numeric<=9007199254740991));
 ELSIF field IN ('lot.in_scope','service.TRUCKING','service.DTHC','service.CUSTOMS_DAKAR','service.SEA_FREIGHT') THEN RETURN jsonb_typeof(j)='boolean';
 END IF;
 IF jsonb_typeof(j) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 RETURN CASE field
  WHEN 'cargo.container_type' THEN s=ANY(ARRAY['20GP','40GP','40HC','20RF','40RF','20OT','40OT','20FR','40FR'])
  WHEN 'routing.incoterm' THEN s=ANY(ARRAY['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'])
  WHEN 'transport.mode' THEN s=ANY(ARRAY['AIR','MARITIME','ROUTE','MULTIMODAL'])
  WHEN 'movement.direction' THEN s=ANY(ARRAY['IMPORT','EXPORT','REEXPORT','TRANSIT','CROSS_TRADE'])
  WHEN 'terminal.operation_mode' THEN s=ANY(ARRAY['LOLO','RORO','CONRO']) ELSE false END;
END $$;
CREATE FUNCTION public.frs_target(a jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN a->>'operation' IN ('set','remove') THEN jsonb_build_array('field',CASE WHEN a->'scope'='"case"'::jsonb THEN 'case' ELSE 'lot:'||(a#>>'{scope,lotId}') END,a->>'field')
  WHEN a->>'operation' IN ('accept_quote','reject_quote') THEN jsonb_build_array('quote',a->>'quotationVersionId')
  WHEN a->>'operation' IN ('cancel_request','resume_request') THEN '["lifecycle"]'::jsonb ELSE NULL END
$$;

-- One SQL statement / one statement snapshot. Does NOT lock or rewrite any upstream writer.
CREATE FUNCTION public.frs_inventory(p_case uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('caseId',q.id,'threadId',q.thread_id,
  'sources',coalesce((SELECT jsonb_agg(s ORDER BY s->>'kind',s->>'id') FROM (
   SELECT jsonb_build_object('kind','email','id',e.id,'threadId',e.thread_ref,'author',e.from_address,
    'text',e.body_text,'sentAt',e.sent_at,'captureMode',e.body_capture_mode) s FROM public.emails e WHERE e.thread_ref=q.thread_id
   UNION ALL SELECT jsonb_build_object('kind','attachment','id',a.id,'emailId',e.id,'threadId',e.thread_ref,
    'author',e.from_address,'fileName',a.filename,'text',a.extracted_text,'sentAt',e.sent_at,'captureMode','document_extraction')
    FROM public.email_attachments a JOIN public.emails e ON e.id=a.email_id WHERE e.thread_ref=q.thread_id
   UNION ALL SELECT jsonb_build_object('kind','document','id',d.id,'caseId',d.case_id,'fileName',d.file_name,
    'documentType',d.document_type,'text',d.extracted_text,'sentAt',NULL,'captureMode','document_extraction')
    FROM public.case_documents d WHERE d.case_id=q.id
  ) src),'[]'::jsonb),
  'cargoLines',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.cargo_lines c WHERE c.case_id=q.id AND c.is_current),'[]'::jsonb),
  'requestLines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.quote_request_lines l WHERE l.case_id=q.id),'[]'::jsonb),
  'quotations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'sourceKind',v.source_kind,'number',v.version_number,
    'status',v.status,'selected',v.is_selected,'snapshotHash',public.frs_hash(v.snapshot)) ORDER BY v.id)
    FROM public.quotation_versions v WHERE v.case_id=q.id),'[]'::jsonb),
  'protectedFacts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'key',f.fact_key,'text',f.value_text,
    'number',f.value_number,'json',f.value_json,'date',f.value_date,'sourceType',f.source_type,
    'validated',f.is_validated,'validatedBy',f.validated_by,'validatedAt',f.validated_at) ORDER BY f.id)
    FROM public.quote_facts f WHERE f.case_id=q.id AND f.is_current AND (f.is_validated OR f.source_type='manual_input')),'[]'::jsonb))
 FROM public.quote_cases q WHERE q.id=p_case
$$;

-- Privileged operational bootstrap/revocation ONLY. Not granted to service_role or exposed by an Edge.
-- Reviewer row lock precedes any case lock everywhere. Revocation never waits while holding a case lock.
CREATE FUNCTION public.frs_admin_set_reviewer(p_operator uuid,p_user uuid,p_active boolean,p_reason text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g bigint;
BEGIN
 IF p_active IS NULL OR NOT public.frs_text(to_jsonb(p_reason),1000)
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_operator)
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user)
 THEN RAISE EXCEPTION 'FRS_GRANT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO public.final_request_reviewer_grants(user_id,active,generation,changed_by,reason)
 VALUES(p_user,p_active,1,p_operator,p_reason)
 ON CONFLICT(user_id) DO UPDATE SET active=excluded.active,generation=public.final_request_reviewer_grants.generation+1,
 changed_by=excluded.changed_by,reason=excluded.reason,changed_at=clock_timestamp() RETURNING generation INTO g;
 INSERT INTO public.final_request_grant_events(user_id,generation,active,actor_id,reason) VALUES(p_user,g,p_active,p_operator,p_reason);
 RETURN g;
END $$;

CREATE FUNCTION public.frs_assertions_valid(i jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a jsonb; s jsonb; op text; f text; scope jsonb; seen text[]:='{}';
BEGIN
 IF jsonb_typeof(i->'assertions') IS DISTINCT FROM 'array' OR jsonb_array_length(i->'assertions')>3000 THEN RETURN false; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(i->'assertions') LOOP
  op:=a->>'operation'; f:=a->>'field'; scope:=a->'scope';
  IF NOT public.frs_keys(a,ARRAY['id','sourceId','scope','operation','excerpt'],ARRAY['field','value','quotationVersionId'])
   OR NOT public.frs_text(a->'id',128) OR a->>'id'=ANY(seen) OR NOT public.frs_text(a->'sourceId',128)
   OR NOT public.frs_text(a->'excerpt',2000) OR op IS NULL
   OR op NOT IN ('set','remove','cancel_request','resume_request','accept_quote','reject_quote','acknowledge') THEN RETURN false; END IF;
  seen:=array_append(seen,a->>'id');
  SELECT value INTO s FROM jsonb_array_elements(i->'sources') WHERE value->>'id'=a->>'sourceId';
  IF NOT FOUND OR position((a->>'excerpt') IN (s->>'text'))=0 THEN RETURN false; END IF;
  IF scope IS DISTINCT FROM '"case"'::jsonb THEN
   IF NOT public.frs_keys(scope,ARRAY['lotId']) OR NOT(i->'lotIds' @> jsonb_build_array(scope->>'lotId')) THEN RETURN false; END IF;
  END IF;
  IF op IN ('set','remove') THEN
   IF f IS NULL OR f NOT IN ('cargo.description','cargo.weight_kg','cargo.volume_cbm','cargo.pieces_count','cargo.container_type',
    'routing.origin_port','routing.destination_port','routing.destination_city','routing.incoterm','transport.mode','movement.direction',
    'terminal.operation_mode','lot.in_scope','service.TRUCKING','service.DTHC','service.CUSTOMS_DAKAR','service.SEA_FREIGHT')
    OR (f='lot.in_scope' AND scope='"case"'::jsonb) OR a ? 'quotationVersionId' THEN RETURN false; END IF;
   IF op='set' AND NOT public.frs_value(f,a->'value') THEN RETURN false; END IF;
   IF op='remove' AND a ? 'value' THEN RETURN false; END IF;
  ELSIF op IN ('accept_quote','reject_quote') THEN
   IF scope IS DISTINCT FROM '"case"'::jsonb OR a ?| ARRAY['field','value']
    OR NOT public.frs_text(a->'quotationVersionId',128)
    OR NOT(i->'quotationVersionIds' @> jsonb_build_array(a->>'quotationVersionId')) THEN RETURN false; END IF;
  ELSE
   IF a ?| ARRAY['field','value','quotationVersionId'] OR scope IS DISTINCT FROM '"case"'::jsonb THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
END $$;

-- Validate the closed output/provenance contract, not the entire C1 algorithm in SQL.
-- Semantic computation is a trusted Edge obligation; hashes are NOT proof it executed.
CREATE FUNCTION public.frs_result_valid(r jsonb,i jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE j jsonb; a jsonb; s jsonb; v jsonb; seen text[]:='{}'; targets jsonb:='[]'; t jsonb; k text:=r->>'kind'; required text[];
BEGIN
 IF k IS NULL OR k NOT IN ('no_request','consistent','needs_review','cancelled') THEN RETURN false; END IF;
 required:=ARRAY['schemaVersion','caseId','kind','journal','protectedFacts'];
 IF k<>'no_request' THEN required:=required||ARRAY['fields','requestStatus','quoteResponses']; END IF;
 IF k='needs_review' THEN required:=required||ARRAY['reasons','protectedFactConflicts']; END IF;
 IF NOT public.frs_keys(r,required) OR r->'schemaVersion'<>'1'::jsonb OR r->'caseId' IS DISTINCT FROM i->'caseId'
  OR jsonb_typeof(r->'journal') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'protectedFacts') IS DISTINCT FROM 'array'
  OR jsonb_array_length(r->'journal')<>jsonb_array_length(i->'assertions')
  OR jsonb_array_length(r->'protectedFacts')<>jsonb_array_length(i->'protectedFacts')
  OR NOT((r->'protectedFacts') @> (i->'protectedFacts') AND (i->'protectedFacts') @> (r->'protectedFacts')) THEN RETURN false; END IF;
 FOR j IN SELECT value FROM jsonb_array_elements(r->'journal') LOOP
  IF NOT public.frs_keys(j,ARRAY['assertionId','sourceId','excerpt','scope','operation','outcome','reason'],ARRAY['field','value','quotationVersionId'])
   OR j->>'assertionId'=ANY(seen) OR NOT public.frs_text(j->'reason',2000)
   OR coalesce(j->>'outcome','') NOT IN ('applied','superseded','ignored','conflict') THEN RETURN false; END IF;
  SELECT value INTO a FROM jsonb_array_elements(i->'assertions') WHERE value->>'id'=j->>'assertionId';
  IF NOT FOUND OR (a-'id') IS DISTINCT FROM (j-ARRAY['assertionId','outcome','reason']) THEN RETURN false; END IF;
  seen:=array_append(seen,j->>'assertionId');
 END LOOP;
 IF k='no_request' THEN RETURN true; END IF;
 IF jsonb_typeof(r->'fields') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'quoteResponses') IS DISTINCT FROM 'array'
  OR NOT public.frs_keys(r->'requestStatus',ARRAY['state'],ARRAY['sourceId','assertionId','sentAt','excerpt'])
  OR coalesce(r#>>'{requestStatus,state}','') NOT IN ('open','cancelled','undetermined') THEN RETURN false; END IF;
 IF (k='cancelled' AND r#>>'{requestStatus,state}'<>'cancelled') OR (k='consistent' AND r#>>'{requestStatus,state}'<>'open') THEN RETURN false; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(r->'fields') UNION ALL SELECT value FROM jsonb_array_elements(r->'quoteResponses') LOOP
  SELECT value INTO a FROM jsonb_array_elements(i->'assertions') WHERE value->>'id'=v->>'assertionId';
  IF NOT FOUND THEN RETURN false; END IF;
  t:=public.frs_target(a);
  IF t IS NULL OR targets @> jsonb_build_array(t) THEN RETURN false; END IF;
  targets:=targets||jsonb_build_array(t);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'journal') jr WHERE jr->>'assertionId'=a->>'id' AND jr->>'outcome'='applied') THEN RETURN false; END IF;
  SELECT value INTO s FROM jsonb_array_elements(i->'sources') WHERE value->>'id'=a->>'sourceId';
  IF v->'sourceId' IS DISTINCT FROM a->'sourceId' OR v->'excerpt' IS DISTINCT FROM a->'excerpt' OR v->'sentAt' IS DISTINCT FROM s->'sentAt' THEN RETURN false; END IF;
  IF v ? 'field' THEN
   required:=ARRAY['scope','field','status','sourceId','assertionId','sentAt','excerpt'];
   IF v->>'status'='set' THEN required:=required||ARRAY['value']; END IF;
   IF NOT public.frs_keys(v,required) OR v->'field' IS DISTINCT FROM a->'field' OR v->'scope' IS DISTINCT FROM a->'scope'
    OR (v->>'status'='set' AND (a->>'operation'<>'set' OR v->'value' IS DISTINCT FROM a->'value'))
    OR (v->>'status'='removed' AND a->>'operation'<>'remove') OR coalesce(v->>'status','') NOT IN ('set','removed') THEN RETURN false; END IF;
  ELSE
   IF NOT public.frs_keys(v,ARRAY['quotationVersionId','response','sourceId','assertionId','sentAt','excerpt'])
    OR v->'quotationVersionId' IS DISTINCT FROM a->'quotationVersionId'
    OR (v->>'response'='accepted' AND a->>'operation'<>'accept_quote')
    OR (v->>'response'='rejected' AND a->>'operation'<>'reject_quote')
    OR coalesce(v->>'response','') NOT IN ('accepted','rejected') THEN RETURN false; END IF;
  END IF;
 END LOOP;
 IF r->'requestStatus' ? 'assertionId' THEN
  v:=r->'requestStatus'; SELECT value INTO a FROM jsonb_array_elements(i->'assertions') WHERE value->>'id'=v->>'assertionId';
  IF NOT FOUND OR a->>'operation' NOT IN ('cancel_request','resume_request')
   OR (a->>'operation'='cancel_request' AND v->>'state'<>'cancelled') OR (a->>'operation'='resume_request' AND v->>'state'<>'open')
   OR v->'sourceId' IS DISTINCT FROM a->'sourceId'
   OR v->'excerpt' IS DISTINCT FROM a->'excerpt' THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'journal') jr WHERE jr->>'assertionId'=a->>'id' AND jr->>'outcome'='applied') THEN RETURN false; END IF;
  SELECT value INTO s FROM jsonb_array_elements(i->'sources') WHERE value->>'id'=a->>'sourceId';
  IF v->'sentAt' IS DISTINCT FROM s->'sentAt' THEN RETURN false; END IF;
 ELSIF r->'requestStatus' ?| ARRAY['sourceId','sentAt','excerpt'] THEN RETURN false; END IF;
 IF k='needs_review' THEN
  IF jsonb_typeof(r->'reasons') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'protectedFactConflicts') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(r->'reasons') LOOP IF NOT public.frs_text(v,2000) THEN RETURN false; END IF; END LOOP;
  FOR v IN SELECT value FROM jsonb_array_elements(r->'protectedFactConflicts') LOOP
   IF NOT public.frs_keys(v,ARRAY['scope','field','protectedValue','conflictingAssertionId','conflictingSourceId','reason']) THEN RETURN false; END IF;
   SELECT value INTO a FROM jsonb_array_elements(i->'assertions') WHERE value->>'id'=v->>'conflictingAssertionId';
   IF NOT FOUND OR a->>'operation' NOT IN ('set','remove') OR v->'scope' IS DISTINCT FROM a->'scope'
    OR v->'field' IS DISTINCT FROM a->'field' OR v->'conflictingSourceId' IS DISTINCT FROM a->'sourceId'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i->'protectedFacts') p WHERE p->'scope'=v->'scope' AND p->'field'=v->'field' AND p->'value'=v->'protectedValue')
    OR NOT public.frs_text(v->'reason',2000) THEN RETURN false; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'journal') jr WHERE jr->>'assertionId'=a->>'id' AND jr->>'outcome'='conflict') THEN RETURN false; END IF;
  END LOOP;
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.frs_build_capture(p_actor uuid,p_case uuid,p_capture uuid,p_head uuid,p_generation bigint,p_inventory jsonb)
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
  IF raw->>'kind'<>'email' THEN limits:=limits||jsonb_build_array('SOURCE_TRUNCATED:'||sv.id); END IF;
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

CREATE FUNCTION public.frs_apply_review(p_actor uuid,p_case uuid,p_revision uuid,p_generation bigint,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r public.final_request_revisions%ROWTYPE; prev public.final_request_review_events%ROWTYPE;
 d text:=p->>'decision'; v_target jsonb:=p->'target'; candidate text:=p->>'candidateRef'; previous uuid;
 a jsonb; s jsonb; pf jsonb; grp jsonb; active_decision public.final_request_review_events%ROWTYPE;
 event_id uuid:=gen_random_uuid(); reconcile boolean:=false;
BEGIN
 IF NOT public.frs_keys(p,ARRAY['decision','target','candidateRef','previousEventId','reason'])
  OR NOT public.frs_text(p->'reason',1000) OR jsonb_typeof(v_target) IS DISTINCT FROM 'array'
  OR d IS NULL OR d NOT IN ('confirm_instruction','keep_protected_fact','request_clarification','revoke_decision','review_capture')
  OR (jsonb_typeof(p->'candidateRef') NOT IN ('string','null')) OR (jsonb_typeof(p->'previousEventId') NOT IN ('string','null'))
 THEN RAISE EXCEPTION 'FRS_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 previous:=(p->>'previousEventId')::uuid;
 SELECT * INTO r FROM public.final_request_revisions WHERE id=p_revision AND case_id=p_case;
 IF NOT FOUND THEN RAISE EXCEPTION 'FRS_REVISION_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT * INTO prev FROM public.final_request_review_events WHERE case_id=p_case AND revision_id=r.id AND final_request_review_events.target=v_target ORDER BY generation DESC LIMIT 1;
 IF prev.id IS DISTINCT FROM previous THEN RAISE EXCEPTION 'FRS_STALE_REVIEW' USING ERRCODE='40001'; END IF;
 IF v_target='["capture"]'::jsonb THEN
  IF d NOT IN ('review_capture','revoke_decision') THEN RAISE EXCEPTION 'FRS_REVIEW_TARGET' USING ERRCODE='22023'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.raw_result->'journal') j WHERE j->>'outcome'='conflict' AND public.frs_target(j)=v_target)
 THEN RAISE EXCEPTION 'FRS_REVIEW_TARGET' USING ERRCODE='22023'; END IF;
 IF d='confirm_instruction' THEN
  SELECT value INTO a FROM jsonb_array_elements(r.input->'assertions') WHERE value->>'id'=candidate AND public.frs_target(value)=v_target;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.raw_result->'journal') j WHERE j->>'assertionId'=candidate AND j->>'outcome'='conflict')
  THEN RAISE EXCEPTION 'FRS_REVIEW_CANDIDATE' USING ERRCODE='22023'; END IF;
  SELECT value INTO s FROM jsonb_array_elements(r.input->'sources') WHERE value->>'id'=a->>'sourceId';
  IF s->>'authorRole'<>'client' OR s->'roleVerified'<>'true'::jsonb OR s->>'contentClass'<>'current' OR NOT public.frs_instant(s->>'sentAt')
  THEN RAISE EXCEPTION 'FRS_SOURCE_REATTESTATION_REQUIRED' USING ERRCODE='23514'; END IF;
  -- Derive reconciliation from the captured protected facts and exact candidate,
  -- not merely a server-supplied result annotation which could be accidentally omitted.
  reconcile:=EXISTS(SELECT 1 FROM jsonb_array_elements(r.input->'protectedFacts') fact WHERE fact->'scope'=a->'scope' AND fact->'field'=a->'field'
   AND (a->>'operation'='remove' OR fact->'value' IS DISTINCT FROM a->'value'));
 ELSIF d='keep_protected_fact' THEN
  SELECT value INTO pf FROM jsonb_array_elements(r.input->'protectedFacts') f WHERE f->>'reference'=candidate AND
   jsonb_build_array('field',CASE WHEN f->'scope'='"case"'::jsonb THEN 'case' ELSE 'lot:'||(f#>>'{scope,lotId}') END,f->>'field')=v_target;
  IF NOT FOUND THEN RAISE EXCEPTION 'FRS_PROTECTED_CANDIDATE' USING ERRCODE='22023'; END IF;
 ELSIF d='review_capture' THEN
  IF v_target<>'["capture"]'::jsonb OR candidate IS NOT NULL OR r.limitations<>'[]'::jsonb OR r.raw_result->>'kind'='no_request'
  THEN RAISE EXCEPTION 'FRS_CAPTURE_NOT_REVIEWABLE' USING ERRCODE='23514'; END IF;
  FOR grp IN SELECT DISTINCT public.frs_target(j) FROM jsonb_array_elements(r.raw_result->'journal') j WHERE j->>'outcome'='conflict' LOOP
   SELECT * INTO active_decision FROM public.final_request_review_events WHERE case_id=p_case AND revision_id=r.id AND final_request_review_events.target=grp ORDER BY generation DESC LIMIT 1;
   IF NOT FOUND OR active_decision.action NOT IN ('confirm_instruction','keep_protected_fact') THEN RAISE EXCEPTION 'FRS_UNRESOLVED_CONFLICT' USING ERRCODE='23514'; END IF;
   reconcile:=reconcile OR active_decision.needs_fact_reconciliation;
  END LOOP;
 ELSIF d='revoke_decision' THEN
  IF prev.id IS NULL OR prev.action='revoke_decision' OR candidate IS NOT NULL THEN RAISE EXCEPTION 'FRS_REVOKE_INVALID' USING ERRCODE='22023'; END IF;
 ELSIF candidate IS NOT NULL THEN RAISE EXCEPTION 'FRS_REVIEW_CANDIDATE' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.final_request_review_events(id,case_id,revision_id,target,action,candidate_ref,previous_id,needs_fact_reconciliation,reason,actor_id,generation)
 VALUES(event_id,p_case,r.id,v_target,d,candidate,prev.id,reconcile,p->>'reason',p_actor,p_generation);
 RETURN jsonb_build_object('eventId',event_id,'revisionId',r.id,'reviewState',CASE WHEN d='review_capture' THEN 'reviewed' ELSE 'pending' END,
  'needsFactReconciliation',reconcile,'pricingAuthorized',false);
END $$;

CREATE FUNCTION public.frs_mutate(p_actor uuid,p_case uuid,p_key text,p_action text,p_expected_revision uuid,p_expected_generation bigint,p_payload jsonb)
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
  IF NOT public.frs_keys(p_payload,ARRAY['originKind','originId','expectedSourceHash','authorRole','contentClass','reason'],ARRAY['sentAt'])
   OR coalesce(p_payload->>'originKind','') NOT IN ('email','attachment','document')
   OR coalesce(p_payload->>'authorRole','') NOT IN ('client','operator','partner','unknown')
   OR coalesce(p_payload->>'contentClass','') NOT IN ('current','quoted','historical','hypothesis')
   OR NOT public.frs_text(p_payload->'reason',1000) THEN RAISE EXCEPTION 'FRS_ATTESTATION_INVALID' USING ERRCODE='22023'; END IF;
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
  INSERT INTO public.final_request_source_versions(case_id,origin_kind,origin_id,version_number,previous_id,source_data,source_hash,author_role,content_class,sent_at,attested_by,reason,created_by)
  VALUES(p_case,raw->>'kind',(raw->>'id')::uuid,coalesce(prior.version_number,0)+1,prior.id,raw,h,p_payload->>'authorRole',p_payload->>'contentClass',sent,p_actor,p_payload->>'reason',p_actor) RETURNING id INTO source_id;
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

CREATE FUNCTION public.frs_read(p_actor uuid,p_case uuid,p_revision uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h public.final_request_heads%ROWTYPE; r public.final_request_revisions%ROWTYPE; snapshot jsonb; history jsonb; decisions jsonb;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor) THEN RAISE EXCEPTION 'FRS_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.quote_cases WHERE id=p_case) THEN RAISE EXCEPTION 'FRS_CASE_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT * INTO h FROM public.final_request_heads WHERE case_id=p_case;
 SELECT * INTO r FROM public.final_request_revisions WHERE case_id=p_case AND id=coalesce(p_revision,h.revision_id);
 IF p_revision IS NOT NULL AND r.id IS NULL THEN RAISE EXCEPTION 'FRS_REVISION_NOT_IN_CASE' USING ERRCODE='23514'; END IF;
 -- A new uncommitted capture must be reloadable; do not return the older revision's
 -- capture while claiming to show the current head. Historical selection stays explicit.
 SELECT response INTO snapshot FROM public.final_request_commands WHERE case_id=p_case AND id=CASE WHEN p_revision IS NULL THEN h.capture_id ELSE r.capture_id END AND action='capture';
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.generation),'[]') INTO decisions FROM public.final_request_review_events e WHERE e.case_id=p_case AND e.revision_id=r.id;
 SELECT coalesce(jsonb_agg(m ORDER BY (m->>'number')::bigint DESC),'[]') INTO history FROM (
  SELECT jsonb_build_object('id',id,'number',version_number,'parentId',parent_id,'createdAt',created_at) m FROM public.final_request_revisions WHERE case_id=p_case ORDER BY version_number DESC LIMIT 100
 ) x;
 RETURN jsonb_build_object('head',to_jsonb(h),'revision',to_jsonb(r),'captureRecord',snapshot,'reviews',decisions,'history',history,
  'selectedRevisionMatchesHeadCapture',coalesce(r.id=h.revision_id AND r.capture_id=h.capture_id,false),
  'historyTruncated',(SELECT count(*)>100 FROM public.final_request_revisions WHERE case_id=p_case),'pricingAuthorized',false);
END $$;

-- Grant no live capability here. Every new table is deny-all, including service_role.
-- Only the two explicitly named server RPCs receive service_role EXECUTE.
DO $security$
DECLARE obj record;
BEGIN
 FOR obj IN SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'final_request_%' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',obj.relname);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',obj.relname);
  IF obj.relname NOT IN ('final_request_heads','final_request_reviewer_grants') THEN
   EXECUTE format('CREATE TRIGGER frs_no_rewrite BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.frs_immutable()',obj.relname);
   EXECUTE format('CREATE TRIGGER frs_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.frs_immutable()',obj.relname);
  END IF;
 END LOOP;
 FOR obj IN SELECT p.oid::regprocedure signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'frs_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',obj.signature);
 END LOOP;
END $security$;
GRANT EXECUTE ON FUNCTION public.frs_mutate(uuid,uuid,text,text,uuid,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.frs_read(uuid,uuid,uuid) TO service_role;
COMMIT;
