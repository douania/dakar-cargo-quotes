-- GO SODATRA du 4 septembre 2026 : premiers tarifs cotables fermes.
-- AGENCY import (200 000 XOF forfait) et CUSTOMS_DAKAR import (350 000 XOF
-- par déclaration) sont des HONORAIRES INTERNES SODATRA : la source de vérité
-- est la décision de l'opérateur, pas une pièce externe. Validés comme
-- forfaits provisoires ; cohérents avec pricing_service_catalogue
-- (mêmes montants, FIXED, actifs).
-- Le paramétrage fin (poids, nombre de conteneurs, sens, régime douanier,
-- classe internal_fee vs débours, versionnement des débours) relève d'un lot
-- d'architecture dédié consigné dans la roadmap — pas de cette migration.
-- Idempotent : cible 2 UUID, uniquement s'ils sont encore to_confirm ;
-- no-op sinon (déjà actifs, ou absents sur reset Git sans seed).
UPDATE public.pricing_rate_cards
SET status = 'active',
    notes = COALESCE(notes,'') || E'\n[2026-09-04] Validé par SODATRA comme forfait provisoire d''honoraires internes (internal_fee) — GO explicite. Paramétrage fin (poids / nb conteneurs / sens / régime douanier) prévu en lot d''architecture dédié.',
    updated_at = now()
WHERE id IN (
  '44819e64-9041-4392-8403-cad3fb8a685e', -- AGENCY import, forfait 200 000 XOF
  'f0d3aea5-0b8a-4cc5-8dd4-52dad27e63d5'  -- CUSTOMS_DAKAR import, 350 000 XOF/déclaration
)
AND status = 'to_confirm';
