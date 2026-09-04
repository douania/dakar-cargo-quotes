-- Décision SODATRA du 4 septembre 2026 (preuve : factures DP World de sortie
-- de conteneur fournies par le métier) : pour le FCL, la manutention terminal
-- est l'ACCONAGE par EVP (155 000 XOF/EVP = DTHC STANDARD officiel DPW déjà
-- actif dans port_tariffs). La manutention à la tonne relève du conventionnel,
-- couverte par le barème officiel DPW (lignes DISCHARGE de port_tariffs).
-- Les 2 rate cards PORT_DAKAR_HANDLING (15 000 XOF/tonne, import + transit,
-- source internal sans pièce) sont rejetées.
-- NOTE D'ARCHITECTURE (ne pas « corriger » sans lot dédié) : la clé
-- PORT_DAKAR_HANDLING présente dans les packages conteneur de
-- _shared/service-scope.ts n'est PAS une ligne facturable — c'est le marqueur
-- du droit de passage PAD, exclu de l'enrichissement des lignes de service
-- (excludePadScopeKeysForEnrichment, tests P0-E). La retirer des packages
-- ouvrirait le garde PAD en fail-open. Aucun devis FCL ne génère de ligne
-- manutention/tonne aujourd'hui.
-- Idempotent : no-op si déjà rejetées ou absentes (reset Git sans seed).
UPDATE public.pricing_rate_cards
SET status = 'rejected',
    notes = COALESCE(notes,'') || E'\n[2026-09-04] Rejeté sur décision SODATRA (preuve : factures DP World de sortie conteneur) : pour le FCL, la manutention terminal est l''ACCONAGE par EVP = DTHC officiel DPW déjà actif (155 000/EVP). La manutention à la tonne relève du conventionnel, couverte par le barème officiel DPW (port_tariffs DISCHARGE). Ne jamais promouvoir.',
    updated_at = now()
WHERE service_key = 'PORT_DAKAR_HANDLING'
  AND status = 'to_confirm';
