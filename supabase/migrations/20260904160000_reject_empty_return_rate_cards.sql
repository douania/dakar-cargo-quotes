-- Décision SODATRA du 4 septembre 2026 (suite de 20260904140000/150000) :
-- le retour de conteneur vide (EMPTY_RETURN) est une obligation contractuelle
-- du client, PAS un service facturable. Le moteur applique déjà cette doctrine
-- (price-service-lines, règle V4.1.6 : EMPTY_RETURN = 0, « Obligation
-- contractuelle client, non facturé en import SN »).
-- Les 5 rate cards EMPTY_RETURN (import 20DV/40DV/40HC, transit 20DV/40HC,
-- 150 000/200 000 XOF) contredisent cette doctrine : rejet définitif par
-- service_key pour empêcher toute promotion. Si un cas transit devait un jour
-- devenir facturable, ce serait une nouvelle ligne sourcée + décision CTO,
-- jamais la réactivation de celles-ci.
-- Idempotent : no-op si déjà rejetées ou absentes (reset Git sans seed).
UPDATE public.pricing_rate_cards
SET status = 'rejected',
    notes = COALESCE(notes,'') || E'\n[2026-09-04] Rejeté sur décision SODATRA : le retour de conteneur vide est une obligation contractuelle, pas un service facturable (règle moteur V4.1.6 : EMPTY_RETURN = 0). Ne jamais promouvoir.',
    updated_at = now()
WHERE service_key = 'EMPTY_RETURN'
  AND status = 'to_confirm';
