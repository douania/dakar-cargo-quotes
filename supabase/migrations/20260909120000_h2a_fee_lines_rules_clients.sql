-- =============================================================================
-- H2-a — HONORAIRES PARAMÉTRABLES : modèle dédié, registre clients, rôle admin
-- GO CTO SODATRA du 9 septembre 2026 (« go H2-a avec tes recommandations »).
--
-- Contexte : HONORAIRES-1 (9 septembre) a ramené les honoraires internes à une
-- source unique lue par price-service-lines (pricing_rate_cards AGENCY /
-- CUSTOMS_DAKAR). Les rate cards sont conçues pour les débours tiers adossés à
-- une pièce ; l'administrateur doit pouvoir créer librement des lignes
-- d'honoraires et leurs règles (forfait, par conteneur 20'/40', par tonne,
-- pourcentage de la valeur, conditions cumulatives, client). Ce patch crée le
-- modèle. Aucune fonction Edge ne le lit encore : la bascule de la lecture est
-- le sous-lot H2-c, l'écran le sous-lot H2-d. Les rate cards restent servies
-- jusqu'à H2-c.
--
-- Doctrine encodée ici (décisions CTO 9 septembre) :
--   * une règle = conditions toutes facultatives et CUMULATIVES ; NULL = indifférent ;
--   * le OU s'exprime par plusieurs règles DISJOINTES sous la même ligne ;
--     un trigger refuse à l'enregistrement deux règles actives d'une même ligne
--     qui pourraient s'appliquer au même dossier (même scope client) ;
--   * les règles client (client_code renseigné) coexistent avec les règles
--     génériques : le résolveur fera primer la règle client (H2-b) ;
--   * tranches [min, max) : borne haute exclusive, NULL = sans borne ;
--   * par conteneur : deux montants 20' et 40' sur la MÊME règle ;
--   * pourcentage : assiette CAF ou valeur marchandise ; assiette absente au
--     runtime ⇒ « à confirmer », jamais 0 (H2-b) ;
--   * versionnement par date d'effet, jamais de modification en place d'un
--     montant déjà utilisé (discipline d'écran H2-d, supersedes_rule_id) ;
--   * écriture réservée au rôle tariff_admin (app_roles), miroir du précédent
--     PAD-C2 (has_pad_admin_role) ; lecture pour tout utilisateur authentifié.
--
-- Idempotent : CREATE IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS ;
-- amorçage protégé par ON CONFLICT et NOT EXISTS. Aucune donnée existante
-- modifiée. Rollback : DROP des trois tables, du trigger et de la fonction.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Précheck : app_roles et update_updated_at_column doivent exister.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.app_roles') IS NULL THEN
    RAISE EXCEPTION '[H2-a] STOP — public.app_roles absente. Appliquer 20260620130000_pad_c2_app_roles.sql avant H2-a.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column') THEN
    RAISE EXCEPTION '[H2-a] STOP — public.update_updated_at_column() absente.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Rôle tariff_admin — même patron que public.has_pad_admin_role().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_tariff_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_roles
    WHERE user_id = auth.uid()
      AND role = 'tariff_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.has_tariff_admin_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_tariff_admin_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.has_tariff_admin_role() TO authenticated;

COMMENT ON FUNCTION public.has_tariff_admin_role() IS
  'H2-a : vrai si l''utilisateur appelant porte le rôle tariff_admin dans app_roles. Attribution par SQL en service_role uniquement : INSERT INTO public.app_roles (user_id, role, created_by) VALUES (<uuid>, ''tariff_admin'', <uuid>).';

-- ---------------------------------------------------------------------------
-- 2. Registre clients.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
  code          text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  legal_name    text NOT NULL CHECK (btrim(legal_name) <> ''),
  ninea         text UNIQUE CHECK (ninea IS NULL OR btrim(ninea) <> ''),
  country_code  text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  email_domains text[] NOT NULL DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clients IS
  'H2-a : registre clients. code = identifiant stable référencé par les faits client.code, les surcharges client et les règles d''honoraires ; ninea facultatif (clients étrangers).';

DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_read_authenticated" ON public.clients;
CREATE POLICY "clients_read_authenticated"
  ON public.clients FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "clients_insert_tariff_admin" ON public.clients;
CREATE POLICY "clients_insert_tariff_admin"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.has_tariff_admin_role());

DROP POLICY IF EXISTS "clients_update_tariff_admin" ON public.clients;
CREATE POLICY "clients_update_tariff_admin"
  ON public.clients FOR UPDATE TO authenticated
  USING (public.has_tariff_admin_role()) WITH CHECK (public.has_tariff_admin_role());

DROP POLICY IF EXISTS "clients_delete_tariff_admin" ON public.clients;
CREATE POLICY "clients_delete_tariff_admin"
  ON public.clients FOR DELETE TO authenticated
  USING (public.has_tariff_admin_role());

-- Amorçage : les deux codes client déjà présents en base (surcharges client et
-- tarifs de transport à code client). Raison sociale = code, à compléter par
-- l'administrateur ; aucune valeur inventée.
INSERT INTO public.clients (code, legal_name, notes)
VALUES
  ('AI0CARGO',    'AI0CARGO',    'Amorcé automatiquement le 2026-09-09 depuis pricing_client_overrides — raison sociale, NINEA et domaines email à compléter.'),
  ('AKSA_ENERGY', 'AKSA_ENERGY', 'Amorcé automatiquement le 2026-09-09 depuis local_transport_rates — raison sociale, NINEA et domaines email à compléter.')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Lignes de facturation d'honoraires.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  label_fr              text NOT NULL CHECK (btrim(label_fr) <> ''),
  description           text,
  vat_applicable        boolean NOT NULL DEFAULT true,
  -- Comportement quand AUCUNE règle ne s'applique au dossier :
  --   TO_CONFIRM : la ligne est attendue (ex. frais d'agence) → ligne « à confirmer » ;
  --   SKIP       : la ligne est conditionnelle (ex. supplément) → absente du devis.
  missing_rule_behavior text NOT NULL DEFAULT 'TO_CONFIRM'
                        CHECK (missing_rule_behavior IN ('TO_CONFIRM', 'SKIP')),
  display_order         integer NOT NULL DEFAULT 100,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fee_lines IS
  'H2-a : lignes de facturation d''honoraires internes SODATRA, créées librement par l''administrateur. code = clé de service dans les lignes de chiffrage (bloc honoraires, TVA SODATRA).';

DROP TRIGGER IF EXISTS trg_fee_lines_updated_at ON public.fee_lines;
CREATE TRIGGER trg_fee_lines_updated_at
  BEFORE UPDATE ON public.fee_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.fee_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fee_lines_read_authenticated" ON public.fee_lines;
CREATE POLICY "fee_lines_read_authenticated"
  ON public.fee_lines FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "fee_lines_insert_tariff_admin" ON public.fee_lines;
CREATE POLICY "fee_lines_insert_tariff_admin"
  ON public.fee_lines FOR INSERT TO authenticated
  WITH CHECK (public.has_tariff_admin_role());

DROP POLICY IF EXISTS "fee_lines_update_tariff_admin" ON public.fee_lines;
CREATE POLICY "fee_lines_update_tariff_admin"
  ON public.fee_lines FOR UPDATE TO authenticated
  USING (public.has_tariff_admin_role()) WITH CHECK (public.has_tariff_admin_role());

DROP POLICY IF EXISTS "fee_lines_delete_tariff_admin" ON public.fee_lines;
CREATE POLICY "fee_lines_delete_tariff_admin"
  ON public.fee_lines FOR DELETE TO authenticated
  USING (public.has_tariff_admin_role());

-- ---------------------------------------------------------------------------
-- 4. Règles d'une ligne : conditions cumulatives + méthode de calcul + validité.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_line_id         uuid NOT NULL REFERENCES public.fee_lines(id) ON DELETE CASCADE,
  label               text,
  -- Conditions (NULL = indifférent). Valeurs alignées sur les faits canoniques.
  transport_mode      text CHECK (transport_mode IN ('SEA', 'AIR', 'ROAD')),
  direction           text CHECK (direction IN ('IMPORT', 'EXPORT', 'TRANSIT')),
  shipment_type       text CHECK (shipment_type IN ('FCL', 'LCL', 'BREAKBULK', 'RORO', 'AIR')),
  customs_regime_code text,
  container_family    text CHECK (container_family IN ('DRY', 'REEFER', 'SPECIAL')),
  dangerous_goods     boolean,
  weight_min_kg       numeric CHECK (weight_min_kg IS NULL OR weight_min_kg >= 0),
  weight_max_kg       numeric CHECK (weight_max_kg IS NULL OR weight_max_kg > 0),
  value_min           numeric CHECK (value_min IS NULL OR value_min >= 0),
  value_max           numeric CHECK (value_max IS NULL OR value_max > 0),
  client_code         text REFERENCES public.clients(code) ON UPDATE CASCADE,
  -- Calcul.
  method              text NOT NULL CHECK (method IN ('FIXED', 'PER_CONTAINER', 'PER_TONNE', 'PERCENT_OF_VALUE')),
  amount              numeric CHECK (amount IS NULL OR amount >= 0),
  amount_20           numeric CHECK (amount_20 IS NULL OR amount_20 >= 0),
  amount_40           numeric CHECK (amount_40 IS NULL OR amount_40 >= 0),
  percent             numeric CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  value_basis         text CHECK (value_basis IN ('CAF', 'CARGO_VALUE')),
  min_amount          numeric CHECK (min_amount IS NULL OR min_amount >= 0),
  max_amount          numeric CHECK (max_amount IS NULL OR max_amount >= 0),
  currency            text NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  -- Validité et versionnement.
  effective_from      date NOT NULL DEFAULT CURRENT_DATE,
  effective_to        date,
  is_active           boolean NOT NULL DEFAULT true,
  supersedes_rule_id  uuid REFERENCES public.fee_rules(id),
  source_reference    text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_rules_method_fields CHECK (
    (method = 'FIXED'            AND amount IS NOT NULL) OR
    (method = 'PER_TONNE'        AND amount IS NOT NULL) OR
    (method = 'PER_CONTAINER'    AND amount_20 IS NOT NULL AND amount_40 IS NOT NULL) OR
    (method = 'PERCENT_OF_VALUE' AND percent IS NOT NULL AND value_basis IS NOT NULL)
  ),
  CONSTRAINT fee_rules_weight_range CHECK (weight_min_kg IS NULL OR weight_max_kg IS NULL OR weight_max_kg > weight_min_kg),
  CONSTRAINT fee_rules_value_range  CHECK (value_min IS NULL OR value_max IS NULL OR value_max > value_min),
  CONSTRAINT fee_rules_min_max      CHECK (min_amount IS NULL OR max_amount IS NULL OR max_amount >= min_amount),
  CONSTRAINT fee_rules_validity     CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE public.fee_rules IS
  'H2-a : règles d''une ligne d''honoraires. Conditions cumulatives (NULL = indifférent), tranches [min, max), méthode fermée, validité par date d''effet. Le trigger fee_rules_reject_overlap interdit deux règles actives d''une même ligne pouvant viser le même dossier dans le même scope client.';
COMMENT ON COLUMN public.fee_rules.dangerous_goods IS 'NULL = indifférent ; true = marchandise dangereuse uniquement ; false = non dangereuse uniquement. Alimenté par le fait DG-1 (à créer).';
COMMENT ON COLUMN public.fee_rules.value_basis IS 'Assiette du pourcentage : CAF (fait cargo.caf_value) ou CARGO_VALUE (fait cargo.value). Assiette absente au runtime ⇒ ligne à confirmer, jamais 0.';

CREATE INDEX IF NOT EXISTS idx_fee_rules_line_active ON public.fee_rules (fee_line_id) WHERE is_active;

DROP TRIGGER IF EXISTS trg_fee_rules_updated_at ON public.fee_rules;
CREATE TRIGGER trg_fee_rules_updated_at
  BEFORE UPDATE ON public.fee_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Garde-fou anti-chevauchement. Deux règles actives d'une même ligne et du même
-- scope client se recouvrent si, pour chaque condition discrète, l'une des deux
-- est indifférente ou les deux sont égales, si les tranches poids et valeur se
-- croisent, et si les périodes de validité se croisent. La règle générique
-- (tout indifférent) recouvre donc tout : une ligne est une grille dont les
-- cases ne se recouvrent pas. Les règles client (client_code renseigné) sont
-- comparées entre elles seulement : la primauté client sur générique est
-- tranchée par le résolveur, pas ici.
CREATE OR REPLACE FUNCTION public.fee_rules_reject_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting uuid;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  SELECT r.id INTO conflicting
  FROM public.fee_rules r
  WHERE r.fee_line_id = NEW.fee_line_id
    AND r.id IS DISTINCT FROM NEW.id
    AND r.is_active
    AND r.client_code IS NOT DISTINCT FROM NEW.client_code
    AND (r.transport_mode      IS NULL OR NEW.transport_mode      IS NULL OR r.transport_mode      = NEW.transport_mode)
    AND (r.direction           IS NULL OR NEW.direction           IS NULL OR r.direction           = NEW.direction)
    AND (r.shipment_type       IS NULL OR NEW.shipment_type       IS NULL OR r.shipment_type       = NEW.shipment_type)
    AND (r.customs_regime_code IS NULL OR NEW.customs_regime_code IS NULL OR r.customs_regime_code = NEW.customs_regime_code)
    AND (r.container_family    IS NULL OR NEW.container_family    IS NULL OR r.container_family    = NEW.container_family)
    AND (r.dangerous_goods     IS NULL OR NEW.dangerous_goods     IS NULL OR r.dangerous_goods     = NEW.dangerous_goods)
    AND COALESCE(r.weight_min_kg, 0) < COALESCE(NEW.weight_max_kg, 'infinity'::numeric)
    AND COALESCE(NEW.weight_min_kg, 0) < COALESCE(r.weight_max_kg, 'infinity'::numeric)
    AND COALESCE(r.value_min, 0) < COALESCE(NEW.value_max, 'infinity'::numeric)
    AND COALESCE(NEW.value_min, 0) < COALESCE(r.value_max, 'infinity'::numeric)
    AND r.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
    AND NEW.effective_from <= COALESCE(r.effective_to, 'infinity'::date)
  LIMIT 1;

  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION '[H2-a] Règle refusée : elle recouvre la règle active % de la même ligne (mêmes conditions compatibles, tranches et périodes croisées). Rendez les conditions disjointes ou clôturez l''ancienne règle (effective_to).', conflicting
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fee_rules_reject_overlap ON public.fee_rules;
CREATE TRIGGER trg_fee_rules_reject_overlap
  BEFORE INSERT OR UPDATE ON public.fee_rules
  FOR EACH ROW EXECUTE FUNCTION public.fee_rules_reject_overlap();

ALTER TABLE public.fee_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fee_rules_read_authenticated" ON public.fee_rules;
CREATE POLICY "fee_rules_read_authenticated"
  ON public.fee_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "fee_rules_insert_tariff_admin" ON public.fee_rules;
CREATE POLICY "fee_rules_insert_tariff_admin"
  ON public.fee_rules FOR INSERT TO authenticated
  WITH CHECK (public.has_tariff_admin_role());

DROP POLICY IF EXISTS "fee_rules_update_tariff_admin" ON public.fee_rules;
CREATE POLICY "fee_rules_update_tariff_admin"
  ON public.fee_rules FOR UPDATE TO authenticated
  USING (public.has_tariff_admin_role()) WITH CHECK (public.has_tariff_admin_role());

DROP POLICY IF EXISTS "fee_rules_delete_tariff_admin" ON public.fee_rules;
CREATE POLICY "fee_rules_delete_tariff_admin"
  ON public.fee_rules FOR DELETE TO authenticated
  USING (public.has_tariff_admin_role());

-- ---------------------------------------------------------------------------
-- 5. Amorçage : reprise exacte des deux forfaits provisoires validés le
--    4 septembre 2026 (rate cards AGENCY 200 000 et CUSTOMS_DAKAR 350 000,
--    import). Les rate cards restent la source servie jusqu'à H2-c.
-- ---------------------------------------------------------------------------
INSERT INTO public.fee_lines (code, label_fr, description, vat_applicable, missing_rule_behavior, display_order)
VALUES
  ('AGENCY',        'Frais d''agence',            'Honoraires d''agence SODATRA par dossier.',          true, 'TO_CONFIRM', 10),
  ('CUSTOMS_DAKAR', 'Honoraires de dédouanement', 'Honoraires de dédouanement SODATRA, Dakar.',        true, 'TO_CONFIRM', 20)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.fee_rules (fee_line_id, label, direction, method, amount, effective_from, source_reference, notes)
SELECT l.id, 'Forfait provisoire import', 'IMPORT', 'FIXED', 200000, DATE '2026-09-04',
       'GO SODATRA 2026-09-04 — forfait provisoire (rate card 44819e64)',
       'Reprise à l''identique du forfait provisoire ; à remplacer par le paramétrage réel (nouvelle règle à date d''effet).'
FROM public.fee_lines l
WHERE l.code = 'AGENCY'
  AND NOT EXISTS (SELECT 1 FROM public.fee_rules r WHERE r.fee_line_id = l.id);

INSERT INTO public.fee_rules (fee_line_id, label, direction, method, amount, effective_from, source_reference, notes)
SELECT l.id, 'Forfait provisoire import', 'IMPORT', 'FIXED', 350000, DATE '2026-09-04',
       'GO SODATRA 2026-09-04 — forfait provisoire (rate card f0d3aea5)',
       'Reprise à l''identique du forfait provisoire ; à remplacer par le paramétrage réel (nouvelle règle à date d''effet).'
FROM public.fee_lines l
WHERE l.code = 'CUSTOMS_DAKAR'
  AND NOT EXISTS (SELECT 1 FROM public.fee_rules r WHERE r.fee_line_id = l.id);
