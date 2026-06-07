-- CARRIER-CONTACT-CHANNELS-SEED-1: official Senegal/Dakar carrier quotation channels.

INSERT INTO public.known_business_contacts (
  domain_pattern,
  company_name,
  default_role,
  country,
  notes,
  is_active
)
VALUES (
  'csttaogroup.com',
  'CSTT-AO / ONE Line Senegal Agent',
  'agent',
  'SN',
  'Agent officiel ONE Line Senegal a partir du 2026-03-01 ; ne pas utiliser les anciens contacts R-Logistic.',
  true
)
ON CONFLICT (domain_pattern) DO NOTHING;

DO $$
DECLARE
  missing_domains text[];
BEGIN
  SELECT array_agg(required.domain_pattern ORDER BY required.domain_pattern)
  INTO missing_domains
  FROM (
    VALUES
      ('cma-cgm.com'),
      ('csttaogroup.com'),
      ('hapag-lloyd.com'),
      ('maersk.com'),
      ('msc.com')
  ) AS required(domain_pattern)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.known_business_contacts contacts
    WHERE contacts.domain_pattern = required.domain_pattern
  );

  IF missing_domains IS NOT NULL THEN
    RAISE EXCEPTION 'Missing known_business_contacts parents for carrier channel seed: %', missing_domains;
  END IF;
END $$;

WITH channels AS (
  SELECT *
  FROM (
    VALUES
      (
        'maersk.com',
        'email',
        'Export Sales / Customer Service',
        'sn.export@maersk.com',
        NULL::text,
        false,
        ARRAY['freight_maritime', 'export_fcl', 'sea_freight']::text[],
        'high',
        'https://www.maersk.com/local-information/imea/senegal',
        '2026-06-07'::timestamptz,
        'Email officiel export Senegal ; exclure sn.import@maersk.com pour RFQ export.'
      ),
      (
        'hapag-lloyd.com',
        'email',
        'Sales',
        'Senegal@sales.hlag.com',
        NULL::text,
        false,
        ARRAY['freight_maritime', 'export_fcl', 'sea_freight']::text[],
        'high',
        'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/africa/senegal/dakar.html',
        '2026-06-07'::timestamptz,
        'Contact sales officiel pour cotation.'
      ),
      (
        'hapag-lloyd.com',
        'email',
        'Customer Service',
        'Senegal@service.hlag.com',
        NULL::text,
        false,
        ARRAY['freight_maritime', 'export_fcl', 'sea_freight', 'documentation']::text[],
        'high',
        'https://www.hapag-lloyd.com/en/services-information/offices-localinfo/africa/senegal/dakar.html',
        '2026-06-07'::timestamptz,
        'Service client / booking / documentation ; pas prioritaire pour RFQ sales si sales disponible.'
      ),
      (
        'csttaogroup.com',
        'email',
        'ONE Line Sales',
        'One-line.sn.sales@csttaogroup.com',
        NULL::text,
        false,
        ARRAY['freight_maritime', 'export_fcl', 'sea_freight']::text[],
        'high',
        'https://la.one-line.com/en/news/change-agency-representation-senegal-effective-march-1st-2026-0',
        '2026-06-07'::timestamptz,
        'Agent officiel ONE Line Senegal actuel ; R-Logistic obsolete.'
      ),
      (
        'csttaogroup.com',
        'email',
        'ONE Line Customer Service',
        'One-line.sn.customerservice@csttaogroup.com',
        NULL::text,
        false,
        ARRAY['freight_maritime', 'export_fcl', 'sea_freight', 'booking']::text[],
        'high',
        'https://la.one-line.com/en/news/change-agency-representation-senegal-effective-march-1st-2026-0',
        '2026-06-07'::timestamptz,
        'Customer service / booking ; utiliser sales en priorite pour RFQ tarifaire.'
      ),
      (
        'msc.com',
        'portal',
        'myMSC / Instant Quote',
        NULL::text,
        'https://www.mymsc.com/',
        true,
        ARRAY['freight_maritime', 'export_fcl', 'sea_freight']::text[],
        'high',
        'https://www.msc.com/ebusiness',
        '2026-06-07'::timestamptz,
        'Portal-first ; aucun email quotation Senegal recent verifiable ; ne pas utiliser anciens emails MSC historiques.'
      ),
      (
        'cma-cgm.com',
        'portal',
        'My CMA CGM / SpotOn / Quotation Dashboard',
        NULL::text,
        'https://www.cma-cgm.com/my-cma-cgm/prices/instant-quote-spoton',
        true,
        ARRAY['freight_maritime', 'export_fcl', 'sea_freight']::text[],
        'high',
        'https://www.cma-cgm.com/local/senegal-agencies',
        '2026-06-07'::timestamptz,
        'Portal-first ; aucun email quotation Dakar recent verifiable ; ne pas utiliser anciens emails CMA CGM 2019.'
      )
  ) AS seed_data(
    domain_pattern,
    channel_type,
    contact_label,
    contact_email,
    portal_url,
    requires_account,
    service_types,
    confidence_level,
    source_url,
    last_verified_at,
    notes
  )
),
resolved_channels AS (
  SELECT
    contacts.id AS business_contact_id,
    channels.channel_type,
    channels.contact_label,
    channels.contact_email,
    channels.portal_url,
    channels.requires_account,
    channels.service_types,
    channels.confidence_level,
    channels.source_url,
    channels.last_verified_at,
    channels.notes
  FROM channels
  JOIN public.known_business_contacts contacts
    ON contacts.domain_pattern = channels.domain_pattern
)
INSERT INTO public.known_business_contact_channels (
  business_contact_id,
  channel_type,
  contact_label,
  contact_email,
  portal_url,
  requires_account,
  service_types,
  confidence_level,
  source_url,
  last_verified_at,
  notes
)
SELECT
  resolved_channels.business_contact_id,
  resolved_channels.channel_type,
  resolved_channels.contact_label,
  resolved_channels.contact_email,
  resolved_channels.portal_url,
  resolved_channels.requires_account,
  resolved_channels.service_types,
  resolved_channels.confidence_level,
  resolved_channels.source_url,
  resolved_channels.last_verified_at,
  resolved_channels.notes
FROM resolved_channels
WHERE NOT EXISTS (
  SELECT 1
  FROM public.known_business_contact_channels existing
  WHERE existing.is_active
    AND existing.business_contact_id = resolved_channels.business_contact_id
    AND existing.channel_type = resolved_channels.channel_type
    AND coalesce(existing.contact_label, '') = coalesce(resolved_channels.contact_label, '')
    AND coalesce(existing.contact_email, '') = coalesce(resolved_channels.contact_email, '')
    AND coalesce(existing.portal_url, '') = coalesce(resolved_channels.portal_url, '')
);
