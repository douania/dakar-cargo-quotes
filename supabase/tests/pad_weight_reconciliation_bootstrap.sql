-- LOCAL SYNTHETIC HARNESS ONLY. Not a migration, not a full-schema restore.
create schema auth;
create table auth.users(id uuid primary key);
create table public.quote_cases(id uuid primary key,status text not null default 'FACTS_PARTIAL');
create table public.quote_facts(id uuid primary key,case_id uuid references public.quote_cases(id),is_current boolean default true,
 fact_key text,value_number numeric,value_text text,source_type text,source_email_id uuid);
create table public.fixture_pad_context(case_id uuid primary key,context jsonb);
create table public.fixture_finalizations(kind text);
create function public.read_pad_group_context(p_case_id uuid) returns jsonb language sql stable as $$
 select context from public.fixture_pad_context where case_id=p_case_id;
$$;
create function public.sync_pad_group_gap(uuid,text,jsonb,boolean,text) returns void language sql as $$
 insert into public.fixture_finalizations values('gap');
$$;
create function public.complete_pad_group_pricing(uuid,uuid,text,jsonb,jsonb) returns void language sql as $$
 insert into public.fixture_finalizations values('pricing');
$$;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
 if not exists(select 1 from pg_roles where rolname='fixture_sandbox') then create role fixture_sandbox; end if;
end $$;
alter default privileges grant execute on functions to fixture_sandbox,anon,authenticated;
alter default privileges grant select on tables to fixture_sandbox,anon,authenticated;
