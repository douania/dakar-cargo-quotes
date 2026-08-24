-- Technical Git reconciliation of the unverified tariff quarantine observed in
-- Lovable. Three families are involved, 25 rows in total:
--   * the 6 Taleb rows of public.border_clearing_rates;
--   * the 10 Taleb rows of public.destination_terminal_rates;
--   * the 9 unverified rows of public.demurrage_rates (COSCO / EVERGREEN / ONE).
--
-- On Lovable these 25 rows are already is_active = false. No Git migration
-- reproduces that state: 20260114114407 seeds the 16 Taleb rows active by
-- default and 20251220103347 seeds the 9 demurrage rows active by default. A
-- fresh `supabase db reset` therefore rebuilds them active and quotable, while
-- quotation-engine loads border_clearing_rates and destination_terminal_rates
-- on `is_active = true` alone and totals their positive amounts as OFFICIAL.
-- The Git/live gap is consequently a firm-quote hazard, which this migration
-- closes by making Git converge onto the observed live state.
--
-- This is a technical reconciliation of an observed live state. It is NOT a
-- SODATRA business validation of these tariffs, and it does not decide their
-- fate: it only restores in Git the quarantine that already exists in Lovable.
--
-- Scope contract enforced below:
--   * never activates a tariff - is_active only ever moves TRUE -> FALSE;
--   * never INSERTs, never DELETEs, no table DDL, no RLS change;
--   * never encodes a live UUID - every row is matched on its business key;
--   * never touches the business amounts, methods or currencies of the 16
--     Taleb rows;
--   * leaves the other demurrage_rates rows - including the two parents
--     reconciled by 20260402152121 - provably untouched, proven by a digest
--     taken before and after the mutation pass;
--   * strict read-only no-op once the observed live state is already in place.
--
-- Two distinct fingerprints are used per row, mirroring
-- 20260402152121_reconcile_demurrage_rate_parents.sql:
--   * the seed fingerprint, taken verbatim from the existing migrations, is the
--     only shape this migration accepts before mutating a row;
--   * the target fingerprint is the read-only Lovable snapshot. The exhaustive
--     live extraction did return charge_name and notes for the 16 Taleb rows,
--     and both are identical to the seed labels, so the target fingerprint
--     validates them too - against those same seed values - alongside the
--     business key, method, amounts, currency, source, effective date and
--     activity. The border and terminal target rows therefore differ from
--     their seed rows by is_active alone. Only the 9 demurrage rows carry
--     target labels of their own, pinned below as constants.
--
-- The demurrage seed (20251220103347) declares `effective_date DATE NOT NULL
-- DEFAULT CURRENT_DATE` and does not list the column in its INSERT, so a fresh
-- seed produces a nondeterministic effective_date. It is therefore excluded
-- from the demurrage seed fingerprint. Every other seed attribute must match
-- exactly before any mutation is allowed.

DO $reconcile_unverified_tariff_quarantine$
DECLARE
  -- ---------------------------------------------------------------------
  -- Expected fingerprints. Single source of truth for the three passes.
  -- ---------------------------------------------------------------------
  v_border_expected jsonb := '[
    {"corridor":"KIDIRA_DIBOLI","country":"MALI","charge_code":"CUSTOMS_ESCORT_SN","charge_name":"Customs Escort Senegal","calculation_method":"PER_CNT","amount_20ft":75000,"amount_40ft":75000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Escorte douanière sénégalaise"},
    {"corridor":"KIDIRA_DIBOLI","country":"MALI","charge_code":"SCANNER","charge_name":"Scanner Frontière","calculation_method":"PER_CNT","amount_20ft":30000,"amount_40ft":30000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Passage scanner frontière"},
    {"corridor":"KIDIRA_DIBOLI","country":"MALI","charge_code":"TRIE_CARNET","charge_name":"TRIE Carnet","calculation_method":"PER_CNT","amount_20ft":7500,"amount_40ft":7500,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Carnet de transit international"},
    {"corridor":"KIDIRA_DIBOLI","country":"MALI","charge_code":"TS_KIDIRA","charge_name":"Ts Kidira / Ts Diboli","calculation_method":"PER_CNT","amount_20ft":15000,"amount_40ft":15000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Frais de transit frontière sénégalaise"},
    {"corridor":"KIDIRA_DIBOLI","country":"MALI","charge_code":"RI_RS","charge_name":"RI RS","calculation_method":"PER_CNT","amount_20ft":7000,"amount_40ft":7000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Redevance informatique"},
    {"corridor":"KIDIRA_DIBOLI","country":"MALI","charge_code":"MALI_BORDER","charge_name":"Mali Border Clearing Fees","calculation_method":"PER_CNT","amount_20ft":50000,"amount_40ft":75000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Dédouanement côté malien"}
  ]'::jsonb;

  v_terminal_expected jsonb := '[
    {"terminal_name":"SDV_KATI","country":"MALI","charge_code":"ACCORD_SORTIE","charge_name":"Accord sortie","calculation_method":"PER_CNT","rate_per_tonne":null,"rate_per_truck":null,"rate_fixed":null,"rate_per_cnt":19000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Accord de sortie terminal"},
    {"terminal_name":"MALI_SHIPPER_COUNCIL","country":"MALI","charge_code":"DM_LV","charge_name":"DM/LV (Conseil Malien des Chargeurs)","calculation_method":"FIXED","rate_per_tonne":null,"rate_per_truck":null,"rate_fixed":15000,"rate_per_cnt":null,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Frais fixe par dossier"},
    {"terminal_name":"MALI_SHIPPER_COUNCIL","country":"MALI","charge_code":"EMASE","charge_name":"EMASE","calculation_method":"PER_TONNE","rate_per_tonne":505,"rate_per_truck":null,"rate_fixed":null,"rate_per_cnt":null,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"€0.77 × 656 = 505 XOF/tonne"},
    {"terminal_name":"SDV_KATI","country":"MALI","charge_code":"MALIAN_CLEARING_AGENT","charge_name":"Malian Clearing Agent","calculation_method":"PER_CNT","rate_per_tonne":null,"rate_per_truck":null,"rate_fixed":null,"rate_per_cnt":25000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Honoraires transitaire malien"},
    {"terminal_name":"SDV_KATI","country":"MALI","charge_code":"PDI_RS_RI","charge_name":"PDI - RS - RI","calculation_method":"PER_CNT","rate_per_tonne":null,"rate_per_truck":null,"rate_fixed":null,"rate_per_cnt":17000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Redevances informatiques"},
    {"terminal_name":"SDV_KATI","country":"MALI","charge_code":"ECOR_DOUANE","charge_name":"Ecor Douane","calculation_method":"PER_CNT","rate_per_tonne":null,"rate_per_truck":null,"rate_fixed":null,"rate_per_cnt":25000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Ecor de douane"},
    {"terminal_name":"SDV_KATI","country":"MALI","charge_code":"TS_BRIGADE","charge_name":"Ts Brigade","calculation_method":"PER_CNT","rate_per_tonne":null,"rate_per_truck":null,"rate_fixed":null,"rate_per_cnt":100000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Frais brigade"},
    {"terminal_name":"SDV_KATI","country":"MALI","charge_code":"KATI_PER_TON","charge_name":"Kati Fees per ton","calculation_method":"PER_TONNE","rate_per_tonne":997,"rate_per_truck":null,"rate_fixed":null,"rate_per_cnt":null,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"€1.52 × 656 = 997 XOF"},
    {"terminal_name":"MALI_SHIPPER_COUNCIL","country":"MALI","charge_code":"CMC","charge_name":"CMC","calculation_method":"PER_CNT","rate_per_tonne":null,"rate_per_truck":null,"rate_fixed":null,"rate_per_cnt":10000,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"Conseil Malien des Chargeurs par conteneur"},
    {"terminal_name":"SDV_KATI","country":"MALI","charge_code":"KATI_PER_TRUCK","charge_name":"Kati Fees per truck","calculation_method":"PER_TRUCK","rate_per_tonne":null,"rate_per_truck":7080,"rate_fixed":null,"rate_per_cnt":null,"currency":"XOF","source_document":"Taleb_Tiakabougou_Quote_2024","effective_date":"2024-10-01","seed_notes":"€10.79 × 656 = 7,080 XOF"}
  ]'::jsonb;

  -- carrier_normalized mirrors the normalization already used by
  -- 20260402152121 so that a renamed variant such as "CMA CGM" -> "CMA_CGM"
  -- can never hide behind an exact-text lookup.
  v_demurrage_expected jsonb := '[
    {"carrier":"COSCO","carrier_normalized":"COSCO","container_type":"20DV","free_days_import":10,"free_days_export":7,"currency":"USD","day_1_7_rate":45,"day_8_14_rate":90,"day_15_plus_rate":135,"seed_notes":"COSCO offre franchise étendue","seed_source_document":"COSCO Local Charges","target_source_document":"COSCO Local Charges (non vérifié Sénégal)"},
    {"carrier":"COSCO","carrier_normalized":"COSCO","container_type":"40DV","free_days_import":10,"free_days_export":7,"currency":"USD","day_1_7_rate":90,"day_8_14_rate":180,"day_15_plus_rate":270,"seed_notes":"COSCO offre franchise étendue","seed_source_document":"COSCO Local Charges","target_source_document":"COSCO Local Charges (non vérifié Sénégal)"},
    {"carrier":"COSCO","carrier_normalized":"COSCO","container_type":"40HC","free_days_import":10,"free_days_export":7,"currency":"USD","day_1_7_rate":90,"day_8_14_rate":180,"day_15_plus_rate":270,"seed_notes":"Même tarif que 40DV","seed_source_document":"COSCO Local Charges","target_source_document":"COSCO Local Charges (non vérifié Sénégal)"},
    {"carrier":"EVERGREEN","carrier_normalized":"EVERGREEN","container_type":"20DV","free_days_import":7,"free_days_export":5,"currency":"USD","day_1_7_rate":48,"day_8_14_rate":96,"day_15_plus_rate":144,"seed_notes":"Tarifs Evergreen 2024","seed_source_document":"Evergreen Local Charges","target_source_document":"Evergreen Local Charges (non vérifié Sénégal)"},
    {"carrier":"EVERGREEN","carrier_normalized":"EVERGREEN","container_type":"40DV","free_days_import":7,"free_days_export":5,"currency":"USD","day_1_7_rate":96,"day_8_14_rate":192,"day_15_plus_rate":288,"seed_notes":"Tarifs Evergreen 2024","seed_source_document":"Evergreen Local Charges","target_source_document":"Evergreen Local Charges (non vérifié Sénégal)"},
    {"carrier":"EVERGREEN","carrier_normalized":"EVERGREEN","container_type":"40HC","free_days_import":7,"free_days_export":5,"currency":"USD","day_1_7_rate":96,"day_8_14_rate":192,"day_15_plus_rate":288,"seed_notes":"Même tarif que 40DV","seed_source_document":"Evergreen Local Charges","target_source_document":"Evergreen Local Charges (non vérifié Sénégal)"},
    {"carrier":"ONE","carrier_normalized":"ONE","container_type":"20DV","free_days_import":7,"free_days_export":5,"currency":"USD","day_1_7_rate":50,"day_8_14_rate":100,"day_15_plus_rate":150,"seed_notes":"Tarifs ONE Line 2024","seed_source_document":"one_line_local_charges.pdf","target_source_document":"one_line_local_charges.pdf (non vérifié Sénégal)"},
    {"carrier":"ONE","carrier_normalized":"ONE","container_type":"40DV","free_days_import":7,"free_days_export":5,"currency":"USD","day_1_7_rate":100,"day_8_14_rate":200,"day_15_plus_rate":300,"seed_notes":"Tarifs ONE Line 2024","seed_source_document":"one_line_local_charges.pdf","target_source_document":"one_line_local_charges.pdf (non vérifié Sénégal)"},
    {"carrier":"ONE","carrier_normalized":"ONE","container_type":"40HC","free_days_import":7,"free_days_export":5,"currency":"USD","day_1_7_rate":100,"day_8_14_rate":200,"day_15_plus_rate":300,"seed_notes":"Même tarif que 40DV","seed_source_document":"one_line_local_charges.pdf","target_source_document":"one_line_local_charges.pdf (non vérifié Sénégal)"}
  ]'::jsonb;

  -- Shared quarantine metadata observed live on the 9 unverified demurrage rows.
  c_demurrage_target_notes          CONSTANT text := 'TO_CONFIRM — pas de barème officiel Sénégal vérifié, données estimatives';
  c_demurrage_target_effective_date CONSTANT date := DATE '2025-12-20';

  v_e                       jsonb;
  v_border                  public.border_clearing_rates%ROWTYPE;
  v_terminal                public.destination_terminal_rates%ROWTYPE;
  v_demurrage               public.demurrage_rates%ROWTYPE;
  v_demurrage_keys          text[];
  v_demurrage_total_before  integer;
  v_demurrage_total_after   integer;
  v_others_digest_before    text;
  v_others_digest_after     text;
  v_cardinality             integer;
  v_total                   integer;
  v_updated                 integer;
  v_is_seed                 boolean;
  v_is_target               boolean;
  v_border_deactivated      integer := 0;
  v_terminal_deactivated    integer := 0;
  v_demurrage_reconciled    integer := 0;
BEGIN
  -- =====================================================================
  -- PASS 0 - self-check of the expected fingerprints and pre-mutation
  --          snapshot of everything that must remain untouched.
  -- =====================================================================
  IF jsonb_array_length(v_border_expected) IS DISTINCT FROM 6
     OR jsonb_array_length(v_terminal_expected) IS DISTINCT FROM 10
     OR jsonb_array_length(v_demurrage_expected) IS DISTINCT FROM 9
  THEN
    RAISE EXCEPTION
      'tariff quarantine stopped: expected fingerprint lists must hold exactly 6 / 10 / 9 rows, got % / % / %',
      jsonb_array_length(v_border_expected),
      jsonb_array_length(v_terminal_expected),
      jsonb_array_length(v_demurrage_expected);
  END IF;

  SELECT array_agg((e.value ->> 'carrier_normalized') || '|' || (e.value ->> 'container_type'))
  INTO v_demurrage_keys
  FROM jsonb_array_elements(v_demurrage_expected) AS e(value);

  IF (SELECT count(DISTINCT k) FROM unnest(v_demurrage_keys) AS k) IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION
      'tariff quarantine stopped: the 9 expected demurrage business keys are not unique';
  END IF;

  IF (
    SELECT count(DISTINCT (e.value ->> 'corridor') || '|' || (e.value ->> 'country') || '|' || (e.value ->> 'charge_code'))
    FROM jsonb_array_elements(v_border_expected) AS e(value)
  ) IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION
      'tariff quarantine stopped: the 6 expected border business keys are not unique';
  END IF;

  IF (
    SELECT count(DISTINCT (e.value ->> 'terminal_name') || '|' || (e.value ->> 'country') || '|' || (e.value ->> 'charge_code'))
    FROM jsonb_array_elements(v_terminal_expected) AS e(value)
  ) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'tariff quarantine stopped: the 10 expected terminal business keys are not unique';
  END IF;

  SELECT count(*) INTO v_demurrage_total_before FROM public.demurrage_rates;

  -- Digest of every demurrage row outside the 9 in scope. Compared again after
  -- the mutation pass, this proves the other rows - the 26 active ones on
  -- Lovable, 20 on a fresh Git seed - were neither modified, inserted nor
  -- deleted, including the two parents pinned by 20260402152121.
  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_others_digest_before
  FROM (
    SELECT d::text AS row_text
    FROM public.demurrage_rates AS d
    WHERE (regexp_replace(upper(btrim(d.carrier)), '[^A-Z0-9]', '', 'g') || '|' || d.container_type)
          <> ALL (v_demurrage_keys)
  ) AS t;

  -- =====================================================================
  -- PASS 1 - strict validation. No row is written before every one of the
  --          25 rows has been proven to be either the exact Git seed row or
  --          the exact observed Lovable target row. Rows are locked here and
  --          stay locked for the rest of this transaction.
  -- =====================================================================

  -- ---- border_clearing_rates -----------------------------------------
  SELECT count(*) INTO v_total FROM public.border_clearing_rates;
  IF v_total IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION
      'tariff quarantine stopped: border_clearing_rates holds % rows, expected exactly the 6 Taleb rows',
      v_total;
  END IF;

  FOR v_e IN SELECT value FROM jsonb_array_elements(v_border_expected) LOOP
    SELECT count(*) INTO v_cardinality
    FROM public.border_clearing_rates AS b
    WHERE b.corridor = v_e ->> 'corridor'
      AND b.country = v_e ->> 'country'
      AND b.charge_code = v_e ->> 'charge_code';

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: expected exactly one border_clearing_rates row for % / % / %, found %',
        v_e ->> 'corridor', v_e ->> 'country', v_e ->> 'charge_code', v_cardinality;
    END IF;

    SELECT * INTO v_border
    FROM public.border_clearing_rates AS b
    WHERE b.corridor = v_e ->> 'corridor'
      AND b.country = v_e ->> 'country'
      AND b.charge_code = v_e ->> 'charge_code'
    FOR UPDATE;

    v_is_seed :=
      v_border.charge_name        IS NOT DISTINCT FROM v_e ->> 'charge_name'
      AND v_border.calculation_method IS NOT DISTINCT FROM v_e ->> 'calculation_method'
      AND v_border.amount_20ft    IS NOT DISTINCT FROM (v_e ->> 'amount_20ft')::numeric
      AND v_border.amount_40ft    IS NOT DISTINCT FROM (v_e ->> 'amount_40ft')::numeric
      AND v_border.currency       IS NOT DISTINCT FROM v_e ->> 'currency'
      AND v_border.source_document IS NOT DISTINCT FROM v_e ->> 'source_document'
      AND v_border.effective_date IS NOT DISTINCT FROM (v_e ->> 'effective_date')::date
      AND v_border.notes          IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND v_border.is_active      IS TRUE;

    v_is_target :=
      v_border.charge_name        IS NOT DISTINCT FROM v_e ->> 'charge_name'
      AND v_border.calculation_method IS NOT DISTINCT FROM v_e ->> 'calculation_method'
      AND v_border.amount_20ft    IS NOT DISTINCT FROM (v_e ->> 'amount_20ft')::numeric
      AND v_border.amount_40ft    IS NOT DISTINCT FROM (v_e ->> 'amount_40ft')::numeric
      AND v_border.currency       IS NOT DISTINCT FROM v_e ->> 'currency'
      AND v_border.source_document IS NOT DISTINCT FROM v_e ->> 'source_document'
      AND v_border.effective_date IS NOT DISTINCT FROM (v_e ->> 'effective_date')::date
      AND v_border.notes          IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND v_border.is_active      IS FALSE;

    IF NOT (v_is_seed OR v_is_target) THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: border_clearing_rates row % / % / % matches neither the exact Git seed fingerprint nor the observed Lovable target state',
        v_e ->> 'corridor', v_e ->> 'country', v_e ->> 'charge_code';
    END IF;
  END LOOP;

  -- ---- destination_terminal_rates ------------------------------------
  SELECT count(*) INTO v_total FROM public.destination_terminal_rates;
  IF v_total IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'tariff quarantine stopped: destination_terminal_rates holds % rows, expected exactly the 10 Taleb rows',
      v_total;
  END IF;

  FOR v_e IN SELECT value FROM jsonb_array_elements(v_terminal_expected) LOOP
    SELECT count(*) INTO v_cardinality
    FROM public.destination_terminal_rates AS t
    WHERE t.terminal_name = v_e ->> 'terminal_name'
      AND t.country = v_e ->> 'country'
      AND t.charge_code = v_e ->> 'charge_code';

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: expected exactly one destination_terminal_rates row for % / % / %, found %',
        v_e ->> 'terminal_name', v_e ->> 'country', v_e ->> 'charge_code', v_cardinality;
    END IF;

    SELECT * INTO v_terminal
    FROM public.destination_terminal_rates AS t
    WHERE t.terminal_name = v_e ->> 'terminal_name'
      AND t.country = v_e ->> 'country'
      AND t.charge_code = v_e ->> 'charge_code'
    FOR UPDATE;

    v_is_seed :=
      v_terminal.charge_name         IS NOT DISTINCT FROM v_e ->> 'charge_name'
      AND v_terminal.calculation_method IS NOT DISTINCT FROM v_e ->> 'calculation_method'
      AND v_terminal.rate_per_tonne  IS NOT DISTINCT FROM (v_e ->> 'rate_per_tonne')::numeric
      AND v_terminal.rate_per_truck  IS NOT DISTINCT FROM (v_e ->> 'rate_per_truck')::numeric
      AND v_terminal.rate_fixed      IS NOT DISTINCT FROM (v_e ->> 'rate_fixed')::numeric
      AND v_terminal.rate_per_cnt    IS NOT DISTINCT FROM (v_e ->> 'rate_per_cnt')::numeric
      AND v_terminal.currency        IS NOT DISTINCT FROM v_e ->> 'currency'
      AND v_terminal.source_document IS NOT DISTINCT FROM v_e ->> 'source_document'
      AND v_terminal.effective_date  IS NOT DISTINCT FROM (v_e ->> 'effective_date')::date
      AND v_terminal.notes           IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND v_terminal.is_active       IS TRUE;

    v_is_target :=
      v_terminal.charge_name         IS NOT DISTINCT FROM v_e ->> 'charge_name'
      AND v_terminal.calculation_method IS NOT DISTINCT FROM v_e ->> 'calculation_method'
      AND v_terminal.rate_per_tonne  IS NOT DISTINCT FROM (v_e ->> 'rate_per_tonne')::numeric
      AND v_terminal.rate_per_truck  IS NOT DISTINCT FROM (v_e ->> 'rate_per_truck')::numeric
      AND v_terminal.rate_fixed      IS NOT DISTINCT FROM (v_e ->> 'rate_fixed')::numeric
      AND v_terminal.rate_per_cnt    IS NOT DISTINCT FROM (v_e ->> 'rate_per_cnt')::numeric
      AND v_terminal.currency        IS NOT DISTINCT FROM v_e ->> 'currency'
      AND v_terminal.source_document IS NOT DISTINCT FROM v_e ->> 'source_document'
      AND v_terminal.effective_date  IS NOT DISTINCT FROM (v_e ->> 'effective_date')::date
      AND v_terminal.notes           IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND v_terminal.is_active       IS FALSE;

    IF NOT (v_is_seed OR v_is_target) THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: destination_terminal_rates row % / % / % matches neither the exact Git seed fingerprint nor the observed Lovable target state',
        v_e ->> 'terminal_name', v_e ->> 'country', v_e ->> 'charge_code';
    END IF;
  END LOOP;

  -- ---- demurrage_rates (9 unverified rows only) -----------------------
  -- No cardinality guard is placed on the table as a whole: the 26 other live
  -- rows are out of scope and only partially seeded in Git.
  FOR v_e IN SELECT value FROM jsonb_array_elements(v_demurrage_expected) LOOP
    SELECT count(*) INTO v_cardinality
    FROM public.demurrage_rates AS d
    WHERE regexp_replace(upper(btrim(d.carrier)), '[^A-Z0-9]', '', 'g') = v_e ->> 'carrier_normalized'
      AND d.container_type = v_e ->> 'container_type';

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: expected exactly one demurrage_rates row for % / %, found %',
        v_e ->> 'carrier_normalized', v_e ->> 'container_type', v_cardinality;
    END IF;

    SELECT * INTO v_demurrage
    FROM public.demurrage_rates AS d
    WHERE regexp_replace(upper(btrim(d.carrier)), '[^A-Z0-9]', '', 'g') = v_e ->> 'carrier_normalized'
      AND d.container_type = v_e ->> 'container_type'
    FOR UPDATE;

    -- effective_date is deliberately absent from the seed fingerprint: the
    -- 20251220103347 seed leaves it to DEFAULT CURRENT_DATE.
    v_is_seed :=
      v_demurrage.carrier            IS NOT DISTINCT FROM v_e ->> 'carrier'
      AND v_demurrage.free_days_import IS NOT DISTINCT FROM (v_e ->> 'free_days_import')::integer
      AND v_demurrage.free_days_export IS NOT DISTINCT FROM (v_e ->> 'free_days_export')::integer
      AND v_demurrage.currency       IS NOT DISTINCT FROM v_e ->> 'currency'
      AND v_demurrage.day_1_7_rate   IS NOT DISTINCT FROM (v_e ->> 'day_1_7_rate')::numeric
      AND v_demurrage.day_8_14_rate  IS NOT DISTINCT FROM (v_e ->> 'day_8_14_rate')::numeric
      AND v_demurrage.day_15_plus_rate IS NOT DISTINCT FROM (v_e ->> 'day_15_plus_rate')::numeric
      AND v_demurrage.expiry_date    IS NULL
      AND v_demurrage.notes          IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND v_demurrage.source_document IS NOT DISTINCT FROM v_e ->> 'seed_source_document'
      AND v_demurrage.is_active      IS TRUE;

    v_is_target :=
      v_demurrage.carrier            IS NOT DISTINCT FROM v_e ->> 'carrier'
      AND v_demurrage.free_days_import IS NOT DISTINCT FROM (v_e ->> 'free_days_import')::integer
      AND v_demurrage.free_days_export IS NOT DISTINCT FROM (v_e ->> 'free_days_export')::integer
      AND v_demurrage.currency       IS NOT DISTINCT FROM v_e ->> 'currency'
      AND v_demurrage.day_1_7_rate   IS NOT DISTINCT FROM (v_e ->> 'day_1_7_rate')::numeric
      AND v_demurrage.day_8_14_rate  IS NOT DISTINCT FROM (v_e ->> 'day_8_14_rate')::numeric
      AND v_demurrage.day_15_plus_rate IS NOT DISTINCT FROM (v_e ->> 'day_15_plus_rate')::numeric
      AND v_demurrage.effective_date IS NOT DISTINCT FROM c_demurrage_target_effective_date
      AND v_demurrage.expiry_date    IS NULL
      AND v_demurrage.notes          IS NOT DISTINCT FROM c_demurrage_target_notes
      AND v_demurrage.source_document IS NOT DISTINCT FROM v_e ->> 'target_source_document'
      AND v_demurrage.is_active      IS FALSE;

    IF NOT (v_is_seed OR v_is_target) THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: demurrage_rates row % / % matches neither the exact Git seed fingerprint nor the observed Lovable target state',
        v_e ->> 'carrier', v_e ->> 'container_type';
    END IF;
  END LOOP;

  -- =====================================================================
  -- PASS 2 - mutation. Every statement repeats the full seed fingerprint in
  --          its WHERE clause, so it can only ever reach a row PASS 1 has
  --          already accepted, and it updates 0 rows when the quarantine is
  --          already in place. That is what makes this migration idempotent.
  -- =====================================================================

  FOR v_e IN SELECT value FROM jsonb_array_elements(v_border_expected) LOOP
    UPDATE public.border_clearing_rates AS b
    SET is_active = FALSE
    WHERE b.corridor = v_e ->> 'corridor'
      AND b.country = v_e ->> 'country'
      AND b.charge_code = v_e ->> 'charge_code'
      AND b.charge_name IS NOT DISTINCT FROM v_e ->> 'charge_name'
      AND b.calculation_method IS NOT DISTINCT FROM v_e ->> 'calculation_method'
      AND b.amount_20ft IS NOT DISTINCT FROM (v_e ->> 'amount_20ft')::numeric
      AND b.amount_40ft IS NOT DISTINCT FROM (v_e ->> 'amount_40ft')::numeric
      AND b.currency IS NOT DISTINCT FROM v_e ->> 'currency'
      AND b.source_document IS NOT DISTINCT FROM v_e ->> 'source_document'
      AND b.effective_date IS NOT DISTINCT FROM (v_e ->> 'effective_date')::date
      AND b.notes IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND b.is_active IS TRUE;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 1 THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: border_clearing_rates deactivation touched % rows for % / % / %',
        v_updated, v_e ->> 'corridor', v_e ->> 'country', v_e ->> 'charge_code';
    END IF;
    v_border_deactivated := v_border_deactivated + v_updated;
  END LOOP;

  FOR v_e IN SELECT value FROM jsonb_array_elements(v_terminal_expected) LOOP
    UPDATE public.destination_terminal_rates AS t
    SET is_active = FALSE
    WHERE t.terminal_name = v_e ->> 'terminal_name'
      AND t.country = v_e ->> 'country'
      AND t.charge_code = v_e ->> 'charge_code'
      AND t.charge_name IS NOT DISTINCT FROM v_e ->> 'charge_name'
      AND t.calculation_method IS NOT DISTINCT FROM v_e ->> 'calculation_method'
      AND t.rate_per_tonne IS NOT DISTINCT FROM (v_e ->> 'rate_per_tonne')::numeric
      AND t.rate_per_truck IS NOT DISTINCT FROM (v_e ->> 'rate_per_truck')::numeric
      AND t.rate_fixed IS NOT DISTINCT FROM (v_e ->> 'rate_fixed')::numeric
      AND t.rate_per_cnt IS NOT DISTINCT FROM (v_e ->> 'rate_per_cnt')::numeric
      AND t.currency IS NOT DISTINCT FROM v_e ->> 'currency'
      AND t.source_document IS NOT DISTINCT FROM v_e ->> 'source_document'
      AND t.effective_date IS NOT DISTINCT FROM (v_e ->> 'effective_date')::date
      AND t.notes IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND t.is_active IS TRUE;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 1 THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: destination_terminal_rates deactivation touched % rows for % / % / %',
        v_updated, v_e ->> 'terminal_name', v_e ->> 'country', v_e ->> 'charge_code';
    END IF;
    v_terminal_deactivated := v_terminal_deactivated + v_updated;
  END LOOP;

  -- The demurrage branch also realigns the provenance metadata onto the live
  -- snapshot. Carrier, container type, free days, currency and the three daily
  -- rates are never written: they already match and stay as seeded.
  FOR v_e IN SELECT value FROM jsonb_array_elements(v_demurrage_expected) LOOP
    UPDATE public.demurrage_rates AS d
    SET effective_date  = c_demurrage_target_effective_date,
        notes           = c_demurrage_target_notes,
        source_document = v_e ->> 'target_source_document',
        is_active       = FALSE
    WHERE d.carrier = v_e ->> 'carrier'
      AND d.container_type = v_e ->> 'container_type'
      AND d.free_days_import IS NOT DISTINCT FROM (v_e ->> 'free_days_import')::integer
      AND d.free_days_export IS NOT DISTINCT FROM (v_e ->> 'free_days_export')::integer
      AND d.currency IS NOT DISTINCT FROM v_e ->> 'currency'
      AND d.day_1_7_rate IS NOT DISTINCT FROM (v_e ->> 'day_1_7_rate')::numeric
      AND d.day_8_14_rate IS NOT DISTINCT FROM (v_e ->> 'day_8_14_rate')::numeric
      AND d.day_15_plus_rate IS NOT DISTINCT FROM (v_e ->> 'day_15_plus_rate')::numeric
      AND d.expiry_date IS NULL
      AND d.notes IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND d.source_document IS NOT DISTINCT FROM v_e ->> 'seed_source_document'
      AND d.is_active IS TRUE;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 1 THEN
      RAISE EXCEPTION
        'tariff quarantine stopped: demurrage_rates reconciliation touched % rows for % / %',
        v_updated, v_e ->> 'carrier', v_e ->> 'container_type';
    END IF;
    v_demurrage_reconciled := v_demurrage_reconciled + v_updated;
  END LOOP;

  -- =====================================================================
  -- PASS 3 - exhaustive post-check of the target state.
  -- =====================================================================

  SELECT count(*) INTO v_total FROM public.border_clearing_rates;
  IF v_total IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION
      'tariff quarantine post-check failed: border_clearing_rates holds % rows instead of 6', v_total;
  END IF;

  SELECT count(*) INTO v_total FROM public.border_clearing_rates WHERE is_active IS NOT FALSE;
  IF v_total IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'tariff quarantine post-check failed: % border_clearing_rates rows are still quotable', v_total;
  END IF;

  FOR v_e IN SELECT value FROM jsonb_array_elements(v_border_expected) LOOP
    SELECT count(*) INTO v_cardinality
    FROM public.border_clearing_rates AS b
    WHERE b.corridor = v_e ->> 'corridor'
      AND b.country = v_e ->> 'country'
      AND b.charge_code = v_e ->> 'charge_code'
      AND b.charge_name IS NOT DISTINCT FROM v_e ->> 'charge_name'
      AND b.calculation_method IS NOT DISTINCT FROM v_e ->> 'calculation_method'
      AND b.amount_20ft IS NOT DISTINCT FROM (v_e ->> 'amount_20ft')::numeric
      AND b.amount_40ft IS NOT DISTINCT FROM (v_e ->> 'amount_40ft')::numeric
      AND b.currency IS NOT DISTINCT FROM v_e ->> 'currency'
      AND b.source_document IS NOT DISTINCT FROM v_e ->> 'source_document'
      AND b.effective_date IS NOT DISTINCT FROM (v_e ->> 'effective_date')::date
      AND b.notes IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND b.is_active IS FALSE;

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'tariff quarantine post-check failed for border_clearing_rates % / % / %: % matching inactive rows',
        v_e ->> 'corridor', v_e ->> 'country', v_e ->> 'charge_code', v_cardinality;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_total FROM public.destination_terminal_rates;
  IF v_total IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'tariff quarantine post-check failed: destination_terminal_rates holds % rows instead of 10', v_total;
  END IF;

  SELECT count(*) INTO v_total FROM public.destination_terminal_rates WHERE is_active IS NOT FALSE;
  IF v_total IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'tariff quarantine post-check failed: % destination_terminal_rates rows are still quotable', v_total;
  END IF;

  FOR v_e IN SELECT value FROM jsonb_array_elements(v_terminal_expected) LOOP
    SELECT count(*) INTO v_cardinality
    FROM public.destination_terminal_rates AS t
    WHERE t.terminal_name = v_e ->> 'terminal_name'
      AND t.country = v_e ->> 'country'
      AND t.charge_code = v_e ->> 'charge_code'
      AND t.charge_name IS NOT DISTINCT FROM v_e ->> 'charge_name'
      AND t.calculation_method IS NOT DISTINCT FROM v_e ->> 'calculation_method'
      AND t.rate_per_tonne IS NOT DISTINCT FROM (v_e ->> 'rate_per_tonne')::numeric
      AND t.rate_per_truck IS NOT DISTINCT FROM (v_e ->> 'rate_per_truck')::numeric
      AND t.rate_fixed IS NOT DISTINCT FROM (v_e ->> 'rate_fixed')::numeric
      AND t.rate_per_cnt IS NOT DISTINCT FROM (v_e ->> 'rate_per_cnt')::numeric
      AND t.currency IS NOT DISTINCT FROM v_e ->> 'currency'
      AND t.source_document IS NOT DISTINCT FROM v_e ->> 'source_document'
      AND t.effective_date IS NOT DISTINCT FROM (v_e ->> 'effective_date')::date
      AND t.notes IS NOT DISTINCT FROM v_e ->> 'seed_notes'
      AND t.is_active IS FALSE;

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'tariff quarantine post-check failed for destination_terminal_rates % / % / %: % matching inactive rows',
        v_e ->> 'terminal_name', v_e ->> 'country', v_e ->> 'charge_code', v_cardinality;
    END IF;
  END LOOP;

  FOR v_e IN SELECT value FROM jsonb_array_elements(v_demurrage_expected) LOOP
    SELECT count(*) INTO v_cardinality
    FROM public.demurrage_rates AS d
    WHERE regexp_replace(upper(btrim(d.carrier)), '[^A-Z0-9]', '', 'g') = v_e ->> 'carrier_normalized'
      AND d.container_type = v_e ->> 'container_type';

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'tariff quarantine post-check found % demurrage_rates rows for % / %',
        v_cardinality, v_e ->> 'carrier_normalized', v_e ->> 'container_type';
    END IF;

    SELECT count(*) INTO v_cardinality
    FROM public.demurrage_rates AS d
    WHERE d.carrier = v_e ->> 'carrier'
      AND d.container_type = v_e ->> 'container_type'
      AND d.free_days_import IS NOT DISTINCT FROM (v_e ->> 'free_days_import')::integer
      AND d.free_days_export IS NOT DISTINCT FROM (v_e ->> 'free_days_export')::integer
      AND d.currency IS NOT DISTINCT FROM v_e ->> 'currency'
      AND d.day_1_7_rate IS NOT DISTINCT FROM (v_e ->> 'day_1_7_rate')::numeric
      AND d.day_8_14_rate IS NOT DISTINCT FROM (v_e ->> 'day_8_14_rate')::numeric
      AND d.day_15_plus_rate IS NOT DISTINCT FROM (v_e ->> 'day_15_plus_rate')::numeric
      AND d.effective_date IS NOT DISTINCT FROM c_demurrage_target_effective_date
      AND d.expiry_date IS NULL
      AND d.notes IS NOT DISTINCT FROM c_demurrage_target_notes
      AND d.source_document IS NOT DISTINCT FROM v_e ->> 'target_source_document'
      AND d.is_active IS FALSE;

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'tariff quarantine post-check failed for demurrage_rates % / %: % matching quarantined rows',
        v_e ->> 'carrier', v_e ->> 'container_type', v_cardinality;
    END IF;
  END LOOP;

  -- Nothing was inserted or deleted, and no out-of-scope demurrage row moved.
  SELECT count(*) INTO v_demurrage_total_after FROM public.demurrage_rates;
  IF v_demurrage_total_after IS DISTINCT FROM v_demurrage_total_before THEN
    RAISE EXCEPTION
      'tariff quarantine post-check failed: demurrage_rates went from % to % rows',
      v_demurrage_total_before, v_demurrage_total_after;
  END IF;

  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_others_digest_after
  FROM (
    SELECT d::text AS row_text
    FROM public.demurrage_rates AS d
    WHERE (regexp_replace(upper(btrim(d.carrier)), '[^A-Z0-9]', '', 'g') || '|' || d.container_type)
          <> ALL (v_demurrage_keys)
  ) AS t;

  IF v_others_digest_after IS DISTINCT FROM v_others_digest_before THEN
    RAISE EXCEPTION
      'tariff quarantine post-check failed: out-of-scope demurrage_rates rows were modified';
  END IF;

  RAISE NOTICE
    'tariff quarantine reconciled: % border row(s) deactivated, % terminal row(s) deactivated, % demurrage row(s) realigned; % out-of-scope demurrage row(s) left untouched',
    v_border_deactivated,
    v_terminal_deactivated,
    v_demurrage_reconciled,
    v_demurrage_total_after - 9;
END
$reconcile_unverified_tariff_quarantine$;
