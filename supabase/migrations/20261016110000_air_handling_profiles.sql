-- AIR_HANDLING only. Append-only supplier profiles and explicit case selections.
BEGIN;
CREATE TABLE public.air_handling_profiles (
  id uuid PRIMARY KEY, parent_id uuid UNIQUE REFERENCES public.air_handling_profiles(id), revision integer NOT NULL CHECK (revision > 0),
  supplier text NOT NULL CHECK (supplier = '2AS'), airport text NOT NULL CHECK (airport = 'DSS'),
  direction text NOT NULL CHECK (direction = 'IMPORT'), cargo_class text NOT NULL CHECK (cargo_class = 'GENERAL_CARGO'),
  effective_from date NOT NULL CHECK (effective_from >= DATE '2026-10-16'), effective_to date CHECK (effective_to >= effective_from),
  rates jsonb NOT NULL, source_reference text NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 10 AND 2000), evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES auth.users(id),
  CONSTRAINT air_rates_shape CHECK (jsonb_typeof(rates)='object' AND rates ?& ARRAY['collection_per_kg','security_per_kg','documents','warehouse_passage','it']
    AND (rates - ARRAY['collection_per_kg','security_per_kg','documents','warehouse_passage','it']) = '{}'::jsonb
    AND jsonb_typeof(rates->'collection_per_kg')='number' AND (rates->>'collection_per_kg')::numeric BETWEEN 0 AND 999999999
    AND jsonb_typeof(rates->'security_per_kg')='number' AND (rates->>'security_per_kg')::numeric BETWEEN 0 AND 999999999
    AND jsonb_typeof(rates->'documents')='number' AND (rates->>'documents')::numeric BETWEEN 0 AND 999999999
    AND jsonb_typeof(rates->'warehouse_passage')='number' AND (rates->>'warehouse_passage')::numeric BETWEEN 0 AND 999999999
    AND jsonb_typeof(rates->'it')='number' AND (rates->>'it')::numeric BETWEEN 0 AND 999999999)
);
CREATE TABLE public.air_handling_selections (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES public.quote_cases(id), version integer NOT NULL CHECK(version > 0),
  profile_id uuid REFERENCES public.air_handling_profiles(id), source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 10 AND 2000),
  warehouse_bracket_confirmed boolean NOT NULL DEFAULT false, context_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES auth.users(id), UNIQUE(case_id,version)
);
ALTER TABLE public.air_handling_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.air_handling_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY air_profiles_read ON public.air_handling_profiles FOR SELECT TO authenticated USING (public.has_workspace_access());
CREATE POLICY air_selections_read ON public.air_handling_selections FOR SELECT TO authenticated
  USING (public.has_workspace_access() AND EXISTS(SELECT 1 FROM public.quote_cases c WHERE c.id=case_id));
REVOKE ALL ON public.air_handling_profiles, public.air_handling_selections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.air_handling_profiles, public.air_handling_selections TO authenticated;
GRANT SELECT ON public.air_handling_profiles, public.air_handling_selections TO service_role;

CREATE FUNCTION public.air_handling_context_hash(p_case_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT md5(jsonb_build_object('request_type',c.request_type,
    'facts',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.fact_key,f.id) FROM public.quote_facts f WHERE f.case_id=c.id AND f.is_current),'[]'::jsonb),
    'lots',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.quote_request_lines l WHERE l.case_id=c.id),'[]'::jsonb))::text)
  FROM public.quote_cases c WHERE c.id=p_case_id;
$$;
CREATE FUNCTION public.air_handling_read(p_case_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE s public.air_handling_selections; p public.air_handling_profiles; c public.quote_cases;
BEGIN
  IF NOT public.has_workspace_access() THEN RAISE EXCEPTION 'Workspace admission required' USING ERRCODE='42501'; END IF;
  IF p_case_id IS NULL THEN
    RETURN jsonb_build_object('profiles',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at,t.id) FROM public.air_handling_profiles t),'[]'::jsonb),
      'can_edit',public.has_tariff_admin_role());
  END IF;
  SELECT * INTO c FROM public.quote_cases WHERE id=p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case inaccessible' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.air_handling_selections WHERE case_id=p_case_id ORDER BY version DESC LIMIT 1;
  IF s.profile_id IS NOT NULL THEN SELECT * INTO p FROM public.air_handling_profiles WHERE id=s.profile_id; END IF;
  RETURN jsonb_build_object('selection',CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s) END,
    'profile',CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END,
    'context_hash',public.air_handling_context_hash(p_case_id),'request_type',c.request_type,
    'lot_count',(SELECT count(*) FROM public.quote_request_lines WHERE case_id=p_case_id),
    'facts',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.fact_key,f.id) FROM public.quote_facts f WHERE f.case_id=p_case_id AND f.is_current),'[]'::jsonb));
END; $$;

CREATE FUNCTION public.air_handling_publish(p_id uuid,p_parent_id uuid,p_rates jsonb,p_effective_from date,p_effective_to date,p_source_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent public.air_handling_profiles; prior public.air_handling_profiles;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_access() OR NOT public.has_tariff_admin_role() THEN
    RAISE EXCEPTION 'Tariff administration required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('air_handling_profiles',0));
  SELECT * INTO prior FROM public.air_handling_profiles WHERE id=p_id;
  IF FOUND THEN
    IF prior.parent_id IS NOT DISTINCT FROM p_parent_id AND prior.rates=p_rates AND prior.effective_from=p_effective_from
      AND prior.effective_to IS NOT DISTINCT FROM p_effective_to AND prior.source_reference=p_source_reference AND prior.created_by=auth.uid() THEN RETURN p_id; END IF;
    RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='40001';
  END IF;
  SELECT * INTO parent FROM public.air_handling_profiles WHERE id=p_parent_id;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.air_handling_profiles WHERE parent_id=p_parent_id) THEN RAISE EXCEPTION 'Profile revision changed' USING ERRCODE='40001'; END IF;
  IF p_effective_from < CURRENT_DATE THEN RAISE EXCEPTION 'No retroactive validity'; END IF;
  INSERT INTO public.air_handling_profiles(id,parent_id,revision,supplier,airport,direction,cargo_class,effective_from,effective_to,rates,source_reference,evidence,created_by)
    VALUES(p_id,p_parent_id,parent.revision+1,'2AS','DSS','IMPORT','GENERAL_CARGO',p_effective_from,p_effective_to,p_rates,p_source_reference,
      jsonb_build_object('kind','operator_tariff_revision','parent_profile',p_parent_id,'confirmed_at',now(),'coverage','Import general cargo; weighted charges below1000kg; warehouse bracket explicitly attested; taxes/storage/selling excluded'),auth.uid());
  RETURN p_id;
END; $$;

CREATE FUNCTION public.air_handling_select(p_id uuid,p_case_id uuid,p_expected_id uuid,p_profile_id uuid,p_source_reference text,p_warehouse_bracket_confirmed boolean,p_context_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.quote_cases; head public.air_handling_selections; prior public.air_handling_selections; context text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_access() THEN RAISE EXCEPTION 'Workspace admission required' USING ERRCODE='42501'; END IF;
  -- Current case portfolio is shared among admitted operators; retain that contract.
  SELECT * INTO c FROM public.quote_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case inaccessible' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM public.air_handling_selections WHERE id=p_id;
  IF FOUND THEN
    IF prior.case_id=p_case_id AND prior.profile_id IS NOT DISTINCT FROM p_profile_id AND prior.source_reference=p_source_reference
      AND prior.warehouse_bracket_confirmed=p_warehouse_bracket_confirmed AND prior.context_hash=p_context_hash AND prior.created_by=auth.uid() THEN RETURN p_id; END IF;
    RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='40001';
  END IF;
  IF NOT public.has_case_write_access(p_case_id) OR c.status::text NOT IN ('INTAKE','FACTS_PARTIAL','NEED_INFO','READY_TO_PRICE','DECISIONS_PENDING','DECISIONS_COMPLETE','ACK_READY_FOR_PRICING','PRICED_DRAFT','QUOTED_VERSIONED') THEN RAISE EXCEPTION 'Case not editable' USING ERRCODE='40001'; END IF;
  IF c.request_type !~ '^AIR_IMPORT(_|$)' OR (SELECT count(*) FROM public.quote_request_lines WHERE case_id=p_case_id)>=2 THEN RAISE EXCEPTION 'AIR import mono-lot only'; END IF;
  SELECT * INTO head FROM public.air_handling_selections WHERE case_id=p_case_id ORDER BY version DESC LIMIT 1;
  IF head.id IS DISTINCT FROM p_expected_id THEN RAISE EXCEPTION 'Case selection changed' USING ERRCODE='40001'; END IF;
  context:=public.air_handling_context_hash(p_case_id);
  IF context IS DISTINCT FROM p_context_hash THEN RAISE EXCEPTION 'Case context changed' USING ERRCODE='40001'; END IF;
  IF p_profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.air_handling_profiles WHERE id=p_profile_id AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)) THEN RAISE EXCEPTION 'Profile not current'; END IF;
  INSERT INTO public.air_handling_selections(id,case_id,version,profile_id,source_reference,warehouse_bracket_confirmed,context_hash,created_by)
    VALUES(p_id,p_case_id,COALESCE(head.version,0)+1,p_profile_id,p_source_reference,p_warehouse_bracket_confirmed,context,auth.uid());
  RETURN p_id;
END; $$;
CREATE FUNCTION public.air_handling_finish(p_run_id uuid,p_case_id uuid,p_selection_id uuid,p_context_hash text,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE head public.air_handling_selections; affected integer;
BEGIN
  -- Server only: an operator cannot submit arbitrary monetary results through this RPC.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.quote_cases WHERE id=p_case_id FOR UPDATE;
  -- Existing rows: UPDATE/DELETE without changing case_id does not acquire the
  -- parent FK lock. Lock ALL facts (including historical) and request rows too.
  -- The parent FOR UPDATE blocks FK inserts/moves into this case until commit.
  PERFORM 1 FROM public.quote_facts WHERE case_id=p_case_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.quote_request_lines WHERE case_id=p_case_id ORDER BY id FOR SHARE;
  SELECT * INTO head FROM public.air_handling_selections WHERE case_id=p_case_id ORDER BY version DESC LIMIT 1;
  IF head.id IS DISTINCT FROM p_selection_id OR head.context_hash IS DISTINCT FROM p_context_hash
    OR public.air_handling_context_hash(p_case_id) IS DISTINCT FROM p_context_hash THEN RAISE EXCEPTION 'Handling context changed' USING ERRCODE='40001'; END IF;
  IF p_result->>'status' IS DISTINCT FROM 'success' OR
    (SELECT count(*) FROM jsonb_array_elements(p_result->'tariff_lines') l
      WHERE l#>>'{source,air_handling,selection_id}'=p_selection_id::text
        AND l#>>'{source,air_handling,context_hash}'=p_context_hash AND l#>>'{source,type}'='TO_CONFIRM'
        AND l#>'{source,air_handling,profile}'=(SELECT to_jsonb(p) FROM public.air_handling_profiles p WHERE p.id=head.profile_id)) <> 1
    THEN RAISE EXCEPTION 'Handling evidence missing'; END IF;
  UPDATE public.pricing_runs SET status='success', engine_request=p_result->'engine_request',engine_response=p_result->'engine_response',
    outputs_json=p_result->'outputs_json',tariff_lines=p_result->'tariff_lines',total_ht=(p_result->>'total_ht')::numeric,
    total_ttc=(p_result->>'total_ttc')::numeric,currency=p_result->>'currency',tariff_sources=p_result->'tariff_sources',
    completed_at=(p_result->>'completed_at')::timestamptz,duration_ms=(p_result->>'duration_ms')::integer
    WHERE id=p_run_id AND case_id=p_case_id AND status='running';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Pricing run changed' USING ERRCODE='40001'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.air_handling_finish(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.air_handling_finish(uuid,uuid,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.air_handling_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Append-only handling evidence'; END; $$;
CREATE TRIGGER air_profile_immutable BEFORE UPDATE OR DELETE ON public.air_handling_profiles FOR EACH ROW EXECUTE FUNCTION public.air_handling_immutable();
CREATE TRIGGER air_selection_immutable BEFORE UPDATE OR DELETE ON public.air_handling_selections FOR EACH ROW EXECUTE FUNCTION public.air_handling_immutable();
REVOKE ALL ON FUNCTION public.air_handling_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.air_handling_context_hash(uuid), public.air_handling_read(uuid), public.air_handling_publish(uuid,uuid,jsonb,date,date,text), public.air_handling_select(uuid,uuid,uuid,uuid,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.air_handling_context_hash(uuid), public.air_handling_read(uuid), public.air_handling_publish(uuid,uuid,jsonb,date,date,text), public.air_handling_select(uuid,uuid,uuid,uuid,text,boolean,text) TO authenticated;

INSERT INTO public.air_handling_profiles(id,revision,supplier,airport,direction,cargo_class,effective_from,rates,source_reference,evidence)
VALUES('a2a50000-1016-4000-8000-000000000001',1,'2AS','DSS','IMPORT','GENERAL_CARGO','2026-10-16',
  '{"collection_per_kg":20,"security_per_kg":10,"documents":25000,"warehouse_passage":6000,"it":1500}',
  'Grille CargoSpot 2024, RECAP ; applicabilité actuelle 2AS confirmée par Ramzi le 16 octobre 2026 ; aucune validité passée attestée.',
  '{"library_file_id":"libfile_120048a636dc8191906b47e51aefa16e","source_read_mode":"Library parsed workbook; LTA bases supplied by two parent reviewers, pixels not read locally", "basis":"Explicit validated LTA taxable fact for collection/security; no volumetric rounding inferred", "coverage":"Import general cargo; weighted charges strictly below1000kg; warehouse bracket separately attested", "documented_not_enabled":{"security_high_bracket_per_kg":5,"ordinary_storage_per_kg_day":20,"fridge_entry_1_500_kg":30000,"fridge_free_hours":48,"fridge_day_rates_1_500_kg":[50,40,35],"supplier_vat_percent":18,"anacim_percent":3.2,"cash_stamp_percent":1,"cash_stamp_threshold":100000},"unconfirmed":["Higher weight boundaries and mechanised collection applicability","Ordinary storage free period and basis","Fridge progressivity","Supplier VAT base and rounding","ANACIM base","Supplier TTC and SODATRA sale policy"]}');
COMMIT;
