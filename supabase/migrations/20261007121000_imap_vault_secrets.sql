-- Installation seulement : ne déplace aucune valeur réelle à l'application.
-- migrate_legacy_imap_secrets() est une action séparée, sous GO, sans résultat secret.
BEGIN;
DO $$ BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'IMAP_VAULT prerequisite missing';
  END IF;
END $$;

ALTER TABLE public.email_configs ALTER COLUMN password_encrypted DROP NOT NULL;
ALTER TABLE public.email_configs ADD COLUMN password_secret_id uuid UNIQUE REFERENCES vault.secrets(id);
-- NOT VALID permet la transition des seules anciennes lignes. Tout nouvel INSERT/
-- UPDATE doit éliminer le clair ; le code déployé ne le lit jamais.
ALTER TABLE public.email_configs ADD CONSTRAINT imap_no_new_plaintext
  CHECK (password_encrypted IS NULL) NOT VALID;

CREATE OR REPLACE FUNCTION public.set_mailbox_secret(p_config_id uuid, p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE sid uuid;
BEGIN
  IF p_password IS NULL OR length(p_password) = 0 THEN RAISE EXCEPTION 'IMAP_SECRET_EMPTY'; END IF;
  SELECT password_secret_id INTO sid FROM public.email_configs WHERE id = p_config_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IMAP_CONFIG_MISSING'; END IF;
  IF sid IS NULL THEN
    sid := vault.create_secret(p_password, 'imap-config-' || p_config_id::text, 'IMAP credential');
  ELSE
    PERFORM vault.update_secret(sid, p_password);
  END IF;
  UPDATE public.email_configs SET password_secret_id = sid, password_encrypted = NULL WHERE id = p_config_id;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'IMAP_SECRET_STORE_FAILED'; -- ne restituer ni DETAIL ni valeur
END $$;

CREATE OR REPLACE FUNCTION public.read_mailbox_secret(p_config_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result text;
BEGIN
  SELECT s.decrypted_secret INTO result FROM public.email_configs c
    JOIN vault.decrypted_secrets s ON s.id = c.password_secret_id WHERE c.id = p_config_id;
  IF result IS NULL OR length(result) = 0 THEN RAISE EXCEPTION 'IMAP_SECRET_UNAVAILABLE'; END IF;
  RETURN result;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'IMAP_SECRET_UNAVAILABLE';
END $$;

CREATE OR REPLACE FUNCTION public.create_mailbox_config(p_config jsonb, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cid uuid; result jsonb;
BEGIN
  IF coalesce(p_config->>'name', '') = '' OR coalesce(p_config->>'host', '') = ''
     OR coalesce(p_config->>'username', '') = '' THEN RAISE EXCEPTION 'IMAP_CONFIG_INVALID'; END IF;
  INSERT INTO public.email_configs(name, host, port, username, folder, use_ssl)
    VALUES (p_config->>'name', p_config->>'host', coalesce((p_config->>'port')::integer, 993),
      p_config->>'username', coalesce(p_config->>'folder', 'INBOX'), coalesce((p_config->>'use_ssl')::boolean, true))
    RETURNING id INTO cid;
  PERFORM public.set_mailbox_secret(cid, p_password);
  SELECT to_jsonb(c) - 'password_encrypted' - 'password_secret_id' INTO result
    FROM public.email_configs c WHERE c.id = cid;
  RETURN result || jsonb_build_object('password_encrypted', '********');
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'IMAP_CONFIG_STORE_FAILED';
END $$;

CREATE OR REPLACE FUNCTION public.migrate_legacy_imap_secrets()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; migrated integer := 0;
BEGIN
  FOR c IN SELECT id, password_encrypted FROM public.email_configs
    WHERE password_encrypted IS NOT NULL FOR UPDATE LOOP
    -- Refuse une double source au lieu d'écraser un secret Vault déjà provisionné.
    IF EXISTS (SELECT 1 FROM public.email_configs WHERE id = c.id AND password_secret_id IS NOT NULL) THEN
      RAISE EXCEPTION 'IMAP_SECRET_CONFLICT';
    END IF;
    PERFORM public.set_mailbox_secret(c.id, c.password_encrypted);
    migrated := migrated + 1;
  END LOOP;
  ALTER TABLE public.email_configs VALIDATE CONSTRAINT imap_no_new_plaintext;
  RETURN migrated;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'IMAP_SECRET_MIGRATION_FAILED';
END $$;

CREATE OR REPLACE FUNCTION public.delete_mailbox_secret()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = OLD.password_secret_id;
  RETURN OLD;
END $$;
CREATE TRIGGER email_config_delete_secret AFTER DELETE ON public.email_configs
  FOR EACH ROW EXECUTE FUNCTION public.delete_mailbox_secret();

REVOKE ALL ON FUNCTION public.set_mailbox_secret(uuid,text), public.read_mailbox_secret(uuid),
  public.create_mailbox_config(jsonb,text), public.migrate_legacy_imap_secrets(), public.delete_mailbox_secret()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_mailbox_secret(uuid,text), public.read_mailbox_secret(uuid),
  public.create_mailbox_config(jsonb,text), public.migrate_legacy_imap_secrets() TO service_role;
-- Le seul chemin applicatif de déchiffrement est la RPC serveur ci-dessus.
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC, anon, authenticated;
-- Native crypto helpers already private can belong to the provider's reserved
-- role. Revoke existing client grants without administering those helpers.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid, p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'vault' AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) LOOP
    IF NOT has_function_privilege(current_user, f.oid, 'EXECUTE WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'IMAP_VAULT_CLIENT_GRANT_NOT_MANAGEABLE';
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'vault' AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )) THEN RAISE EXCEPTION 'IMAP_VAULT_CLIENT_EXECUTE_REMAINS'; END IF;
END $$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC, anon, authenticated;
COMMIT;
