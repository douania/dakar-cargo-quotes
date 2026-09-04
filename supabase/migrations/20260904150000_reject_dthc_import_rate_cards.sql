-- Décision SODATRA du 4 septembre 2026 (suite de 20260904140000) :
-- le DTHC import est coté exclusivement par le tarif officiel DP World
-- (port_tariffs, source_document DPW_TARIFS_2025_0001.pdf, evidence_level
-- official, module fail-closed DTHC-1 consommé par quotation-engine et
-- price-service-lines : BASIC 70 000 / STANDARD 155 000 / DANGEROUS 155 000 /
-- REEFER 170 500 / SPECIAL 310 000 XOF par EVP).
-- Les 4 rate cards DTHC import sont des doublons DIVERGENTS (250 000 vs
-- 155 000 pour un 20' standard ; 350 000 vs 310 000 pour un 40' ; 450 000 vs
-- 341 000 reefer) : rejet définitif pour empêcher promotion et double comptage.
-- Les 3 rate cards DTHC transit ne sont PAS concernées (phase 2 : la ligne
-- officielle Transit TRIE existe mais est inactive ; fail-closed maintenu).
-- Idempotent : no-op si déjà rejetées ou absentes (reset Git sans seed).
UPDATE public.pricing_rate_cards
SET status = 'rejected',
    notes = COALESCE(notes,'') || E'\n[2026-09-04] Rejeté sur décision SODATRA : doublon divergent du DTHC officiel DP World (port_tariffs, DPW_TARIFS_2025_0001.pdf, module fail-closed DTHC-1). Ne jamais promouvoir.',
    updated_at = now()
WHERE id IN (
  '2720ca96-e2d2-4d10-b446-32e09c3a5321', -- DTHC import 20DV 250 000
  '47b7ffef-2b85-46c4-b164-c62816a7163c', -- DTHC import 40DV 350 000
  '75626aa6-ac55-4012-ad51-deecee566ae2', -- DTHC import 40HC 350 000
  '2c365f35-b17b-4c61-bc7a-7b749234b120'  -- DTHC import 40RF 450 000
)
AND status = 'to_confirm';
