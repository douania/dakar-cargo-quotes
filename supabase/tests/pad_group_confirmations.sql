-- Synthetic local fixture only, always rolls back. No customer rows or emails.
begin;
do $test$
declare actor uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); tid uuid:=gen_random_uuid();
 scope jsonb; sc jsonb; ctx jsonb; req jsonb; d jsonb; d2 jsonb; replay jsonb;
 rid uuid:=gen_random_uuid(); role_name text; f text; before_hash text;
begin
 insert into auth.users(id,email) values(actor,'pad-local-test@example.invalid');
 insert into public.email_threads(id,subject_normalized,client_email) values(tid,'SYNTHETIC PAD TEST','pad-local-test@example.invalid');
 insert into public.quote_cases(id,thread_id) values(cid,tid);
 scope:='{"schema_version":3,"transport_mode":"MARITIME","movement_direction":"IMPORT","terminal_operation_mode":null,"cargo_units":[{"unit_ref":"a","unit_kind":"CONTAINER","equipment_code":"20hq","packaging":"unknown","quantity":2,"gross_weight_kg":18000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":null,"required_attachment_status":"not_required","ownership":"SOC","un_number":null,"imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic local source"}],"pad_choices":[{"unit_ref":"a","category":"T02","basis":"Synthetic classification proposal"}]}'::jsonb;
 sc:=public.manage_quote_scenario(cid,'create',actor,'pad-confirmation-fixture',repeat('a',64),p_title=>'SYNTHETIC LOCAL PAD',p_scope_snapshot=>scope);
 perform public.manage_quote_scenario(cid,'select',actor,'pad-confirmation-select',repeat('b',64),p_scenario_id=>(sc->>'scenario_id')::uuid);
 ctx:=public.read_pad_group_context(cid); before_hash:=ctx->>'context_hash';
 req:=jsonb_build_object('unit_ref','a','action','confirm','category','T02','source_reference','Synthetic source document',
   'weight_source_reference','Synthetic 18 t per container source','expected_context_hash',before_hash,'expected_head_id',null,'idempotency_key',gen_random_uuid());
 d:=public.record_pad_group_confirmation(cid,actor,req);
 if (d->>'total_weight_kg')::numeric<>36000 or d->>'decided_by'<>actor::text then raise exception 'wrong weight or actor'; end if;
 if public.read_pad_group_context(cid)->>'context_hash'<>before_hash then raise exception 'decision changed its own context'; end if;
 replay:=public.record_pad_group_confirmation(cid,actor,req);
 if replay->>'id'<>d->>'id' then raise exception 'idempotency failed'; end if;
 begin
   perform public.record_pad_group_confirmation(cid,actor,req||'{"category":"T03"}');
   raise exception 'conflicting replay accepted';
 exception when serialization_failure then null; end;
 begin
   perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('actor',actor,'idempotency_key',gen_random_uuid()));
   raise exception 'actor injection accepted';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('idempotency_key',gen_random_uuid()));
   raise exception 'stale head accepted';
 exception when serialization_failure then null; end;
 d2:=public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('expected_head_id',d->>'id','idempotency_key',gen_random_uuid(),'category','T03'));
 if (d2->>'decision_version')::int<>2 then raise exception 'version not incremented'; end if;
 ctx:=public.read_pad_group_context(cid);
 insert into public.pricing_runs(id,case_id,run_number,status,created_by,inputs_json,facts_snapshot) values(rid,cid,1,'running',actor,'{}','[]');
 perform public.complete_pad_group_pricing(cid,rid,ctx->>'context_hash',ctx->'heads',
   '{"status":"success","engine_request":{},"engine_response":{},"outputs_json":{},"tariff_lines":[],"total_ht":3600,"total_ttc":3600,"currency":"XOF","tariff_sources":[],"completed_at":"2026-09-17T12:00:00Z","duration_ms":1}');
 if (select total_ht from public.pricing_runs where id=rid)<>3600 then raise exception 'valid completion failed'; end if;
 rid:=gen_random_uuid();
 insert into public.quote_gaps(case_id,gap_key,gap_category,question_fr,is_blocking,status) values(cid,'pricing.pad_category','pricing','Synthetic PAD gap',true,'open');
 perform public.sync_pad_group_gap(cid,ctx->>'context_hash',ctx->'heads',true,'Synthetic PAD question');
 if exists(select 1 from public.quote_gaps where case_id=cid and gap_key='pricing.pad_category' and status='open') then raise exception 'gap not closed'; end if;
 -- Concurrency interleaving: reader kept old heads; a new writer won.
 perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('expected_head_id',d2->>'id','idempotency_key',gen_random_uuid(),'action','revoke','category',null));
 begin
   perform public.sync_pad_group_gap(cid,ctx->>'context_hash',ctx->'heads',true,'Synthetic PAD question');
   raise exception 'stale gap close accepted';
 exception when serialization_failure then null; end;
 insert into public.pricing_runs(id,case_id,run_number,status,created_by,inputs_json,facts_snapshot) values(rid,cid,2,'running',actor,'{}','[]');
 begin
   perform public.complete_pad_group_pricing(cid,rid,ctx->>'context_hash',ctx->'heads','{"status":"success"}');
   raise exception 'concurrent revoked pricing accepted';
 exception when serialization_failure then null; end;
 if (select status from public.pricing_runs where id=rid)<>'running' then raise exception 'failed completion mutated run'; end if;
 update public.email_threads set client_email='changed@example.invalid' where id=tid;
 if public.read_pad_group_context(cid)->>'context_hash'=before_hash then raise exception 'source drift not detected'; end if;
 begin
   perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('expected_head_id',d2->>'id','idempotency_key',gen_random_uuid()));
   raise exception 'stale source accepted';
 exception when serialization_failure then null; end;
 update public.quote_cases set status='SENT' where id=cid;
 begin
   perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('idempotency_key',gen_random_uuid()));
   raise exception 'locked case accepted a decision';
 exception when invalid_parameter_value then
   if sqlerrm not like '%PAD_CASE_LOCKED%' then raise; end if;
 end;
 foreach role_name in array array['anon','authenticated'] loop
   if has_table_privilege(role_name,'public.pad_group_confirmations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'operator table access'; end if;
   foreach f in array array['public.read_pad_group_context(uuid)','public.record_pad_group_confirmation(uuid,uuid,jsonb)',
     'public.sync_pad_group_gap(uuid,text,jsonb,boolean,text)','public.complete_pad_group_pricing(uuid,uuid,text,jsonb,jsonb)'] loop
     if has_function_privilege(role_name,f,'EXECUTE') then raise exception 'operator RPC access'; end if;
   end loop;
 end loop;
 if has_table_privilege('service_role','public.pad_group_confirmations','UPDATE,DELETE') then raise exception 'mutable registry'; end if;
 if (select count(*) from public.pad_group_confirmations where case_id=cid)<>3 then raise exception 'unexpected writes'; end if;
 raise notice 'PASS PAD registry: weight, actor, replay, CAS, drift, gap, pricing success/race guard, locked case, ACL';
end;
$test$;
rollback;
