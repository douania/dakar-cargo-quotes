-- Stage the official container delivery grid (20P / 40P) into
-- public.local_transport_rates as INACTIVE, NON-QUOTABLE evidence.
--
-- Business input, attested by the requester on 2026-08-23: the two PDFs
-- "TARIFS DE LIVRAISONS DES CONTENEURS 20P.pdf" and
-- "TARIFS DE LIVRAISONS DES CONTENEURS 40P.pdf" are the official container
-- delivery tariffs, per distance and per zone. They cover 30 destinations and
-- two container types, i.e. exactly 60 rows.
--
-- SOURCE_BASIS = TOTAL_TTC. Every rate_amount staged here is the document's
-- exact TTC total (transport before VAT + file fee + 18% VAT), NOT the
-- transport-only amount. That choice is imposed by the 10 rows already live in
-- Lovable under this same source_document, which all carry the TTC total. It is
-- pinned in each row's notes so no later lot can mistake the basis.
--
-- Doctrine stated by the requester on 2026-08-23: container delivery is a
-- third-party DEBOURS (disbursement) for as long as SODATRA does not operate
-- its own fleet. This lot does NOT change the engine. It only records that
-- doctrine in the staging metadata.
--
-- ACTIVATION BARRIER - deliberately left open, not closed by this lot:
--   * supabase/functions/quotation-engine/index.ts stamps the local transport
--     line with bloc = 'operationnel' (and price-service-lines/index.ts routes
--     TRUCKING / ON_CARRIAGE through the same table). That contradicts the
--     DEBOURS doctrine above.
--   * rate_amount here is a supplier TTC total. Activating it as-is would put
--     embedded supplier VAT and a file fee inside the operational bloc and the
--     client-facing `total_ht`. The current run-pricing code does not apply a
--     second VAT to operationnel, but the HT label would still be fiscally
--     misleading.
--   * quotation-engine matches destinations with `ilike '%term%'` then
--     `.limit(1)`; with 60 rows sharing this source_document that lookup is not
--     deterministic.
-- Consequently every row created here is is_active = false and
-- evidence_level = 'to_confirm'. Both readers filter on
-- `is_active = true AND evidence_level IN ('official','validated_internal')`,
-- so these rows are provably invisible to pricing. Activation is forbidden
-- until a separate lot performs the debours classification and the fiscal /
-- tariff validation. No TypeScript is touched by this migration.
--
-- Scope contract enforced below:
--   * INSERT only. Never UPDATE, never DELETE, no promotion to 'official' or
--     'validated_internal', no activation.
--   * The 10 rows already live under this source_document (KEDOUGOU,
--     KIDIRA / BISSAU, KOLDA / MATAM, ROSSO / NIOKOLOKO, VELINGARA / GOUDIRI,
--     each in 20' Dry and 40' Dry) are a strict no-op, proven by a digest taken
--     before and after the insert pass.
--   * The 81 Aksa Energy rows and every other row of the table are provably
--     untouched, proven by a second digest plus a row count.
--   * Business key: source_document + origin + destination + container_type +
--     cargo_category, with client_code IS NULL. No live UUID is encoded; the
--     only ids used are captured at runtime to fence the pre-existing rows.
--   * No CURRENT_DATE / now() drives business content. The staging date, the
--     document hashes and the live validity_start are pinned constants. Only
--     created_at / updated_at fall back to the table's own technical defaults.
--
-- Accepted initial states, anything else raises before a single write:
--   A - 0 row for this source_document (fresh `supabase db reset`).
--       Result: 60 rows inserted, all inactive / to_confirm.
--   B - exactly the 10 live Lovable rows and nothing else for this
--       source_document. Result: those 10 stay byte-for-byte, 50 rows inserted.
--   C - the 60 expected rows already present. Result: strict no-op.
-- Any other cardinality, duplicate, normalised-key collision or contradictory
-- attribute stops the migration.
--
-- Canonical destination normalisation, chosen to converge on the 10 live rows:
--   * pair separators are normalised to " / " (spaces around the slash), which
--     is the spelling already live for "KIDIRA / BISSAU" & co;
--   * raw PDF "ZONE" becomes "FORFAIT ZONE 1 <18 KM";
--   * raw PDF "ZONE SEBIKHOTANE ET POUT" becomes
--     "FORFAIT ZONE 2, SEIKHOTANE ET POUT" (the runtime already spells it
--     SEIKHOTANE; the raw PDF spelling is preserved in notes).
-- The raw PDF label is always kept verbatim in notes.

DO $stage_official_local_transport_debours$
DECLARE
  -- ---------------------------------------------------------------------
  -- Pinned constants. Single source of truth for both validation and insert.
  -- ---------------------------------------------------------------------
  c_source_document    constant text := 'TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS';
  c_origin             constant text := 'Dakar Port';
  c_cargo_category     constant text := 'Dry';
  c_currency           constant text := 'XOF';
  c_evidence           constant text := 'to_confirm';
  c_ct20               constant text := '20'' Dry';
  c_ct40               constant text := '40'' Dry';
  c_pdf20_file         constant text := 'TARIFS DE LIVRAISONS DES CONTENEURS 20P.pdf';
  c_pdf20_sha256       constant text := '4027D051A1C36A4ECB4D5ECC2AD3146B70A940E817368130A940696E98149676';
  c_pdf40_file         constant text := 'TARIFS DE LIVRAISONS DES CONTENEURS 40P.pdf';
  c_pdf40_sha256       constant text := '64C458A1679DBAD133A6D6599A1B9F2AD53F5168646797AB4CA4FDC8FC807BB4';

  -- validity_start carried by the 10 rows already live in Lovable. Pinned so
  -- their fingerprint can be recognised without reading a live UUID.
  c_live_validity_start constant date := DATE '2026-03-30';

  -- Deterministic, single-line notes template. Kept on one line on purpose: an
  -- embedded newline would be exposed to CRLF rewriting and would break the
  -- byte-for-byte no-op of state C. 8 placeholders, in order: raw PDF label,
  -- distance, transport before VAT, file fee, VAT, TTC total, PDF file name,
  -- PDF SHA-256.
  c_note_template constant text :=
       $fmt$[STAGING 2026-08-23] DEBOURS | SOURCE_BASIS=TOTAL_TTC | DO_NOT_PRICE$fmt$
    || $fmt$ | Libellé brut PDF: "%s" | Distance: %s km$fmt$
    || $fmt$ | Transport avant TVA: %s XOF | Frais de dossier: %s XOF | TVA 18%%: %s XOF | Total TTC: %s XOF$fmt$
    || $fmt$ | PDF source: "%s" | SHA-256: %s$fmt$
    || $fmt$ | Le PDF ne porte aucune date d'effet, aucune identité d'émetteur, aucune signature ni cachet visibles.$fmt$
    || $fmt$ | Doctrine SODATRA du 2026-08-23: la livraison conteneur est un débours tiers tant que SODATRA n'exploite pas sa propre flotte.$fmt$
    || $fmt$ | Barrière d'activation: le moteur classe le transport local en bloc='operationnel' (quotation-engine) alors que la doctrine impose débours, et rate_amount porte le TOTAL TTC et non le transport HT.$fmt$
    || $fmt$ | Ligne de staging inactive (is_active=false, evidence_level=to_confirm): activation interdite avant un lot séparé de classification débours et de validation fiscale et tarifaire SODATRA.$fmt$;

  -- ---------------------------------------------------------------------
  -- The grid, transcribed from the two PDFs. 30 destinations.
  --   raw_label   - verbatim PDF wording, kept in notes;
  --   destination - canonical spelling written to the table;
  --   tcNN/feeNN/vatNN/totalNN - transport before VAT / file fee / 18% VAT /
  --   TTC total, per container size. Only totalNN reaches rate_amount; the
  --   components are pinned so the internal arithmetic can be self-checked
  --   below without trusting the transcription.
  -- ---------------------------------------------------------------------
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

  -- The 10 keys already live in Lovable under this source_document, taken from
  -- the read-only snapshot. Only these keys may legally be found in the live
  -- shape (active, notes NULL, validity_start 2026-03-30). The 50 others may
  -- only be absent or in the staging shape produced by this migration.
  v_live_keys jsonb := '[
    {"destination":"KEDOUGOU","container_type":"20'' Dry"},
    {"destination":"KEDOUGOU","container_type":"40'' Dry"},
    {"destination":"KIDIRA / BISSAU","container_type":"20'' Dry"},
    {"destination":"KIDIRA / BISSAU","container_type":"40'' Dry"},
    {"destination":"KOLDA / MATAM","container_type":"20'' Dry"},
    {"destination":"KOLDA / MATAM","container_type":"40'' Dry"},
    {"destination":"ROSSO / NIOKOLOKO","container_type":"20'' Dry"},
    {"destination":"ROSSO / NIOKOLOKO","container_type":"40'' Dry"},
    {"destination":"VELINGARA / GOUDIRI","container_type":"20'' Dry"},
    {"destination":"VELINGARA / GOUDIRI","container_type":"40'' Dry"}
  ]'::jsonb;

  -- Expanded 60-row expectation: grid x {20' Dry, 40' Dry}, notes included.
  v_rows jsonb;

  v_e                    jsonb;
  v_row                  public.local_transport_rates%ROWTYPE;
  v_preexisting_ids      uuid[];
  v_scope_before         integer;
  v_scope_after          integer;
  v_scope_client_scoped  integer;
  v_scope_digest_before  text;
  v_scope_digest_after   text;
  v_out_count_before     integer;
  v_out_count_after      integer;
  v_out_digest_before    text;
  v_out_digest_after     text;
  v_table_after          integer;
  v_cardinality          integer;
  v_present              integer := 0;
  v_present_live         integer := 0;
  v_inserted             integer;
  v_count_20             integer;
  v_count_40             integer;
  v_bad                  integer;
  v_is_live_key          boolean;
  v_is_staged_shape      boolean;
  v_is_live_shape        boolean;
BEGIN
  -- =====================================================================
  -- PASS 0 - self-check of the pinned grid. Nothing is read from the table
  --          until the transcription has proven internally consistent.
  -- =====================================================================
  IF jsonb_array_length(v_grid) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION
      'local transport staging stopped: the pinned grid must hold exactly 30 destinations, got %',
      jsonb_array_length(v_grid);
  END IF;

  IF jsonb_array_length(v_live_keys) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'local transport staging stopped: the live key list must hold exactly 10 keys, got %',
      jsonb_array_length(v_live_keys);
  END IF;

  IF (
    SELECT count(DISTINCT g.value ->> 'destination') FROM jsonb_array_elements(v_grid) AS g(value)
  ) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION
      'local transport staging stopped: the 30 canonical destinations are not unique (normalisation collision)';
  END IF;

  IF (
    SELECT count(DISTINCT g.value ->> 'raw_label') FROM jsonb_array_elements(v_grid) AS g(value)
  ) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION
      'local transport staging stopped: the 30 raw PDF labels are not unique';
  END IF;

  -- Arithmetic self-check on both container sizes: TTC total must be the sum of
  -- its own components, and VAT must be exactly 18% of (transport + file fee).
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
      'local transport staging stopped: % pinned destination(s) fail the TTC / 18%% VAT arithmetic self-check',
      v_bad;
  END IF;

  -- Expand the grid into the 60 expected rows, notes included, so validation
  -- and insert read the exact same strings.
  SELECT jsonb_agg(x.payload ORDER BY x.payload ->> 'destination', x.payload ->> 'container_type')
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'destination',    g.value ->> 'destination',
             'container_type', ct.container_type,
             'total_ttc',      g.value ->> ct.total_key,
             'notes',          format(
                                 c_note_template,
                                 g.value ->> 'raw_label',
                                 g.value ->> 'distance_km',
                                 g.value ->> ct.transport_key,
                                 g.value ->> ct.fee_key,
                                 g.value ->> ct.vat_key,
                                 g.value ->> ct.total_key,
                                 ct.pdf_file,
                                 ct.pdf_sha256)
           ) AS payload
    FROM jsonb_array_elements(v_grid) AS g(value)
    CROSS JOIN (
      VALUES
        (c_ct20, 'tc20', 'fee20', 'vat20', 'total20', c_pdf20_file, c_pdf20_sha256),
        (c_ct40, 'tc40', 'fee40', 'vat40', 'total40', c_pdf40_file, c_pdf40_sha256)
    ) AS ct(container_type, transport_key, fee_key, vat_key, total_key, pdf_file, pdf_sha256)
  ) AS x;

  IF jsonb_array_length(v_rows) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION
      'local transport staging stopped: the expansion must yield exactly 60 rows, got %',
      jsonb_array_length(v_rows);
  END IF;

  IF (
    SELECT count(DISTINCT (e.value ->> 'destination') || '|' || (e.value ->> 'container_type'))
    FROM jsonb_array_elements(v_rows) AS e(value)
  ) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION
      'local transport staging stopped: the 60 expected business keys are not unique';
  END IF;

  -- Every live key must exist in the expansion, otherwise the canonical
  -- normalisation has drifted away from the rows already in production.
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(v_live_keys) AS l(value)
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_rows) AS e(value)
    WHERE e.value ->> 'destination' = l.value ->> 'destination'
      AND e.value ->> 'container_type' = l.value ->> 'container_type'
  );

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport staging stopped: % live key(s) have no canonical counterpart in the expansion',
      v_bad;
  END IF;

  -- =====================================================================
  -- PASS 1 - lock the table, snapshot everything that must not move, then
  --          prove the current state is one of the three accepted states.
  --          No row is written before every check below has passed.
  -- =====================================================================
  LOCK TABLE public.local_transport_rates IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*), count(*) FILTER (WHERE r.client_code IS NOT NULL)
  INTO v_scope_before, v_scope_client_scoped
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document;

  IF v_scope_client_scoped IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport staging stopped: % row(s) of source_document % carry a non-NULL client_code; this grid is a generic barème',
      v_scope_client_scoped, c_source_document;
  END IF;

  IF v_scope_before NOT IN (0, 10, 60) THEN
    RAISE EXCEPTION
      'local transport staging stopped: source_document % holds % row(s); only 0 (fresh reset), 10 (observed Lovable state) or 60 (already staged) are accepted',
      c_source_document, v_scope_before;
  END IF;

  -- Runtime fence around the pre-existing in-scope rows. No UUID is hardcoded;
  -- the ids are only used to prove those rows never move.
  SELECT coalesce(array_agg(r.id ORDER BY r.id), ARRAY[]::uuid[])
  INTO v_preexisting_ids
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document;

  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_scope_digest_before
  FROM (
    SELECT r::text AS row_text
    FROM public.local_transport_rates AS r
    WHERE r.id = ANY (v_preexisting_ids)
  ) AS t;

  -- Everything outside this source_document: the 81 Aksa Energy rows and any
  -- other barème. Compared again after the insert pass.
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
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_live_keys) AS l(value)
      WHERE l.value ->> 'destination' = v_e ->> 'destination'
        AND l.value ->> 'container_type' = v_e ->> 'container_type'
    ) INTO v_is_live_key;

    SELECT count(*) INTO v_cardinality
    FROM public.local_transport_rates AS r
    WHERE r.source_document = c_source_document
      AND r.origin = c_origin
      AND r.destination = v_e ->> 'destination'
      AND r.container_type = v_e ->> 'container_type'
      AND r.cargo_category = c_cargo_category
      AND r.client_code IS NULL;

    IF v_cardinality > 1 THEN
      RAISE EXCEPTION
        'local transport staging stopped: % row(s) already match the business key % / % / % / %; the normalised key must be unique',
        v_cardinality, c_source_document, c_origin, v_e ->> 'destination', v_e ->> 'container_type';
    END IF;

    CONTINUE WHEN v_cardinality = 0;

    SELECT * INTO v_row
    FROM public.local_transport_rates AS r
    WHERE r.source_document = c_source_document
      AND r.origin = c_origin
      AND r.destination = v_e ->> 'destination'
      AND r.container_type = v_e ->> 'container_type'
      AND r.cargo_category = c_cargo_category
      AND r.client_code IS NULL;

    v_present := v_present + 1;

    -- Staging fingerprint: exactly what this migration writes.
    v_is_staged_shape :=
          v_row.rate_amount = (v_e ->> 'total_ttc')::numeric
      AND v_row.rate_currency IS NOT DISTINCT FROM c_currency
      AND v_row.evidence_level IS NOT DISTINCT FROM c_evidence
      AND v_row.is_active IS NOT DISTINCT FROM false
      AND v_row.notes IS NOT DISTINCT FROM (v_e ->> 'notes')
      AND v_row.provider IS NULL
      AND v_row.source_attachment_id IS NULL
      AND v_row.validity_start IS NULL
      AND v_row.validity_end IS NULL
      AND v_row.rate_includes IS NULL;

    -- Live fingerprint: exactly the read-only Lovable snapshot.
    v_is_live_shape :=
          v_row.rate_amount = (v_e ->> 'total_ttc')::numeric
      AND v_row.rate_currency IS NOT DISTINCT FROM c_currency
      AND v_row.evidence_level IS NOT DISTINCT FROM c_evidence
      AND v_row.is_active IS NOT DISTINCT FROM true
      AND v_row.notes IS NULL
      AND v_row.provider IS NULL
      AND v_row.source_attachment_id IS NULL
      AND v_row.validity_start IS NOT DISTINCT FROM c_live_validity_start
      AND v_row.validity_end IS NULL
      AND v_row.rate_includes IS NULL;

    IF coalesce(v_is_staged_shape, false) THEN
      NULL;
    ELSIF coalesce(v_is_live_shape, false) AND v_is_live_key THEN
      v_present_live := v_present_live + 1;
    ELSE
      RAISE EXCEPTION
        'local transport staging stopped: the row for % / % matches neither the staging fingerprint nor an accepted live fingerprint (amount=%, active=%, evidence=%, validity_start=%, notes_is_null=%)',
        v_e ->> 'destination', v_e ->> 'container_type',
        v_row.rate_amount, v_row.is_active, v_row.evidence_level,
        v_row.validity_start, (v_row.notes IS NULL);
    END IF;
  END LOOP;

  -- No row may sit under this source_document outside the 60 expected keys.
  IF v_present IS DISTINCT FROM v_scope_before THEN
    RAISE EXCEPTION
      'local transport staging stopped: % row(s) carry source_document % but only % match an expected business key',
      v_scope_before, c_source_document, v_present;
  END IF;

  IF v_scope_before = 10 AND v_present_live IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'local transport staging stopped: the 10-row state must be exactly the 10 observed live rows, found % of them',
      v_present_live;
  END IF;

  -- =====================================================================
  -- PASS 2 - insert only what is missing. INSERT only: no UPDATE, no DELETE,
  --          so the pre-existing rows are a structural no-op.
  -- =====================================================================
  INSERT INTO public.local_transport_rates (
    origin, destination, container_type, cargo_category,
    rate_amount, rate_currency, rate_includes,
    validity_start, validity_end,
    source_document, provider, notes, is_active,
    source_attachment_id, evidence_level, client_code
  )
  SELECT
    c_origin,
    e.value ->> 'destination',
    e.value ->> 'container_type',
    c_cargo_category,
    (e.value ->> 'total_ttc')::numeric,
    c_currency,
    NULL::text[],
    NULL::date,
    NULL::date,
    c_source_document,
    NULL::text,
    e.value ->> 'notes',
    false,
    NULL::uuid,
    c_evidence,
    NULL::text
  FROM jsonb_array_elements(v_rows) AS e(value)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.local_transport_rates AS r
    WHERE r.source_document = c_source_document
      AND r.origin = c_origin
      AND r.destination = e.value ->> 'destination'
      AND r.container_type = e.value ->> 'container_type'
      AND r.cargo_category = c_cargo_category
      AND r.client_code IS NULL
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted IS DISTINCT FROM (60 - v_scope_before) THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: expected % insert(s), performed %',
      60 - v_scope_before, v_inserted;
  END IF;

  -- =====================================================================
  -- PASS 3 - postconditions.
  -- =====================================================================
  SELECT count(*),
         count(*) FILTER (WHERE r.container_type = c_ct20),
         count(*) FILTER (WHERE r.container_type = c_ct40)
  INTO v_scope_after, v_count_20, v_count_40
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document;

  IF v_scope_after IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: source_document % holds % row(s), expected 60',
      c_source_document, v_scope_after;
  END IF;

  IF v_count_20 IS DISTINCT FROM 30 OR v_count_40 IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: expected 30 x %s and 30 x %s, got % and %',
      c_ct20, c_ct40, v_count_20, v_count_40;
  END IF;

  -- Shared attributes of the whole grid.
  SELECT count(*) INTO v_bad
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document
    AND (   r.origin IS DISTINCT FROM c_origin
         OR r.cargo_category IS DISTINCT FROM c_cargo_category
         OR r.rate_currency IS DISTINCT FROM c_currency
         OR r.evidence_level IS DISTINCT FROM c_evidence
         OR r.client_code IS NOT NULL
         OR r.provider IS NOT NULL
         OR r.source_attachment_id IS NOT NULL
         OR r.validity_end IS NOT NULL
         OR r.rate_includes IS NOT NULL);

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: % row(s) of the grid carry an out-of-contract attribute',
      v_bad;
  END IF;

  -- Every in-scope amount is the exact TTC total pinned for its business key.
  SELECT count(*) INTO v_bad
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_rows) AS e(value)
      WHERE e.value ->> 'destination' = r.destination
        AND e.value ->> 'container_type' = r.container_type
        AND (e.value ->> 'total_ttc')::numeric = r.rate_amount
    );

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: % row(s) of the grid do not carry the pinned TTC total',
      v_bad;
  END IF;

  -- Every newly staged row is inactive, to_confirm, undated and carries the
  -- exact deterministic notes computed above.
  SELECT count(*) INTO v_bad
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document
    AND NOT (r.id = ANY (v_preexisting_ids))
    AND (   r.is_active IS DISTINCT FROM false
         OR r.evidence_level IS DISTINCT FROM c_evidence
         OR r.validity_start IS NOT NULL
         OR NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(v_rows) AS e(value)
              WHERE e.value ->> 'destination' = r.destination
                AND e.value ->> 'container_type' = r.container_type
                AND e.value ->> 'notes' = r.notes
            ));

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: % newly staged row(s) are not inactive / to_confirm / annotated as required',
      v_bad;
  END IF;

  -- Explicit non-quotability of everything this migration created, stated
  -- against the exact predicate both readers use.
  SELECT count(*) INTO v_bad
  FROM public.local_transport_rates AS r
  WHERE r.source_document = c_source_document
    AND NOT (r.id = ANY (v_preexisting_ids))
    AND (r.is_active OR r.evidence_level IN ('official', 'validated_internal'));

  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: % newly staged row(s) would be quotable by the pricing engine',
      v_bad;
  END IF;

  -- The pre-existing in-scope rows are byte-for-byte untouched.
  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_scope_digest_after
  FROM (
    SELECT r::text AS row_text
    FROM public.local_transport_rates AS r
    WHERE r.id = ANY (v_preexisting_ids)
  ) AS t;

  IF v_scope_digest_after IS DISTINCT FROM v_scope_digest_before THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: the % pre-existing row(s) of source_document % were modified',
      coalesce(array_length(v_preexisting_ids, 1), 0), c_source_document;
  END IF;

  -- Nothing outside this source_document moved - Aksa Energy included.
  SELECT count(*) INTO v_out_count_after
  FROM public.local_transport_rates AS r
  WHERE r.source_document IS DISTINCT FROM c_source_document;

  IF v_out_count_after IS DISTINCT FROM v_out_count_before THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: out-of-scope rows went from % to %',
      v_out_count_before, v_out_count_after;
  END IF;

  SELECT md5(coalesce(string_agg(t.row_text, E'\n' ORDER BY t.row_text), ''))
  INTO v_out_digest_after
  FROM (
    SELECT r::text AS row_text
    FROM public.local_transport_rates AS r
    WHERE r.source_document IS DISTINCT FROM c_source_document
  ) AS t;

  IF v_out_digest_after IS DISTINCT FROM v_out_digest_before THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: out-of-scope local_transport_rates rows were modified';
  END IF;

  SELECT count(*) INTO v_table_after FROM public.local_transport_rates;

  IF v_table_after IS DISTINCT FROM (v_out_count_before + 60) THEN
    RAISE EXCEPTION
      'local transport staging post-check failed: local_transport_rates holds % row(s), expected % out-of-scope + 60',
      v_table_after, v_out_count_before;
  END IF;

  RAISE NOTICE
    'local transport debours grid staged: % row(s) inserted inactive/to_confirm, % pre-existing row(s) left untouched, 60 row(s) now under %, % out-of-scope row(s) unchanged',
    v_inserted,
    coalesce(array_length(v_preexisting_ids, 1), 0),
    c_source_document,
    v_out_count_after;
END
$stage_official_local_transport_debours$;

-- Collision guard for this source only. The predicate is strictly limited to
-- source_document = the official delivery grid AND client_code IS NULL, so the
-- 81 Aksa Energy rows - and any other barème - are outside the index entirely.
-- Created only after the DO block above proved the 60 normalised keys unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_local_transport_rates_official_delivery_grid
  ON public.local_transport_rates (origin, destination, container_type, cargo_category)
  WHERE source_document = 'TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS'
    AND client_code IS NULL;

COMMENT ON INDEX public.uq_local_transport_rates_official_delivery_grid IS
  'Unicité de la grille officielle de livraison conteneurs (30 destinations x 20''/40'' Dry = 60 clés), limitée à source_document = TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS et client_code IS NULL. N''affecte ni les 81 lignes Aksa Energy ni aucune autre source.';
