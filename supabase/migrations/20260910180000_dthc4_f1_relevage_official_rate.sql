-- DTHC-4-F1 — Aligne le relevage DP World sur le barème officiel (GO CTO 2026-09-10).
--
-- Barème arrêté par le CTO : **18 280 FCFA par EVP**, soit le double pour un
-- 40 pieds. La facture DP World Dakar n° 3384292 du 31/07/2026 (BL SHZ8041934,
-- quatre conteneurs 20 pieds) le confirme ligne à ligne : 4 × 18 280 = 73 120.
--
-- Ce que la base portait :
--   * CONTENEUR_20 = 36 560  (soit 2 × le barème)
--   * CONTENEUR_40 = 73 120  (soit 2 × le barème — le total de ligne de facture
--     repris comme s'il était le taux unitaire du 40 pieds)
--   les deux sur `Taleb_Quote_2024`, un devis, en `evidence_level = 'observed'`.
--
-- CONSÉQUENCE À CONNAÎTRE : `observed` n'est pas dans la whitelist de provenance
-- du runtime (`quotation-engine.fetchOfficialTariffs` ne lit que 'official' et
-- 'validated_internal'). Les deux lignes étaient donc INVISIBLES au moteur : le
-- relevage n'était chiffré nulle part, ni en transit ni en import. Passer la
-- preuve à 'official' ACTIVE une ligne qui n'a jamais été servie. C'est voulu —
-- la facture prouve que DP World la facture — mais ce n'est pas une simple
-- correction de montant.
--
-- Périmètre strict : les seules lignes `category = 'RELEVAGE'`. Une empreinte
-- avant/après prouve qu'aucune autre ligne de `port_tariffs` n'est touchée.
--
-- Tout tient dans un unique bloc DO : une seule instruction, donc atomique. Le
-- moindre RAISE annule l'intégralité des mutations.
--
-- États sûrs :
--   1. Base d'origine (36 560 / 73 120, aucune ligne 45) -> correction + insertion.
--   2. Migration déjà passée (18 280 / 36 560 / 41 130 en 'official') -> no-op strict.
--   Toute autre valeur, cardinalité ou provenance -> abort AVANT toute mutation.
--
-- Reste hors périmètre, sous GO distinct (sous-lot F2, touche un module FROZEN) :
--   * le relevage n'est émis que si `isTransit` (`quotation-engine:1505`), alors
--     que la facture 3384292 est un import ;
--   * `cargoType` ne connaît que CONTENEUR_20 / CONTENEUR_40 (`:1450`) : la ligne
--     45 pieds créée ici restera dormante tant que le moteur n'aura pas de branche
--     45 ;
--   * la ligne émise porte `source.type: 'OFFICIAL'` en dur (`:1519`).

DO $$
DECLARE
  c_provider   CONSTANT TEXT := 'DPW';
  c_category   CONSTANT TEXT := 'RELEVAGE';
  c_operation  CONSTANT TEXT := 'TRANSIT';
  c_unit       CONSTANT TEXT := 'FCFA/CNT';
  c_evidence   CONSTANT TEXT := 'official';
  c_source     CONSTANT TEXT :=
    'Facture DP World Dakar n° 3384292 du 31/07/2026 (BL SHZ8041934) — barème 18 280 FCFA/EVP';

  -- Barème cible, dérivé du taux unique de 18 280 par EVP.
  c_rate_evp   CONSTANT NUMERIC := 18280;   -- 1,00 EVP -> 20 pieds
  c_amount_20  CONSTANT NUMERIC := 18280;   -- 1,00 EVP
  c_amount_40  CONSTANT NUMERIC := 36560;   -- 2,00 EVP
  c_amount_45  CONSTANT NUMERIC := 41130;   -- 2,25 EVP

  -- Valeurs héritées, seules tolérées en entrée.
  c_legacy_20  CONSTANT NUMERIC := 36560;
  c_legacy_40  CONSTANT NUMERIC := 73120;

  v_outside_before  TEXT;
  v_outside_after   TEXT;
  v_scope_count     INT;
  v_row             public.port_tariffs%ROWTYPE;
  v_match           INT;
  v_updated         INT := 0;
  v_inserted        INT := 0;
  v_untouched       INT := 0;
  v_final_20        NUMERIC;
  v_final_40        NUMERIC;
  v_final_45        NUMERIC;
BEGIN
  IF to_regclass('public.port_tariffs') IS NULL THEN
    RAISE EXCEPTION '[DTHC-4-F1] STOP — public.port_tariffs est absente.';
  END IF;

  -- Cohérence interne du barème : le 40 et le 45 dérivent du taux EVP.
  IF c_amount_20 <> c_rate_evp
     OR c_amount_40 <> c_rate_evp * 2
     OR c_amount_45 <> c_rate_evp * 2.25 THEN
    RAISE EXCEPTION '[DTHC-4-F1] STOP — barème incohérent avec le taux de % FCFA/EVP.', c_rate_evp;
  END IF;

  -- Bloque les écritures concurrentes, laisse passer les lecteurs runtime.
  LOCK TABLE public.port_tariffs IN SHARE ROW EXCLUSIVE MODE;

  -- Empreinte de TOUT ce qui n'est pas du relevage : doit être identique à la fin.
  SELECT md5(string_agg(t.sig, '|' ORDER BY t.sig)) INTO v_outside_before
  FROM (
    SELECT id::text || '~' || coalesce(amount::text, '') || '~'
             || coalesce(unit, '') || '~' || coalesce(evidence_level, '') || '~'
             || coalesce(is_active::text, '') AS sig
    FROM public.port_tariffs
    WHERE category IS DISTINCT FROM c_category
  ) t;

  -- Le périmètre doit être exactement celui qu'on connaît : 2 ou 3 lignes, ce
  -- fournisseur, cette opération. Toute autre ligne de relevage est un signal.
  SELECT count(*) INTO v_scope_count FROM public.port_tariffs WHERE category = c_category;
  IF v_scope_count NOT BETWEEN 2 AND 3 THEN
    RAISE EXCEPTION '[DTHC-4-F1] STOP — % lignes RELEVAGE, 2 (avant) ou 3 (après) attendues.',
      v_scope_count;
  END IF;

  SELECT count(*) INTO v_match
  FROM public.port_tariffs
  WHERE category = c_category
    AND (provider IS DISTINCT FROM c_provider OR operation_type IS DISTINCT FROM c_operation);
  IF v_match > 0 THEN
    RAISE EXCEPTION '[DTHC-4-F1] STOP — % ligne(s) RELEVAGE hors % / %.', v_match, c_provider, c_operation;
  END IF;

  -- ---------------------------------------------------------------------
  -- CONTENEUR_20 et CONTENEUR_40 : correction en place.
  -- ---------------------------------------------------------------------
  FOR v_row IN
    SELECT * FROM public.port_tariffs
    WHERE category = c_category AND cargo_type IN ('CONTENEUR_20', 'CONTENEUR_40')
    ORDER BY cargo_type
  LOOP
    DECLARE
      v_target NUMERIC;
      v_legacy NUMERIC;
    BEGIN
      IF v_row.cargo_type = 'CONTENEUR_20' THEN
        v_target := c_amount_20; v_legacy := c_legacy_20;
      ELSE
        v_target := c_amount_40; v_legacy := c_legacy_40;
      END IF;

      IF v_row.amount = v_target
         AND v_row.unit = c_unit
         AND v_row.evidence_level = c_evidence
         AND v_row.source_document = c_source THEN
        v_untouched := v_untouched + 1;          -- état 2 : déjà canonique
      ELSIF v_row.amount = v_legacy THEN
        UPDATE public.port_tariffs
        SET amount          = v_target,
            unit            = c_unit,
            source_document = c_source,
            evidence_level  = c_evidence,
            updated_at      = now()
        WHERE id = v_row.id;
        v_updated := v_updated + 1;              -- état 1 : correction
      ELSE
        RAISE EXCEPTION
          '[DTHC-4-F1] STOP — % porte % FCFA ; ni le barème (%) ni la valeur héritée (%).',
          v_row.cargo_type, v_row.amount, v_target, v_legacy;
      END IF;
    END;
  END LOOP;

  IF v_updated + v_untouched <> 2 THEN
    RAISE EXCEPTION '[DTHC-4-F1] STOP — % ligne(s) 20/40 traitée(s), 2 attendues.',
      v_updated + v_untouched;
  END IF;

  -- ---------------------------------------------------------------------
  -- CONTENEUR_45 : 2,25 EVP. Absente du barème d'origine, créée ici.
  -- Elle restera inerte tant que le moteur n'aura pas de branche 45 (F2).
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO v_match
  FROM public.port_tariffs WHERE category = c_category AND cargo_type = 'CONTENEUR_45';

  IF v_match = 0 THEN
    INSERT INTO public.port_tariffs (
      provider, category, operation_type, classification, cargo_type,
      amount, unit, surcharge_percent, surcharge_conditions,
      source_document, effective_date, expiry_date, is_active, evidence_level
    )
    SELECT c_provider, c_category, c_operation, 'Standard 45 pieds', 'CONTENEUR_45',
           c_amount_45, c_unit, 0, NULL,
           c_source, min(effective_date), NULL, true, c_evidence
    FROM public.port_tariffs
    WHERE category = c_category AND cargo_type IN ('CONTENEUR_20', 'CONTENEUR_40');
    v_inserted := 1;
  ELSIF v_match = 1 THEN
    PERFORM 1 FROM public.port_tariffs
    WHERE category = c_category AND cargo_type = 'CONTENEUR_45'
      AND amount = c_amount_45 AND unit = c_unit AND evidence_level = c_evidence;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[DTHC-4-F1] STOP — la ligne CONTENEUR_45 existe mais diverge du barème.';
    END IF;
  ELSE
    RAISE EXCEPTION '[DTHC-4-F1] STOP — % lignes CONTENEUR_45, 0 ou 1 attendue.', v_match;
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
    RAISE EXCEPTION '[DTHC-4-F1] STOP — barème final % / % / %, attendu % / % / %.',
      v_final_20, v_final_40, v_final_45, c_amount_20, c_amount_40, c_amount_45;
  END IF;

  SELECT count(*) INTO v_scope_count FROM public.port_tariffs WHERE category = c_category;
  IF v_scope_count <> 3 THEN
    RAISE EXCEPTION '[DTHC-4-F1] STOP — % lignes RELEVAGE en sortie, 3 attendues.', v_scope_count;
  END IF;

  SELECT count(*) INTO v_match
  FROM public.port_tariffs
  WHERE category = c_category
    AND (evidence_level IS DISTINCT FROM c_evidence
         OR source_document IS DISTINCT FROM c_source
         OR unit IS DISTINCT FROM c_unit
         OR is_active IS DISTINCT FROM true);
  IF v_match > 0 THEN
    RAISE EXCEPTION '[DTHC-4-F1] STOP — % ligne(s) RELEVAGE hors provenance canonique.', v_match;
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
    RAISE EXCEPTION '[DTHC-4-F1] STOP — des lignes hors RELEVAGE ont bougé.';
  END IF;

  RAISE NOTICE '[DTHC-4-F1] OK — % corrigée(s), % inchangée(s), % insérée(s). Barème % / % / % FCFA.',
    v_updated, v_untouched, v_inserted, c_amount_20, c_amount_40, c_amount_45;
END $$;
