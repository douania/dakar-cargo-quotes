-- DTHC-4-F1b — Restaure le barème de relevage TRANSIT (GO CTO 2026-09-11).
--
-- CORRECTIF D'UNE ERREUR INTRODUITE PAR LA MIGRATION 20260910180000 (F1).
--
-- L'arrêté portant homologation des tarifs de manutention de conteneurs
-- (Ministère du Commerce, Sénégal, 2015 — publié par DP World Dakar sous
-- `dpw-dakar-landside-tariff.pdf`) fixe le relevage PAR TEU ET PAR
-- CLASSIFICATION, pas par taille de conteneur :
--
--     C1 à C5 (coton, frigo, standards export, produits de base import,
--              standards import) ............................ 18 280 / TEU
--     C6      (transit — Imp/Exp sauf coton) ................. 36 560 / TEU
--
-- Les deux lignes `RELEVAGE` de `port_tariffs` portent `operation_type =
-- 'TRANSIT'`, donc la classification C6. Leurs valeurs d'origine — 36 560 pour
-- un 20 pieds (1 TEU) et 73 120 pour un 40 pieds (2 TEU) — étaient EXACTES.
--
-- F1 a comparé la facture DP World 3384292, qui est un IMPORT facturé au tarif
-- C1–C5 de 18 280, à ces lignes de transit, et en a conclu à tort qu'elles
-- portaient le double du barème. Elle a donc appliqué le tarif import à des
-- lignes de transit, divisant par deux le relevage transit.
--
-- Portée de l'erreur : avant F1 ces lignes étaient en `evidence_level =
-- 'observed'`, hors de la whitelist de provenance du runtime — aucune cotation
-- antérieure n'a jamais porté de relevage. Seules les cotations TRANSIT émises
-- entre le 2026-09-10 et l'application de ce correctif sous-évaluent la ligne.
--
-- Ce que F1 a apporté et qui reste valable : la provenance `official`, l'unité
-- explicite `FCFA/CNT`, la ligne 45 pieds, et l'activation de la ligne.
--
-- Reste hors périmètre, sous GO distinct : créer les lignes `RELEVAGE` en IMPORT
-- et EXPORT au barème C1–C5 (18 280 / 36 560 / 41 130). La facture 3384292
-- prouve que DP World facture le relevage à l'import, mais `quotation-engine`
-- ne l'émet qu'en transit (`:1505`) — sous-lot F2, module FROZEN.
--
-- Bloc DO unique, donc atomique. Deux états sûrs : barème F1 (à corriger) ou
-- barème C6 (déjà correct). Toute autre valeur avorte AVANT toute mutation.

DO $$
DECLARE
  c_provider   CONSTANT TEXT := 'DPW';
  c_category   CONSTANT TEXT := 'RELEVAGE';
  c_operation  CONSTANT TEXT := 'TRANSIT';
  c_unit       CONSTANT TEXT := 'FCFA/CNT';
  c_evidence   CONSTANT TEXT := 'official';
  c_source     CONSTANT TEXT :=
    'Arrêté portant homologation des tarifs de manutention de conteneurs (Ministère du Commerce, Sénégal, 2015) — annexe, RELEVAGE C6 : 36 560 FCFA par TEU';

  -- Barème C6 (transit), dérivé du taux unique par TEU.
  c_rate_teu   CONSTANT NUMERIC := 36560;
  c_amount_20  CONSTANT NUMERIC := 36560;   -- 1,00 TEU
  c_amount_40  CONSTANT NUMERIC := 73120;   -- 2,00 TEU
  c_amount_45  CONSTANT NUMERIC := 82260;   -- 2,25 TEU

  -- Valeurs posées à tort par F1, seules tolérées en entrée.
  c_wrong_20   CONSTANT NUMERIC := 18280;
  c_wrong_40   CONSTANT NUMERIC := 36560;
  c_wrong_45   CONSTANT NUMERIC := 41130;

  v_outside_before  TEXT;
  v_outside_after   TEXT;
  v_scope_count     INT;
  v_row             public.port_tariffs%ROWTYPE;
  v_match           INT;
  v_fixed           INT := 0;
  v_untouched       INT := 0;
  v_final_20        NUMERIC;
  v_final_40        NUMERIC;
  v_final_45        NUMERIC;
BEGIN
  IF to_regclass('public.port_tariffs') IS NULL THEN
    RAISE EXCEPTION '[DTHC-4-F1b] STOP — public.port_tariffs est absente.';
  END IF;

  -- Cohérence interne : le 40 et le 45 dérivent du taux TEU.
  IF c_amount_20 <> c_rate_teu
     OR c_amount_40 <> c_rate_teu * 2
     OR c_amount_45 <> c_rate_teu * 2.25 THEN
    RAISE EXCEPTION '[DTHC-4-F1b] STOP — barème incohérent avec le taux de % FCFA/TEU.', c_rate_teu;
  END IF;

  LOCK TABLE public.port_tariffs IN SHARE ROW EXCLUSIVE MODE;

  SELECT md5(string_agg(t.sig, '|' ORDER BY t.sig)) INTO v_outside_before
  FROM (
    SELECT id::text || '~' || coalesce(amount::text, '') || '~'
             || coalesce(unit, '') || '~' || coalesce(evidence_level, '') || '~'
             || coalesce(is_active::text, '') AS sig
    FROM public.port_tariffs
    WHERE category IS DISTINCT FROM c_category
  ) t;

  -- Le périmètre est exactement les trois lignes laissées par F1.
  SELECT count(*) INTO v_scope_count FROM public.port_tariffs WHERE category = c_category;
  IF v_scope_count <> 3 THEN
    RAISE EXCEPTION '[DTHC-4-F1b] STOP — % lignes RELEVAGE, 3 attendues.', v_scope_count;
  END IF;

  SELECT count(*) INTO v_match
  FROM public.port_tariffs
  WHERE category = c_category
    AND (provider IS DISTINCT FROM c_provider OR operation_type IS DISTINCT FROM c_operation);
  IF v_match > 0 THEN
    RAISE EXCEPTION '[DTHC-4-F1b] STOP — % ligne(s) RELEVAGE hors % / %.', v_match, c_provider, c_operation;
  END IF;

  FOR v_row IN
    SELECT * FROM public.port_tariffs
    WHERE category = c_category
      AND cargo_type IN ('CONTENEUR_20', 'CONTENEUR_40', 'CONTENEUR_45')
    ORDER BY cargo_type
  LOOP
    DECLARE
      v_target NUMERIC;
      v_wrong  NUMERIC;
    BEGIN
      IF v_row.cargo_type = 'CONTENEUR_20' THEN
        v_target := c_amount_20; v_wrong := c_wrong_20;
      ELSIF v_row.cargo_type = 'CONTENEUR_40' THEN
        v_target := c_amount_40; v_wrong := c_wrong_40;
      ELSE
        v_target := c_amount_45; v_wrong := c_wrong_45;
      END IF;

      IF v_row.amount = v_target AND v_row.source_document = c_source THEN
        v_untouched := v_untouched + 1;            -- état 2 : déjà restauré
      ELSIF v_row.amount = v_wrong THEN
        UPDATE public.port_tariffs
        SET amount          = v_target,
            unit            = c_unit,
            source_document = c_source,
            evidence_level  = c_evidence,
            updated_at      = now()
        WHERE id = v_row.id;
        v_fixed := v_fixed + 1;                    -- état 1 : correction
      ELSE
        RAISE EXCEPTION
          '[DTHC-4-F1b] STOP — % porte % FCFA ; ni le barème C6 (%) ni la valeur posée par F1 (%).',
          v_row.cargo_type, v_row.amount, v_target, v_wrong;
      END IF;
    END;
  END LOOP;

  IF v_fixed + v_untouched <> 3 THEN
    RAISE EXCEPTION '[DTHC-4-F1b] STOP — % ligne(s) traitée(s), 3 attendues.', v_fixed + v_untouched;
  END IF;

  -- ---------------------------------------------------------------------
  -- Contrôles de sortie.
  -- ---------------------------------------------------------------------
  SELECT amount INTO v_final_20 FROM public.port_tariffs
   WHERE category = c_category AND cargo_type = 'CONTENEUR_20';
  SELECT amount INTO v_final_40 FROM public.port_tariffs
   WHERE category = c_category AND cargo_type = 'CONTENEUR_40';
  SELECT amount INTO v_final_45 FROM public.port_tariffs
   WHERE category = c_category AND cargo_type = 'CONTENEUR_45';

  IF v_final_20 <> c_amount_20 OR v_final_40 <> c_amount_40 OR v_final_45 <> c_amount_45 THEN
    RAISE EXCEPTION '[DTHC-4-F1b] STOP — barème final % / % / %, attendu % / % / %.',
      v_final_20, v_final_40, v_final_45, c_amount_20, c_amount_40, c_amount_45;
  END IF;

  SELECT count(*) INTO v_match
  FROM public.port_tariffs
  WHERE category = c_category
    AND (evidence_level IS DISTINCT FROM c_evidence
         OR source_document IS DISTINCT FROM c_source
         OR unit IS DISTINCT FROM c_unit
         OR is_active IS DISTINCT FROM true);
  IF v_match > 0 THEN
    RAISE EXCEPTION '[DTHC-4-F1b] STOP — % ligne(s) RELEVAGE hors provenance canonique.', v_match;
  END IF;

  SELECT md5(string_agg(t.sig, '|' ORDER BY t.sig)) INTO v_outside_after
  FROM (
    SELECT id::text || '~' || coalesce(amount::text, '') || '~'
             || coalesce(unit, '') || '~' || coalesce(evidence_level, '') || '~'
             || coalesce(is_active::text, '') AS sig
    FROM public.port_tariffs
    WHERE category IS DISTINCT FROM c_category
  ) t;

  IF v_outside_before IS DISTINCT FROM v_outside_after THEN
    RAISE EXCEPTION '[DTHC-4-F1b] STOP — des lignes hors RELEVAGE ont bougé.';
  END IF;

  RAISE NOTICE '[DTHC-4-F1b] OK — % ligne(s) restaurée(s), % déjà correcte(s). Barème C6 : % / % / % FCFA.',
    v_fixed, v_untouched, c_amount_20, c_amount_40, c_amount_45;
END $$;
