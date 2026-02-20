
-- Table exchange_rates pour centraliser les taux de change douaniers GAINDE
create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  currency_code text not null,
  rate_to_xof numeric not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  source text not null default 'GAINDE',
  updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Unique index pour idempotence du seed
create unique index if not exists idx_exchange_rates_currency_valid
on public.exchange_rates(currency_code, valid_from);

-- Index performance
create index if not exists idx_exchange_rates_currency
on public.exchange_rates(currency_code);

-- RLS
alter table public.exchange_rates enable row level security;

-- SELECT pour authenticated
create policy "exchange_rates_read"
on public.exchange_rates for select to authenticated using (true);

-- INSERT pour authenticated avec check minimal (anti-pollution)
create policy "exchange_rates_insert"
on public.exchange_rates for insert to authenticated
with check (rate_to_xof > 0 and char_length(currency_code) >= 3);

-- Seed EUR BCEAO fixe (idempotent)
insert into public.exchange_rates (currency_code, rate_to_xof, valid_from, valid_until, source)
values ('EUR', 655.957, '2000-01-01', '2100-01-01', 'BCEAO_FIXED')
on conflict (currency_code, valid_from) do nothing;
