-- Remove only the synthetic Auth owner created for a fresh MAP-6 reset.
-- The preceding historical MAP-6 cleanup removes every dependent sandbox row.
-- A real user with the same UUID is never deleted because the reset marker and
-- fixture email must both match.

DO $$
DECLARE
  c_owner_id       CONSTANT UUID := 'e3999a32-8aec-4318-bef0-6c2a9453d8e3';
  c_fixture_email  CONSTANT TEXT := 'map6-reset-fixture-e3999a32@invalid.local';
  v_deleted_count  INT;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'MAP-6 owner cleanup abort: auth.users is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = c_owner_id) THEN
    RAISE NOTICE 'MAP-6 owner cleanup: owner absent — no-op';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = c_owner_id
      AND email = c_fixture_email
      AND COALESCE((raw_user_meta_data ->> 'codex_map6_reset_fixture')::BOOLEAN, false)
  ) THEN
    RAISE NOTICE 'MAP-6 owner cleanup: existing owner is not the reset fixture — no-op';
    RETURN;
  END IF;

  DELETE FROM auth.users
  WHERE id = c_owner_id
    AND email = c_fixture_email
    AND COALESCE((raw_user_meta_data ->> 'codex_map6_reset_fixture')::BOOLEAN, false);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'MAP-6 owner cleanup abort: deleted %, expected 1', v_deleted_count;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = c_owner_id) THEN
    RAISE EXCEPTION 'MAP-6 owner cleanup abort: reset fixture still exists';
  END IF;

  RAISE NOTICE 'MAP-6 owner cleanup: synthetic reset-only Auth owner removed';
END;
$$ LANGUAGE plpgsql;
