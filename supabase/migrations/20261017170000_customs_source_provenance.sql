BEGIN;
-- Extend only the current source context. Existing immutable decisions and snapshots remain intact.
CREATE OR REPLACE FUNCTION public.customs_basis_context(p_case uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object(
  'proposal_schema_version',2,
  'scope',jsonb_build_object('case_id',c.id,'request_type',c.request_type,'thread_id',c.thread_id,'created_by',c.created_by,'assigned_to',c.assigned_to,
   'lot_count',(SELECT count(*) FROM public.quote_request_lines l WHERE l.case_id=c.id),
   'request_lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'line_index',l.line_index,'line_label',l.line_label,'source_email_id',l.source_email_id) ORDER BY l.line_index,l.id) FROM public.quote_request_lines l WHERE l.case_id=c.id),'[]'::jsonb),
   'package',(SELECT value_text FROM public.quote_facts WHERE case_id=c.id AND is_current AND fact_key='service.package' LIMIT 1),
   'incoterm',(SELECT upper(value_text) FROM public.quote_facts WHERE case_id=c.id AND is_current AND fact_key='routing.incoterm' LIMIT 1)),
  'facts',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.quote_facts f WHERE f.case_id=c.id AND f.is_current),'[]'::jsonb),
  'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'extracted_data',a.extracted_data,
    'email_id',e.id,'email_sent_at',e.sent_at,'email_received_at',e.received_at,'email_subject',e.subject,
    'email_body_text',left(e.body_text,8000),'created_at',a.created_at) ORDER BY a.id)
   FROM public.email_attachments a JOIN public.emails e ON e.id=a.email_id WHERE e.thread_ref=c.thread_id),'[]'::jsonb),
  'profiles',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.code_normalized) FROM public.hs_codes h WHERE left(h.code_normalized,6) IN (
   SELECT DISTINCT left(regexp_replace(v#>>'{}','\D','','g'),6) FROM public.email_attachments a JOIN public.emails e ON e.id=a.email_id,
    LATERAL jsonb_path_query(a.extracted_data,'$.**.hs_code') v WHERE e.thread_ref=c.thread_id AND length(regexp_replace(v#>>'{}','\D','','g'))>=6)),'[]'::jsonb),
  'regimes',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.code) FROM public.customs_regimes r WHERE r.is_active),'[]'::jsonb)
 ) INTO result FROM public.quote_cases c WHERE c.id=p_case;
 IF result IS NULL OR octet_length(result::text)>=2000000 OR jsonb_array_length(result->'attachments')>100 OR jsonb_array_length(result->'profiles')>100 THEN RAISE EXCEPTION 'Customs source unavailable or too large'; END IF;
 RETURN result;
END; $$;
COMMIT;
