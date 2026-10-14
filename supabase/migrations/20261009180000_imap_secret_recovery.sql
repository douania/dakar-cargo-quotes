-- Recovery replaces only the credential reference of an existing configuration.
-- A new encryption operation never needs to decrypt the old Vault row.
BEGIN;
CREATE OR REPLACE FUNCTION public.replace_mailbox_secret(p_config_id uuid, p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_sid uuid; new_sid uuid;
BEGIN
  IF p_password IS NULL OR length(p_password) = 0 OR length(p_password) > 1024
     OR position(chr(10) in p_password) > 0 OR position(chr(13) in p_password) > 0 THEN
    RAISE EXCEPTION 'IMAP_SECRET_INVALID';
  END IF;
  SELECT password_secret_id INTO old_sid FROM public.email_configs
    WHERE id = p_config_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IMAP_CONFIG_MISSING'; END IF;
  new_sid := vault.create_secret(p_password,
    'imap-recovery-' || p_config_id::text || '-' || gen_random_uuid()::text, 'IMAP credential');
  UPDATE public.email_configs SET password_secret_id = new_sid, password_encrypted = NULL
    WHERE id = p_config_id;
  -- Metadata-only cleanup; absence is harmless and no decrypted view is accessed.
  DELETE FROM vault.secrets WHERE id = old_sid;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'IMAP_SECRET_REPLACE_FAILED';
END $$;
REVOKE ALL ON FUNCTION public.replace_mailbox_secret(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_mailbox_secret(uuid,text) TO service_role;
COMMIT;
