-- Forward-only lexical repair after a real AI proposal used 40'HC alongside 40HC.
-- Existing source receipts remain immutable; no equipment or quantity is inferred.
BEGIN;
DO $preflight$ BEGIN
 IF md5(replace(pg_get_functiondef('public.reprocess_case_equipment(uuid,uuid,text,uuid,uuid,jsonb,jsonb)'::regprocedure),chr(13),''))<>'beed43722020a0db723228b1f75e8577'
 OR md5(replace(pg_get_functiondef('public.unicode_equipment_inventory(text)'::regprocedure),chr(13),''))<>'1381c9d02fbb170831e4717c3f7f1323'
 THEN RAISE EXCEPTION 'Unexpected equipment repair baseline'; END IF;
END $preflight$;

CREATE FUNCTION public.container_designation_type(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE m text[]; tail text; aliases jsonb:='{"20DV":"20GP","20DC":"20GP","20GP":"20GP","20ST":"20GP","20HC":"20HC","20HQ":"20HC","20RF":"20RF","20OT":"20OT","20FR":"20FR","20FL":"20FL","40DV":"40GP","40DC":"40GP","40GP":"40GP","40ST":"40GP","40HC":"40HC","40HQ":"40HC","40RF":"40RF","40OT":"40OT","40FR":"40FR","40FL":"40FL","45HC":"45HC","45HQ":"45HC","20DRY":"20GP","40DRY":"40GP","20DRYVAN20DV":"20GP","20DRY86":"20GP","40DRY86":"40GP","40DRY96":"40HC","20DRY96":"20HC","20FLATRACK":"20FR","20OPENTOP":"20OT","20REEFER":"20RF","20STD":"20GP","20DRYVAN":"20GP","20DRYCONTAINER":"20GP","20GENERALPURPOSE":"20GP","20HIGHCUBE":"20HC","40FLATRACK":"40FR","40OPENTOP":"40OT","40REEFER":"40RF","40STD":"40GP","40DRYVAN":"40GP","40DRYCONTAINER":"40GP","40GENERALPURPOSE":"40GP","40HIGHCUBE":"40HC","45HIGHCUBE":"45HC"}';
BEGIN
 IF p_raw IS NULL OR p_raw ~* '[/|?]|\m(or|ou)\M' THEN RETURN NULL; END IF;
 m:=regexp_match(upper(normalize(btrim(p_raw),NFKC)),'^(20|40|45)([^0-9].*|$)');
 IF m IS NULL THEN RETURN NULL; END IF;
 tail:=regexp_replace(m[2],'^[[:space:]]*(FT\.?|FEET|FOOT|PIEDS?)(?=[[:space:]''._A-Z-]|$)','');
 IF tail !~ '^[A-Z0-9[:space:]''‘’′ʼ＇._()–—-]*$' THEN RETURN NULL; END IF;
 tail:=regexp_replace(tail,'[[:space:]''‘’′ʼ＇._()–—-]','','g');
 RETURN aliases->>(m[1]||tail);
END; $$;
REVOKE ALL ON FUNCTION public.container_designation_type(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.equipment_notation_inventory(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE row jsonb; result jsonb:='[]'; code text; quantity numeric;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF jsonb_array_length(p_value) NOT BETWEEN 1 AND 128 THEN RETURN NULL; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_value) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR jsonb_typeof(row->'quantity') IS DISTINCT FROM 'number'
   OR jsonb_typeof(row->'type') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  quantity:=(row->>'quantity')::numeric;
  IF quantity<>trunc(quantity) OR quantity NOT BETWEEN 1 AND 9007199254740991 THEN RETURN NULL; END IF;
  code:=public.container_designation_type(row->>'type');
  IF code IS NULL THEN RETURN NULL; END IF;
  result:=result||jsonb_build_array(jsonb_set(row,'{type}',to_jsonb(code)));
 END LOOP;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.equipment_notation_inventory(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.container_revision_value_key(p_key text,p_type text,p_value jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT public.email_revision_value_key(p_type,CASE WHEN p_key='cargo.containers' AND p_type='json'
  THEN COALESCE(public.equipment_notation_inventory(p_value),p_value) ELSE p_value END);
$$;
REVOKE ALL ON FUNCTION public.container_revision_value_key(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $ordered$ DECLARE definition text; anchor text; BEGIN
 IF md5(replace(pg_get_functiondef('public.apply_case_email_fact_revisions(uuid,uuid,text,jsonb,jsonb)'::regprocedure),chr(13),''))<>'e73fb5ecba0f05a46ccf5dd0fd5435ca'
 THEN RAISE EXCEPTION 'Unexpected equipment comparison baseline'; END IF;
 definition:=replace(pg_get_functiondef('public.apply_case_email_fact_revisions(uuid,uuid,text,jsonb,jsonb)'::regprocedure),chr(13),'');
 IF strpos(definition,'public.email_revision_value_key(')=0 THEN RAISE EXCEPTION 'Equipment comparison anchor missing'; END IF;
 definition:=replace(definition,'public.email_revision_value_key(','public.container_revision_value_key(g->>''key'',');
 anchor:='   IF candidate->>''evidence_error'' IS NOT NULL OR candidate->>''email_id'' IS NULL';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Equipment supported-value anchor missing'; END IF;
 definition:=replace(definition,anchor,E'   IF g->>''key''=''cargo.containers'' AND (candidate->>''value_type'' IS DISTINCT FROM ''json'' OR public.equipment_notation_inventory(candidate->''value'') IS NULL) THEN\n    state:=''conflict''; reason:=''container_designation_unsupported''; EXIT;\n   END IF;\n'||anchor);
 EXECUTE definition;
END $ordered$;

DO $patch$ DECLARE definition text; anchor text; replacement text; BEGIN
 definition:=replace(pg_get_functiondef('public.reprocess_case_equipment(uuid,uuid,text,uuid,uuid,jsonb,jsonb)'::regprocedure),chr(13),'');
 anchor:='OR candidate->''value'' IS DISTINCT FROM inventory';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Equipment candidate anchor missing'; END IF;
 definition:=replace(definition,anchor,'OR public.equipment_notation_inventory(candidate->''value'') IS DISTINCT FROM inventory');
 anchor:='inventory:=public.unicode_equipment_inventory(att.source_evidence->''selected''->>''excerpt'');';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Equipment canonical source anchor missing'; END IF;
 definition:=replace(definition,anchor,'inventory:=public.equipment_notation_inventory(public.unicode_equipment_inventory(att.source_evidence->''selected''->>''excerpt''));');
 definition:=replace(definition,'public.unicode_equipment_inventory(candidate->>''excerpt'') IS DISTINCT FROM inventory','public.equipment_notation_inventory(public.unicode_equipment_inventory(candidate->>''excerpt'')) IS DISTINCT FROM inventory');
 anchor:=E'   OR r.source_evidence->''selected''->>''email_id'' IS DISTINCT FROM source.id::text\n   OR r.source_evidence->''selected''->>''body_sha256'' IS DISTINCT FROM att.source_evidence->''selected''->>''body_sha256''\n   OR r.source_evidence->''selected''->''value'' IS DISTINCT FROM inventory';
 replacement:=E'   OR (r.source_evidence->''selected'' IS DISTINCT FROM ''null''::jsonb AND (\n    r.source_evidence->''selected''->>''email_id'' IS DISTINCT FROM source.id::text\n    OR r.source_evidence->''selected''->>''body_sha256'' IS DISTINCT FROM att.source_evidence->''selected''->>''body_sha256''\n    OR public.equipment_notation_inventory(r.source_evidence->''selected''->''value'') IS DISTINCT FROM inventory))\n   OR jsonb_typeof(r.source_evidence->''candidates'') IS DISTINCT FROM ''array''\n   OR jsonb_array_length(r.source_evidence->''candidates'')=0';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Equipment selected receipt anchor missing'; END IF;
 definition:=replace(definition,anchor,replacement);
 anchor:='OR x->''value'' IS DISTINCT FROM inventory OR x->>''evidence_error'' IS NOT NULL)';
 replacement:=E'OR public.equipment_notation_inventory(x->''value'') IS DISTINCT FROM inventory OR x->>''evidence_error'' IS NOT NULL\n     OR x->>''value_type'' IS DISTINCT FROM ''json'' OR x->>''source_type'' IS NULL\n     OR x->>''source_type'' NOT IN(''email_body'',''ai_extraction'')\n     OR public.equipment_notation_inventory(public.unicode_equipment_inventory(x->>''excerpt'')) IS DISTINCT FROM inventory)';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Equipment conflict candidate anchor missing'; END IF;
 definition:=replace(definition,anchor,replacement);
 anchor:='processing:=jsonb_build_object(''kind'',''parser_correction''';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Equipment processing anchor missing'; END IF;
 definition:=replace(definition,anchor,'processing:=jsonb_build_object(''notation_rule'',''container-designation/1'',''kind'',''parser_correction''');
 EXECUTE definition;
END $patch$;
DO $owner$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.container_designation_type(text)','public.container_revision_value_key(text,text,jsonb)'] LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.reprocess_case_equipment(uuid,uuid,text,uuid,uuid,jsonb,jsonb)'::regprocedure)));
 END LOOP;
 EXECUTE format('ALTER FUNCTION public.equipment_notation_inventory(jsonb) OWNER TO %I',
  pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.reprocess_case_equipment(uuid,uuid,text,uuid,uuid,jsonb,jsonb)'::regprocedure)));
END $owner$;

-- Retain the exact rows under the same lock as every destructive replacement.
-- The handler separately retains raw/rejected proposals and its admitted actor.
DO $line_history$ DECLARE definition text; anchor text; BEGIN
 IF md5(replace(pg_get_functiondef('public.replace_quote_request_lines(uuid,jsonb)'::regprocedure),chr(13),''))<>'8783601677e879f35119f58eaa91e921'
  OR has_function_privilege('anon','public.replace_quote_request_lines(uuid,jsonb)','execute')
  OR has_function_privilege('authenticated','public.replace_quote_request_lines(uuid,jsonb)','execute')
  OR NOT has_function_privilege('service_role','public.replace_quote_request_lines(uuid,jsonb)','execute')
 THEN RAISE EXCEPTION 'Unexpected request line writer baseline or grants'; END IF;
 definition:=replace(pg_get_functiondef('public.replace_quote_request_lines(uuid,jsonb)'::regprocedure),chr(13),'');
 anchor:='  DELETE FROM quote_request_lines WHERE case_id = p_case_id;';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Request line deletion anchor missing'; END IF;
 definition:=replace(definition,anchor,E'  INSERT INTO public.case_timeline_events(case_id,event_type,actor_type,actor_user_id,event_data)\n  SELECT p_case_id,''case_reasoning_v1'',''system'',NULL,jsonb_build_object(\n   ''kind'',''quote_line_location_review'',''version'',1,''mode'',''atomic_replace'',''atomic'',true,\n   ''previous_lines'',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.quote_request_lines q WHERE q.case_id=p_case_id),''[]''::jsonb),\n   ''proposed_lines'',p_lines);\n'||anchor);
 EXECUTE definition;
END $line_history$;
COMMIT;
