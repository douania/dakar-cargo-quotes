-- CARRIER-CONTACT-CHANNELS-MIGRATION-1: additive child table for carrier quotation channels.

CREATE TABLE IF NOT EXISTS public.known_business_contact_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_contact_id uuid NOT NULL REFERENCES public.known_business_contacts(id) ON DELETE CASCADE,
  channel_type text NOT NULL,
  contact_label text,
  contact_email text,
  portal_url text,
  requires_account boolean NOT NULL DEFAULT false,
  service_types text[] NOT NULL DEFAULT '{}'::text[],
  confidence_level text NOT NULL DEFAULT 'medium',
  source_url text,
  last_verified_at timestamptz,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT known_business_contact_channels_channel_type_chk
    CHECK (channel_type IN ('email', 'portal', 'manual')),
  CONSTRAINT known_business_contact_channels_confidence_level_chk
    CHECK (confidence_level IN ('high', 'medium', 'low')),
  CONSTRAINT known_business_contact_channels_channel_payload_chk
    CHECK (
      (
        channel_type = 'email'
        AND contact_email IS NOT NULL
        AND length(trim(contact_email)) > 0
      )
      OR (
        channel_type = 'portal'
        AND portal_url IS NOT NULL
        AND length(trim(portal_url)) > 0
      )
      OR channel_type = 'manual'
    ),
  CONSTRAINT known_business_contact_channels_contact_email_format_chk
    CHECK (
      contact_email IS NULL
      OR position('@' in trim(contact_email)) > 1
    ),
  CONSTRAINT known_business_contact_channels_portal_url_format_chk
    CHECK (
      portal_url IS NULL
      OR portal_url ~* '^https?://'
    )
);

CREATE INDEX IF NOT EXISTS known_business_contact_channels_business_contact_id_idx
  ON public.known_business_contact_channels (business_contact_id);

CREATE INDEX IF NOT EXISTS known_business_contact_channels_channel_type_idx
  ON public.known_business_contact_channels (channel_type);

CREATE INDEX IF NOT EXISTS known_business_contact_channels_is_active_idx
  ON public.known_business_contact_channels (is_active);

CREATE INDEX IF NOT EXISTS known_business_contact_channels_service_types_gin_idx
  ON public.known_business_contact_channels USING gin (service_types);

CREATE UNIQUE INDEX IF NOT EXISTS known_business_contact_channels_active_identity_uq
  ON public.known_business_contact_channels (
    business_contact_id,
    channel_type,
    coalesce(contact_label, ''),
    coalesce(contact_email, ''),
    coalesce(portal_url, '')
  )
  WHERE is_active;

GRANT SELECT ON public.known_business_contact_channels TO authenticated;
GRANT ALL ON public.known_business_contact_channels TO service_role;

ALTER TABLE public.known_business_contact_channels ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'known_business_contact_channels'
      AND policyname = 'known_business_contact_channels_authenticated_read'
  ) THEN
    CREATE POLICY "known_business_contact_channels_authenticated_read"
      ON public.known_business_contact_channels
      FOR SELECT
      TO authenticated
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_known_business_contact_channels_updated_at'
      AND tgrelid = 'public.known_business_contact_channels'::regclass
  ) THEN
    CREATE TRIGGER update_known_business_contact_channels_updated_at
      BEFORE UPDATE ON public.known_business_contact_channels
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;