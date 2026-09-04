-- Décision SODATRA du 4 septembre 2026 (GO CTO) :
-- le transport intérieur Sénégal est coté exclusivement par la grille officielle
-- TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS (local_transport_rates, 60 lignes
-- actives, evidence_level=validated_internal, débours TTC — P0-D).
-- Les rate cards TRUCKING/ON_CARRIAGE intérieur Sénégal sont des doublons
-- (ex. Kédougou 40HC : 3 500 000 XOF vs 1 739 320 officiel) : rejet définitif
-- pour empêcher toute promotion future et tout double comptage.
-- Idempotent : cible 6 UUID précis, uniquement s'ils sont encore en to_confirm ;
-- no-op sur une base où ils sont déjà rejetés ou absents (reset Git sans seed).
-- Les lignes TRUCKING transit (Bamako/Banjul) ne sont PAS concernées.
UPDATE public.pricing_rate_cards
SET status = 'rejected',
    notes = COALESCE(notes,'') || E'\n[2026-09-04] Rejeté sur décision SODATRA : doublon de la grille officielle TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS (local_transport_rates, 60 lignes actives). Ne jamais promouvoir.',
    updated_at = now()
WHERE id IN (
  '419b2b10-b545-43cd-9fea-a65b89fd1a20', -- TRUCKING zone urbaine 20DV 800 000
  '19739121-2dd3-439d-9aad-9aab58bfbc2c', -- TRUCKING zone urbaine 40HC 1 000 000
  '661ade2d-3f39-4a6a-a613-1c8659bd196d', -- TRUCKING Dakar→Saint-Louis 40HC 1 200 000
  '7b0508f1-9257-4425-9d9c-338c6eae5d69', -- TRUCKING Dakar→Kédougou 40HC 3 500 000
  '30e33494-faa9-484a-8978-b17c58c8518c', -- ON_CARRIAGE Dakar zone 40HC 1 000 000
  '44f0023c-cabe-4eaf-9f49-514e594f4ad6'  -- TRUCKING LCL valeur 0 (déjà neutralisée Lot 1)
)
AND status = 'to_confirm';
