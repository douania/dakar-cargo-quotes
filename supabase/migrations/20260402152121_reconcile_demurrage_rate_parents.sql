-- Technical Git reconciliation of the two demurrage_rates parents with the
-- state observed in Lovable. No historical migration explaining these UUID
-- and business-attribute changes was found. The values below reproduce that
-- observed state; they are not an independent business validation.
--
-- The following demurrage_tiers migration references both UUIDs directly.
-- This prerequisite therefore pins only the two matching fresh-seed rows.
-- It is a strict no-op when the observed Lovable fingerprints already exist.

DO $reconcile_demurrage_rate_parents$
DECLARE
  r             record;
  v_rate        public.demurrage_rates%ROWTYPE;
  v_source_id   uuid;
  v_cardinality integer;
  v_updated     integer;
BEGIN
  FOR r IN
    SELECT *
    FROM (
      VALUES
        (
          '26b67f17-f9aa-4917-b186-82a0be14d46c'::uuid,
          'MSC'::text,
          '20DV'::text,
          10::integer,
          5::integer,
          'USD'::text,
          50::numeric,
          100::numeric,
          150::numeric,
          DATE '2025-12-20',
          'Barème MSC Sénégal - franchise 10j dry confirmée, taux journaliers TO_CONFIRM, devise USD conservée (pas de source XOF confirmée)'::text,
          'MSC Local Charges Sénégal'::text,
          'MSC'::text,
          'MSC'::text,
          7::integer,
          5::integer,
          'USD'::text,
          50::numeric,
          100::numeric,
          150::numeric,
          'Tarifs standards MSC Sénégal 2024'::text,
          'MSC Local Charges 2024'::text
        ),
        (
          'b94192e4-0495-4446-9bd8-d901626db40a'::uuid,
          'CMA_CGM'::text,
          '40HC'::text,
          10::integer,
          5::integer,
          'USD'::text,
          104::numeric,
          208::numeric,
          312::numeric,
          DATE '2025-12-20',
          'Barème officiel CMA CGM Dakar - franchise 10j dry confirmée, taux journaliers et devise TO_CONFIRM (montants USD conservés en attendant barème XOF exact)'::text,
          'CMA CGM Tarif Local Sénégal (source officielle)'::text,
          'CMA CGM'::text,
          'CMACGM'::text,
          7::integer,
          5::integer,
          'USD'::text,
          104::numeric,
          208::numeric,
          312::numeric,
          'Même tarif que 40DV'::text,
          'CMA CGM Local Charges'::text
        )
    ) AS expected (
      target_id,
      target_carrier,
      container_type,
      target_free_days_import,
      target_free_days_export,
      target_currency,
      target_day_1_7_rate,
      target_day_8_14_rate,
      target_day_15_plus_rate,
      target_effective_date,
      target_notes,
      target_source_document,
      source_carrier,
      source_carrier_normalized,
      source_free_days_import,
      source_free_days_export,
      source_currency,
      source_day_1_7_rate,
      source_day_8_14_rate,
      source_day_15_plus_rate,
      source_notes,
      source_source_document
    )
  LOOP
    SELECT count(*)
    INTO v_cardinality
    FROM public.demurrage_rates AS candidate
    WHERE regexp_replace(upper(btrim(candidate.carrier)), '[^A-Z0-9]', '', 'g') = r.source_carrier_normalized
      AND candidate.container_type = r.container_type;

    SELECT *
    INTO v_rate
    FROM public.demurrage_rates
    WHERE id = r.target_id;

    IF FOUND THEN
      IF v_rate.carrier             IS DISTINCT FROM r.target_carrier
         OR v_rate.container_type   IS DISTINCT FROM r.container_type
         OR v_rate.free_days_import IS DISTINCT FROM r.target_free_days_import
         OR v_rate.free_days_export IS DISTINCT FROM r.target_free_days_export
         OR v_rate.currency         IS DISTINCT FROM r.target_currency
         OR v_rate.day_1_7_rate     IS DISTINCT FROM r.target_day_1_7_rate
         OR v_rate.day_8_14_rate    IS DISTINCT FROM r.target_day_8_14_rate
         OR v_rate.day_15_plus_rate IS DISTINCT FROM r.target_day_15_plus_rate
         OR v_rate.effective_date   IS DISTINCT FROM r.target_effective_date
         OR v_rate.expiry_date      IS DISTINCT FROM NULL
         OR v_rate.is_active        IS DISTINCT FROM TRUE
         OR v_rate.notes            IS DISTINCT FROM r.target_notes
         OR v_rate.source_document  IS DISTINCT FROM r.target_source_document
      THEN
        RAISE EXCEPTION
          'demurrage_rates reconciliation stopped: target UUID % exists with attributes different from the observed Lovable fingerprint',
          r.target_id;
      END IF;

      IF v_cardinality IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION
          'demurrage_rates reconciliation stopped: expected exactly one normalized parent for % / %, found %',
          r.source_carrier_normalized, r.container_type, v_cardinality;
      END IF;

      -- Existing exact target: strict read-only no-op.
      CONTINUE;
    END IF;

    IF to_regclass('public.demurrage_tiers') IS NOT NULL THEN
      RAISE EXCEPTION
        'demurrage_rates reconciliation stopped: target UUID % is absent while public.demurrage_tiers already exists',
        r.target_id;
    END IF;

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'demurrage_rates reconciliation stopped: expected exactly one fresh-seed candidate for % / %, found %',
        r.source_carrier_normalized, r.container_type, v_cardinality;
    END IF;

    SELECT *
    INTO v_rate
    FROM public.demurrage_rates AS candidate
    WHERE regexp_replace(upper(btrim(candidate.carrier)), '[^A-Z0-9]', '', 'g') = r.source_carrier_normalized
      AND candidate.container_type = r.container_type
    FOR UPDATE;

    -- effective_date is intentionally excluded here: the original seed uses
    -- CURRENT_DATE. Timestamps are also excluded and preserved by the UPDATE.
    IF v_rate.carrier             IS DISTINCT FROM r.source_carrier
       OR v_rate.container_type   IS DISTINCT FROM r.container_type
       OR v_rate.free_days_import IS DISTINCT FROM r.source_free_days_import
       OR v_rate.free_days_export IS DISTINCT FROM r.source_free_days_export
       OR v_rate.currency         IS DISTINCT FROM r.source_currency
       OR v_rate.day_1_7_rate     IS DISTINCT FROM r.source_day_1_7_rate
       OR v_rate.day_8_14_rate    IS DISTINCT FROM r.source_day_8_14_rate
       OR v_rate.day_15_plus_rate IS DISTINCT FROM r.source_day_15_plus_rate
       OR v_rate.expiry_date      IS DISTINCT FROM NULL
       OR v_rate.is_active        IS DISTINCT FROM TRUE
       OR v_rate.notes            IS DISTINCT FROM r.source_notes
       OR v_rate.source_document  IS DISTINCT FROM r.source_source_document
    THEN
      RAISE EXCEPTION
        'demurrage_rates reconciliation stopped: candidate UUID % is not the exact expected fresh-seed row for % / %',
        v_rate.id, r.source_carrier, r.container_type;
    END IF;

    v_source_id := v_rate.id;

    IF EXISTS (
      SELECT 1
      FROM public.demurrage_rates
      WHERE id = r.target_id
    ) THEN
      RAISE EXCEPTION
        'demurrage_rates reconciliation stopped: target UUID % collided before source UUID % could be reconciled',
        r.target_id, v_source_id;
    END IF;

    UPDATE public.demurrage_rates
    SET id               = r.target_id,
        carrier          = r.target_carrier,
        container_type   = r.container_type,
        free_days_import = r.target_free_days_import,
        free_days_export = r.target_free_days_export,
        currency         = r.target_currency,
        day_1_7_rate     = r.target_day_1_7_rate,
        day_8_14_rate    = r.target_day_8_14_rate,
        day_15_plus_rate = r.target_day_15_plus_rate,
        effective_date   = r.target_effective_date,
        expiry_date      = NULL,
        is_active        = TRUE,
        notes            = r.target_notes,
        source_document  = r.target_source_document
    WHERE id = v_source_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'demurrage_rates reconciliation stopped: expected one update for target UUID %, updated %',
        r.target_id, v_updated;
    END IF;
  END LOOP;

  -- Validate the final fingerprints and normalized-key cardinality for both
  -- parents before allowing the atomic block to complete.
  FOR r IN
    SELECT *
    FROM (
      VALUES
        (
          '26b67f17-f9aa-4917-b186-82a0be14d46c'::uuid,
          'MSC'::text,
          '20DV'::text,
          10::integer,
          5::integer,
          'USD'::text,
          50::numeric,
          100::numeric,
          150::numeric,
          DATE '2025-12-20',
          'Barème MSC Sénégal - franchise 10j dry confirmée, taux journaliers TO_CONFIRM, devise USD conservée (pas de source XOF confirmée)'::text,
          'MSC Local Charges Sénégal'::text,
          'MSC'::text
        ),
        (
          'b94192e4-0495-4446-9bd8-d901626db40a'::uuid,
          'CMA_CGM'::text,
          '40HC'::text,
          10::integer,
          5::integer,
          'USD'::text,
          104::numeric,
          208::numeric,
          312::numeric,
          DATE '2025-12-20',
          'Barème officiel CMA CGM Dakar - franchise 10j dry confirmée, taux journaliers et devise TO_CONFIRM (montants USD conservés en attendant barème XOF exact)'::text,
          'CMA CGM Tarif Local Sénégal (source officielle)'::text,
          'CMACGM'::text
        )
    ) AS expected (
      target_id,
      target_carrier,
      container_type,
      target_free_days_import,
      target_free_days_export,
      target_currency,
      target_day_1_7_rate,
      target_day_8_14_rate,
      target_day_15_plus_rate,
      target_effective_date,
      target_notes,
      target_source_document,
      carrier_normalized
    )
  LOOP
    SELECT *
    INTO v_rate
    FROM public.demurrage_rates
    WHERE id = r.target_id;

    IF NOT FOUND
       OR v_rate.carrier             IS DISTINCT FROM r.target_carrier
       OR v_rate.container_type      IS DISTINCT FROM r.container_type
       OR v_rate.free_days_import    IS DISTINCT FROM r.target_free_days_import
       OR v_rate.free_days_export    IS DISTINCT FROM r.target_free_days_export
       OR v_rate.currency            IS DISTINCT FROM r.target_currency
       OR v_rate.day_1_7_rate        IS DISTINCT FROM r.target_day_1_7_rate
       OR v_rate.day_8_14_rate       IS DISTINCT FROM r.target_day_8_14_rate
       OR v_rate.day_15_plus_rate    IS DISTINCT FROM r.target_day_15_plus_rate
       OR v_rate.effective_date      IS DISTINCT FROM r.target_effective_date
       OR v_rate.expiry_date         IS DISTINCT FROM NULL
       OR v_rate.is_active           IS DISTINCT FROM TRUE
       OR v_rate.notes               IS DISTINCT FROM r.target_notes
       OR v_rate.source_document     IS DISTINCT FROM r.target_source_document
    THEN
      RAISE EXCEPTION
        'demurrage_rates reconciliation post-check failed for target UUID %',
        r.target_id;
    END IF;

    SELECT count(*)
    INTO v_cardinality
    FROM public.demurrage_rates AS candidate
    WHERE regexp_replace(upper(btrim(candidate.carrier)), '[^A-Z0-9]', '', 'g') = r.carrier_normalized
      AND candidate.container_type = r.container_type;

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'demurrage_rates reconciliation post-check found % normalized parents for % / %',
        v_cardinality, r.carrier_normalized, r.container_type;
    END IF;
  END LOOP;
END
$reconcile_demurrage_rate_parents$;
