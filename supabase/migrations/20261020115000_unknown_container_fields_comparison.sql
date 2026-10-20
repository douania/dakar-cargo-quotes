-- Null optional ownership (including its legacy alias) and notes carry no value.
-- Compare them with absence; preserve explicit values, lot identities and raw receipts.
BEGIN;
DO $patch$ DECLARE definition text; anchor text; BEGIN
 IF md5(replace(pg_get_functiondef('public.equipment_notation_inventory(jsonb)'::regprocedure),chr(13),''))<>'a7a1c15fd12a07aabe54773de18dca15'
  OR has_function_privilege('anon','public.equipment_notation_inventory(jsonb)','execute')
  OR has_function_privilege('authenticated','public.equipment_notation_inventory(jsonb)','execute')
  OR has_function_privilege('service_role','public.equipment_notation_inventory(jsonb)','execute')
 THEN RAISE EXCEPTION 'Unexpected equipment comparison baseline or grants'; END IF;
 definition:=replace(pg_get_functiondef('public.equipment_notation_inventory(jsonb)'::regprocedure),chr(13),'');
 anchor:='  result:=result||jsonb_build_array(jsonb_set(row,''{type}'',to_jsonb(code)));';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Equipment comparison append anchor missing'; END IF;
 definition:=replace(definition,anchor,E'  row:=CASE WHEN row->''coc_soc''=''null''::jsonb THEN row-''coc_soc'' ELSE row END;\n  row:=CASE WHEN row->''cocSoc''=''null''::jsonb THEN row-''cocSoc'' ELSE row END;\n  row:=CASE WHEN row->''notes''=''null''::jsonb THEN row-''notes'' ELSE row END;\n'||anchor);
 EXECUTE definition;
END $patch$;
COMMIT;
