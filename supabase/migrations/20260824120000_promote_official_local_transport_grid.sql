-- Promote the official container delivery grid (20P / 40P) staged by
-- 20260823130000 from INACTIVE / to_confirm to ACTIVE / validated_internal.
--
-- Business decisions attested by the SODATRA officer on 2026-08-24:
--   * the two PDFs "TARIFS DE LIVRAISONS DES CONTENEURS 20P/40P" are the grid
--     currently in force, with no expiry date;
--   * the 60 rows are all approved for promotion;
--   * container delivery stays a third-party supplier DEBOURS, TTC, with no
--     SODATRA commission and no additional SODATRA VAT. That application
--     contract is already delivered (see
--     supabase/functions/_shared/local-transport-debours.ts) and is NOT
--     rewritten here;
--   * the exact grid amount always wins; the kilometric formula is a coherence
--     control only and must never produce a runtime amount.
--
-- EVIDENCE TAXONOMY - deliberately 'validated_internal', NOT 'official':
-- the grid is approved by SODATRA, but the PDFs carry no regulatory authority,
-- no issuer identity, no signature and no stamp. 'official' is reserved for a
-- regulatory source. Both runtime readers whitelist
-- ('official','validated_internal'), so 'validated_internal' is quotable.
--
-- DETERMINISM PREREQUISITE, delivered in the same lot:
-- quotation-engine used to resolve the destination with `ilike '%term%'` then
-- `.limit(1)`, which could serve an arbitrary wrong tariff once 60 rows share
-- this source_document. Both readers now use the shared, exact, fail-closed
-- resolver supabase/functions/_shared/local-transport-destination.ts, which
-- requires EXACTLY one candidate. Activating these rows without that resolver
-- would be unsafe; this migration therefore also asserts that no out-of-scope
-- active + whitelisted row competes for any of the 60 business keys.
--
-- Scope contract enforced below:
--   * UPDATE of `is_active` and `evidence_level` ONLY. No INSERT, no DELETE,
--     no DDL, no RLS / Auth change, no live data touched by this file.
--   * `validity_start` is neither invented nor homogenised: the 10 rows live in
--     Lovable keep 2026-03-30, the 50 staged rows keep NULL. Proven by a digest
--     of every non-promoted column taken before and after the write.
--   * `validity_end` must be NULL everywhere and stays NULL (grid in force with
--     no expiry).
--   * Everything outside this source_document - the 81 Aksa Energy rows
--     included - is proven byte-for-byte untouched.
--   * Re-running the migration updates 0 row: the `updated_at` trigger does not
--     fire, so the second pass is a strict no-op.
--
-- Accepted initial states, per row, anything else raises before a single write:
--   A - staged shape  : is_active = false, evidence_level = 'to_confirm',
--                       validity_start IS NULL.
--   B - live shape    : is_active = true,  evidence_level = 'to_confirm',
--                       validity_start = 2026-03-30.
--   C - target shape  : is_active = true,  evidence_level = 'validated_internal'
--                       (already promoted -> no-op).
-- In all three the pinned TTC amount, currency, origin, cargo category,
-- NULL client_code / provider / source_attachment_id / rate_includes and NULL
-- validity_end must already hold.

DO $promote_official_local_transport_grid$
DECLARE
  -- ---------------------------------------------------------------------
  -- Pinned constants, identical to 20260823130000.
  -- ---------------------------------------------------------------------
  c_source_document     constant text := 'TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS';
  c_origin              constant text := 'Dakar Port';
  c_cargo_category      constant text := 'Dry';
  c_currency            constant text := 'XOF';
  c_staged_evidence     constant text := 'to_confirm';
  c_target_evidence     constant text := 'validated_internal';
  c_ct20                constant text := '20'' Dry';
  c_ct40                constant text := '40'' Dry';
  c_live_validity_start constant date := DATE '2026-03-30';

  -- Runtime whitelist shared by quotation-engine and price-service-lines.
  c_runtime_whitelist   constant text[] := ARRAY['official', 'validated_internal'];

  -- Kilometric coherence control (NEVER a source of rate_amount):
  --   20P transport before VAT = 57 000 + 1 000 / km, exceptions:
  --       ZONE -5 000, BIGNONA +2 000, ZIGUINCHOR +6 000, CAP SKIRING +27 000
  --   40P transport before VAT = 69 000 + 2 000 / km, exceptions:
  --       BIGNONA +74 000, ZIGUINCHOR +23 000, CAP SKIRING +99 000
  -- Keyed on the raw PDF label, so "ZONE" and "ZONE SEBIKHOTANE ET POUT" are
  -- two distinct keys and the -5 000 exception applies to zone 1 only.
  c_km_base_20          constant numeric := 57000;
  c_km_rate_20          constant numeric := 1000;
  c_km_base_40          constant numeric := 69000;
  c_km_rate_40          constant numeric := 2000;
  v_km_exceptions_20 jsonb := '{"ZONE":-5000,"BIGNONA":2000,"ZIGUINCHOR":6000,"CAP SKIRING":27000}'::jsonb;
  v_km_exceptions_40 jsonb := '{"BIGNONA":74000,"ZIGUINCHOR":23000,"CAP SKIRING":99000}'::jsonb;

  -- The grid, re-transcribed from the two PDFs and cross-checked against the
  -- staging migration by the shared Deno test
  -- supabase/functions/_shared/local-transport-destination_test.ts.
  v_grid jsonb := '[
    {"raw_label":"ZONE","destination":"FORFAIT ZONE 1 <18 KM","distance_km":18,"tc20":70000,"fee20":0,"vat20":12600,"total20":82600,"tc40":105000,"fee40":1000,"vat40":19080,"total40":125080},
    {"raw_label":"ZONE SEBIKHOTANE ET POUT","destination":"FORFAIT ZONE 2, SEIKHOTANE ET POUT","distance_km":58,"tc20":115000,"fee20":0,"vat20":20700,"total20":135700,"tc40":185000,"fee40":1000,"vat40":33480,"total40":219480},
    {"raw_label":"THIES/POPONGUINE","destination":"THIES / POPONGUINE","distance_km":71,"tc20":128000,"fee20":0,"vat20":23040,"total20":151040,"tc40":211000,"fee40":1000,"vat40":38160,"total40":250160},
    {"raw_label":"THIADIAYE","destination":"THIADIAYE","distance_km":80,"tc20":137000,"fee20":0,"vat20":24660,"total20":161660,"tc40":229000,"fee40":1000,"vat40":41400,"total40":271400},
    {"raw_label":"MBOUR","destination":"MBOUR","distance_km":83,"tc20":140000,"fee20":0,"vat20":25200,"total20":165200,"tc40":235000,"fee40":1000,"vat40":42480,"total40":278480},
    {"raw_label":"TIVAOUNE","destination":"TIVAOUNE","distance_km":95,"tc20":152000,"fee20":0,"vat20":27360,"total20":179360,"tc40":259000,"fee40":1000,"vat40":46800,"total40":306800},
    {"raw_label":"MEKHE","destination":"MEKHE","distance_km":118,"tc20":175000,"fee20":0,"vat20":31500,"total20":206500,"tc40":305000,"fee40":1000,"vat40":55080,"total40":361080},
    {"raw_label":"BAMBEYE TAIBA","destination":"BAMBEYE TAIBA","distance_km":125,"tc20":182000,"fee20":0,"vat20":32760,"total20":214760,"tc40":319000,"fee40":1000,"vat40":57600,"total40":377600},
    {"raw_label":"JOAL","destination":"JOAL","distance_km":134,"tc20":191000,"fee20":0,"vat20":34380,"total20":225380,"tc40":337000,"fee40":1000,"vat40":60840,"total40":398840},
    {"raw_label":"DIOURBEL","destination":"DIOURBEL","distance_km":146,"tc20":203000,"fee20":0,"vat20":36540,"total20":239540,"tc40":361000,"fee40":1000,"vat40":65160,"total40":427160},
    {"raw_label":"KEBEMER/FATICK","destination":"KEBEMER / FATICK","distance_km":155,"tc20":212000,"fee20":0,"vat20":38160,"total20":250160,"tc40":379000,"fee40":1000,"vat40":68400,"total40":448400},
    {"raw_label":"MBACKE","destination":"MBACKE","distance_km":186,"tc20":243000,"fee20":0,"vat20":43740,"total20":286740,"tc40":441000,"fee40":1000,"vat40":79560,"total40":521560},
    {"raw_label":"KAOLACK","destination":"KAOLACK","distance_km":189,"tc20":246000,"fee20":0,"vat20":44280,"total20":290280,"tc40":447000,"fee40":1000,"vat40":80640,"total40":528640},
    {"raw_label":"LOUGA/TOUBA","destination":"LOUGA / TOUBA","distance_km":194,"tc20":251000,"fee20":0,"vat20":45180,"total20":296180,"tc40":457000,"fee40":1000,"vat40":82440,"total40":540440},
    {"raw_label":"SOKONE","destination":"SOKONE","distance_km":234,"tc20":291000,"fee20":0,"vat20":52380,"total20":343380,"tc40":537000,"fee40":1000,"vat40":96840,"total40":634840},
    {"raw_label":"KAFFRINE","destination":"KAFFRINE","distance_km":247,"tc20":304000,"fee20":0,"vat20":54720,"total20":358720,"tc40":563000,"fee40":1000,"vat40":101520,"total40":665520},
    {"raw_label":"NIORO/ST LOUIS","destination":"NIORO / ST LOUIS","distance_km":268,"tc20":325000,"fee20":0,"vat20":58500,"total20":383500,"tc40":605000,"fee40":1000,"vat40":109080,"total40":715080},
    {"raw_label":"RICHARD TOLL","destination":"RICHARD TOLL","distance_km":376,"tc20":433000,"fee20":0,"vat20":77940,"total20":510940,"tc40":821000,"fee40":1000,"vat40":147960,"total40":969960},
    {"raw_label":"DAGANA/MAKA","destination":"DAGANA / MAKA","distance_km":407,"tc20":464000,"fee20":0,"vat20":83520,"total20":547520,"tc40":883000,"fee40":1000,"vat40":159120,"total40":1043120},
    {"raw_label":"BIGNONA","destination":"BIGNONA","distance_km":427,"tc20":486000,"fee20":0,"vat20":87480,"total20":573480,"tc40":997000,"fee40":1000,"vat40":179640,"total40":1177640},
    {"raw_label":"ZIGUINCHOR","destination":"ZIGUINCHOR","distance_km":454,"tc20":517000,"fee20":0,"vat20":93060,"total20":610060,"tc40":1000000,"fee40":1000,"vat40":180180,"total40":1181180},
    {"raw_label":"TAMBACOUNDA","destination":"TAMBACOUNDA","distance_km":467,"tc20":524000,"fee20":0,"vat20":94320,"total20":618320,"tc40":1003000,"fee40":1000,"vat40":180720,"total40":1184720},
    {"raw_label":"PODOR","destination":"PODOR","distance_km":487,"tc20":544000,"fee20":0,"vat20":97920,"total20":641920,"tc40":1043000,"fee40":1000,"vat40":187920,"total40":1231920},
    {"raw_label":"CAP SKIRING","destination":"CAP SKIRING","distance_km":497,"tc20":581000,"fee20":0,"vat20":104580,"total20":685580,"tc40":1162000,"fee40":1000,"vat40":209340,"total40":1372340},
    {"raw_label":"VELINGARA/GOUDIRI","destination":"VELINGARA / GOUDIRI","distance_km":575,"tc20":632000,"fee20":0,"vat20":113760,"total20":745760,"tc40":1219000,"fee40":1000,"vat40":219600,"total40":1439600},
    {"raw_label":"ROSSO/NIOKOLOKO","destination":"ROSSO / NIOKOLOKO","distance_km":604,"tc20":661000,"fee20":0,"vat20":118980,"total20":779980,"tc40":1277000,"fee40":1000,"vat40":230040,"total40":1508040},
    {"raw_label":"KIDIRA/BISSAU","destination":"KIDIRA / BISSAU","distance_km":650,"tc20":707000,"fee20":0,"vat20":127260,"total20":834260,"tc40":1369000,"fee40":1000,"vat40":246600,"total40":1616600},
    {"raw_label":"KOLDA/MATAM","destination":"KOLDA / MATAM","distance_km":693,"tc20":750000,"fee20":0,"vat20":135000,"total20":885000,"tc40":1455000,"fee40":1000,"vat40":262080,"total40":1718080},
    {"raw_label":"KEDOUGOU","destination":"KEDOUGOU","distance_km":702,"tc20":759000,"fee20":0,"vat20":136620,"total20":895620,"tc40":1473000,"fee40":1000,"vat40":265320,"total40":1739320},
    {"raw_label":"ZIGUINCHOR VIA TAMBA","destination":"ZIGUINCHOR VIA TAMBA","distance_km":881,"tc20":938000,"fee20":0,"vat20":168840,"total20":1106840,"tc40":1831000,"fee40":1000,"vat40":329760,"total40":2161760}
  ]'::jsonb;

  -- Expanded 60-row expectation: grid x {20' Dry, 40' Dry}.
  v_rows jsonb;

  v_e                    jsonb;
  v_row                  public.local_transport_rates%ROWTYPE;
  v_scope_ids            uuid[];
  v_scope_before         integer;
  v_scope_client_scoped  integer;
  v_scope_digest_before  text;
  v_scope_digest_after   text;
  v_out_count_before     integer;
  v_out_count_after      integer;
  v_out_digest_before    text;
  v_out_digest_after     text;
  v_table_before         integer;
  v_table_after          integer;
  v_cardinality          integer;
  v_present              integer := 0;
  v_already_target       integer := 0;
  v_expected_updates     integer;
  v_updated              integer;
  v_count_20             integer;
  v_count_40             integer;
  v_active_after         integer;
  v_bad                  integer;
  v_is_staged_shape      boolean;
  v_is_live_shape        boolean;
  v_is_target_shape      boolean;
BEGIN
  -- =====================================================================
  -- PASS 0 - self-check of the pinned grid. Nothing is read from the table
  --          until the transcription has proven internally consistent.
  -- =====================================================================
  IF jsonb_array_length(v_grid) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: the pinned grid must hold exactly 30 destinations, got %',
      jsonb_array_length(v_grid);
  END IF;

  IF (
    SELECT count(DISTINCT g.value ->> 'destination') FROM jsonb_array_elements(v_grid) AS g(value)
  ) IS DISTINCT FROM 30
  OR (
    SELECT count(DISTINCT g.value ->> 'raw_label') FROM jsonb_array_elements(v_grid) AS g(value)
  ) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: the 30 canonical destinations / raw labels are not unique';
  END IF;

  -- Normalised uniqueness: two destinations that the runtime resolver would
  -- fold onto the same key would make the grid ambiguous by construction.
  IF (
    SELECT count(DISTINCT btrim(regexp_replace(
             regexp_replace(
               regexp_replace(
                 upper(translate(g.value ->> 'destination',
                   'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
                   'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy')),
                 '[^A-Z0-9/]+', ' ', 'g'),
               ' */ *', '/', 'g'),
             ' +', ' ', 'g')))
    FROM jsonb_array_elements(v_grid) AS g(value)
  ) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: two canonical destinations collide once normalised';
  END IF;

  -- Kilometric coherence control. Guards the transcription only: rate_amount is
  -- never computed from this formula, here or at runtime.
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(v_grid) AS g(value)
  WHERE (g.value ->> 'tc20')::numeric IS DISTINCT FROM
          c_km_base_20 + c_km_rate_20 * (g.value ->> 'distance_km')::numeric
          + coalesce((v_km_exceptions_20 ->> (g.value ->> 'raw_label'))::numeric, 0)
     OR (g.value ->> 'tc40')::numeric IS DISTINCT FROM
          c_km_base_40 + c_km_rate_40 * (g.value ->> 'distance_km')::numeric
          + coalesce((v_km_exceptions_40 ->> (g.value ->> 'raw_label'))::numeric, 0);

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: % destination(s) fail the kilometric coherence control (20P 57k+1k/km, 40P 69k+2k/km, pinned exceptions)',
      v_bad;
  END IF;

  -- TTC arithmetic: total = transport + file fee + 18% VAT on (transport + fee).
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(v_grid) AS g(value)
  WHERE (g.value ->> 'tc20')::numeric + (g.value ->> 'fee20')::numeric + (g.value ->> 'vat20')::numeric
          IS DISTINCT FROM (g.value ->> 'total20')::numeric
     OR (g.value ->> 'tc40')::numeric + (g.value ->> 'fee40')::numeric + (g.value ->> 'vat40')::numeric
          IS DISTINCT FROM (g.value ->> 'total40')::numeric
     OR round(((g.value ->> 'tc20')::numeric + (g.value ->> 'fee20')::numeric) * 0.18)
          IS DISTINCT FROM (g.value ->> 'vat20')::numeric
     OR round(((g.value ->> 'tc40')::numeric + (g.value ->> 'fee40')::numeric) * 0.18)
          IS DISTINCT FROM (g.value ->> 'vat40')::numeric
     OR (g.value ->> 'total20')::numeric <= 0
     OR (g.value ->> 'total40')::numeric <= 0;

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: % destination(s) fail the TTC / 18%% VAT arithmetic self-check',
      v_bad;
  END IF;

  SELECT jsonb_agg(x.payload ORDER BY x.payload ->> 'destination', x.payload ->> 'container_type')
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'destination',    g.value ->> 'destination',
             'container_type', ct.container_type,
             'total_ttc',      g.value ->> ct.total_key
           ) AS payload
    FROM jsonb_array_elements(v_grid) AS g(value)
    CROSS JOIN (
      VALUES (c_ct20, 'total20'), (c_ct40, 'total40')
    ) AS ct(container_type, total_key)
  ) AS x;

  IF jsonb_array_length(v_rows) IS DISTINCT FROM 60
  OR (
    SELECT count(DISTINCT (e.value ->> 'destination') || '|' || (e.value ->> 'container_type'))
    FROM jsonb_array_elements(v_rows) AS e(value)
  ) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: the expansion must yield exactly 60 unique business keys';
  END IF;

  -- =====================================================================
  -- PASS 1 - lock, snapshot, and prove the current state is promotable.
  --          No row is written before every check below has passed.
  -- =====================================================================
  LOCK TABLE public.local_transport_rates IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_table_before FROM public.local_transport_rates;

  SELECT count(*), count(*) FILTER (WHERE r.client_code IS NOT NULL)
  INTO v_scope_before, v_scope_client_scoped
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document;

  IF v_scope_before IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: source_document % holds % row(s); the staging migration 20260823130000 must have produced exactly 60',
      c_source_document, v_scope_before;
  END IF;

  IF v_scope_client_scoped IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: % in-scope row(s) carry a non-NULL client_code; this grid is a generic barème',
      v_scope_client_scoped;
  END IF;

  SELECT coalesce(array_agg(r.id ORDER BY r.id), ARRAY[]::uuid[])
  INTO v_scope_ids
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document;

  -- Digest of every column this migration must NOT move. is_active and
  -- evidence_level are excluded on purpose; updated_at is excluded because the
  -- table's trigger legitimately bumps it on the promoting pass.
  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_scope_digest_before
  FROM (
    SELECT ((to_jsonb(r) - 'is_active'::text - 'evidence_level'::text - 'updated_at'::text)::text) AS row_text
    FROM public.local_transport_rates AS r
    WHERE r.id = ANY (v_scope_ids)
  ) AS t;

  SELECT count(*) INTO v_out_count_before
  FROM public.local_transport_rates AS r
  WHERE r.source_document IS DISTINCT FROM c_source_document;

  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_out_digest_before
  FROM (
    SELECT r::text AS row_text
    FROM public.local_transport_rates AS r
    WHERE r.source_document IS DISTINCT FROM c_source_document
  ) AS t;

  -- Key-by-key validation of the current state.
  FOR v_e IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    SELECT count(*) INTO v_cardinality
    FROM public.local_transport_rates AS r
    WHERE r.source_document = c_source_document
      AND r.origin = c_origin
      AND r.destination = v_e ->> 'destination'
      AND r.container_type = v_e ->> 'container_type'
      AND r.cargo_category = c_cargo_category
      AND r.client_code IS NULL;

    IF v_cardinality IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'local transport promotion stopped: % row(s) match the business key % / % / %; exactly 1 is required',
        v_cardinality, c_origin, v_e ->> 'destination', v_e ->> 'container_type';
    END IF;

    SELECT * INTO v_row
    FROM public.local_transport_rates AS r
    WHERE r.source_document = c_source_document
      AND r.origin = c_origin
      AND r.destination = v_e ->> 'destination'
      AND r.container_type = v_e ->> 'container_type'
      AND r.cargo_category = c_cargo_category
      AND r.client_code IS NULL;

    v_present := v_present + 1;

    -- Attributes that must already hold whatever the accepted input state is.
    IF v_row.rate_amount IS DISTINCT FROM (v_e ->> 'total_ttc')::numeric
       OR v_row.rate_currency IS DISTINCT FROM c_currency
       OR v_row.validity_end IS NOT NULL
       OR v_row.provider IS NOT NULL
       OR v_row.source_attachment_id IS NOT NULL
       OR v_row.rate_includes IS NOT NULL
       OR (v_row.validity_start IS NOT NULL
           AND v_row.validity_start IS DISTINCT FROM c_live_validity_start) THEN
      RAISE EXCEPTION
        'local transport promotion stopped: the row for % / % carries an out-of-contract attribute (amount=%, currency=%, validity_start=%, validity_end=%, provider=%, attachment=%, rate_includes=%)',
        v_e ->> 'destination', v_e ->> 'container_type',
        v_row.rate_amount, v_row.rate_currency, v_row.validity_start,
        v_row.validity_end, v_row.provider, v_row.source_attachment_id, v_row.rate_includes;
    END IF;

    v_is_staged_shape :=
          v_row.is_active IS NOT DISTINCT FROM false
      AND v_row.evidence_level IS NOT DISTINCT FROM c_staged_evidence
      AND v_row.validity_start IS NULL;

    v_is_live_shape :=
          v_row.is_active IS NOT DISTINCT FROM true
      AND v_row.evidence_level IS NOT DISTINCT FROM c_staged_evidence
      AND v_row.validity_start IS NOT DISTINCT FROM c_live_validity_start;

    v_is_target_shape :=
          v_row.is_active IS NOT DISTINCT FROM true
      AND v_row.evidence_level IS NOT DISTINCT FROM c_target_evidence;

    IF v_is_target_shape THEN
      v_already_target := v_already_target + 1;
    ELSIF NOT (coalesce(v_is_staged_shape, false) OR coalesce(v_is_live_shape, false)) THEN
      RAISE EXCEPTION
        'local transport promotion stopped: the row for % / % is in none of the accepted states (staged / live / already promoted): is_active=%, evidence_level=%, validity_start=%',
        v_e ->> 'destination', v_e ->> 'container_type',
        v_row.is_active, v_row.evidence_level, v_row.validity_start;
    END IF;
  END LOOP;

  IF v_present IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: only % of the 60 expected business keys were found',
      v_present;
  END IF;

  -- Out-of-scope collision guard. Once promoted, these 60 rows are the runtime
  -- candidates; any other ACTIVE + whitelisted row landing on the same
  -- (normalised destination, container size) would make the resolver ambiguous
  -- and silently degrade every quote for that destination to TO_CONFIRM.
  SELECT count(*) INTO v_bad
  FROM public.local_transport_rates AS r
  WHERE r.source_document IS DISTINCT FROM c_source_document
    AND r.is_active
    AND r.evidence_level = ANY (c_runtime_whitelist)
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_rows) AS e(value)
      WHERE btrim(regexp_replace(regexp_replace(regexp_replace(
              upper(translate(e.value ->> 'destination',
                'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
                'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy')),
              '[^A-Z0-9/]+', ' ', 'g'), ' */ *', '/', 'g'), ' +', ' ', 'g'))
          = btrim(regexp_replace(regexp_replace(regexp_replace(
              upper(translate(r.destination,
                'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
                'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy')),
              '[^A-Z0-9/]+', ' ', 'g'), ' */ *', '/', 'g'), ' +', ' ', 'g'))
        AND substring(regexp_replace(e.value ->> 'container_type', '[^0-9]', '', 'g') FROM '^(20|40)')
          IS NOT DISTINCT FROM
            substring(regexp_replace(r.container_type, '[^0-9]', '', 'g') FROM '^(20|40)')
    );

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport promotion stopped: % active + quotable row(s) outside % already compete for one of the 60 business keys; promoting would make the runtime resolver ambiguous',
      v_bad, c_source_document;
  END IF;

  -- =====================================================================
  -- PASS 2 - the write. UPDATE of is_active / evidence_level ONLY, and only
  --          on rows that are not already in the target state, so a second
  --          run touches 0 row and does not even fire the updated_at trigger.
  -- =====================================================================
  v_expected_updates := 60 - v_already_target;

  UPDATE public.local_transport_rates AS r
  SET is_active = true,
      evidence_level = c_target_evidence
  WHERE r.source_document = c_source_document
    AND r.client_code IS NULL
    AND (r.is_active IS DISTINCT FROM true OR r.evidence_level IS DISTINCT FROM c_target_evidence);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated IS DISTINCT FROM v_expected_updates THEN
    RAISE EXCEPTION
      'local transport promotion post-check failed: expected % update(s), performed %',
      v_expected_updates, v_updated;
  END IF;

  -- =====================================================================
  -- PASS 3 - postconditions.
  -- =====================================================================
  SELECT count(*),
         count(*) FILTER (WHERE r.container_type = c_ct20),
         count(*) FILTER (WHERE r.container_type = c_ct40),
         count(*) FILTER (WHERE r.is_active AND r.evidence_level = c_target_evidence)
  INTO v_bad, v_count_20, v_count_40, v_active_after
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document;

  IF v_bad IS DISTINCT FROM 60 OR v_count_20 IS DISTINCT FROM 30 OR v_count_40 IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION
      'local transport promotion post-check failed: expected 60 in-scope rows (30 x 20'' Dry, 30 x 40'' Dry), got % (% / %)',
      v_bad, v_count_20, v_count_40;
  END IF;

  IF v_active_after IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION
      'local transport promotion post-check failed: only % of the 60 rows are active + %',
      v_active_after, c_target_evidence;
  END IF;

  -- Grid-wide invariants after the write.
  SELECT count(*) INTO v_bad
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document
    AND (   r.origin IS DISTINCT FROM c_origin
         OR r.cargo_category IS DISTINCT FROM c_cargo_category
         OR r.rate_currency IS DISTINCT FROM c_currency
         OR r.client_code IS NOT NULL
         OR r.provider IS NOT NULL
         OR r.source_attachment_id IS NOT NULL
         OR r.validity_end IS NOT NULL
         OR r.rate_includes IS NOT NULL
         OR NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(v_rows) AS e(value)
              WHERE e.value ->> 'destination' = r.destination
                AND e.value ->> 'container_type' = r.container_type
                AND (e.value ->> 'total_ttc')::numeric = r.rate_amount
            ));

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport promotion post-check failed: % in-scope row(s) drifted from the pinned contract (amount, currency, origin, cargo, NULL client/provider/attachment/validity_end/rate_includes)',
      v_bad;
  END IF;

  -- Nothing but is_active / evidence_level moved in scope: validity_start is
  -- preserved row by row, so the 10 live 2026-03-30 dates and the 50 NULLs stay.
  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_scope_digest_after
  FROM (
    SELECT ((to_jsonb(r) - 'is_active'::text - 'evidence_level'::text - 'updated_at'::text)::text) AS row_text
    FROM public.local_transport_rates AS r
    WHERE r.id = ANY (v_scope_ids)
  ) AS t;

  IF v_scope_digest_after IS DISTINCT FROM v_scope_digest_before THEN
    RAISE EXCEPTION
      'local transport promotion post-check failed: a column other than is_active / evidence_level changed on the 60 in-scope rows';
  END IF;

  -- Determinism of the promoted set: exactly one active + quotable generic row
  -- per business key across the WHOLE table, which is what the shared resolver
  -- requires to return an amount.
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(v_rows) AS e(value)
  WHERE (
    SELECT count(*)
    FROM public.local_transport_rates AS r
    WHERE r.is_active
      AND r.evidence_level = ANY (c_runtime_whitelist)
      AND r.client_code IS NULL
      AND r.destination = e.value ->> 'destination'
      AND r.container_type = e.value ->> 'container_type'
  ) IS DISTINCT FROM 1;

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport promotion post-check failed: % business key(s) do not resolve to exactly one active + quotable generic row',
      v_bad;
  END IF;

  -- Nothing outside this source_document moved - Aksa Energy included.
  SELECT count(*) INTO v_out_count_after
  FROM public.local_transport_rates AS r
  WHERE r.source_document IS DISTINCT FROM c_source_document;

  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_out_digest_after
  FROM (
    SELECT r::text AS row_text
    FROM public.local_transport_rates AS r
    WHERE r.source_document IS DISTINCT FROM c_source_document
  ) AS t;

  IF v_out_count_after IS DISTINCT FROM v_out_count_before
     OR v_out_digest_after IS DISTINCT FROM v_out_digest_before THEN
    RAISE EXCEPTION
      'local transport promotion post-check failed: out-of-scope local_transport_rates rows were modified (% -> % row(s))',
      v_out_count_before, v_out_count_after;
  END IF;

  SELECT count(*) INTO v_table_after FROM public.local_transport_rates;

  IF v_table_after IS DISTINCT FROM v_table_before THEN
    RAISE EXCEPTION
      'local transport promotion post-check failed: local_transport_rates went from % to % row(s); this migration must never insert or delete',
      v_table_before, v_table_after;
  END IF;

  RAISE NOTICE
    'official local transport grid promoted: % row(s) updated to is_active=true / evidence_level=%, % already in target state, 60 quotable key(s) under %, % out-of-scope row(s) unchanged',
    v_updated, c_target_evidence, v_already_target, c_source_document, v_out_count_after;
END
$promote_official_local_transport_grid$;

-- No DDL, no COMMENT, no index, no policy: this migration is a guarded UPDATE
-- of `is_active` and `evidence_level` on 60 rows and nothing else. The
-- uniqueness of the 60 business keys is already enforced by
-- uq_local_transport_rates_official_delivery_grid (migration 20260823130000).
