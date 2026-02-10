
-- Phase PRICING V3.2: Client Overrides (contrats tarifaires)

-- 1. Table pricing_client_overrides
CREATE TABLE pricing_client_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_code text NOT NULL,
  service_code text NOT NULL,
  pricing_mode text NOT NULL DEFAULT 'FIXED',
  base_price numeric NOT NULL DEFAULT 0,
  min_price numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'XOF',
  mode_scope text NULL,
  valid_from date NULL,
  valid_to date NULL,
  description text NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- CTO Fix #1: Mode check
  CONSTRAINT pricing_client_overrides_mode_chk
    CHECK (pricing_mode IN ('FIXED', 'UNIT_RATE', 'PERCENTAGE')),

  -- CTO Fix #2: Date coherence
  CONSTRAINT pricing_client_overrides_date_chk
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);

-- CTO Fix #1: Unique partial index — 1 active override per (client, service, scope)
CREATE UNIQUE INDEX uniq_client_override_active
  ON pricing_client_overrides(client_code, service_code, COALESCE(mode_scope, '*'))
  WHERE active = true;

-- Lookup index
CREATE INDEX idx_client_overrides_lookup
  ON pricing_client_overrides(client_code, service_code)
  WHERE active = true;

-- 2. RLS
ALTER TABLE pricing_client_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_overrides_read"
  ON pricing_client_overrides
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Seed de test
INSERT INTO pricing_client_overrides
  (client_code, service_code, pricing_mode, base_price, min_price, currency, description)
VALUES
  ('AI0CARGO', 'CUSTOMS_DAKAR', 'FIXED', 200000, 200000, 'XOF', 'Contrat client AI0CARGO');
