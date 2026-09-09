-- =============================================================================
-- H2-d2-A — Codes de ligne d'honoraires : interdiction des clés de service
-- réservées par le moteur de chiffrage.
-- GO CTO SODATRA du 9 septembre 2026 (« go H2-d »).
--
-- Contexte : depuis H2-c2, le code d'une ligne `fee_lines` devient une CLÉ DE
-- SERVICE (`canonical.service_key`) dans les lignes de chiffrage. Un code qui
-- collisionne avec une clé déjà émise par `quotation-engine` ou servie par
-- `price-service-lines` produirait, selon les cas :
--   * une double facturation (ligne structurelle + ligne d'honoraires) ;
--   * ou une disparition silencieuse par déduplication (`dedup_group`).
-- L'écran H2-d1 filtre déjà ces codes, mais un filtre d'écran est contournable
-- (SQL direct, autre client). Ce patch porte le garde-fou en base.
--
-- Trois familles de codes réservés :
--   1. clés servies par price-service-lines (VALID_SERVICE_KEYS) et libellées
--      par run-pricing (SERVICE_KEY_LABELS) ;
--   2. clés structurelles fixes des couches d'enrichissement de run-pricing
--      (PAD_DROIT_PASSAGE, TERMINAL_STORAGE_PROVISION_ESTIMATE, CMA_CGM_COMM)
--      et groupes de déduplication de DEDUP_GROUP_MAP (TERMINAL_HANDLING,
--      TERMINAL_STORAGE, SUIVI_OPERATIONNEL, OUVERTURE_DOSSIER,
--      FRAIS_DOCUMENTATION, DEDOUANEMENT) ;
--   3. clés DYNAMIQUES de la couche `enrichment_carrier_charges`, de la forme
--      `<compagnie normalisée>_<code de charge>` construites à l'exécution
--      depuis `carrier_billing_templates` — non énumérables statiquement, d'où
--      un trigger (qui peut interroger une autre table) plutôt qu'un CHECK.
--
-- EXCEPTION VOULUE : `AGENCY` et `CUSTOMS_DAKAR` restent autorisés. Ce sont
-- précisément les deux honoraires internes que ce modèle sert depuis H2-c
-- (INTERNAL_FEE_SERVICE_KEYS) ; ils existent déjà dans `fee_lines` et le
-- moteur n'émet plus de ligne structurelle pour eux depuis HONORAIRES-1.
--
-- Limite assumée : le garde-fou s'applique à l'écriture de `fee_lines`. Un
-- template compagnie créé APRÈS une ligne d'honoraires de même code ne
-- déclenche pas de contrôle rétroactif (cas jugé improbable : les codes de
-- charge compagnie sont préfixés du nom de compagnie).
--
-- Idempotent : CREATE OR REPLACE / DROP TRIGGER IF EXISTS. Aucune donnée
-- modifiée. Rollback : DROP TRIGGER trg_fee_lines_reject_reserved_code ON
-- public.fee_lines; DROP FUNCTION public.fee_line_code_is_reserved(text);
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.fee_lines') IS NULL THEN
    RAISE EXCEPTION '[H2-d2] STOP — public.fee_lines absente. Appliquer 20260909120000_h2a_fee_lines_rules_clients.sql avant H2-d2.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Normalisation d'un code compagnie, miroir exact de normalizeCarrierCode()
--    (supabase/functions/run-pricing/index.ts) : majuscules, tout caractère non
--    alphanumérique remplacé par « _ », « _ » de bordure retirés, et le cas
--    particulier CMACGM → CMA_CGM.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_carrier_code(p_carrier text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN normalized = 'CMACGM' THEN 'CMA_CGM'
    ELSE normalized
  END
  FROM (
    SELECT btrim(
             regexp_replace(upper(coalesce(p_carrier, '')), '[^A-Z0-9]+', '_', 'g'),
             '_'
           ) AS normalized
  ) s;
$$;

COMMENT ON FUNCTION public.normalize_carrier_code(text) IS
  'H2-d2 : miroir SQL de normalizeCarrierCode() de run-pricing. Sert à reconstituer les clés de service dynamiques <compagnie>_<code de charge> de la couche enrichment_carrier_charges.';

-- ---------------------------------------------------------------------------
-- 2. Un code de ligne d'honoraires est-il réservé par le moteur ?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fee_line_code_is_reserved(p_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  code text := upper(btrim(coalesce(p_code, '')));
BEGIN
  IF code = '' THEN
    RETURN false;
  END IF;

  -- Honoraires internes légitimes : ce modèle EST leur source (H2-c).
  IF code IN ('AGENCY', 'CUSTOMS_DAKAR') THEN
    RETURN false;
  END IF;

  -- Familles 1 et 2 : clés fixes.
  IF code = ANY (ARRAY[
    -- price-service-lines : VALID_SERVICE_KEYS / run-pricing : SERVICE_KEY_LABELS
    'DTHC', 'ON_CARRIAGE', 'EMPTY_RETURN', 'DISCHARGE',
    'PORT_CHARGES', 'TRUCKING', 'CUSTOMS', 'PORT_DAKAR_HANDLING',
    'CUSTOMS_EXPORT', 'BORDER_FEES', 'SURVEY', 'CUSTOMS_BAMAKO',
    'TRANSIT_DOCS', 'AIR_HANDLING', 'AIR_FREIGHT',
    'PICKUP_ORIGIN', 'PRE_CARRIAGE', 'SEA_FREIGHT',
    'THC_EXPORT', 'DOCUMENTATION_BL', 'VGM_WEIGHING',
    'STUFFING_FACTORY', 'STUFFING_CFS', 'EMPTY_REPO',
    -- run-pricing : couches d'enrichissement structurelles
    'PAD_DROIT_PASSAGE', 'TERMINAL_STORAGE_PROVISION_ESTIMATE', 'CMA_CGM_COMM',
    -- run-pricing : DEDUP_GROUP_MAP (une collision de groupe fait disparaître
    -- silencieusement une ligne à la déduplication)
    'TERMINAL_HANDLING', 'TERMINAL_STORAGE',
    'SUIVI_OPERATIONNEL', 'OUVERTURE_DOSSIER', 'FRAIS_DOCUMENTATION', 'DEDOUANEMENT'
  ]) THEN
    RETURN true;
  END IF;

  -- Famille 3 : clés dynamiques <compagnie>_<code de charge>.
  IF to_regclass('public.carrier_billing_templates') IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.carrier_billing_templates t
      WHERE coalesce(t.is_active, false)
        AND public.normalize_carrier_code(t.carrier) || '_' || upper(btrim(coalesce(t.charge_code, ''))) = code
    );
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.fee_line_code_is_reserved(text) IS
  'H2-d2 : vrai si le code entrerait en collision avec une clé de service émise par quotation-engine / run-pricing ou servie par price-service-lines. AGENCY et CUSTOMS_DAKAR sont explicitement autorisés (honoraires internes servis par ce modèle depuis H2-c). À tenir synchronisé avec VALID_SERVICE_KEYS, SERVICE_KEY_LABELS et DEDUP_GROUP_MAP.';

-- ---------------------------------------------------------------------------
-- 3. Précheck : aucune ligne existante ne doit violer la règle (sinon le
--    trigger bloquerait toute mise à jour ultérieure de cette ligne).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(code, ', ' ORDER BY code) INTO offending
  FROM public.fee_lines
  WHERE public.fee_line_code_is_reserved(code);

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION '[H2-d2] STOP — lignes d''honoraires existantes portant un code réservé : %. Renommer ces lignes avant d''appliquer le garde-fou.', offending;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Trigger de refus.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fee_lines_reject_reserved_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.fee_line_code_is_reserved(NEW.code) THEN
    RAISE EXCEPTION '[H2-d2] Code refusé : « % » est déjà une clé de service du moteur de chiffrage (ligne structurelle, catalogue ou charge compagnie). Choisissez un autre code pour cette ligne d''honoraires.', NEW.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fee_lines_reject_reserved_code ON public.fee_lines;
CREATE TRIGGER trg_fee_lines_reject_reserved_code
  BEFORE INSERT OR UPDATE OF code ON public.fee_lines
  FOR EACH ROW EXECUTE FUNCTION public.fee_lines_reject_reserved_code();
