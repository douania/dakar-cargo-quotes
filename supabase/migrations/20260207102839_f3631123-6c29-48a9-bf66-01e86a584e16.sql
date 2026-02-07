
CREATE OR REPLACE VIEW public.historical_quotation_profiles AS
SELECT
  hq.id AS quotation_id,
  hq.origin_country,
  hq.destination_country,
  hq.final_destination,
  hq.incoterm,
  hq.transport_mode,
  hq.cargo_description,
  hq.total_weight_kg,
  hm.hs_code,
  hm.carrier,
  hm.container_types,
  hm.container_count,
  hq.created_at
FROM public.historical_quotations hq
LEFT JOIN public.historical_quotation_metadata hm
  ON hm.quotation_id = hq.id;
