-- CANDIDATE ONLY. Separate transaction: the new enum value is consumed by the next migration.
ALTER TYPE public.quote_request_type ADD VALUE IF NOT EXISTS 'AIR_CROSS_TRADE';
