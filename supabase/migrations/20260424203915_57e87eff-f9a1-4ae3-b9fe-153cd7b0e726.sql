-- ============================================================================
-- LOT 1.1-bis : Correctif provenance port_tariffs
-- ============================================================================
-- Contexte : la migration 20260424201919 (Lot 1.1) a promu en `official` 
-- toutes les lignes `provider='PAD'` non-official, ce qui a faussement 
-- officialisé 4 lignes issues de `Taleb_Quote_2024` (cotation client, 
-- pas un barème officiel PAD).
--
-- Correction :
-- 1. Rétrograder les 4 lignes Taleb_Quote_2024 en `observed`.
-- 2. Documenter que la logique de replay correcte doit utiliser 
--    `source_document = 'pdf_redevances_portuaires_2006'` comme 
--    discriminant, et non `provider = 'PAD'`.
-- ============================================================================

-- Étape 1 : Rétrogradation ciblée (idempotente)
UPDATE port_tariffs
SET evidence_level = 'observed',
    updated_at = now()
WHERE source_document = 'Taleb_Quote_2024'
  AND evidence_level = 'official';

-- Étape 2 : Replay corrigé — promouvoir uniquement les lignes PAD
-- dont la source documentaire est l'arrêté officiel.
-- Ce bloc est idempotent et constitue la nouvelle clause de référence
-- qui REMPLACE la clause trop large `provider='PAD'` du Lot 1.1.
UPDATE port_tariffs
SET evidence_level = 'official',
    updated_at = now()
WHERE source_document = 'pdf_redevances_portuaires_2006'
  AND (evidence_level IS NULL OR evidence_level <> 'official');

-- Note de gouvernance (commentaire SQL, pas d'effet runtime) :
-- Règle : `provider` seul ne prouve PAS l'officialité d'une ligne.
-- Le discriminant légitime est `source_document` pointant vers un
-- arrêté ministériel ou un barème officiel publié.
-- Toute future migration de replay doit respecter cette règle.
COMMENT ON COLUMN port_tariffs.evidence_level IS 
  'Niveau de preuve : official (arrêté/barème publié), validated_internal (doc compagnie sérieux), observed (cotation/observation terrain), to_confirm (preuve insuffisante), historical_only (archive/doublon structurel). RÈGLE : provider seul ne prouve pas official — le discriminant est source_document.';