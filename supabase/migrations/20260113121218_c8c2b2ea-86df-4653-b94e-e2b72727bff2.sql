-- Update existing tariffs to populate matching_criteria from data field
UPDATE learned_knowledge 
SET matching_criteria = jsonb_build_object(
  'origin', COALESCE(data->>'origine', data->>'origin', data->>'port_origine', data->>'origin_port'),
  'destination', COALESCE(data->>'destination', data->>'port_destination', data->>'destination_port'),
  'container_type', COALESCE(data->>'type_conteneur', data->>'container_type', data->>'conteneur'),
  'cargo_type', COALESCE(data->>'type_marchandise', data->>'cargo_type', data->>'marchandise'),
  'service', COALESCE(data->>'service', data->>'service_type', data->>'type_service'),
  'year', EXTRACT(YEAR FROM created_at)::text
)
WHERE category = 'tarif'
AND (matching_criteria IS NULL OR matching_criteria = '{}'::jsonb);

-- Also update quotation-related knowledge
UPDATE learned_knowledge 
SET matching_criteria = jsonb_build_object(
  'origin', COALESCE(data->>'origine', data->>'origin', data->>'port_origine'),
  'destination', COALESCE(data->>'destination', data->>'port_destination'),
  'container_type', COALESCE(data->>'type_conteneur', data->>'container_type'),
  'cargo_type', COALESCE(data->>'type_marchandise', data->>'cargo_type'),
  'year', EXTRACT(YEAR FROM created_at)::text
)
WHERE category IN ('quotation_history', 'pricing_pattern', 'tarification')
AND (matching_criteria IS NULL OR matching_criteria = '{}'::jsonb);