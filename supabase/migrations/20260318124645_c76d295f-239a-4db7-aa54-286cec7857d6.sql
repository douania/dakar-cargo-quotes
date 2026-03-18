-- Phase CL1: client_gap_requests table for conversation tracking

create table public.client_gap_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  gap_key text not null,
  source_timeline_event_id uuid null references public.case_timeline_events(id) on delete set null,
  draft_subject text null,
  draft_body text null,
  status text not null default 'drafted',
  sent_at timestamptz null,
  source_email_id uuid null references public.emails(id) on delete set null,
  response_email_id uuid null references public.emails(id) on delete set null,
  matched_fact_key text null,
  validated_fact_id uuid null references public.quote_facts(id) on delete set null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_gap_requests_status_check
    check (status in ('drafted','sent','answered','validated','cancelled'))
);

-- CORRECTED unique index: one active request per (case_id, gap_key)
create unique index uq_client_gap_requests_active
  on public.client_gap_requests(case_id, gap_key)
  where status in ('drafted','sent','answered');

-- Performance indexes
create index idx_client_gap_requests_case_id on public.client_gap_requests(case_id);
create index idx_client_gap_requests_status on public.client_gap_requests(status);
create index idx_client_gap_requests_case_gap on public.client_gap_requests(case_id, gap_key);

-- updated_at trigger (reuses existing function)
create trigger set_updated_at before update on public.client_gap_requests
  for each row execute function public.update_updated_at_column();

-- RLS
alter table public.client_gap_requests enable row level security;
create policy "Authenticated full access" on public.client_gap_requests
  for all to authenticated using (true) with check (true);