-- Only before any reconciliation exists; preserve history otherwise.
begin;
lock table public.pad_weight_reconciliations in access exclusive mode;
do $$ begin
 if exists(select 1 from public.pad_weight_reconciliations) then
  raise exception 'PAD_WEIGHT_HISTORY_EXISTS'; end if;
end $$;
drop function public.complete_pad_weight_pricing(uuid,uuid,text,jsonb,jsonb,uuid);
drop function public.sync_pad_weight_gap(uuid,text,jsonb,boolean,text,uuid);
drop function public.assert_pad_weight_head(uuid,uuid,boolean);
drop function public.record_pad_weight_reconciliation(uuid,uuid,jsonb);
drop function public.read_pad_weight_context(uuid);
drop table public.pad_weight_reconciliations;
commit;
