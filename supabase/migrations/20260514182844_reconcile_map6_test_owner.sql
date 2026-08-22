-- Provide the owner fixture required by the historical MAP-6 test migration.
--
-- Fresh rebuilds have no Auth users, while the historical test hard-codes an
-- owner UUID. Current Lovable has already applied the test migration under
-- version 20260514182845, so this backfilled prerequisite must be a strict
-- no-op there. The local historical filename uses version 20260514182847.

DO $$
DECLARE
  c_owner_id       CONSTANT UUID := 'e3999a32-8aec-4318-bef0-6c2a9453d8e3';
  c_fixture_email  CONSTANT TEXT := 'map6-reset-fixture-e3999a32@invalid.local';
  v_blocker_applied BOOLEAN;
  v_user_exists     BOOLEAN;
  v_fixture_matches BOOLEAN;
  v_inserted_count  INT;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'MAP-6 owner prerequisite abort: auth.users is missing';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'MAP-6 owner prerequisite abort: migration ledger is missing';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260514182845', '20260514182847')
  ) INTO v_blocker_applied;

  -- Lovable/current or any environment that already ran MAP-6: zero writes.
  IF v_blocker_applied THEN
    RAISE NOTICE 'MAP-6 owner prerequisite: historical test already applied — no-op';
    RETURN;
  END IF;

  SELECT
    EXISTS (SELECT 1 FROM auth.users WHERE id = c_owner_id),
    EXISTS (
      SELECT 1
      FROM auth.users
      WHERE id = c_owner_id
        AND email = c_fixture_email
        AND COALESCE((raw_user_meta_data ->> 'codex_map6_reset_fixture')::BOOLEAN, false)
    )
  INTO v_user_exists, v_fixture_matches;

  IF v_user_exists THEN
    -- A real historical owner is also a valid pre-state. Never overwrite it.
    IF v_fixture_matches THEN
      RAISE NOTICE 'MAP-6 owner prerequisite: exact reset fixture already present — no-op';
    ELSE
      RAISE NOTICE 'MAP-6 owner prerequisite: owner already exists without reset marker — no-op';
    END IF;
    RETURN;
  END IF;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    c_owner_id,
    'authenticated',
    'authenticated',
    c_fixture_email,
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"codex_map6_reset_fixture":true,"purpose":"migration_reset_only"}'::JSONB,
    now(),
    now()
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <> 1 THEN
    RAISE EXCEPTION 'MAP-6 owner prerequisite abort: inserted %, expected 1', v_inserted_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = c_owner_id
      AND email = c_fixture_email
      AND COALESCE((raw_user_meta_data ->> 'codex_map6_reset_fixture')::BOOLEAN, false)
  ) THEN
    RAISE EXCEPTION 'MAP-6 owner prerequisite abort: reset fixture post-check failed';
  END IF;

  RAISE NOTICE 'MAP-6 owner prerequisite: synthetic reset-only Auth owner inserted';
END;
$$ LANGUAGE plpgsql;
