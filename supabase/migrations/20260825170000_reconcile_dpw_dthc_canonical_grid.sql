-- DTHC-1 — Réconcilie la grille DTHC DP World import sur le document canonique
-- `DPW_TARIFS_2025_0001.pdf` (décision CTO du 2026-08-25).
--
-- Tout tient dans un unique bloc DO : c'est une seule instruction, donc atomique.
-- Le moindre RAISE annule l'intégralité des mutations.
--
-- États sûrs :
--   1. Live : les cinq lignes existent, exactes, avec source_document
--      'Arrêté DPW 2025' -> seul `source_document` est réécrit.
--   2. Reset frais : aucune des cinq lignes -> insertion des manquantes.
--   3. Déjà canonique et exact -> no-op strict.
-- Toute autre dérive (montant, unité, date, preuve, surcharge, classification,
-- cardinalité) avorte AVANT toute mutation.
--
-- Non destructif : aucune ligne hors des cinq clés n'est lue en écriture. Les
-- lignes actives CONTENEUR_40 / Transbordement / Vide issues du même PDF sont
-- hors périmètre et une empreinte avant/après le prouve.

DO $$
DECLARE
  c_provider        CONSTANT TEXT := 'DPW';
  c_category        CONSTANT TEXT := 'THC';
  c_operation_type  CONSTANT TEXT := 'IMPORT';
  c_unit            CONSTANT TEXT := 'EVP';
  c_effective_date  CONSTANT DATE := DATE '2025-01-01';
  c_evidence_level  CONSTANT TEXT := 'official';
  c_source_target   CONSTANT TEXT := 'DPW_TARIFS_2025_0001.pdf';
  c_source_legacy   CONSTANT TEXT := 'Arrêté DPW 2025';
  c_families        CONSTANT TEXT[] :=
    ARRAY['BASIC', 'STANDARD', 'REEFER', 'DANGEROUS', 'SPECIAL'];

  c_payload CONSTANT JSONB := '[
    {"cargo_type":"BASIC","classification":"Produits de base (huile, pharma, riz, sucre, lait)","amount":70000,"surcharge_percent":0},
    {"cargo_type":"STANDARD","classification":"Produits standards","amount":155000,"surcharge_percent":0},
    {"cargo_type":"REEFER","classification":"Conteneurs frigorifiques","amount":170500,"surcharge_percent":0},
    {"cargo_type":"DANGEROUS","classification":"Produits dangereux (IMDG classe 1-9)","amount":155000,"surcharge_percent":50},
    {"cargo_type":"SPECIAL","classification":"Conteneurs spéciaux (OOG, flat, open top, tank)","amount":310000,"surcharge_percent":0}
  ]'::jsonb;

  v_item              JSONB;
  v_cargo_type        TEXT;
  v_classification    TEXT;
  v_amount            NUMERIC;
  v_surcharge         NUMERIC;
  v_match_count       INT;
  v_existing          public.port_tariffs%ROWTYPE;
  v_is_exact          BOOLEAN;
  v_inserted          INT := 0;
  v_realigned         INT := 0;
  v_untouched         INT := 0;
  v_outside_before    TEXT;
  v_outside_after     TEXT;
  v_final_count       INT;
BEGIN
  IF to_regclass('public.port_tariffs') IS NULL THEN
    RAISE EXCEPTION 'DTHC abort: public.port_tariffs is missing';
  END IF;

  -- Bloque les écritures concurrentes, laisse les lecteurs runtime passer.
  LOCK TABLE public.port_tariffs IN SHARE ROW EXCLUSIVE MODE;

  -- Empreinte de tout ce qui est HORS des cinq clés canoniques.
  SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), ''))
    INTO v_outside_before
  FROM public.port_tariffs t
  WHERE NOT COALESCE(
    t.provider = c_provider
    AND t.category = c_category
    AND t.operation_type = c_operation_type
    AND t.cargo_type = ANY (c_families)
    AND t.is_active, false);

  FOR v_item IN SELECT * FROM jsonb_array_elements(c_payload) LOOP
    v_cargo_type     := v_item ->> 'cargo_type';
    v_classification := v_item ->> 'classification';
    v_amount         := (v_item ->> 'amount')::numeric;
    v_surcharge      := (v_item ->> 'surcharge_percent')::numeric;

    SELECT count(*) INTO v_match_count
    FROM public.port_tariffs t
    WHERE t.provider = c_provider
      AND t.category = c_category
      AND t.operation_type = c_operation_type
      AND t.cargo_type = v_cargo_type
      AND t.is_active;

    IF v_match_count > 1 THEN
      RAISE EXCEPTION
        'DTHC abort: % active rows for cargo_type=% (exactly 0 or 1 expected)',
        v_match_count, v_cargo_type;
    END IF;

    IF v_match_count = 0 THEN
      -- Reset frais : la ligne canonique manque, on l'insère telle quelle.
      INSERT INTO public.port_tariffs (
        provider, category, operation_type, classification, cargo_type,
        amount, unit, surcharge_percent, source_document,
        effective_date, expiry_date, is_active, evidence_level
      ) VALUES (
        c_provider, c_category, c_operation_type, v_classification, v_cargo_type,
        v_amount, c_unit, v_surcharge, c_source_target,
        c_effective_date, NULL, true, c_evidence_level
      );
      v_inserted := v_inserted + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_existing
    FROM public.port_tariffs t
    WHERE t.provider = c_provider
      AND t.category = c_category
      AND t.operation_type = c_operation_type
      AND t.cargo_type = v_cargo_type
      AND t.is_active;

    -- Tous les attributs hors `source_document` doivent correspondre au payload.
    v_is_exact :=
      v_existing.classification IS NOT DISTINCT FROM v_classification
      AND v_existing.amount = v_amount
      AND v_existing.unit IS NOT DISTINCT FROM c_unit
      AND COALESCE(v_existing.surcharge_percent, 0) = v_surcharge
      AND v_existing.effective_date = c_effective_date
      AND v_existing.expiry_date IS NULL
      AND v_existing.evidence_level IS NOT DISTINCT FROM c_evidence_level;

    IF NOT v_is_exact THEN
      RAISE EXCEPTION
        'DTHC abort: unexpected active row for cargo_type=% (classification=%, amount=%, unit=%, surcharge=%, effective_date=%, expiry_date=%, evidence_level=%)',
        v_cargo_type, v_existing.classification, v_existing.amount, v_existing.unit,
        v_existing.surcharge_percent, v_existing.effective_date, v_existing.expiry_date,
        v_existing.evidence_level;
    END IF;

    IF v_existing.source_document IS NOT DISTINCT FROM c_source_target THEN
      v_untouched := v_untouched + 1;
    ELSIF v_existing.source_document IS NOT DISTINCT FROM c_source_legacy THEN
      UPDATE public.port_tariffs
      SET source_document = c_source_target
      WHERE id = v_existing.id;
      v_realigned := v_realigned + 1;
    ELSE
      RAISE EXCEPTION
        'DTHC abort: unexpected source_document % for cargo_type=% (expected % or %)',
        v_existing.source_document, v_cargo_type, c_source_legacy, c_source_target;
    END IF;
  END LOOP;

  -- Post-état : exactement les cinq lignes canoniques, aux valeurs exactes.
  SELECT count(*) INTO v_final_count
  FROM public.port_tariffs t
  JOIN jsonb_array_elements(c_payload) AS p(item) ON true
  WHERE t.provider = c_provider
    AND t.category = c_category
    AND t.operation_type = c_operation_type
    AND t.is_active
    AND t.cargo_type = (p.item ->> 'cargo_type')
    AND t.classification = (p.item ->> 'classification')
    AND t.amount = (p.item ->> 'amount')::numeric
    AND COALESCE(t.surcharge_percent, 0) = (p.item ->> 'surcharge_percent')::numeric
    AND t.unit = c_unit
    AND t.effective_date = c_effective_date
    AND t.expiry_date IS NULL
    AND t.evidence_level = c_evidence_level
    AND t.source_document = c_source_target;

  IF v_final_count <> 5 THEN
    RAISE EXCEPTION
      'DTHC abort: post-state has % canonical active rows, 5 expected', v_final_count;
  END IF;

  -- Non-destructivité : rien n'a bougé hors des cinq clés.
  SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), ''))
    INTO v_outside_after
  FROM public.port_tariffs t
  WHERE NOT COALESCE(
    t.provider = c_provider
    AND t.category = c_category
    AND t.operation_type = c_operation_type
    AND t.cargo_type = ANY (c_families)
    AND t.is_active, false);

  IF v_outside_after IS DISTINCT FROM v_outside_before THEN
    RAISE EXCEPTION 'DTHC abort: rows outside the five canonical keys were modified';
  END IF;

  RAISE NOTICE 'DTHC canonical grid: % inserted, % realigned, % already canonical',
    v_inserted, v_realigned, v_untouched;
END $$;
