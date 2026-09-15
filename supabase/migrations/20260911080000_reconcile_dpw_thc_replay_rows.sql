-- Authored 2026-09-14, explicit CTO GO: LOCAL reconciliation/tests only.
-- Ordered before DTHC-4-D1, without editing any already applied migration.
-- Source: read-only Lovable port_tariffs inspection 2026-09-14, corroborated
-- by the D1 target list and 20260911120000 annex. No new tariff decision.
-- Six current canonical rows + five historical rows kept INACTIVE at insertion.
-- Never update existing rows, never reactivate legacy prices. Any drift aborts.
-- Cloud application and migration-ledger reconciliation require a separate GO.
DO $$
DECLARE
  c_source constant text := 'Arrêté ministériel n° 035532 du 28/11/2023 - JORS n° 7723 du 06/04/2024 p. 471';
  c_rows constant jsonb := '[
    {"operation_type":"EXPORT","cargo_type":"COTON","classification":"Coton (Mali/Sénégal)","amount":70000,"surcharge_percent":0,"is_active":true},
    {"operation_type":"EXPORT","cargo_type":"STANDARD","classification":"Produits standards","amount":155000,"surcharge_percent":0,"is_active":true},
    {"operation_type":"EXPORT","cargo_type":"REEFER","classification":"Conteneurs frigorifiques","amount":170500,"surcharge_percent":0,"is_active":true},
    {"operation_type":"EXPORT","cargo_type":"DANGEROUS","classification":"Produits dangereux (IMDG classe 1-9)","amount":155000,"surcharge_percent":50,"is_active":true},
    {"operation_type":"EXPORT","cargo_type":"SPECIAL","classification":"Conteneurs spéciaux (OOG, flat, open top, tank)","amount":310000,"surcharge_percent":0,"is_active":true},
    {"operation_type":"TRANSIT","cargo_type":"STANDARD","classification":"Import/export (sauf coton Mali/SN et spéciaux)","amount":110000,"surcharge_percent":0,"is_active":true},
    {"operation_type":"IMPORT","cargo_type":"CONTENEUR_40","classification":"Standard 40 pieds","amount":232500,"surcharge_percent":50,"is_active":false},
    {"operation_type":"EXPORT","cargo_type":"CONTENEUR_40","classification":"Standard 40 pieds","amount":232500,"surcharge_percent":50,"is_active":false},
    {"operation_type":"IMPORT","cargo_type":"CONTENEUR_VIDE","classification":"Vide","amount":75000,"surcharge_percent":50,"is_active":false},
    {"operation_type":"EXPORT","cargo_type":"CONTENEUR_VIDE","classification":"Vide","amount":75000,"surcharge_percent":50,"is_active":false},
    {"operation_type":"IMPORT","cargo_type":"CONTENEUR_20","classification":"Transbordement","amount":75000,"surcharge_percent":50,"is_active":false}
  ]';
  v_item jsonb; v_expected jsonb; v_existing jsonb;
  v_before jsonb; v_after jsonb;
  v_inserted_id uuid;
  v_count integer; v_inserted integer := 0;
BEGIN
  IF to_regclass('public.port_tariffs') IS NULL THEN
    RAISE EXCEPTION '[DTHC-REPLAY] STOP: port_tariffs absent';
  END IF;
  LOCK TABLE public.port_tariffs IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) INTO v_before FROM public.port_tariffs t;
  FOR v_item IN SELECT value FROM jsonb_array_elements(c_rows) LOOP
    v_expected := v_item || jsonb_build_object('provider','DPW','category','THC','unit','EVP',
      'evidence_level','official','expiry_date',null,
      'source_document',CASE WHEN (v_item->>'is_active')::boolean THEN c_source ELSE 'DPW_TARIFS_2025_0001.pdf' END,
      'effective_date',CASE WHEN (v_item->>'is_active')::boolean THEN '2024-04-06' ELSE '2025-01-01' END,
      'surcharge_conditions',CASE WHEN (v_item->>'is_active')::boolean THEN null ELSE 'Produits dangereux' END);
    SELECT count(*) INTO v_count FROM public.port_tariffs t
    WHERE t.provider IN ('DPW','DP_WORLD') AND t.category='THC'
      AND t.operation_type=v_item->>'operation_type' AND t.cargo_type=v_item->>'cargo_type'
      AND ((v_item->>'is_active')::boolean OR t.classification=v_item->>'classification');
    IF v_count > 1 THEN
      RAISE EXCEPTION '[DTHC-REPLAY] STOP: duplicate target %', v_item;
    ELSIF v_count = 1 THEN
      SELECT to_jsonb(t) INTO v_existing FROM public.port_tariffs t
      WHERE t.provider IN ('DPW','DP_WORLD') AND t.category='THC'
        AND t.operation_type=v_item->>'operation_type' AND t.cargo_type=v_item->>'cargo_type'
        AND ((v_item->>'is_active')::boolean OR t.classification=v_item->>'classification');
      IF NOT (v_existing @> v_expected) THEN
        RAISE EXCEPTION '[DTHC-REPLAY] STOP: existing target differs %', v_item;
      END IF;
    ELSE
      INSERT INTO public.port_tariffs(provider,category,operation_type,classification,cargo_type,
        amount,unit,surcharge_percent,surcharge_conditions,source_document,effective_date,expiry_date,is_active,evidence_level)
      VALUES ('DPW','THC',v_expected->>'operation_type',v_expected->>'classification',v_expected->>'cargo_type',
        (v_expected->>'amount')::numeric,'EVP',(v_expected->>'surcharge_percent')::numeric,
        v_expected->>'surcharge_conditions',v_expected->>'source_document',(v_expected->>'effective_date')::date,
        null,(v_expected->>'is_active')::boolean,'official') RETURNING id INTO v_inserted_id;
      SELECT to_jsonb(t) INTO v_existing FROM public.port_tariffs t WHERE t.id=v_inserted_id;
      IF v_existing IS NULL OR NOT (v_existing @> v_expected) THEN
        RAISE EXCEPTION '[DTHC-REPLAY] STOP: inserted target differs %', v_item;
      END IF;
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) INTO v_after FROM public.port_tariffs t;
  IF NOT (v_after @> v_before) OR jsonb_array_length(v_after) <> jsonb_array_length(v_before)+v_inserted THEN
    RAISE EXCEPTION '[DTHC-REPLAY] STOP: existing rows changed or unexpected insert';
  END IF;
  RAISE NOTICE '[DTHC-REPLAY] PASS: % rows inserted, existing rows unchanged, legacy targets inactive', v_inserted;
END $$;
