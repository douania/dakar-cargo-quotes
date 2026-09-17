-- LOCAL preparation. Never erase operator decisions. Ledger is not rewritten.
begin;
do $$ begin
 if current_setting('dcq.pad_group_rollback_ack',true) is distinct from 'REVIEWED_PAD_GROUP_ROLLBACK' then
   raise exception 'PAD_GROUP_ROLLBACK_ACK_REQUIRED';
 end if;
 lock table public.pad_group_confirmations in access exclusive mode;
 if exists(select 1 from public.pad_group_confirmations) then raise exception 'PAD_GROUP_ROWS_PRESENT'; end if;
end $$;
drop function if exists public.complete_pad_group_pricing(uuid,uuid,text,jsonb,jsonb);
drop function if exists public.sync_pad_group_gap(uuid,text,jsonb,boolean,text);
drop function public.record_pad_group_confirmation(uuid,uuid,jsonb);
drop function public.read_pad_group_context(uuid);
drop table public.pad_group_confirmations;
commit;
