-- Full restored schema only: real scenario/PAD/gap/finalization RPCs, no stubs.
begin;
do $test$
declare actor uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); tid uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid();
 scope jsonb; sc jsonb; ctx jsonb; req jsonb; d jsonb; r jsonb; heads jsonb; original text;
 fixture_email text:=coalesce(nullif(current_setting('dcq.weight_fixture_email',true),''),actor::text||'@example.invalid');
begin
 insert into auth.users(id,email) values(actor,fixture_email);
 insert into public.email_threads(id,subject_normalized,client_email) values(tid,'SYNTHETIC WEIGHT FULL',fixture_email);
 insert into public.quote_cases(id,thread_id) values(cid,tid);
 insert into public.quote_facts(id,case_id,fact_key,fact_category,value_number,source_type,is_current)
 values(fid,cid,'cargo.weight_kg','cargo',35000,'ai_extraction',true);
 insert into public.quote_facts(case_id,fact_key,fact_category,value_json,source_type,is_current)
 values(cid,'cargo.containers','cargo','[{"type":"20HQ","quantity":2,"coc_soc":"SOC"}]','ai_extraction',true);
 insert into public.quote_facts(case_id,fact_key,fact_category,value_text,source_type,is_current)
 values(cid,'service.package','service','DAP_PROJECT_IMPORT','ai_extraction',true);
 scope:='{"schema_version":3,"transport_mode":"MARITIME","movement_direction":"IMPORT","terminal_operation_mode":null,"cargo_units":[{"unit_ref":"a","unit_kind":"CONTAINER","equipment_code":"20hq","packaging":"unknown","quantity":2,"gross_weight_kg":18000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":null,"required_attachment_status":"not_required","ownership":"SOC","un_number":null,"imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic client source"}],"pad_choices":[{"unit_ref":"a","category":"T02","basis":"Synthetic classification"}]}'::jsonb;
 sc:=public.manage_quote_scenario(cid,'create',actor,'weight-full-create',repeat('a',64),p_title=>'SYNTHETIC WEIGHT FULL',p_scope_snapshot=>scope);
 perform public.manage_quote_scenario(cid,'select',actor,'weight-full-select',repeat('b',64),p_scenario_id=>(sc->>'scenario_id')::uuid);
 ctx:=public.read_pad_group_context(cid); original:=ctx->>'context_hash';
 req:=jsonb_build_object('unit_ref','a','action','confirm','category','T02','source_reference','Synthetic equipment source',
  'weight_source_reference','Synthetic two units of 18t','expected_context_hash',original,'expected_head_id',null,'idempotency_key',gen_random_uuid());
 d:=public.record_pad_group_confirmation(cid,actor,req);
 ctx:=public.read_pad_weight_context(cid); heads:=ctx->'heads';
 perform public.sync_pad_weight_gap(cid,original,heads,false,'Synthetic weight conflict',null);
 if not exists(select 1 from public.quote_gaps where case_id=cid and status='open') then raise exception 'gap not opened'; end if;
 req:=jsonb_build_object('action','retain','expected_context_hash',original,'expected_heads',jsonb_build_array(d->'id'),
  'expected_head_id',null,'idempotency_key',gen_random_uuid(),'justification','Synthetic client total two times eighteen tonnes.',
  'reservation','Commercial weight revisable against final transport documents.');
 r:=public.record_pad_weight_reconciliation(cid,actor,req);
 if (r->>'total_weight_kg')::numeric<>36000 then raise exception 'total not derived'; end if;
 if public.read_pad_group_context(cid)->>'context_hash'<>original then raise exception 'PAD hash changed'; end if;
 if public.read_pad_group_context(cid)->'heads' is distinct from heads then raise exception 'confirmations replaced'; end if;
 if public.record_pad_weight_reconciliation(cid,actor,req)->>'id'<>r->>'id' then raise exception 'replay failed'; end if;
 perform public.sync_pad_weight_gap(cid,original,heads,true,'Synthetic reconciled',(r->>'id')::uuid);
 if exists(select 1 from public.quote_gaps where case_id=cid and status='open') then raise exception 'gap not closed'; end if;
 insert into public.pricing_runs(id,case_id,status,inputs_json,facts_snapshot) values(rid,cid,'running','{}','[]');
 perform public.complete_pad_weight_pricing(cid,rid,original,heads,
  jsonb_build_object('status','success','total_ht',3600,'currency','XOF','outputs_json',jsonb_build_object('weight_reconciliation',r)),(r->>'id')::uuid);
 if not exists(select 1 from public.pricing_runs where id=rid and status='success' and total_ht=3600) then raise exception 'finalization failed'; end if;
 update public.quote_facts set source_type='operator' where id=fid;
 if public.read_pad_group_context(cid)->>'context_hash'<>original then raise exception 'fixture should preserve original hash'; end if;
 perform public.sync_pad_weight_gap(cid,original,heads,false,'Synthetic source changed',(r->>'id')::uuid);
 if not exists(select 1 from public.quote_gaps where case_id=cid and status='open') then raise exception 'gap not reopened'; end if;
 begin
  perform public.sync_pad_weight_gap(cid,original,heads,true,'Invalid closure',(r->>'id')::uuid);
  raise exception 'source drift closed gap';
 exception when serialization_failure then null; end;
 begin
  perform public.complete_pad_weight_pricing(cid,rid,original,heads,'{"status":"success"}',(r->>'id')::uuid);
  raise exception 'source drift finalized run';
 exception when serialization_failure then null; end;
 if (select value_number from public.quote_facts where id=fid)<>35000 then raise exception 'fact value changed'; end if;
 if (select count(*) from public.pad_group_confirmations where case_id=cid)<>1 then raise exception 'PAD decisions changed'; end if;
 raise notice 'PAD_WEIGHT_FULL_SCHEMA_PASS';
end;
$test$;
rollback;
