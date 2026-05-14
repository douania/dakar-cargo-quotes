DO $rb$
DECLARE
  v_case_id     uuid;
  v_remain_case int;
  v_remain_cand int;
  v_remain_fact int;
  v_remain_tl   int;
BEGIN
  SELECT id INTO v_case_id FROM public._map6_t1_seed_ids WHERE kind='case' LIMIT 1;

  -- Delete timelines explicitly tracked
  DELETE FROM public.case_timeline_events
   WHERE id IN (SELECT id FROM public._map6_t1_seed_ids WHERE kind='timeline');
  -- Safety net: any remaining timelines tied to the sandbox case
  DELETE FROM public.case_timeline_events WHERE case_id = v_case_id;

  -- Delete facts explicitly tracked
  DELETE FROM public.quote_facts
   WHERE id IN (SELECT id FROM public._map6_t1_seed_ids WHERE kind='fact');
  -- Safety net: any remaining facts tied to the sandbox case
  DELETE FROM public.quote_facts WHERE case_id = v_case_id;

  -- Delete candidates
  DELETE FROM public.commodity_classification_candidates
   WHERE id IN (SELECT id FROM public._map6_t1_seed_ids WHERE kind='candidate');
  -- Safety net
  DELETE FROM public.commodity_classification_candidates WHERE case_id = v_case_id;

  -- Delete sandbox case
  DELETE FROM public.quote_cases
   WHERE id IN (SELECT id FROM public._map6_t1_seed_ids WHERE kind='case');

  -- Postcheck
  SELECT COUNT(*) INTO v_remain_case FROM public.quote_cases WHERE id = v_case_id;
  SELECT COUNT(*) INTO v_remain_cand FROM public.commodity_classification_candidates WHERE case_id = v_case_id;
  SELECT COUNT(*) INTO v_remain_fact FROM public.quote_facts WHERE case_id = v_case_id;
  SELECT COUNT(*) INTO v_remain_tl   FROM public.case_timeline_events WHERE case_id = v_case_id;

  IF v_remain_case + v_remain_cand + v_remain_fact + v_remain_tl > 0 THEN
    RAISE EXCEPTION 'MAP-6 rollback INCOMPLETE: case=% cand=% fact=% tl=%',
      v_remain_case, v_remain_cand, v_remain_fact, v_remain_tl;
  END IF;
END
$rb$;

DROP TABLE IF EXISTS public._map6_t1_test_log;
DROP TABLE IF EXISTS public._map6_t1_seed_ids;