-- V1 interne : admission explicite dans l'équipe partagée, sans seed de compte.
-- À appliquer uniquement après GO distinct, avec attribution revue des rôles.
BEGIN;

ALTER TABLE public.app_roles DROP CONSTRAINT app_roles_role_check;
ALTER TABLE public.app_roles ADD CONSTRAINT app_roles_role_check CHECK (
  role IN ('pad_admin', 'pad_supervisor', 'tariff_admin', 'role_admin', 'workspace_operator')
);

CREATE OR REPLACE FUNCTION public.has_workspace_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_roles r JOIN auth.users u ON u.id = r.user_id
    WHERE r.user_id = auth.uid()
      AND r.role IN ('workspace_operator', 'role_admin')
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  );
$$;
REVOKE ALL ON FUNCTION public.has_workspace_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_workspace_access() TO anon, authenticated;

-- Les helpers SECURITY DEFINER contournent la RLS de quote_cases : admission
-- requise également ici, partage READ / propriétaire-assigné WRITE inchangé.
CREATE OR REPLACE FUNCTION public.has_case_read_access(_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.role() = 'authenticated' AND public.has_workspace_access()
    AND EXISTS (SELECT 1 FROM public.quote_cases WHERE id = _case_id);
$$;
CREATE OR REPLACE FUNCTION public.has_case_write_access(_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.role() = 'authenticated' AND public.has_workspace_access()
    AND EXISTS (SELECT 1 FROM public.quote_cases WHERE id = _case_id
      AND (created_by = auth.uid() OR assigned_to = auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.has_case_read_access(uuid), public.has_case_write_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_case_read_access(uuid), public.has_case_write_access(uuid) TO authenticated, service_role;

-- RESTRICTIVE = AND avec les policies existantes : aucune ouverture propriétaire,
-- aucune nouvelle permission d'écriture. Les membres gardent le partage existant.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_roles', 'emails', 'email_threads', 'email_attachments', 'email_drafts',
    'quote_cases', 'quote_facts', 'quote_gaps', 'quote_request_lines',
    'cargo_lines', 'cargo_equipment', 'case_timeline_events', 'operator_decisions',
    'decision_proposals', 'pricing_runs', 'quote_service_pricing',
    'commodity_classification_candidates', 'commodity_designation_matches',
    'quotation_versions', 'quotation_version_lines', 'quotation_documents', 'quotation_history',
    'case_documents', 'case_document_metadata', 'case_puzzle_jobs', 'puzzle_jobs',
    'external_quote_requests', 'external_quote_responses', 'external_quote_response_facts',
    'partner_response_suggestions', 'quote_scenarios', 'quote_scenario_assumptions',
    'quote_scenario_links', 'quote_scenario_pricing_runs', 'quote_scenario_selections',
    'clients', 'known_business_contacts', 'known_business_contact_channels',
    'historical_quotations', 'historical_quotation_lines', 'historical_quotation_metadata',
    'learned_knowledge', 'documents', 'pricing_client_overrides',
    'pad_recommendation_audit_log', 'tariff_resolution_log', 'security_alerts',
    'tender_projects', 'tender_segments', 'tender_contingents'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'WORKSPACE_ACCESS prerequisite missing: RLS table %', t;
    END IF;
    EXECUTE format('CREATE POLICY workspace_members_only ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (public.has_workspace_access()) WITH CHECK (public.has_workspace_access())', t);
  END LOOP;
END $$;

-- Les fichiers restent partagés dans l'équipe ; les contrôles owner existants
-- continuent de s'appliquer. Un bucket public contourne la lecture RLS.
DO $$
DECLARE bucket text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS prerequisite missing: storage RLS';
  END IF;
  FOREACH bucket IN ARRAY ARRAY['documents', 'case-documents', 'database_export_15_09_26'] LOOP
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = bucket AND public IS FALSE) THEN
      RAISE EXCEPTION 'WORKSPACE_ACCESS prerequisite missing: private bucket %', bucket;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'quotation-attachments') THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS prerequisite missing: quotation-attachments';
  END IF;
END $$;
UPDATE storage.buckets SET public = false WHERE id = 'quotation-attachments';
CREATE POLICY workspace_files_members_only ON storage.objects AS RESTRICTIVE
  FOR ALL TO PUBLIC
  USING (bucket_id NOT IN ('documents', 'case-documents', 'quotation-attachments', 'database_export_15_09_26') OR public.has_workspace_access())
  WITH CHECK (bucket_id NOT IN ('documents', 'case-documents', 'quotation-attachments', 'database_export_15_09_26') OR public.has_workspace_access());

-- Reprise opérateur : SECURITY DEFINER conserve l'atomicité, mais aucun compte
-- extérieur à l'équipe ne peut contourner la RLS par cette RPC.
CREATE OR REPLACE FUNCTION public.reset_attachment_for_retry(p_attachment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  IF NOT public.has_workspace_access() THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_REQUIRED' USING ERRCODE = '42501';
  END IF;
  UPDATE public.email_attachments SET is_analyzed = false, analysis_claimed_at = NULL,
    extracted_text = NULL, extracted_data = NULL
    WHERE id = p_attachment_id AND is_analyzed = true
      AND extracted_data->>'type' IN ('error', 'skipped') RETURNING id INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reset_attachment_for_retry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_attachment_for_retry(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.select_quotation_version(p_version_id uuid, p_case_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_source text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT public.has_workspace_access() THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('qv_select_' || p_case_id::text));
  SELECT source_kind INTO v_source FROM public.quotation_versions
    WHERE id = p_version_id AND case_id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: version introuvable pour ce dossier' USING ERRCODE = '22023';
  END IF;
  IF v_source <> 'canonical' THEN
    RAISE EXCEPTION 'SCENARIO_OUTPUT_NOT_SELECTABLE: une sortie scénario ne peut pas devenir un devis canonique' USING ERRCODE = '23514';
  END IF;
  UPDATE public.quotation_versions SET is_selected = false
    WHERE case_id = p_case_id AND source_kind = 'canonical' AND is_selected = true;
  UPDATE public.quotation_versions SET is_selected = true
    WHERE id = p_version_id AND case_id = p_case_id AND source_kind = 'canonical';
END $$;
-- Supprimer aussi les grants explicites observés en runtime, pas seulement PUBLIC.
REVOKE ALL ON FUNCTION public.select_quotation_version(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_quotation_version(uuid,uuid) TO authenticated, service_role;

-- Locks d'analyse appelés uniquement par analyze-attachments (client serveur).
REVOKE ALL ON FUNCTION public.claim_attachment_for_analysis(uuid,timestamptz),
  public.release_attachment_claim(uuid,timestamptz),
  public.finalize_attachment_analysis(uuid,timestamptz,text,jsonb),
  public.finalize_attachment_analysis_error(uuid,timestamptz,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attachment_for_analysis(uuid,timestamptz),
  public.release_attachment_claim(uuid,timestamptz),
  public.finalize_attachment_analysis(uuid,timestamptz,text,jsonb),
  public.finalize_attachment_analysis_error(uuid,timestamptz,text,jsonb) TO service_role;


-- RPC métier/maintenance historiques : aucun grant client explicite ne doit
-- survivre aux anciennes révocations de PUBLIC. Corps métier inchangés.
REVOKE ALL ON FUNCTION public.commit_decision_atomic(uuid,text,text,uuid,text,text,text,text,text,uuid),
  public.insert_quotation_version_atomic(uuid,uuid,uuid,integer,jsonb,uuid),
  public.insert_historical_quotation_atomic(jsonb,jsonb,jsonb),
  public.get_next_pricing_run_number(uuid),
  public.get_next_quotation_version_number(uuid),
  public.migrate_legacy_quotations(uuid),
  public.finalize_quotation_ownership(),
  public.check_quotation_ownership_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_decision_atomic(uuid,text,text,uuid,text,text,text,text,text,uuid),
  public.insert_quotation_version_atomic(uuid,uuid,uuid,integer,jsonb,uuid),
  public.insert_historical_quotation_atomic(jsonb,jsonb,jsonb),
  public.get_next_pricing_run_number(uuid),
  public.get_next_quotation_version_number(uuid),
  public.migrate_legacy_quotations(uuid),
  public.finalize_quotation_ownership(),
  public.check_quotation_ownership_status() TO service_role;

COMMIT;
