-- ============================================================================
-- LOT 2A : Isolation Aksa sur local_transport_rates
-- ============================================================================
-- Contexte : 91 lignes actives :
--   - 81 = Aksa Energy (provider='Aksa Energy', evidence_level='client_override')
--   - 10 = générique (TARIFS_LIVRAISONS_CONTENEURS, evidence_level='to_confirm')
-- Avant ce lot : aucun filtre client → fuite Aksa systématique pour TRUCKING/ON_CARRIAGE.
--
-- Garde-fous : aucune promotion d'evidence_level, aucune fusion/suppression,
-- migration strictement additive.
-- ============================================================================

-- 1. Colonne client_code (additive, nullable)
ALTER TABLE public.local_transport_rates
  ADD COLUMN IF NOT EXISTS client_code TEXT NULL;

-- 2. Marquage des 81 lignes Aksa (idempotent)
UPDATE public.local_transport_rates
SET client_code = 'AKSA_ENERGY',
    updated_at = now()
WHERE client_code IS NULL
  AND (
    LOWER(COALESCE(provider, '')) LIKE '%aksa%'
    OR LOWER(COALESCE(source_document, '')) LIKE '%aksa%'
  );

-- 3. Index pour lookups runtime
CREATE INDEX IF NOT EXISTS idx_local_transport_rates_client_code
  ON public.local_transport_rates (client_code)
  WHERE is_active = true;

-- 4. Documentation de gouvernance
COMMENT ON COLUMN public.local_transport_rates.client_code IS
  'Code client canonique pour scoping. NULL = barème générique (utilisable pour tous clients sous réserve de evidence_level). Non-NULL = barème client-spécifique (utilisable UNIQUEMENT si pricingCtx.client_code correspond exactement). Lot 2 : ''AKSA_ENERGY'' pour Aksa Energy. Code technique réalignable si master client officiel SODATRA.';