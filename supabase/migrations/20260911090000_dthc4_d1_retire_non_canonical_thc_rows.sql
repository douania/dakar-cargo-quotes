-- DTHC-4-D1 — Retire de la grille THC DP World les lignes absentes du tarif officiel
-- (GO CTO 2026-09-11).
--
-- PROBLÈME TRAITÉ. Le résolveur de devis (`_shared/dpw-dthc-tariff.ts`) n'adresse
-- que les cinq familles canoniques par `cargo_type` exact ; ces lignes-là ne
-- l'atteignent jamais. Mais `generate-response` lit `port_tariffs` en direct et
-- colle TOUTES les lignes actives dans le prompt du modèle qui rédige la réponse
-- commerciale, sous l'en-tête « UTILISER CES MONTANTS EXACTS - NE PAS ESTIMER ».
-- Le devis structuré reste donc juste, mais l'e-mail envoyé au client peut porter
-- un autre montant.
--
-- La plus nuisible des cinq est « Standard 40 pieds » à 232 500 : c'est le libellé
-- qui répond le plus directement à une question portant sur un 40 pieds, et il
-- contredit le tarif officiel. Le dépliant DP World « Nouveaux tarifs de
-- manutention de conteneurs » donne 155 000 par EVP pour les produits standards
-- et pose « Un 40 Pieds = 2 EVP » : un 40 pieds standard vaut donc 310 000, pas
-- 232 500 (= 155 000 x 1,5, une convention « 40 pieds = 1,5 x 20 pieds » abandonnée).
--
-- Les quatre autres (« Vide » et « Transbordement », import et export) ne sont pas
-- démontrées fausses : elles sont absentes de la page 1 du dépliant, seule page en
-- notre possession. Elles sont néanmoins retirées, pour trois raisons :
--   * elles portent toutes `surcharge_percent = 50 / 'Produits dangereux'`, y
--     compris sur un conteneur VIDE — une majoration pour marchandise dangereuse
--     sur une boîte vide n'a pas de sens : c'est la trace d'une reprise en masse,
--     pas d'un tarif lu sur un document ;
--   * la doctrine du dépôt est fail-closed : mieux vaut « à confirmer » qu'un
--     montant non sourcé présenté au client comme officiel ;
--   * leur premier-match sur `cargo_type` a déjà provoqué un défaut de facturation
--     (cf. DTHC-1, la ligne « Transbordement » à 75 000 servie comme THC).
-- Si la page 2 du dépliant documente ces services, elles seront réintroduites avec
-- leur source et leur montant exacts. La désactivation est réversible.
--
-- Aucune ligne n'est supprimée : `is_active` passe à false, comme pour les lignes
-- héritées déjà neutralisées (CONTENEUR_OOG, CONTENEUR_FRIGO...).
--
-- IMPACT DEVIS : nul. Le résolveur ne lisait aucune de ces cinq lignes.
-- IMPACT RÉDACTION : elles disparaissent du contexte transmis au modèle.
--
-- Bloc DO unique, donc atomique. Deux états sûrs : grille d'origine (5 actives à
-- retirer) ou migration déjà passée (0 active à retirer). Toute autre cardinalité
-- avorte AVANT toute mutation.

DO $$
DECLARE
  c_category   CONSTANT TEXT := 'THC';
  c_providers  CONSTANT TEXT[] := ARRAY['DPW', 'DP_WORLD'];

  -- Les cinq familles du tarif officiel. Elles doivent rester actives.
  c_canonical  CONSTANT TEXT[] :=
    ARRAY['BASIC', 'STANDARD', 'REEFER', 'DANGEROUS', 'SPECIAL', 'COTON'];

  -- Lignes visées : (operation_type, cargo_type, classification, amount).
  c_targets CONSTANT JSONB := '[
    {"op":"IMPORT","cargo":"CONTENEUR_40","label":"Standard 40 pieds","amount":232500},
    {"op":"EXPORT","cargo":"CONTENEUR_40","label":"Standard 40 pieds","amount":232500},
    {"op":"IMPORT","cargo":"CONTENEUR_VIDE","label":"Vide","amount":75000},
    {"op":"EXPORT","cargo":"CONTENEUR_VIDE","label":"Vide","amount":75000},
    {"op":"IMPORT","cargo":"CONTENEUR_20","label":"Transbordement","amount":75000}
  ]'::jsonb;

  -- Effectif canonique attendu : IMPORT 5, EXPORT 5, TRANSIT 1.
  c_canonical_expected CONSTANT INT := 11;

  v_item            JSONB;
  v_outside_before  TEXT;
  v_outside_after   TEXT;
  v_match           INT;
  v_deactivated     INT := 0;
  v_already         INT := 0;
  v_active_after    INT;
  v_rogue           INT;
BEGIN
  IF to_regclass('public.port_tariffs') IS NULL THEN
    RAISE EXCEPTION '[DTHC-4-D1] STOP — public.port_tariffs est absente.';
  END IF;

  LOCK TABLE public.port_tariffs IN SHARE ROW EXCLUSIVE MODE;

  -- Empreinte de tout ce qui n'est PAS la grille THC DP World.
  SELECT md5(string_agg(t.sig, '|' ORDER BY t.sig)) INTO v_outside_before
  FROM (
    SELECT id::text || '~' || coalesce(amount::text, '') || '~' || coalesce(is_active::text, '') AS sig
    FROM public.port_tariffs
    WHERE NOT (category = c_category AND provider = ANY (c_providers))
  ) t;

  -- Les cinq familles canoniques doivent être là, et actives, AVANT toute action.
  SELECT count(*) INTO v_match
  FROM public.port_tariffs
  WHERE category = c_category AND provider = ANY (c_providers)
    AND is_active = true AND cargo_type = ANY (c_canonical);
  IF v_match <> c_canonical_expected THEN
    RAISE EXCEPTION
      '[DTHC-4-D1] STOP — % ligne(s) canonique(s) active(s), % attendues. Grille inattendue, rien n''est touché.',
      v_match, c_canonical_expected;
  END IF;

  -- Désactivation, ligne visée par ligne visée.
  FOR v_item IN SELECT * FROM jsonb_array_elements(c_targets)
  LOOP
    SELECT count(*) INTO v_match
    FROM public.port_tariffs
    WHERE category = c_category AND provider = ANY (c_providers)
      AND operation_type  = v_item ->> 'op'
      AND cargo_type      = v_item ->> 'cargo'
      AND classification  = v_item ->> 'label'
      AND amount          = (v_item ->> 'amount')::numeric;

    IF v_match <> 1 THEN
      RAISE EXCEPTION '[DTHC-4-D1] STOP — % / % / % : % ligne(s), 1 attendue.',
        v_item ->> 'op', v_item ->> 'cargo', v_item ->> 'label', v_match;
    END IF;

    UPDATE public.port_tariffs
    SET is_active = false,
        updated_at = now()
    WHERE category = c_category AND provider = ANY (c_providers)
      AND operation_type  = v_item ->> 'op'
      AND cargo_type      = v_item ->> 'cargo'
      AND classification  = v_item ->> 'label'
      AND amount          = (v_item ->> 'amount')::numeric
      AND is_active = true;

    IF FOUND THEN
      v_deactivated := v_deactivated + 1;
    ELSE
      v_already := v_already + 1;   -- état 2 : migration déjà passée
    END IF;
  END LOOP;

  IF v_deactivated + v_already <> jsonb_array_length(c_targets) THEN
    RAISE EXCEPTION '[DTHC-4-D1] STOP — % ligne(s) traitée(s), % attendues.',
      v_deactivated + v_already, jsonb_array_length(c_targets);
  END IF;

  -- ---------------------------------------------------------------------
  -- Contrôles de sortie : la grille active se réduit EXACTEMENT au tarif officiel.
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO v_active_after
  FROM public.port_tariffs
  WHERE category = c_category AND provider = ANY (c_providers) AND is_active = true;

  IF v_active_after <> c_canonical_expected THEN
    RAISE EXCEPTION '[DTHC-4-D1] STOP — % ligne(s) THC active(s) en sortie, % attendues.',
      v_active_after, c_canonical_expected;
  END IF;

  SELECT count(*) INTO v_rogue
  FROM public.port_tariffs
  WHERE category = c_category AND provider = ANY (c_providers)
    AND is_active = true AND NOT (cargo_type = ANY (c_canonical));
  IF v_rogue > 0 THEN
    RAISE EXCEPTION '[DTHC-4-D1] STOP — % ligne(s) THC active(s) hors des familles canoniques.', v_rogue;
  END IF;

  SELECT md5(string_agg(t.sig, '|' ORDER BY t.sig)) INTO v_outside_after
  FROM (
    SELECT id::text || '~' || coalesce(amount::text, '') || '~' || coalesce(is_active::text, '') AS sig
    FROM public.port_tariffs
    WHERE NOT (category = c_category AND provider = ANY (c_providers))
  ) t;

  IF v_outside_before IS DISTINCT FROM v_outside_after THEN
    RAISE EXCEPTION '[DTHC-4-D1] STOP — des lignes hors grille THC DP World ont bougé.';
  END IF;

  RAISE NOTICE '[DTHC-4-D1] OK — % ligne(s) retirée(s), % déjà inactive(s). Grille active : % lignes canoniques.',
    v_deactivated, v_already, v_active_after;
END $$;
