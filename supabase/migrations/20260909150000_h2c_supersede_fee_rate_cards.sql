-- =============================================================================
-- H2-c — bascule des honoraires internes sur fee_lines / fee_rules :
-- retrait des deux rate cards honoraires et reprise de la surcharge client.
-- GO CTO SODATRA du 9 septembre 2026 (« go H2-c »).
--
-- price-service-lines sert désormais AGENCY et CUSTOMS_DAKAR depuis les règles
-- paramétrables (commit H2-c). Les deux rate cards provisoires du 4 septembre
-- ne sont plus lues pour ces clés : elles passent en statut `superseded`
-- (aucune contrainte de statut sur la table ; les lecteurs ne servent que
-- `active`). Idempotent : cible 2 UUID, uniquement s'ils sont encore actifs.
--
-- La surcharge client AI0CARGO sur CUSTOMS_DAKAR (pricing_client_overrides,
-- forfait 200 000, tous modes) n'est plus lue pour les honoraires internes
-- (source unique). Elle est REPRISE À L'IDENTIQUE comme règle client de la ligne
-- CUSTOMS_DAKAR (scope client, aucune autre condition, effet immédiat), puis
-- désactivée. Aucun montant inventé. Rollback : réactiver la surcharge et
-- désactiver la règle client ; remettre les rate cards en `active`.
-- =============================================================================

UPDATE public.pricing_rate_cards
SET status = 'superseded',
    notes = COALESCE(notes, '') || E'\n[2026-09-09] Remplacée par fee_lines / fee_rules (lot H2-c) : les honoraires internes sont servis par les règles paramétrables. Conservée pour l''historique.',
    updated_at = now()
WHERE id IN (
  '44819e64-9041-4392-8403-cad3fb8a685e', -- AGENCY import, forfait 200 000 XOF
  'f0d3aea5-0b8a-4cc5-8dd4-52dad27e63d5'  -- CUSTOMS_DAKAR import, 350 000 XOF/déclaration
)
AND status = 'active';

INSERT INTO public.fee_rules (fee_line_id, label, client_code, method, amount, effective_from, source_reference, notes)
SELECT l.id,
       'Tarif contractuel AI0CARGO',
       'AI0CARGO',
       'FIXED',
       o.base_price,
       COALESCE(o.valid_from, CURRENT_DATE),
       'Repris de pricing_client_overrides (' || o.id::text || ') le 2026-09-09 — lot H2-c',
       COALESCE(o.description, 'Surcharge client reprise à l''identique lors de la bascule H2-c.')
FROM public.fee_lines l
JOIN public.pricing_client_overrides o
  ON o.client_code = 'AI0CARGO'
 AND o.service_code = 'CUSTOMS_DAKAR'
 AND o.active = true
 AND o.pricing_mode = 'FIXED'
WHERE l.code = 'CUSTOMS_DAKAR'
  AND EXISTS (SELECT 1 FROM public.clients c WHERE c.code = 'AI0CARGO')
  AND NOT EXISTS (
    SELECT 1 FROM public.fee_rules r
    WHERE r.fee_line_id = l.id AND r.client_code = 'AI0CARGO' AND r.is_active
  );

UPDATE public.pricing_client_overrides
SET active = false,
    description = COALESCE(description, '') || ' [2026-09-09 : reprise comme règle client fee_rules — lot H2-c]'
WHERE client_code = 'AI0CARGO'
  AND service_code = 'CUSTOMS_DAKAR'
  AND active = true
  AND EXISTS (
    SELECT 1 FROM public.fee_rules r JOIN public.fee_lines l ON l.id = r.fee_line_id
    WHERE l.code = 'CUSTOMS_DAKAR' AND r.client_code = 'AI0CARGO' AND r.is_active
  );
