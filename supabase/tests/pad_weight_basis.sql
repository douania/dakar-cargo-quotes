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

 req:=req||jsonb_build_object('weight_basis','provisional','weight_reservation','18 tonnes par conteneur ; base révisable selon documents définitifs.');
 d:=public.record_pad_group_confirmation(cid,actor,req);
 if d->>'weight_basis'<>'provisional' or (d->>'total_weight_kg')::numeric<>36000 then raise exception 'provisional basis lost'; end if;
 replay:=public.record_pad_group_confirmation(cid,actor,req);
 if replay->>'id'<>d->>'id' then raise exception 'idempotency failed'; end if;
 begin
  perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('weight_reservation','Changed reserve'));
  raise exception 'reservation drift replay accepted';
 exception when serialization_failure then null; end;
 req:=req||jsonb_build_object('expected_head_id',d->>'id','idempotency_key',gen_random_uuid());
 begin
  perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('weight_reservation',''));
  raise exception 'missing reserve accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('weight_basis','invalid'));
  raise exception 'invalid basis accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('weight_basis','confirmed'));
  raise exception 'confirmed with reserve accepted';
 exception when invalid_parameter_value then null; end;
 d2:=public.record_pad_group_confirmation(cid,actor,req||jsonb_build_object('weight_basis','confirmed','weight_reservation',''));
 if d2->>'weight_basis'<>'confirmed' or d2->>'id'=d->>'id' then raise exception 'revision failed'; end if;
 if (select count(*) from public.pad_group_confirmations where case_id=cid)<>2 then raise exception 'history overwritten'; end if;
 if exists(select 1 from public.quote_facts where case_id=cid) then raise exception 'client facts written'; end if;
 raise notice 'PAD_WEIGHT_BASIS_SQL_PASS';
end;
$test$;
rollback;

