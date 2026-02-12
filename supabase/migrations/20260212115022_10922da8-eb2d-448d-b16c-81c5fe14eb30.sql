ALTER TABLE quote_service_pricing
  DROP CONSTRAINT quote_service_pricing_source_check;

ALTER TABLE quote_service_pricing
  ADD CONSTRAINT quote_service_pricing_source_check
  CHECK (source IN (
    'internal',
    'official',
    'historical',
    'fallback',
    'business_rule',
    'catalogue_sodatra',
    'local_transport_rate',
    'customs_tier',
    'customs_weight_tier',
    'client_override',
    'no_match',
    'missing_quantity',
    'port_tariffs'
  ));