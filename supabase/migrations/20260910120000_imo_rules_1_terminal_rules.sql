-- =============================================================================
-- IMO-RULES-1 — Règles terminal DP World Dakar pour conteneurs IMO.
-- GO CTO SODATRA du 10 septembre 2026 (« go IMO-RULES-1 »).
--
-- SOURCE UNIQUE : « ANNEXE 1 — PROCÉDURE DE GESTION DES CONTENEURS IMO,
-- VERSION 4.0 », QHSSE / juillet 2025, DP World Dakar. Feuilles VF et VA du
-- classeur, qui concordent ligne à ligne. Chaque ligne insérée ci-dessous cite
-- sa ligne d'origine dans `source_reference`. Aucune valeur n'est déduite,
-- extrapolée ni complétée : ce que le document ne dit pas reste NULL.
--
-- Ce que la table apporte : le régime de séjour au terminal par classe IMDG et
-- par numéro ONU. Le séjour standard de 15 jours ne s'applique PAS à ces
-- conteneurs — c'est soit la livraison sous palan (aucun séjour), soit un
-- maximum de 3 jours, avec 7 jours en transbordement. L'écart est majeur pour
-- le calcul des surestaries et du magasinage.
--
-- Trois régimes de séjour du document :
--   * UNDER_TACKLE  — déchargement en livraison directe sous palan ; chargement
--                     avec entrée au terminal 12 h avant l'arrivée du navire ;
--                     transbordement NON autorisé. Aucun jour de séjour.
--   * MAX_3_DAYS    — chargement et déchargement 3 jours maximum ;
--                     transbordement 7 jours maximum.
--   * NOT_SPECIFIED — la cellule « Stockage dans le terminal » est vide dans le
--                     document. Le régime n'est PAS présumé : les lecteurs
--                     doivent traiter ce cas comme « à confirmer ».
--
-- Deux classes sont purement et simplement INTERDITES au terminal (6.2 et 7) :
-- `pad_prior_approval = 'FORBIDDEN'`.
--
-- AMBIGUÏTÉS DU DOCUMENT, conservées telles quelles et signalées en `notes` :
--   1. Classe 4.1 — les numéros 3231 et 3232 figurent à la fois dans la liste
--      « 3221-3222-3231-3232 » (sous palan) et dans la plage « 3231 à 3240 »
--      (3 jours). Deux régimes contradictoires pour le même numéro.
--   2. Classe 5.2 — les numéros 3111 et 3112 figurent à la fois dans « Type B :
--      3101-3102-3111-3112 » (3 jours) et dans « 3111 à 3120 » (non précisé).
--   3. Classe 5.1 — pour 1942-2067-2426-3375, la colonne « Accord préalable du
--      PAD » est vide : ni OUI ni NON.
-- La résolution de ces chevauchements N'EST PAS faite en base : le résolveur
-- applicatif retiendra la règle la plus restrictive et signalera le conflit,
-- plutôt que de choisir silencieusement.
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, purge des lignes de cette version
-- avant réinsertion. Rollback : DROP TABLE public.imo_terminal_rules.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.imo_terminal_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Classe ou division IMDG, alignée sur _shared/imo-classification.ts.
  imdg_class            text NOT NULL CHECK (imdg_class ~ '^[1-9](\.[1-6])?$'),
  -- Portée de la règle : tous les numéros ONU de la classe, une liste explicite,
  -- ou le reste de la classe une fois les listes retirées.
  un_scope              text NOT NULL CHECK (un_scope IN ('ALL', 'LIST', 'OTHERS')),
  -- Numéros ONU visés quand un_scope = 'LIST' (plages du document développées).
  un_numbers            integer[] NOT NULL DEFAULT '{}',
  -- Accord préalable du Port Autonome de Dakar. NULL = colonne vide au document.
  pad_prior_approval    text CHECK (pad_prior_approval IN ('YES', 'NO', 'FORBIDDEN')),
  -- Surveillance des sapeurs-pompiers. NULL = colonne vide au document.
  firefighter_supervision boolean,
  -- Régime de séjour au terminal.
  storage_regime        text NOT NULL DEFAULT 'NOT_SPECIFIED'
                        CHECK (storage_regime IN ('UNDER_TACKLE', 'MAX_3_DAYS', 'NOT_SPECIFIED')),
  -- Jours de séjour au chargement et au déchargement. 0 pour la livraison sous
  -- palan, 3 pour le régime court. NULL si le document ne le précise pas.
  storage_max_days      integer CHECK (storage_max_days IS NULL OR storage_max_days >= 0),
  -- Jours de séjour en transbordement. 0 = transbordement non autorisé.
  transshipment_max_days integer CHECK (transshipment_max_days IS NULL OR transshipment_max_days >= 0),
  -- Délai d'entrée au terminal avant l'arrivée du navire, au chargement.
  loading_gate_in_hours_before_vessel integer CHECK (loading_gate_in_hours_before_vessel IS NULL OR loading_gate_in_hours_before_vessel >= 0),
  -- Traçabilité, au même standard que public.terminal_tariff_codes.
  source_document       text NOT NULL,
  source_reference      text NOT NULL,
  evidence_level        text NOT NULL DEFAULT 'official'
                        CHECK (evidence_level IN ('official', 'validated_internal', 'to_confirm')),
  effective_date        date NOT NULL,
  document_version      text NOT NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT imo_terminal_rules_list_not_empty
    CHECK (un_scope <> 'LIST' OR array_length(un_numbers, 1) > 0),
  CONSTRAINT imo_terminal_rules_list_only
    CHECK (un_scope = 'LIST' OR array_length(un_numbers, 1) IS NULL)
);

COMMENT ON TABLE public.imo_terminal_rules IS
  'IMO-RULES-1 : régime de séjour, accord PAD et surveillance pompiers par classe IMDG et numéro ONU, au terminal à conteneurs DP World de Dakar. Source unique : Annexe 1 v4.0 (QHSSE juillet 2025). Le séjour standard de 15 jours ne s''applique pas à ces conteneurs.';
COMMENT ON COLUMN public.imo_terminal_rules.storage_regime IS
  'UNDER_TACKLE = livraison directe sous palan, aucun séjour, transbordement interdit. MAX_3_DAYS = 3 jours au chargement/déchargement, 7 en transbordement. NOT_SPECIFIED = cellule vide au document, à confirmer, jamais présumé.';
COMMENT ON COLUMN public.imo_terminal_rules.un_scope IS
  'ALL = toute la classe. LIST = les numéros listés. OTHERS = le reste de la classe une fois les listes retirées.';

CREATE INDEX IF NOT EXISTS idx_imo_terminal_rules_class ON public.imo_terminal_rules (imdg_class);

ALTER TABLE public.imo_terminal_rules ENABLE ROW LEVEL SECURITY;

-- Lecture ouverte à tout utilisateur authentifié ; écriture réservée au rôle
-- tariff_admin, comme les autres référentiels tarifaires (H2-a).
DROP POLICY IF EXISTS "imo_terminal_rules_read_authenticated" ON public.imo_terminal_rules;
CREATE POLICY "imo_terminal_rules_read_authenticated"
  ON public.imo_terminal_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "imo_terminal_rules_write_tariff_admin" ON public.imo_terminal_rules;
CREATE POLICY "imo_terminal_rules_write_tariff_admin"
  ON public.imo_terminal_rules FOR ALL TO authenticated
  USING (public.has_tariff_admin_role()) WITH CHECK (public.has_tariff_admin_role());

-- ---------------------------------------------------------------------------
-- Amorçage depuis l'Annexe 1 v4.0. Purge d'abord les lignes de cette version
-- pour que le patch soit rejouable sans doublon.
-- ---------------------------------------------------------------------------
DELETE FROM public.imo_terminal_rules WHERE document_version = '4.0';

INSERT INTO public.imo_terminal_rules (
  imdg_class, un_scope, un_numbers, pad_prior_approval, firefighter_supervision,
  storage_regime, storage_max_days, transshipment_max_days,
  loading_gate_in_hours_before_vessel,
  source_document, source_reference, evidence_level, effective_date,
  document_version, notes
) VALUES
-- Classe 1 — Explosifs.
('1', 'ALL', '{}', 'YES', true, 'UNDER_TACKLE', 0, 0, 12,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 6', 'official', DATE '2025-07-01', '4.0', NULL),

-- Classe 2.1 — Gaz inflammables.
('2.1', 'ALL', '{}', 'YES', true, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 8', 'official', DATE '2025-07-01', '4.0', NULL),

-- Classe 2.2 — Gaz comprimés ininflammables. Colonne stockage vide au document.
('2.2', 'ALL', '{}', 'NO', false, 'NOT_SPECIFIED', NULL, NULL, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 9', 'official', DATE '2025-07-01', '4.0',
 'Colonne « Stockage dans le terminal » vide au document : régime de séjour non précisé, à confirmer auprès du terminal.'),

-- Classe 2.3 — Gaz toxiques.
('2.3', 'ALL', '{}', 'YES', false, 'UNDER_TACKLE', 0, 0, 12,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 10', 'official', DATE '2025-07-01', '4.0', NULL),

-- Classe 3 — Liquides inflammables.
('3', 'ALL', '{}', 'YES', true, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 12', 'official', DATE '2025-07-01', '4.0', NULL),

-- Classe 4.1 — Solides inflammables, trois lignes au document.
('4.1', 'LIST', '{3221,3222,3231,3232}', 'YES', false, 'UNDER_TACKLE', 0, 0, 12,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 14', 'official', DATE '2025-07-01', '4.0',
 'AMBIGUÏTÉ DOCUMENT : 3231 et 3232 figurent aussi dans la plage 3231-3240 de la ligne 15, qui prévoit 3 jours. Régimes contradictoires pour ces deux numéros.'),
('4.1', 'LIST', '{3231,3232,3233,3234,3235,3236,3237,3238,3239,3240}', 'YES', true, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 15 (plage « 3231 à 3240 » développée)', 'official', DATE '2025-07-01', '4.0',
 'AMBIGUÏTÉ DOCUMENT : 3231 et 3232 figurent aussi à la ligne 14, qui prévoit la livraison sous palan.'),
('4.1', 'OTHERS', '{}', 'NO', NULL, 'NOT_SPECIFIED', NULL, NULL, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 16', 'official', DATE '2025-07-01', '4.0',
 'Colonnes « Surveillance » et « Stockage » vides au document : non précisées, à confirmer.'),

-- Classe 4.2 — Substances sujettes à l'inflammation spontanée, trois lignes.
('4.2', 'LIST', '{1431}', 'YES', false, 'UNDER_TACKLE', 0, 0, 12,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 17', 'official', DATE '2025-07-01', '4.0', NULL),
('4.2', 'LIST', '{1380,1381,1383,1854,1855,2008,2441,2447,2545,2546,2845,2846,2870,2881,3194,3200,3254,3255,3391,3392,3393,3394}', 'YES', false, 'NOT_SPECIFIED', NULL, NULL, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 18 (plage « 3391 à 3394 » développée)', 'official', DATE '2025-07-01', '4.0',
 'Colonne « Stockage dans le terminal » vide au document : régime de séjour non précisé, à confirmer.'),
('4.2', 'OTHERS', '{}', 'NO', true, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 19', 'official', DATE '2025-07-01', '4.0', NULL),

-- Classe 4.3 — Substances dégageant des gaz inflammables au contact de l'eau.
('4.3', 'LIST', '{1391,1393,1395,1397,1398,1399,1400,1401,1402,1404,1407,1408,1409,1410,1413,1414,1415,1416,1417,1418,1419,1420,1421,1422,1423,1424,1425,1426,1427,1428,1433}', 'YES', false, 'UNDER_TACKLE', 0, 0, 12,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 20 (plages « 1397 à 1402 », « 1407 à 1410 » et « 1413 à 1428 » développées)', 'official', DATE '2025-07-01', '4.0', NULL),
('4.3', 'OTHERS', '{}', 'NO', NULL, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 21', 'official', DATE '2025-07-01', '4.0',
 'Colonne « Surveillance des sapeurs-pompiers » vide au document.'),

-- Classe 5.1 — Substances comburantes, trois lignes.
('5.1', 'LIST', '{1442,1748,2208,2880}', 'YES', false, 'UNDER_TACKLE', 0, 0, 12,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 23', 'official', DATE '2025-07-01', '4.0', NULL),
('5.1', 'LIST', '{1942,2067,2426,3375}', NULL, false, 'NOT_SPECIFIED', NULL, NULL, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 24', 'official', DATE '2025-07-01', '4.0',
 'AMBIGUÏTÉ DOCUMENT : colonne « Accord préalable du PAD » vide (ni OUI ni NON) et colonne « Stockage » vide. Deux informations manquantes, à confirmer auprès du terminal.'),
('5.1', 'OTHERS', '{}', 'NO', false, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 25', 'official', DATE '2025-07-01', '4.0', NULL),

-- Classe 5.2 — Peroxydes organiques, trois lignes.
('5.2', 'LIST', '{3101,3102,3111,3112}', 'YES', false, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 26 (peroxydes de type B)', 'official', DATE '2025-07-01', '4.0',
 'AMBIGUÏTÉ DOCUMENT : 3111 et 3112 figurent aussi dans la plage 3111-3120 de la ligne 27, dont le régime de séjour n''est pas précisé.'),
('5.2', 'LIST', '{3111,3112,3113,3114,3115,3116,3117,3118,3119,3120}', 'YES', false, 'NOT_SPECIFIED', NULL, NULL, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 27 (plage « 3111 à 3120 » développée)', 'official', DATE '2025-07-01', '4.0',
 'Colonne « Stockage dans le terminal » vide au document. AMBIGUÏTÉ : 3111 et 3112 figurent aussi à la ligne 26 (3 jours).'),
('5.2', 'OTHERS', '{}', 'YES', false, 'NOT_SPECIFIED', NULL, NULL, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 28', 'official', DATE '2025-07-01', '4.0',
 'Colonne « Stockage dans le terminal » vide au document : régime de séjour non précisé, à confirmer.'),

-- Classe 6.1 — Substances toxiques.
('6.1', 'LIST', '{1051,1092,1163,1239,1244,1259,1649,2334,1689}', 'YES', false, 'UNDER_TACKLE', 0, 0, 12,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 30', 'official', DATE '2025-07-01', '4.0', NULL),
('6.1', 'OTHERS', '{}', 'NO', false, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 31', 'official', DATE '2025-07-01', '4.0', NULL),

-- Classe 6.2 — Substances infectieuses : interdites au terminal.
('6.2', 'ALL', '{}', 'FORBIDDEN', NULL, 'NOT_SPECIFIED', NULL, NULL, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 32', 'official', DATE '2025-07-01', '4.0',
 'Mention « INTERDIT » au document : la classe n''est pas admise au terminal à conteneurs de Dakar.'),

-- Classe 7 — Matières radioactives : interdites au terminal.
('7', 'ALL', '{}', 'FORBIDDEN', NULL, 'NOT_SPECIFIED', NULL, NULL, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 34', 'official', DATE '2025-07-01', '4.0',
 'Mention « INTERDIT » au document : la classe n''est pas admise au terminal à conteneurs de Dakar.'),

-- Classe 8 — Corrosifs.
('8', 'ALL', '{}', 'NO', NULL, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 36', 'official', DATE '2025-07-01', '4.0',
 'Colonne « Surveillance des sapeurs-pompiers » vide au document.'),

-- Classe 9 — Matières et objets dangereux divers.
('9', 'ALL', '{}', 'YES', false, 'MAX_3_DAYS', 3, 7, NULL,
 'ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)',
 'Feuille VF, ligne 38', 'official', DATE '2025-07-01', '4.0', NULL);

-- ---------------------------------------------------------------------------
-- Contrôle d'amorçage : le document comporte 25 lignes de règles (VF lignes
-- 6, 8, 9, 10, 12, 14 à 21, 23 à 28, 30 à 32, 34, 36 et 38).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  inserted integer;
BEGIN
  SELECT count(*) INTO inserted FROM public.imo_terminal_rules WHERE document_version = '4.0';
  IF inserted <> 25 THEN
    RAISE EXCEPTION '[IMO-RULES-1] STOP — % règles insérées, 25 attendues depuis l''Annexe 1 v4.0.', inserted;
  END IF;
END $$;
