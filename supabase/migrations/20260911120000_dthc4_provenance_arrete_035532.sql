-- DTHC-4 — Rattache la grille THC DP World à son instrument juridique réel
-- (GO CTO 2026-09-11).
--
-- Les onze lignes actives de la grille THC citaient `DPW_TARIFS_2025_0001.pdf`
-- (import) ou « Arrêté DPW 2025 » (export, transit). Ces deux références ne
-- correspondent à aucun texte : la première est un nom de fichier interne, la
-- seconde une désignation approximative.
--
-- Le texte en vigueur est l'**arrêté ministériel n° 035532 du 28 novembre 2023
-- portant révision des tarifs de manutention de conteneurs** (Ministère du
-- Commerce, de la Consommation et des Petites et Moyennes Entreprises), publié
-- au **Journal officiel de la République du Sénégal n° 7723 du 6 avril 2024,
-- page 471**. Il homologue les THC au titre des articles 6 et 7 du décret
-- n° 2022-89 du 17 janvier 2022.
--
-- Son annexe reproduit exactement les onze lignes portées ici — la migration le
-- VÉRIFIE ligne à ligne avant d'apposer la référence : on ne tamponne pas « JO »
-- sur des montants qui ne seraient pas ceux du JO.
--
-- `effective_date` passe du 2025-01-01 arbitraire au **2024-04-06**, date de
-- publication au Journal officiel, retenue sur décision CTO plutôt que la date
-- de signature. Effet de bord assumé : les dossiers évalués en 2024 résolvent
-- désormais un tarif au lieu de tomber en `TARIF_DTHC_A_CONFIRMER`.
--
-- PÉRIMÈTRE STRICT : uniquement `category = 'THC'` chez DP World. Les lignes
-- RORO, BREAKBULK et de magasinage conservent `DPW_TARIFS_2025_0001.pdf` — elles
-- ne relèvent pas de cet arrêté, dont l'article 3 laisse magasinage, relevage et
-- autres opérations annexes inchangés. Une empreinte avant/après le prouve.
--
-- CHANGEMENT COUPLÉ, OBLIGATOIRE : `_shared/dpw-dthc-tariff.ts` filtre les
-- candidats sur `source_document` via `DPW_DTHC_SOURCE_DOCUMENT`. Cette migration
-- N'EST VALIDE QUE déployée avec la mise à jour de cette constante ; appliquée
-- seule, elle ferait tomber tout le DTHC en `TO_CONFIRM`.
--
-- Bloc DO unique, donc atomique. Deux états sûrs : provenance héritée (à
-- corriger) ou provenance déjà canonique (no-op). Tout écart de montant, de
-- surcharge ou de cardinalité avorte AVANT toute mutation.

DO $$
DECLARE
  c_category   CONSTANT TEXT := 'THC';
  c_providers  CONSTANT TEXT[] := ARRAY['DPW', 'DP_WORLD'];
  c_source     CONSTANT TEXT :=
    'Arrêté ministériel n° 035532 du 28/11/2023 - JORS n° 7723 du 06/04/2024 p. 471';
  c_effective  CONSTANT DATE := DATE '2024-04-06';
  c_legacy     CONSTANT TEXT[] := ARRAY['DPW_TARIFS_2025_0001.pdf', 'Arrêté DPW 2025'];
  c_legacy_date CONSTANT DATE := DATE '2025-01-01';

  -- L'annexe de l'arrêté, telle que publiée au JO n° 7723 p. 471.
  c_annexe CONSTANT JSONB := '[
    {"op":"EXPORT","cargo":"COTON","amount":70000,"surcharge":0},
    {"op":"EXPORT","cargo":"STANDARD","amount":155000,"surcharge":0},
    {"op":"EXPORT","cargo":"REEFER","amount":170500,"surcharge":0},
    {"op":"EXPORT","cargo":"DANGEROUS","amount":155000,"surcharge":50},
    {"op":"EXPORT","cargo":"SPECIAL","amount":310000,"surcharge":0},
    {"op":"IMPORT","cargo":"BASIC","amount":70000,"surcharge":0},
    {"op":"IMPORT","cargo":"STANDARD","amount":155000,"surcharge":0},
    {"op":"IMPORT","cargo":"REEFER","amount":170500,"surcharge":0},
    {"op":"IMPORT","cargo":"DANGEROUS","amount":155000,"surcharge":50},
    {"op":"IMPORT","cargo":"SPECIAL","amount":310000,"surcharge":0},
    {"op":"TRANSIT","cargo":"STANDARD","amount":110000,"surcharge":0}
  ]'::jsonb;

  v_item            JSONB;
  v_outside_before  TEXT;
  v_outside_after   TEXT;
  v_match           INT;
  v_active          INT;
  v_stamped         INT := 0;
  v_already         INT := 0;
  v_rogue           INT;
BEGIN
  IF to_regclass('public.port_tariffs') IS NULL THEN
    RAISE EXCEPTION '[DTHC-4-PROV] STOP — public.port_tariffs est absente.';
  END IF;

  LOCK TABLE public.port_tariffs IN SHARE ROW EXCLUSIVE MODE;

  -- Empreinte de tout ce qui n'est pas la grille THC DP World : RORO, BREAKBULK,
  -- RELEVAGE, magasinage, PAD... doivent être identiques à la fin.
  SELECT md5(string_agg(t.sig, '|' ORDER BY t.sig)) INTO v_outside_before
  FROM (
    SELECT id::text || '~' || coalesce(amount::text, '') || '~'
             || coalesce(source_document, '') || '~' || coalesce(effective_date::text, '') || '~'
             || coalesce(is_active::text, '') AS sig
    FROM public.port_tariffs
    WHERE NOT (category = c_category AND provider = ANY (c_providers))
  ) t;

  SELECT count(*) INTO v_active
  FROM public.port_tariffs
  WHERE category = c_category AND provider = ANY (c_providers) AND is_active = true;
  IF v_active <> jsonb_array_length(c_annexe) THEN
    RAISE EXCEPTION '[DTHC-4-PROV] STOP — % ligne(s) THC active(s), % attendues.',
      v_active, jsonb_array_length(c_annexe);
  END IF;

  -- ---------------------------------------------------------------------
  -- Ligne à ligne : le montant et la surcharge doivent être ceux du JO avant
  -- que la référence du JO ne soit apposée.
  -- ---------------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(c_annexe)
  LOOP
    SELECT count(*) INTO v_match
    FROM public.port_tariffs
    WHERE category = c_category AND provider = ANY (c_providers) AND is_active = true
      AND operation_type    = v_item ->> 'op'
      AND cargo_type        = v_item ->> 'cargo'
      AND amount            = (v_item ->> 'amount')::numeric
      AND coalesce(surcharge_percent, 0) = (v_item ->> 'surcharge')::numeric;

    IF v_match <> 1 THEN
      RAISE EXCEPTION
        '[DTHC-4-PROV] STOP — % / % : % ligne(s) au montant % et surcharge % %% de l''annexe, 1 attendue.',
        v_item ->> 'op', v_item ->> 'cargo', v_match, v_item ->> 'amount', v_item ->> 'surcharge';
    END IF;

    -- Déjà canonique ?
    SELECT count(*) INTO v_match
    FROM public.port_tariffs
    WHERE category = c_category AND provider = ANY (c_providers) AND is_active = true
      AND operation_type = v_item ->> 'op' AND cargo_type = v_item ->> 'cargo'
      AND source_document = c_source AND effective_date = c_effective;

    IF v_match = 1 THEN
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    -- Sinon, la provenance doit être l'une des deux héritées, à la date héritée.
    SELECT count(*) INTO v_match
    FROM public.port_tariffs
    WHERE category = c_category AND provider = ANY (c_providers) AND is_active = true
      AND operation_type = v_item ->> 'op' AND cargo_type = v_item ->> 'cargo'
      AND source_document = ANY (c_legacy) AND effective_date = c_legacy_date;

    IF v_match <> 1 THEN
      RAISE EXCEPTION
        '[DTHC-4-PROV] STOP — % / % : provenance ni canonique ni héritée, rien n''est touché.',
        v_item ->> 'op', v_item ->> 'cargo';
    END IF;

    UPDATE public.port_tariffs
    SET source_document = c_source,
        effective_date  = c_effective,
        updated_at      = now()
    WHERE category = c_category AND provider = ANY (c_providers) AND is_active = true
      AND operation_type = v_item ->> 'op' AND cargo_type = v_item ->> 'cargo';
    v_stamped := v_stamped + 1;
  END LOOP;

  IF v_stamped + v_already <> jsonb_array_length(c_annexe) THEN
    RAISE EXCEPTION '[DTHC-4-PROV] STOP — % ligne(s) traitée(s), % attendues.',
      v_stamped + v_already, jsonb_array_length(c_annexe);
  END IF;

  -- ---------------------------------------------------------------------
  -- Contrôles de sortie.
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO v_rogue
  FROM public.port_tariffs
  WHERE category = c_category AND provider = ANY (c_providers) AND is_active = true
    AND (source_document IS DISTINCT FROM c_source
         OR effective_date IS DISTINCT FROM c_effective
         OR evidence_level IS DISTINCT FROM 'official'
         OR expiry_date IS NOT NULL);
  IF v_rogue > 0 THEN
    RAISE EXCEPTION '[DTHC-4-PROV] STOP — % ligne(s) THC active(s) hors provenance canonique.', v_rogue;
  END IF;

  SELECT md5(string_agg(t.sig, '|' ORDER BY t.sig)) INTO v_outside_after
  FROM (
    SELECT id::text || '~' || coalesce(amount::text, '') || '~'
             || coalesce(source_document, '') || '~' || coalesce(effective_date::text, '') || '~'
             || coalesce(is_active::text, '') AS sig
    FROM public.port_tariffs
    WHERE NOT (category = c_category AND provider = ANY (c_providers))
  ) t;

  IF v_outside_before IS DISTINCT FROM v_outside_after THEN
    RAISE EXCEPTION '[DTHC-4-PROV] STOP — des lignes hors grille THC DP World ont bougé.';
  END IF;

  RAISE NOTICE '[DTHC-4-PROV] OK — % ligne(s) rattachée(s) à l''arrêté n° 035532, % déjà canonique(s). Entrée en vigueur : %.',
    v_stamped, v_already, c_effective;
END $$;
