-- MULTI-LOT-TERMINAL-1 — synthetic local fixture only, always rolls back.
-- No customer rows or e-mails. Run on an isolated PostgreSQL with the full schema and
-- migration 20260925120000 applied. Uses the real writers (scenario manager, request
-- line replacement, PAD writer) so the global context hash behaves as in production.
begin;
do $test$
declare
 actor uuid := gen_random_uuid(); cid uuid := gen_random_uuid(); tid uuid := gen_random_uuid();
 scope jsonb; sc jsonb; ctx jsonb; ctx2 jsonb; lines jsonb; fp1 text; fp2 text; h text;
 b1 jsonb; b2 jsonb; t1 jsonb; replay jsonb; p1 jsonb; rid uuid; role_name text; f text; req jsonb; n integer;
 unit_a jsonb; unit_b jsonb;
begin
 insert into auth.users(id, email) values (actor, 'lot-local-test@example.invalid');
 insert into public.email_threads(id, subject_normalized, client_email) values (tid, 'SYNTHETIC LOT TEST', 'lot-local-test@example.invalid');
 insert into public.quote_cases(id, thread_id, status) values (cid, tid, 'READY_TO_PRICE');
 lines := jsonb_build_array(
   jsonb_build_object('line_index', 1, 'line_label', 'Lot conteneurs A', 'request_type_hint', 'SEA_FCL_IMPORT',
     'source_excerpt', 'Synthetic excerpt A', 'segment_text', 'Synthetic segment A',
     'extracted_facts_json', '[{"key":"cargo.containers","value":[{"type":"40HC","quantity":2}]},{"key":"cargo.weight_kg","value":36000}]'::jsonb),
   jsonb_build_object('line_index', 2, 'line_label', 'Lot conteneurs B', 'request_type_hint', 'SEA_FCL_IMPORT',
     'source_excerpt', 'Synthetic excerpt B', 'segment_text', 'Synthetic segment B',
     'extracted_facts_json', '[{"key":"cargo.containers","value":[{"type":"20DV","quantity":1}]},{"key":"cargo.weight_kg","value":12000}]'::jsonb));
 if public.replace_quote_request_lines(cid, lines) <> 2 then raise exception 'fixture lines not stored'; end if;
 unit_a := '{"unit_ref":"a","unit_kind":"CONTAINER","equipment_code":"40hc","packaging":"unknown","quantity":2,"gross_weight_kg":18000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":null,"required_attachment_status":"not_required","ownership":"SOC","un_number":null,"imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic lot A"}'::jsonb;
 unit_b := unit_a || '{"unit_ref":"b","equipment_code":"20dv","quantity":1,"gross_weight_kg":12000,"scenario_basis":"Synthetic lot B"}'::jsonb;
 scope := jsonb_build_object('schema_version', 3, 'transport_mode', 'MARITIME', 'movement_direction', 'IMPORT',
   'terminal_operation_mode', null, 'cargo_units', jsonb_build_array(unit_a, unit_b),
   'pad_choices', '[{"unit_ref":"a","category":"T02","basis":"Synthetic proposal"},{"unit_ref":"b","category":"T03","basis":"Synthetic proposal"}]'::jsonb);
 sc := public.manage_quote_scenario(cid, 'create', actor, 'lot-fixture-create', repeat('a', 64), p_title => 'SYNTHETIC LOT', p_scope_snapshot => scope);
 perform public.manage_quote_scenario(cid, 'select', actor, 'lot-fixture-select', repeat('b', 64), p_scenario_id => (sc->>'scenario_id')::uuid);

 -- Fingerprint: business fields only, deterministic, facts order-insensitive.
 ctx := public.read_lot_confirmation_context(cid);
 if jsonb_array_length(ctx->'lines') <> 2 or (ctx->>'request_count')::int <> 2 then raise exception 'context lines'; end if;
 fp1 := ctx#>>'{lines,0,fingerprint}'; fp2 := ctx#>>'{lines,1,fingerprint}';
 if fp1 = fp2 or fp1 !~ '^[a-f0-9]{64}$' then raise exception 'distinct lines not distinguished'; end if;
 if public.quote_request_line_fingerprint('Lot conteneurs A', 'Synthetic excerpt A', 'Synthetic segment A',
     '[{"key":"cargo.weight_kg","value":36000},{"key":"cargo.containers","value":[{"type":"40HC","quantity":2}]}]') <> fp1 then
   raise exception 'fact order changed the fingerprint'; end if;
 if public.quote_request_line_fingerprint('Lot conteneurs A', 'Synthetic excerpt A', 'Synthetic segment A',
     '[{"key":"cargo.weight_kg","value":36001},{"key":"cargo.containers","value":[{"type":"40HC","quantity":2}]}]') = fp1 then
   raise exception 'fact change not detected'; end if;
 if ctx->>'context_hash' <> public.read_pad_group_context(cid)->>'context_hash' then raise exception 'not the global PAD hash'; end if;

 -- Binding: sourced, actor from caller, idempotent, CAS on context and head.
 req := jsonb_build_object('unit_ref', 'a', 'decision_kind', 'line_binding', 'action', 'confirm', 'line_fingerprint', fp1,
   'terminal_mode', null, 'source_reference', 'Synthetic operator check of line A', 'expected_context_hash', ctx->>'context_hash',
   'expected_head_id', null, 'idempotency_key', gen_random_uuid());
 b1 := public.record_lot_confirmation(cid, actor, req);
 if b1->>'decided_by' <> actor::text or (b1->>'decision_version')::int <> 1 or b1->>'line_fingerprint' <> fp1 then raise exception 'binding not recorded'; end if;
 if public.read_lot_confirmation_context(cid)->>'context_hash' <> ctx->>'context_hash' then raise exception 'decision changed the context'; end if;
 replay := public.record_lot_confirmation(cid, actor, req);
 if replay->>'id' <> b1->>'id' then raise exception 'idempotent replay failed'; end if;
 begin perform public.record_lot_confirmation(cid, actor, req || jsonb_build_object('source_reference', 'Other synthetic source'));
   raise exception 'conflicting replay accepted';
 exception when serialization_failure then if sqlerrm not like '%LOT_IDEMPOTENCY_CONFLICT%' then raise; end if; end;
 begin perform public.record_lot_confirmation(cid, actor, req || jsonb_build_object('actor', actor, 'idempotency_key', gen_random_uuid()));
   raise exception 'actor injection accepted';
 exception when invalid_parameter_value then null; end;
 begin perform public.record_lot_confirmation(cid, actor, req || jsonb_build_object('idempotency_key', gen_random_uuid()));
   raise exception 'stale head accepted';
 exception when serialization_failure then if sqlerrm not like '%LOT_HEAD_CHANGED%' then raise; end if; end;
 begin perform public.record_lot_confirmation(cid, actor, req || jsonb_build_object('expected_context_hash', repeat('0', 64), 'idempotency_key', gen_random_uuid()));
   raise exception 'wrong context accepted';
 exception when serialization_failure then if sqlerrm not like '%LOT_CONTEXT_CHANGED%' then raise; end if; end;
 -- Payload shape: a binding carries a line, never a mode.
 begin perform public.record_lot_confirmation(cid, actor, req || jsonb_build_object('unit_ref', 'b', 'terminal_mode', 'LOLO', 'idempotency_key', gen_random_uuid()));
   raise exception 'mixed payload accepted';
 exception when invalid_parameter_value then null; end;
 -- One line cannot carry two lots; an unknown lot is refused.
 begin perform public.record_lot_confirmation(cid, actor, req || jsonb_build_object('unit_ref', 'b', 'idempotency_key', gen_random_uuid()));
   raise exception 'line bound twice';
 exception when invalid_parameter_value then if sqlerrm not like '%LOT_LINE_ALREADY_BOUND%' then raise; end if; end;
 begin perform public.record_lot_confirmation(cid, actor, req || jsonb_build_object('unit_ref', 'c', 'idempotency_key', gen_random_uuid()));
   raise exception 'unknown lot accepted';
 exception when invalid_parameter_value then if sqlerrm not like '%LOT_UNIT_INVALID%' then raise; end if; end;
 b2 := public.record_lot_confirmation(cid, actor, req || jsonb_build_object('unit_ref', 'b', 'line_fingerprint', fp2,
   'source_reference', 'Synthetic operator check of line B', 'idempotency_key', gen_random_uuid()));

 -- Terminal mode needs a fresh binding of the same lot.
 req := jsonb_build_object('unit_ref', 'a', 'decision_kind', 'terminal_mode', 'action', 'confirm', 'line_fingerprint', null,
   'terminal_mode', 'LOLO', 'source_reference', 'Synthetic vessel schedule', 'expected_context_hash', ctx->>'context_hash',
   'expected_head_id', null, 'idempotency_key', gen_random_uuid());
 t1 := public.record_lot_confirmation(cid, actor, req);
 if t1->>'terminal_mode' <> 'LOLO' then raise exception 'terminal mode not recorded'; end if;
 begin perform public.record_lot_confirmation(cid, actor, req || jsonb_build_object('terminal_mode', 'RO-RO', 'expected_head_id', t1->>'id', 'idempotency_key', gen_random_uuid()));
   raise exception 'invalid mode accepted';
 exception when invalid_parameter_value then null; end;

 -- PAD writer (named change): multi-lot confirmation only for a freshly bound group.
 p1 := public.record_pad_group_confirmation(cid, actor, jsonb_build_object('unit_ref', 'a', 'action', 'confirm', 'category', 'T02',
   'source_reference', 'Synthetic PAD source', 'weight_source_reference', 'Synthetic 18 t per container',
   'expected_context_hash', ctx->>'context_hash', 'expected_head_id', null, 'idempotency_key', gen_random_uuid()));
 if (p1->>'total_weight_kg')::numeric <> 36000 then raise exception 'PAD weight'; end if;
 perform public.record_lot_confirmation(cid, actor, jsonb_build_object('unit_ref', 'b', 'decision_kind', 'line_binding', 'action', 'revoke',
   'line_fingerprint', null, 'terminal_mode', null, 'source_reference', 'Synthetic unbinding', 'expected_context_hash', ctx->>'context_hash',
   'expected_head_id', b2->>'id', 'idempotency_key', gen_random_uuid()));
 begin perform public.record_pad_group_confirmation(cid, actor, jsonb_build_object('unit_ref', 'b', 'action', 'confirm', 'category', 'T03',
     'source_reference', 'Synthetic PAD source', 'weight_source_reference', 'Synthetic 12 t', 'expected_context_hash', ctx->>'context_hash',
     'expected_head_id', null, 'idempotency_key', gen_random_uuid()));
   raise exception 'PAD confirmed on an unbound multi-lot group';
 exception when invalid_parameter_value then if sqlerrm not like '%PAD_LOT_BINDING_REQUIRED%' then raise; end if; end;
 -- Weight reconciliation stays mono-lot only (unchanged writer).
 begin perform public.record_pad_weight_reconciliation(cid, actor, jsonb_build_object('action', 'retain', 'expected_context_hash', ctx->>'context_hash',
     'expected_heads', (select jsonb_agg(e->'id' order by e->>'id') from jsonb_array_elements(public.read_pad_group_context(cid)->'heads') e),
     'expected_head_id', null, 'idempotency_key', gen_random_uuid(), 'justification', 'Synthetic justification', 'reservation', 'Synthetic reservation'));
   raise exception 'multi-lot weight reconciliation accepted';
 exception when invalid_parameter_value then if sqlerrm not like '%PAD_WEIGHT_SCOPE_UNSUPPORTED%' then raise; end if; end;

 -- Completion: decisions and context read by the run must be unchanged under the lock.
 ctx2 := public.read_lot_confirmation_context(cid);
 rid := gen_random_uuid();
 insert into public.pricing_runs(id, case_id, run_number, status, created_by, inputs_json, facts_snapshot) values (rid, cid, 1, 'running', actor, '{}', '[]');
 -- A decision recorded between the run's reading and its completion invalidates the completion.
 perform public.record_lot_confirmation(cid, actor, jsonb_build_object('unit_ref', 'a', 'decision_kind', 'terminal_mode', 'action', 'revoke',
   'line_fingerprint', null, 'terminal_mode', null, 'source_reference', 'Synthetic revocation', 'expected_context_hash', ctx2->>'context_hash',
   'expected_head_id', t1->>'id', 'idempotency_key', gen_random_uuid()));
 begin perform public.complete_lot_pricing(cid, rid, ctx2->>'context_hash', ctx2->'pad_heads', ctx2->'heads', null,
     '{"status":"success","tariff_lines":[],"total_ht":1,"total_ttc":1,"currency":"XOF","completed_at":"2026-09-25T12:00:00Z","duration_ms":1}');
   raise exception 'completion with changed lot decisions accepted';
 exception when serialization_failure then if sqlerrm not like '%LOT_CONTEXT_CHANGED%' then raise; end if; end;
 if (select status from public.pricing_runs where id = rid) <> 'running' then raise exception 'failed completion mutated the run'; end if;
 ctx2 := public.read_lot_confirmation_context(cid);
 perform public.complete_lot_pricing(cid, rid, ctx2->>'context_hash', ctx2->'pad_heads', ctx2->'heads', (ctx2->>'weight_head_id')::uuid,
   '{"status":"success","tariff_lines":[],"total_ht":7,"total_ttc":7,"currency":"XOF","completed_at":"2026-09-25T12:00:00Z","duration_ms":1}');
 if (select total_ht from public.pricing_runs where id = rid) <> 7 then raise exception 'valid completion failed'; end if;

 -- Re-analysis with identical business content: new line ids, same fingerprints, new
 -- global hash. Every decision is stale; nothing is re-associated.
 h := ctx2->>'context_hash';
 perform public.replace_quote_request_lines(cid, lines);
 ctx := public.read_lot_confirmation_context(cid);
 if ctx->>'context_hash' = h then raise exception 're-analysis did not change the context'; end if;
 if ctx#>>'{lines,0,fingerprint}' <> fp1 or ctx#>>'{lines,1,fingerprint}' <> fp2 then raise exception 'fingerprint depends on technical fields'; end if;
 if exists (select 1 from jsonb_array_elements(ctx->'heads') x where x->>'context_hash' = ctx->>'context_hash') then raise exception 'decision survived re-analysis'; end if;
 rid := gen_random_uuid();
 insert into public.pricing_runs(id, case_id, run_number, status, created_by, inputs_json, facts_snapshot) values (rid, cid, 2, 'running', actor, '{}', '[]');
 begin perform public.complete_lot_pricing(cid, rid, h, ctx2->'pad_heads', ctx2->'heads', null, '{"status":"success"}');
   raise exception 'completion after re-analysis accepted';
 exception when serialization_failure then null; end;
 -- A stale decision can still be revoked against the current context.
 perform public.record_lot_confirmation(cid, actor, jsonb_build_object('unit_ref', 'a', 'decision_kind', 'line_binding', 'action', 'revoke',
   'line_fingerprint', null, 'terminal_mode', null, 'source_reference', 'Synthetic cleanup of a stale binding', 'expected_context_hash', ctx->>'context_hash',
   'expected_head_id', b1->>'id', 'idempotency_key', gen_random_uuid()));

 -- Indiscernible lines: assignment refused, clarification required.
 perform public.replace_quote_request_lines(cid, jsonb_build_array(lines->0, (lines->0) || '{"line_index":2}'::jsonb));
 ctx := public.read_lot_confirmation_context(cid);
 if ctx#>>'{lines,0,fingerprint}' <> ctx#>>'{lines,1,fingerprint}' then raise exception 'duplicate lines distinguished by position'; end if;
 b1 := (select x from jsonb_array_elements(ctx->'heads') x where x->>'unit_ref' = 'a' and x->>'decision_kind' = 'line_binding');
 begin perform public.record_lot_confirmation(cid, actor, jsonb_build_object('unit_ref', 'a', 'decision_kind', 'line_binding', 'action', 'confirm',
     'line_fingerprint', fp1, 'terminal_mode', null, 'source_reference', 'Synthetic attempt', 'expected_context_hash', ctx->>'context_hash',
     'expected_head_id', b1->>'id', 'idempotency_key', gen_random_uuid()));
   raise exception 'ambiguous line assigned';
 exception when invalid_parameter_value then if sqlerrm not like '%LOT_LINE_AMBIGUOUS%' then raise; end if; end;

 -- Scenario revision releases the selection: no confirmation without a selected scenario;
 -- once the revision is selected, a new binding is attached to it only.
 perform public.replace_quote_request_lines(cid, lines);
 sc := public.manage_quote_scenario(cid, 'revise', actor, 'lot-fixture-revise', repeat('c', 64), p_scenario_id => (sc->>'scenario_id')::uuid,
   p_title => 'SYNTHETIC LOT', p_scope_snapshot => scope || '{"terminal_operation_mode":"LOLO"}'::jsonb, p_revision_reason => 'Synthetic revision');
 ctx := public.read_lot_confirmation_context(cid);
 if ctx->'scenario' <> 'null'::jsonb then raise exception 'revision kept a selection'; end if;
 begin perform public.record_lot_confirmation(cid, actor, jsonb_build_object('unit_ref', 'b', 'decision_kind', 'line_binding', 'action', 'confirm',
     'line_fingerprint', fp2, 'terminal_mode', null, 'source_reference', 'Synthetic attempt', 'expected_context_hash', ctx->>'context_hash',
     'expected_head_id', (select x->>'id' from jsonb_array_elements(ctx->'heads') x where x->>'unit_ref' = 'b' and x->>'decision_kind' = 'line_binding'),
     'idempotency_key', gen_random_uuid()));
   raise exception 'binding without a selected scenario accepted';
 exception when invalid_parameter_value then if sqlerrm not like '%LOT_SCOPE_UNSUPPORTED%' then raise; end if; end;
 perform public.manage_quote_scenario(cid, 'select', actor, 'lot-fixture-select-2', repeat('d', 64), p_scenario_id => (sc->>'scenario_id')::uuid);
 ctx := public.read_lot_confirmation_context(cid);
 if ctx#>>'{scenario,id}' is distinct from sc->>'scenario_id' then raise exception 'revision not selected'; end if;
 b2 := public.record_lot_confirmation(cid, actor, jsonb_build_object('unit_ref', 'b', 'decision_kind', 'line_binding', 'action', 'confirm',
   'line_fingerprint', fp2, 'terminal_mode', null, 'source_reference', 'Synthetic check after revision', 'expected_context_hash', ctx->>'context_hash',
   'expected_head_id', (select x->>'id' from jsonb_array_elements(ctx->'heads') x where x->>'unit_ref' = 'b' and x->>'decision_kind' = 'line_binding'),
   'idempotency_key', gen_random_uuid()));
 if b2->>'scenario_id' <> ctx#>>'{scenario,id}' or (b2->>'decision_version')::int <> 3 then raise exception 'binding not attached to the revision'; end if;

 -- Locked dossier: no decision at all.
 update public.quote_cases set status = 'SENT' where id = cid;
 begin perform public.record_lot_confirmation(cid, actor, jsonb_build_object('unit_ref', 'a', 'decision_kind', 'line_binding', 'action', 'revoke',
     'line_fingerprint', null, 'terminal_mode', null, 'source_reference', 'Synthetic attempt', 'expected_context_hash', ctx->>'context_hash',
     'expected_head_id', null, 'idempotency_key', gen_random_uuid()));
   raise exception 'locked case accepted a decision';
 exception when invalid_parameter_value then if sqlerrm not like '%LOT_CASE_LOCKED%' then raise; end if; end;

 -- Constraint: an incoherent row cannot exist even for the owner.
 begin
   insert into public.quote_lot_confirmations(case_id, scenario_id, scope_hash, context_hash, unit_ref, decision_kind, action,
     line_fingerprint, terminal_mode, source_reference, decided_by, decision_version, idempotency_key, request_fingerprint)
   values (cid, (sc->>'scenario_id')::uuid, repeat('a', 64), repeat('a', 64), 'z', 'terminal_mode', 'confirm', fp1, null,
     'Synthetic', actor, 1, gen_random_uuid(), repeat('a', 64));
   raise exception 'incoherent row accepted';
 exception when check_violation then null; end;

 -- Rights: browser roles see nothing; the registry is append-only for the service role.
 foreach role_name in array array['anon', 'authenticated', 'sandbox_exec'] loop
   if has_table_privilege(role_name, 'public.quote_lot_confirmations', 'SELECT,INSERT,UPDATE,DELETE') then raise exception 'browser table access'; end if;
   foreach f in array array['public.quote_request_line_fingerprint(text,text,text,jsonb)', 'public.read_lot_confirmation_context(uuid)',
     'public.record_lot_confirmation(uuid,uuid,jsonb)', 'public.complete_lot_pricing(uuid,uuid,text,jsonb,jsonb,uuid,jsonb)'] loop
     if has_function_privilege(role_name, f, 'EXECUTE') then raise exception 'browser RPC access %', f; end if;
   end loop;
 end loop;
 if has_table_privilege('service_role', 'public.quote_lot_confirmations', 'UPDATE,DELETE') then raise exception 'mutable registry'; end if;
 if not has_function_privilege('service_role', 'public.record_pad_group_confirmation(uuid,uuid,jsonb)', 'EXECUTE') then raise exception 'PAD writer ACL lost'; end if;
 if has_function_privilege('authenticated', 'public.record_pad_group_confirmation(uuid,uuid,jsonb)', 'EXECUTE') then raise exception 'PAD writer opened'; end if;
 select count(*) into n from public.quote_lot_confirmations where case_id = cid;
 if n <> 7 then raise exception 'unexpected registry writes: %', n; end if;
 raise notice 'PASS LOT registry: fingerprint, binding, terminal, PAD named change, CAS, replay, completion race, re-analysis, ambiguity, revocation, lock, ACL';
end;
$test$;
rollback;
