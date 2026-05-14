REVOKE EXECUTE ON FUNCTION public.supersede_fact(
  uuid, text, text, text, numeric, jsonb, timestamptz, text, uuid, uuid, text, numeric
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.propagate_classification_candidate_to_fact(
  uuid, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.propagate_classification_candidate_to_fact(
  uuid, text
) TO authenticated;