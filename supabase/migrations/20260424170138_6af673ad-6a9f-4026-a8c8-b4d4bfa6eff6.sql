-- ============================================================
-- LOT 1 — Purge & reclassement provenance tarifaire (schéma)
-- ============================================================

-- 1. Ajouter evidence_level à carrier_billing_templates
ALTER TABLE public.carrier_billing_templates 
  ADD COLUMN IF NOT EXISTS evidence_level TEXT;

ALTER TABLE public.carrier_billing_templates 
  DROP CONSTRAINT IF EXISTS carrier_billing_templates_evidence_level_check;

ALTER TABLE public.carrier_billing_templates 
  ADD CONSTRAINT carrier_billing_templates_evidence_level_check 
  CHECK (evidence_level IS NULL OR evidence_level IN (
    'official', 'validated_internal', 'observed', 'historical_only', 'to_confirm'
  ));

-- 2. Ajouter evidence_level à local_transport_rates (préparation Lot 2)
ALTER TABLE public.local_transport_rates 
  ADD COLUMN IF NOT EXISTS evidence_level TEXT;

ALTER TABLE public.local_transport_rates 
  DROP CONSTRAINT IF EXISTS local_transport_rates_evidence_level_check;

ALTER TABLE public.local_transport_rates 
  ADD CONSTRAINT local_transport_rates_evidence_level_check 
  CHECK (evidence_level IS NULL OR evidence_level IN (
    'official', 'validated_internal', 'observed', 'historical_only', 'to_confirm', 'client_override'
  ));

-- 3. Renforcer la contrainte port_tariffs.evidence_level (déjà existante mais sans check)
ALTER TABLE public.port_tariffs 
  DROP CONSTRAINT IF EXISTS port_tariffs_evidence_level_check;

ALTER TABLE public.port_tariffs 
  ADD CONSTRAINT port_tariffs_evidence_level_check 
  CHECK (evidence_level IS NULL OR evidence_level IN (
    'official', 'validated_internal', 'observed', 'historical_only', 'to_confirm'
  ));

-- 4. Index pour filtres runtime efficaces
CREATE INDEX IF NOT EXISTS idx_port_tariffs_evidence_active 
  ON public.port_tariffs(evidence_level, is_active);
CREATE INDEX IF NOT EXISTS idx_carrier_billing_evidence_active 
  ON public.carrier_billing_templates(evidence_level, is_active);
CREATE INDEX IF NOT EXISTS idx_local_transport_evidence_active 
  ON public.local_transport_rates(evidence_level, is_active);

COMMENT ON COLUMN public.carrier_billing_templates.evidence_level IS 
  'Provenance: official (autorité réglementaire) | validated_internal (doc fournisseur fiable OU validation SODATRA signée) | observed (facture/cotation isolée) | historical_only (audit aveugle, dérivé statistique) | to_confirm (placeholder). Runtime whitelist: official + validated_internal.';

COMMENT ON COLUMN public.local_transport_rates.evidence_level IS 
  'Provenance: idem carrier_billing_templates + client_override (tarif spécifique client, lu via match case.client_id). Runtime whitelist standard: official + validated_internal.';

COMMENT ON COLUMN public.port_tariffs.evidence_level IS 
  'Provenance: idem carrier_billing_templates. Runtime whitelist: official + validated_internal.';