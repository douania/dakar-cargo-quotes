-- Focused local harness; outer transaction leaves no synthetic decisions behind.
begin;
do $test$
declare cid uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid();
 heads jsonb; ctx jsonb; req jsonb; d jsonb; again jsonb; original jsonb; hash text:=repeat('a',64); fn record;
begin
 insert into auth.users values(actor);
 insert into public.quote_cases(id) values(cid);
 insert into public.quote_facts(id,case_id,fact_key,value_number,source_type) values(fid,cid,'cargo.weight_kg',2361000,'ai_extraction');
 heads:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'unit_ref','a','action','confirm','context_hash',hash,
  'scenario_id',sid,'scope_hash',hash,'total_weight_kg',2424000));
 ctx:=jsonb_build_object('case_id',cid,'context_hash',hash,'heads',heads,'request_count',0,'scenario',jsonb_build_object('id',sid,'scope_hash',hash,'status','draft',
  'scope_snapshot',jsonb_build_object('schema_version',3,'transport_mode','MARITIME','movement_direction','IMPORT','cargo_units',
   jsonb_build_array(jsonb_build_object('unit_ref','a','unit_kind','CONTAINER','weight_basis','total','gross_weight_kg',2424000)))));
 insert into public.fixture_pad_context values(cid,ctx);
 original:=public.read_pad_group_context(cid);
 req:=jsonb_build_object('action','retain','expected_context_hash',hash,'expected_heads',(select jsonb_agg(h->'id' order by h->>'id') from jsonb_array_elements(heads) h),'expected_head_id',null,
  'idempotency_key',gen_random_uuid(),'justification','Synthetic client source rechecked, extracted sum incorrect.',
  'reservation','Commercial provisional total, revisable after final documents.');
 d:=public.record_pad_weight_reconciliation(cid,actor,req);
 if (d->>'total_weight_kg')::numeric<>2424000 then raise exception 'wrong retained weight'; end if;
 if public.read_pad_group_context(cid) is distinct from original then raise exception 'category context changed'; end if;
 if (select value_number from public.quote_facts where id=fid)<>2361000 then raise exception 'fact changed'; end if;
 again:=public.record_pad_weight_reconciliation(cid,actor,req);
 if again->>'id'<>d->>'id' then raise exception 'replay duplicated'; end if;
 begin
  perform public.record_pad_weight_reconciliation(cid,actor,req||jsonb_build_object('reservation','Different reservation'));
  raise exception 'changed replay accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.record_pad_weight_reconciliation(cid,actor,req||jsonb_build_object('idempotency_key',gen_random_uuid()));
  raise exception 'stale head accepted';
 exception when serialization_failure then null; end;
 perform public.sync_pad_weight_gap(cid,hash,heads,true,'Synthetic gap',(d->>'id')::uuid);
 perform public.complete_pad_weight_pricing(cid,gen_random_uuid(),hash,heads,'{}',(d->>'id')::uuid);
 begin
  perform public.complete_pad_weight_pricing(cid,gen_random_uuid(),hash,heads,'{}',null);
  raise exception 'unpinned reconciliation accepted';
 exception when serialization_failure then null; end;
 -- Provenance drift does not change the old PAD hash, but must stop finalization.
 update public.quote_facts set source_type='operator' where id=fid;
 begin
  perform public.complete_pad_weight_pricing(cid,gen_random_uuid(),hash,heads,'{}',(d->>'id')::uuid);
  raise exception 'provenance drift accepted';
 exception when serialization_failure then null; end;
 if (select count(*) from public.fixture_finalizations)<>2 then raise exception 'blocked finalization wrote'; end if;
 perform public.sync_pad_weight_gap(cid,hash,heads,false,'Weight provenance changed',(d->>'id')::uuid);
 if (select count(*) from public.fixture_finalizations)<>3 then raise exception 'gap reopening refused'; end if;
 begin
  perform public.sync_pad_weight_gap(cid,hash,heads,true,'Synthetic gap',(d->>'id')::uuid);
  raise exception 'invalid reconciliation closed gap';
 exception when serialization_failure then null; end;
 update public.quote_facts set source_type='ai_extraction' where id=fid;
 req:=req||jsonb_build_object('expected_head_id',d->>'id','idempotency_key',gen_random_uuid(),'action','revoke');
 again:=public.record_pad_weight_reconciliation(cid,actor,req);
 if again->>'action'<>'revoke' or (select count(*) from public.pad_weight_reconciliations where case_id=cid)<>2 then raise exception 'history lost'; end if;
 begin
  perform public.assert_pad_weight_head(cid,(d->>'id')::uuid);
  raise exception 'concurrent revocation ignored';
 exception when serialization_failure then null; end;
 req:=req||jsonb_build_object('expected_head_id',again->>'id','idempotency_key',gen_random_uuid(),'action','retain');
 update public.quote_facts set source_type='operator' where id=fid;
 begin
  perform public.record_pad_weight_reconciliation(cid,actor,req);
  raise exception 'non-extracted fact overridden';
 exception when invalid_parameter_value then null; end;
 update public.quote_facts set source_type='ai_extraction' where id=fid;
 update public.quote_cases set status='SENT' where id=cid;
 begin
  perform public.record_pad_weight_reconciliation(cid,actor,req);
  raise exception 'locked case accepted';
 exception when invalid_parameter_value then null; end;
 for fn in select oid from pg_proc where pronamespace='public'::regnamespace and proname in
  ('read_pad_weight_context','record_pad_weight_reconciliation','assert_pad_weight_head','sync_pad_weight_gap','complete_pad_weight_pricing') loop
  if has_function_privilege('anon',fn.oid,'EXECUTE') or has_function_privilege('authenticated',fn.oid,'EXECUTE') or
   has_function_privilege('fixture_sandbox',fn.oid,'EXECUTE') then raise exception 'inherited ACL leaked'; end if;
 end loop;
 if has_table_privilege('authenticated','public.pad_weight_reconciliations','SELECT') or
  has_table_privilege('service_role','public.pad_weight_reconciliations','INSERT') then raise exception 'registry privilege leaked'; end if;
 raise notice 'PAD_WEIGHT_RECONCILIATION_FOCUSED_PASS';
end;
$test$;
rollback;
