-- LOCAL PREPARATION ONLY. No legacy adoption is seeded by this migration.
-- A reviewed legacy proof must be approved separately and bound to the exact
-- account snapshot, folder, UIDVALIDITY, UID, email UUID and real header ID.
CREATE TABLE public.email_imap_identities (
  email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  config_id uuid NOT NULL REFERENCES public.email_configs(id) ON DELETE CASCADE,
  account jsonb NOT NULL CHECK (jsonb_typeof(account) = 'object'),
  mailbox text NOT NULL CHECK (length(mailbox) > 0),
  uid_validity bigint NOT NULL CHECK (uid_validity BETWEEN 1 AND 4294967295),
  imap_uid bigint NOT NULL CHECK (imap_uid BETWEEN 1 AND 4294967295),
  message_id text NOT NULL CHECK (message_id ~ '^<[^<>[:space:]]+>$' AND message_id !~ '^<[0-9]+@imported>$'),
  root_message_id text NOT NULL CHECK (root_message_id ~ '^<[^<>[:space:]]+>$' AND root_message_id !~ '^<[0-9]+@imported>$'),
  source text NOT NULL CHECK (source IN ('native_import', 'reviewed_legacy')),
  legacy_message_id text,
  evidence_ref text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (config_id, mailbox, uid_validity, imap_uid),
  CHECK (source <> 'reviewed_legacy' OR
    (legacy_message_id IS NOT NULL AND evidence_ref IS NOT NULL AND
     legacy_message_id = '<' || imap_uid::text || '@imported>' AND length(evidence_ref) > 0))
);
CREATE INDEX email_imap_identities_email_idx ON public.email_imap_identities(email_id);
ALTER TABLE public.email_imap_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_imap_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.email_imap_identities TO service_role;

CREATE FUNCTION public.persist_imap_import_batch(
  p_config_id uuid, p_account jsonb, p_mailbox text, p_uid_validity bigint,
  p_root_message_id text, p_messages jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cfg public.email_configs%ROWTYPE;
  proof public.email_imap_identities%ROWTYPE;
  matched public.emails%ROWTYPE;
  legacy public.emails%ROWTYPE;
  item jsonb;
  actual_id text;
  uid_value bigint;
  target_thread uuid;
  linked_root text;
  resolved uuid[] := '{}';
  created uuid[] := '{}';
  output jsonb := '[]';
  changed boolean := false;
  inserted boolean;
  created_thread boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_uid_validity IS NULL OR p_uid_validity NOT BETWEEN 1 AND 4294967295 OR p_mailbox IS NULL OR p_mailbox = '' OR
     p_root_message_id IS NULL OR p_root_message_id !~ '^<[^<>[:space:]]+>$' OR
     p_root_message_id ~ '^<[0-9]+@imported>$' OR jsonb_typeof(p_messages) IS DISTINCT FROM 'array' OR
     jsonb_array_length(p_messages) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMPORT_IDENTITY';
  END IF;
  SELECT * INTO STRICT cfg FROM public.email_configs WHERE id = p_config_id FOR UPDATE;
  IF cfg.is_active IS DISTINCT FROM true OR p_mailbox IS DISTINCT FROM coalesce(nullif(cfg.folder, ''), 'INBOX') OR
     p_account IS DISTINCT FROM jsonb_build_object('host', cfg.host, 'port', cfg.port, 'username', cfg.username, 'use_ssl', cfg.use_ssl) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MAILBOX_SCOPE_CONFLICT';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE
    m->>'root_message_id' IS DISTINCT FROM p_root_message_id OR m->>'message_id' IS NULL OR
    m->>'message_id' !~ '^<[^<>[:space:]]+>$' OR m->>'message_id' ~ '^<[0-9]+@imported>$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MESSAGE_IDENTITY';
  END IF;
  -- Stable lock order protects the global historical message_id uniqueness.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imap-root:' || p_root_message_id, 0));
  FOR actual_id IN SELECT value->>'message_id' FROM jsonb_array_elements(p_messages) ORDER BY value->>'message_id' LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imap-message:' || actual_id, 0));
  END LOOP;
  IF (SELECT count(DISTINCT value->>'uid') FROM jsonb_array_elements(p_messages)) <> jsonb_array_length(p_messages) OR
     (SELECT count(DISTINCT value->>'message_id') FROM jsonb_array_elements(p_messages)) <> jsonb_array_length(p_messages) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AMBIGUOUS_IMPORT_BATCH';
  END IF;
  SELECT id INTO target_thread FROM public.email_threads WHERE root_message_id = p_root_message_id FOR UPDATE;
  IF target_thread IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.emails WHERE thread_ref = target_thread AND email_config_id IS DISTINCT FROM p_config_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'THREAD_SCOPE_CONFLICT';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
    actual_id := item->>'message_id'; uid_value := (item->>'uid')::bigint; inserted := false;
    IF actual_id IS NULL OR actual_id !~ '^<[^<>[:space:]]+>$' OR actual_id ~ '^<[0-9]+@imported>$' OR
       uid_value IS NULL OR uid_value NOT BETWEEN 1 AND 4294967295 OR
       item->>'root_message_id' IS DISTINCT FROM p_root_message_id THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MESSAGE_IDENTITY';
    END IF;
    SELECT * INTO proof FROM public.email_imap_identities
      WHERE config_id = p_config_id AND mailbox = p_mailbox AND uid_validity = p_uid_validity AND imap_uid = uid_value FOR UPDATE;
    IF FOUND AND (proof.account IS DISTINCT FROM p_account OR proof.message_id IS DISTINCT FROM actual_id OR
       proof.root_message_id IS DISTINCT FROM p_root_message_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IDENTITY_SCOPE_CONFLICT';
    END IF;
    SELECT * INTO matched FROM public.emails WHERE message_id = actual_id FOR UPDATE;
    IF matched.id IS NOT NULL AND matched.email_config_id IS DISTINCT FROM p_config_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MESSAGE_CONFIG_CONFLICT';
    END IF;
    SELECT * INTO legacy FROM public.emails
      WHERE email_config_id = p_config_id AND message_id = '<' || uid_value::text || '@imported>' FOR UPDATE;
    IF matched.id IS NOT NULL AND legacy.id IS NOT NULL AND matched.id <> legacy.id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AMBIGUOUS_LEGACY_IDENTITY';
    END IF;
    IF proof.email_id IS NOT NULL THEN
      IF matched.id IS NOT NULL AND matched.id <> proof.email_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AMBIGUOUS_IDENTITY_PROOF';
      END IF;
      SELECT * INTO STRICT matched FROM public.emails WHERE id = proof.email_id FOR UPDATE;
      IF matched.email_config_id IS DISTINCT FROM p_config_id OR
         (matched.message_id IS DISTINCT FROM actual_id AND
          (proof.source <> 'reviewed_legacy' OR matched.message_id IS DISTINCT FROM proof.legacy_message_id)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_IDENTITY_PROOF';
      END IF;
    ELSIF legacy.id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_ADOPTION_REQUIRED';
    END IF;
    IF matched.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.email_imap_identities i WHERE i.email_id = matched.id AND
      (i.config_id IS DISTINCT FROM p_config_id OR i.account IS DISTINCT FROM p_account OR i.mailbox IS DISTINCT FROM p_mailbox)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MESSAGE_MAILBOX_CONFLICT';
    END IF;
    IF matched.thread_id IS NOT NULL AND matched.thread_id IS DISTINCT FROM p_root_message_id THEN
      IF matched.thread_id ~ '^<[^<>[:space:]]+>$' AND matched.thread_id !~ '^<[0-9]+@imported>$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGITIMATE_ROOT_CONFLICT';
      ELSIF proof.source IS DISTINCT FROM 'reviewed_legacy' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGACY_ROOT_ADOPTION_REQUIRED';
      END IF;
    END IF;
    IF matched.thread_ref IS NOT NULL THEN
      SELECT root_message_id INTO linked_root FROM public.email_threads WHERE id = matched.thread_ref FOR UPDATE;
      IF linked_root IS DISTINCT FROM p_root_message_id OR (target_thread IS NOT NULL AND target_thread <> matched.thread_ref) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEGITIMATE_THREAD_CONFLICT';
      END IF;
      target_thread := matched.thread_ref;
    END IF;
    IF matched.id IS NULL THEN
      INSERT INTO public.emails(email_config_id, message_id, thread_id, from_address, to_addresses,
        subject, body_text, body_html, sent_at, is_quotation_request, extracted_data)
      VALUES (p_config_id, actual_id, p_root_message_id, item->>'from_address',
        ARRAY(SELECT jsonb_array_elements_text(item->'to_addresses')), item->>'subject',
        item->>'body_text', item->>'body_html', (item->>'sent_at')::timestamptz,
        coalesce((item->>'is_quotation_request')::boolean, false), item->'extracted_data') RETURNING * INTO matched;
      created := array_append(created, matched.id); inserted := true; changed := true;
    ELSE
      -- Identity-only adoption. No body, attachment, extracted data or case write.
      IF matched.message_id IS DISTINCT FROM actual_id OR matched.thread_id IS DISTINCT FROM p_root_message_id THEN
        UPDATE public.emails SET message_id = actual_id, thread_id = p_root_message_id WHERE id = matched.id;
        changed := true;
      END IF;
    END IF;
    IF proof.email_id IS NULL THEN
      INSERT INTO public.email_imap_identities(email_id, config_id, account, mailbox, uid_validity, imap_uid, message_id, root_message_id, source)
        VALUES(matched.id, p_config_id, p_account, p_mailbox, p_uid_validity, uid_value, actual_id, p_root_message_id, 'native_import');
    END IF;
    resolved := array_append(resolved, matched.id);
    output := output || jsonb_build_array(jsonb_build_object('id', matched.id, 'uid', uid_value, 'created', inserted));
  END LOOP;
  IF target_thread IS NULL THEN
    INSERT INTO public.email_threads(root_message_id, subject_normalized, status, email_count, is_quotation_thread)
      VALUES(p_root_message_id, lower(trim(regexp_replace(coalesce(p_messages->0->>'subject', ''), '\s+', ' ', 'g'))),
        'active', 0, EXISTS(SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE
          coalesce((m->>'is_quotation_request')::boolean, false)) OR EXISTS(
          SELECT 1 FROM unnest(ARRAY['dap','cif','fob','exw','cfr','cpt','cip','ddp','cotation','quotation','devis','rfq','tarif',
          'fret','freight','transport','conteneur','container']) keyword
          WHERE lower(coalesce(p_messages->0->>'subject', '')) LIKE '%' || keyword || '%')) RETURNING id INTO target_thread;
    created_thread := true;
    changed := true;
  END IF;
  UPDATE public.emails SET thread_ref = target_thread WHERE id = ANY(resolved) AND thread_ref IS NULL;
  changed := changed OR FOUND;
  -- Refresh only if this transaction changed identities/links; preserve status,
  -- quotation classification, root, historical cases and operator metadata.
  IF changed THEN
    UPDATE public.email_threads t SET
      email_count = (SELECT count(*) FROM public.emails e WHERE e.thread_ref = t.id),
      first_message_at = (SELECT min(sent_at) FROM public.emails e WHERE e.thread_ref = t.id),
      last_message_at = (SELECT max(sent_at) FROM public.emails e WHERE e.thread_ref = t.id),
      updated_at = now() WHERE t.id = target_thread;
  END IF;
  IF created_thread THEN
    UPDATE public.email_threads t SET participants = (SELECT coalesce(jsonb_agg(jsonb_build_object('email', address, 'role', 'participant')), '[]')
      FROM (SELECT DISTINCT unnest(ARRAY[e.from_address] || coalesce(e.to_addresses, '{}') || coalesce(e.cc_addresses, '{}')) address
        FROM public.emails e WHERE e.thread_ref = t.id) a WHERE address IS NOT NULL AND address <> '') WHERE t.id = target_thread;
  END IF;
  RETURN jsonb_build_object('emails', output, 'thread_ref', target_thread, 'thread_id', p_root_message_id);
END;
$$;
REVOKE ALL ON FUNCTION public.persist_imap_import_batch(uuid,jsonb,text,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_imap_import_batch(uuid,jsonb,text,bigint,text,jsonb) TO service_role;
