
-- Phase M2.1 — Tables historiques + RPC atomique

-- 1. Table principale
CREATE TABLE public.historical_quotations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type text NOT NULL,
  source_reference text,
  client_name text,
  origin_country text,
  destination_country text,
  final_destination text,
  incoterm text,
  transport_mode text,
  cargo_description text,
  total_weight_kg numeric,
  total_volume_cbm numeric,
  total_value numeric,
  currency text DEFAULT 'EUR',
  is_transit boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 2. Table lignes tarifaires
CREATE TABLE public.historical_quotation_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quotation_id uuid NOT NULL REFERENCES public.historical_quotations(id) ON DELETE CASCADE,
  bloc text,
  category text,
  description text,
  amount numeric,
  currency text DEFAULT 'FCFA',
  source_type text,
  created_at timestamptz DEFAULT now()
);

-- 3. Table metadata
CREATE TABLE public.historical_quotation_metadata (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quotation_id uuid NOT NULL REFERENCES public.historical_quotations(id) ON DELETE CASCADE,
  hs_code text,
  carrier text,
  container_types text[],
  container_count integer,
  special_flags jsonb,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- 4. RLS — public read, service role write
ALTER TABLE public.historical_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_quotation_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historical_quotations_public_read" ON public.historical_quotations FOR SELECT USING (true);
CREATE POLICY "historical_quotation_lines_public_read" ON public.historical_quotation_lines FOR SELECT USING (true);
CREATE POLICY "historical_quotation_metadata_public_read" ON public.historical_quotation_metadata FOR SELECT USING (true);

-- 5. Index sur FK pour performance cascade
CREATE INDEX idx_hql_quotation_id ON public.historical_quotation_lines(quotation_id);
CREATE INDEX idx_hqm_quotation_id ON public.historical_quotation_metadata(quotation_id);

-- 6. RPC transactionnelle atomique
CREATE OR REPLACE FUNCTION public.insert_historical_quotation_atomic(
  p_quotation jsonb,
  p_lines jsonb,
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quotation_id uuid;
  v_line jsonb;
BEGIN
  -- Insert quotation principale
  INSERT INTO historical_quotations (
    source_type, source_reference, client_name,
    origin_country, destination_country, final_destination,
    incoterm, transport_mode, cargo_description,
    total_weight_kg, total_volume_cbm, total_value,
    currency, is_transit
  ) VALUES (
    p_quotation->>'source_type',
    p_quotation->>'source_reference',
    p_quotation->>'client_name',
    p_quotation->>'origin_country',
    p_quotation->>'destination_country',
    p_quotation->>'final_destination',
    p_quotation->>'incoterm',
    p_quotation->>'transport_mode',
    p_quotation->>'cargo_description',
    (p_quotation->>'total_weight_kg')::numeric,
    (p_quotation->>'total_volume_cbm')::numeric,
    (p_quotation->>'total_value')::numeric,
    COALESCE(p_quotation->>'currency', 'EUR'),
    COALESCE((p_quotation->>'is_transit')::boolean, false)
  )
  RETURNING id INTO v_quotation_id;

  -- Insert lignes tarifaires
  IF p_lines IS NOT NULL AND jsonb_array_length(p_lines) > 0 THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      INSERT INTO historical_quotation_lines (
        quotation_id, bloc, category, description,
        amount, currency, source_type
      ) VALUES (
        v_quotation_id,
        v_line->>'bloc',
        v_line->>'category',
        v_line->>'description',
        (v_line->>'amount')::numeric,
        COALESCE(v_line->>'currency', 'FCFA'),
        v_line->>'source_type'
      );
    END LOOP;
  END IF;

  -- Insert metadata (si fournie)
  IF p_metadata IS NOT NULL AND p_metadata != 'null'::jsonb THEN
    INSERT INTO historical_quotation_metadata (
      quotation_id, hs_code, carrier, container_types,
      container_count, special_flags, notes
    ) VALUES (
      v_quotation_id,
      p_metadata->>'hs_code',
      p_metadata->>'carrier',
      CASE
        WHEN p_metadata->'container_types' IS NOT NULL
        THEN ARRAY(SELECT jsonb_array_elements_text(p_metadata->'container_types'))
        ELSE NULL
      END,
      (p_metadata->>'container_count')::integer,
      p_metadata->'special_flags',
      p_metadata->>'notes'
    );
  END IF;

  RETURN v_quotation_id;
END;
$$;

-- 7. Restreindre accès RPC à service_role uniquement
REVOKE ALL ON FUNCTION public.insert_historical_quotation_atomic(jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_historical_quotation_atomic(jsonb, jsonb, jsonb) TO service_role;
