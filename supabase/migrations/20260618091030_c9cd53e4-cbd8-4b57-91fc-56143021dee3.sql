-- MULTI-CARGO-LINES-ARCHITECTURE-1 / Phase 2-J : RPC d'écriture canoniques (additif)
--
-- Crée DEUX fonctions RPC service_role-only pour écrire dans les tables
-- canoniques cargo_lines / cargo_equipment (créées en Phase 2-A, migration
-- 20260617120000_multi_cargo_canonical_tables_p2a.sql) :
--   * public.upsert_cargo_line       — upsert + supersession temporelle d'une ligne cargo
--   * public.upsert_cargo_equipment  — upsert idempotent d'un équipement / conteneur
--
-- PORTÉE STRICTEMENT ADDITIVE :
--   * AUCUNE table modifiée, AUCUNE colonne ajoutée, AUCUN index ajouté.
--   * AUCUNE policy RLS des tables modifiée (les policies SELECT équipe de la
--     Phase 2-A restent intactes).
--   * Les écritures passent par service_role uniquement (SECURITY DEFINER +
--     grant EXECUTE service_role exclusivement). Ni anon ni authenticated ne
--     reçoivent EXECUTE.
--
-- Convention SECURITY DEFINER : `SET search_path = public, pg_temp` fige la résolution
-- de schéma (durcissement anti-search_path-hijack, aligné sur les fonctions
-- SECURITY DEFINER existantes du projet).
--
-- ─────────────────────────────────────────────────────────────────────────
-- NOTE SIGNATURE upsert_cargo_equipment :
--   La signature "recommandée" plaçait p_cargo_line_id (DEFAULT NULL) AVANT
--   p_equipment_type / p_quantity (sans défaut). PostgreSQL l'interdit :
--   « input parameters after one with a default value must also have defaults ».
--   L'ordre recommandé est CONSERVÉ ; p_equipment_type et p_quantity reçoivent
--   donc DEFAULT NULL. Leur caractère obligatoire est garanti par les
--   validations runtime (RAISE EXCEPTION si NULL/vide/<=0). Les appels se font
--   par paramètres nommés : l'ordre n'a aucun impact fonctionnel.
-- ─────────────────────────────────────────────────────────────────────────
--
-- ROLLBACK (à exécuter manuellement, jamais en cloud sans GO CTO) :
--   DROP FUNCTION IF EXISTS public.upsert_cargo_equipment(uuid, uuid, text, integer, text, uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.upsert_cargo_line(uuid, integer, text, text, text, numeric, text, numeric, numeric, numeric, uuid, uuid, text, uuid);
--   -- NE JAMAIS dropper : cargo_lines, cargo_equipment, quote_cases,
--   --                     quote_facts, quote_request_lines.

-- =====================================================================
-- RPC 1 : public.upsert_cargo_line
--   Upsert d'une ligne cargo courante (is_current = true) au niveau dossier,
--   avec supersession temporelle optionnelle (modèle is_current aligné quote_facts).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.upsert_cargo_line(
  p_case_id uuid,
  p_line_index integer,
  p_status text DEFAULT 'to_confirm',
  p_description text DEFAULT NULL,
  p_hs_code text DEFAULT NULL,
  p_value_number numeric DEFAULT NULL,
  p_value_currency text DEFAULT NULL,
  p_weight_kg numeric DEFAULT NULL,
  p_volume_cbm numeric DEFAULT NULL,
  p_pieces_count numeric DEFAULT NULL,
  p_source_quote_request_line_id uuid DEFAULT NULL,
  p_source_email_id uuid DEFAULT NULL,
  p_source_excerpt text DEFAULT NULL,
  p_supersedes_cargo_line_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
  v_old_case_id uuid;
BEGIN
  -- ── Validations d'entrée ──
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'upsert_cargo_line: p_case_id ne peut pas être NULL';
  END IF;
  IF p_line_index IS NULL OR p_line_index < 1 THEN
    RAISE EXCEPTION 'upsert_cargo_line: p_line_index doit être >= 1 (reçu: %)', p_line_index;
  END IF;
  -- 'superseded' n'est JAMAIS un statut d'entrée valide pour une ligne courante.
  IF p_status IS NULL OR p_status NOT IN ('to_confirm', 'confirmed') THEN
    RAISE EXCEPTION
      'upsert_cargo_line: p_status invalide (reçu: %). Valeurs acceptées en entrée: to_confirm, confirmed',
      p_status;
  END IF;

  -- ── Verrou transactionnel sur (case_id, line_index) ──
  -- Sérialise les upserts/supersessions concurrents sur la même position
  -- logique ; protège l'index partiel uq_cargo_lines_current_line. Libéré en
  -- fin de transaction (xact).
  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text), p_line_index);

  -- ════════════════════════════════════════════════════════════════════
  -- CAS A — Sans supersession (p_supersedes_cargo_line_id IS NULL)
  -- ════════════════════════════════════════════════════════════════════
  IF p_supersedes_cargo_line_id IS NULL THEN
    SELECT id INTO v_existing_id
    FROM cargo_lines
    WHERE case_id = p_case_id
      AND line_index = p_line_index
      AND is_current = true
    LIMIT 1;

    IF FOUND THEN
      -- UPDATE de la ligne courante existante. is_current et
      -- supersedes_cargo_line_id sont PRÉSERVÉS (jamais écrasés ici).
      UPDATE cargo_lines SET
        status = p_status,
        description = p_description,
        hs_code = p_hs_code,
        value_number = p_value_number,
        value_currency = p_value_currency,
        weight_kg = p_weight_kg,
        volume_cbm = p_volume_cbm,
        pieces_count = p_pieces_count,
        source_quote_request_line_id = p_source_quote_request_line_id,
        source_email_id = p_source_email_id,
        source_excerpt = p_source_excerpt,
        updated_at = now()
      WHERE id = v_existing_id;
      RETURN v_existing_id;
    END IF;

    -- Aucune ligne courante : INSERT.
    INSERT INTO cargo_lines (
      case_id, line_index, status, description, hs_code, value_number,
      value_currency, weight_kg, volume_cbm, pieces_count,
      source_quote_request_line_id, source_email_id, source_excerpt,
      supersedes_cargo_line_id, is_current
    ) VALUES (
      p_case_id, p_line_index, p_status, p_description, p_hs_code, p_value_number,
      p_value_currency, p_weight_kg, p_volume_cbm, p_pieces_count,
      p_source_quote_request_line_id, p_source_email_id, p_source_excerpt,
      NULL, true
    )
    RETURNING id INTO v_new_id;
    RETURN v_new_id;
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- CAS B — Avec supersession (p_supersedes_cargo_line_id IS NOT NULL)
  -- ════════════════════════════════════════════════════════════════════

  -- L'ancienne ligne doit appartenir AU MÊME dossier.
  SELECT case_id INTO v_old_case_id
  FROM cargo_lines
  WHERE id = p_supersedes_cargo_line_id;

  IF v_old_case_id IS NULL THEN
    RAISE EXCEPTION
      'upsert_cargo_line: ligne à superséder introuvable (p_supersedes_cargo_line_id=%)',
      p_supersedes_cargo_line_id;
  END IF;
  IF v_old_case_id <> p_case_id THEN
    RAISE EXCEPTION
      'upsert_cargo_line: la ligne à superséder (%) appartient au dossier % et non à %',
      p_supersedes_cargo_line_id, v_old_case_id, p_case_id;
  END IF;

  -- Idempotence supersession : une ligne courante pointant déjà vers cette
  -- ancienne ligne à cette position existe-t-elle ? Si oui, on met à jour ses
  -- données et on la retourne (pas de nouvelle supersession).
  SELECT id INTO v_existing_id
  FROM cargo_lines
  WHERE case_id = p_case_id
    AND line_index = p_line_index
    AND is_current = true
    AND supersedes_cargo_line_id = p_supersedes_cargo_line_id
  LIMIT 1;

  IF FOUND THEN
    UPDATE cargo_lines SET
      status = p_status,
      description = p_description,
      hs_code = p_hs_code,
      value_number = p_value_number,
      value_currency = p_value_currency,
      weight_kg = p_weight_kg,
      volume_cbm = p_volume_cbm,
      pieces_count = p_pieces_count,
      source_quote_request_line_id = p_source_quote_request_line_id,
      source_email_id = p_source_email_id,
      source_excerpt = p_source_excerpt,
      updated_at = now()
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  -- Superséder l'ancienne ligne D'ABORD (libère le créneau de l'index partiel
  -- uq_cargo_lines_current_line si l'ancienne ligne occupait cette position),
  -- puis insérer la nouvelle ligne courante.
  UPDATE cargo_lines SET
    status = 'superseded',
    is_current = false,
    updated_at = now()
  WHERE id = p_supersedes_cargo_line_id;

  INSERT INTO cargo_lines (
    case_id, line_index, status, description, hs_code, value_number,
    value_currency, weight_kg, volume_cbm, pieces_count,
    source_quote_request_line_id, source_email_id, source_excerpt,
    supersedes_cargo_line_id, is_current
  ) VALUES (
    p_case_id, p_line_index, p_status, p_description, p_hs_code, p_value_number,
    p_value_currency, p_weight_kg, p_volume_cbm, p_pieces_count,
    p_source_quote_request_line_id, p_source_email_id, p_source_excerpt,
    p_supersedes_cargo_line_id, true
  )
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;

-- =====================================================================
-- RPC 2 : public.upsert_cargo_equipment
--   Upsert idempotent d'un équipement / conteneur. cargo_line_id nullable
--   (équipement de dossier / partagé non alloué quand NULL).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.upsert_cargo_equipment(
  p_case_id uuid,
  p_cargo_line_id uuid DEFAULT NULL,
  p_equipment_type text DEFAULT NULL,
  p_quantity integer DEFAULT NULL,
  p_status text DEFAULT 'to_confirm',
  p_source_quote_request_line_id uuid DEFAULT NULL,
  p_source_email_id uuid DEFAULT NULL,
  p_source_excerpt text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
  v_line_exists boolean;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'upsert_cargo_equipment: p_case_id ne peut pas être NULL';
  END IF;
  IF p_equipment_type IS NULL OR length(trim(p_equipment_type)) = 0 THEN
    RAISE EXCEPTION 'upsert_cargo_equipment: p_equipment_type ne peut pas être vide';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'upsert_cargo_equipment: p_quantity doit être > 0 (reçu: %)', p_quantity;
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('to_confirm', 'confirmed', 'superseded') THEN
    RAISE EXCEPTION
      'upsert_cargo_equipment: p_status invalide (reçu: %). Valeurs acceptées: to_confirm, confirmed, superseded',
      p_status;
  END IF;

  IF p_cargo_line_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM cargo_lines
      WHERE id = p_cargo_line_id AND case_id = p_case_id
    ) INTO v_line_exists;
    IF NOT v_line_exists THEN
      RAISE EXCEPTION
        'upsert_cargo_equipment: cargo_line introuvable (id=%) dans le dossier %',
        p_cargo_line_id, p_case_id;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_case_id::text
      || '|' || COALESCE(p_cargo_line_id::text, '')
      || '|' || lower(trim(p_equipment_type))
      || '|' || COALESCE(p_source_quote_request_line_id::text, ''),
      0
    )
  );

  SELECT id INTO v_existing_id
  FROM cargo_equipment
  WHERE case_id = p_case_id
    AND cargo_line_id IS NOT DISTINCT FROM p_cargo_line_id
    AND lower(trim(equipment_type)) = lower(trim(p_equipment_type))
    AND source_quote_request_line_id IS NOT DISTINCT FROM p_source_quote_request_line_id
  LIMIT 1;

  IF FOUND THEN
    UPDATE cargo_equipment SET
      quantity = p_quantity,
      status = p_status,
      source_email_id = p_source_email_id,
      source_excerpt = p_source_excerpt,
      updated_at = now()
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO cargo_equipment (
    case_id, cargo_line_id, equipment_type, quantity, status,
    source_quote_request_line_id, source_email_id, source_excerpt
  ) VALUES (
    p_case_id, p_cargo_line_id, p_equipment_type, p_quantity, p_status,
    p_source_quote_request_line_id, p_source_email_id, p_source_excerpt
  )
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;

-- =====================================================================
-- GRANTS SÉCURITÉ
-- =====================================================================
REVOKE ALL ON FUNCTION public.upsert_cargo_line(uuid, integer, text, text, text, numeric, text, numeric, numeric, numeric, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_cargo_line(uuid, integer, text, text, text, numeric, text, numeric, numeric, numeric, uuid, uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_cargo_line(uuid, integer, text, text, text, numeric, text, numeric, numeric, numeric, uuid, uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_cargo_line(uuid, integer, text, text, text, numeric, text, numeric, numeric, numeric, uuid, uuid, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_cargo_equipment(uuid, uuid, text, integer, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_cargo_equipment(uuid, uuid, text, integer, text, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_cargo_equipment(uuid, uuid, text, integer, text, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_cargo_equipment(uuid, uuid, text, integer, text, uuid, uuid, text) TO service_role;