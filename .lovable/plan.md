

# PHASE 5D-bis — Migration Explicite (VERSION FINALE CTO)

## Corrections CTO intégrées (toutes)

| # | Correction | Statut |
|---|------------|--------|
| 1 | Aucun trigger sur `auth.users` | ✅ INTÉGRÉ |
| 2 | Migration vers admin UUID explicite | ✅ INTÉGRÉ |
| 3 | REVOKE sur fonctions SECURITY DEFINER | ✅ INTÉGRÉ |
| 4 | FK idempotente (test existence) | ✅ INTÉGRÉ |
| 5 | **`SET search_path = public, auth`** | ✅ INTÉGRÉ |

---

## 1. Migration SQL complète

```sql
-- Phase 5D-bis : Migration explicite vers admin choisi (VERSION FINALE CTO)

-- ================================================================
-- FONCTION 1 : Migrer les legacy vers un admin UUID explicite
-- ================================================================
CREATE OR REPLACE FUNCTION migrate_legacy_quotations(owner_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth  -- CORRECTION CTO FINALE
AS $$
DECLARE
  migrated_count INTEGER;
  legacy_uuid UUID := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  IF owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_user_id est requis';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = owner_user_id) THEN
    RAISE EXCEPTION 'owner_user_id % n''existe pas dans auth.users', owner_user_id;
  END IF;

  SELECT COUNT(*) INTO migrated_count
  FROM quotation_history
  WHERE created_by = legacy_uuid;

  IF migrated_count = 0 THEN
    RETURN 'INFO: Aucun devis legacy à migrer';
  END IF;

  UPDATE quotation_history
  SET created_by = owner_user_id
  WHERE created_by = legacy_uuid;

  RETURN format('SUCCESS: %s devis legacy migrés vers %s', migrated_count, owner_user_id);
END;
$$;

-- ================================================================
-- FONCTION 2 : Finaliser (restaurer FK + RLS stricte)
-- ================================================================
CREATE OR REPLACE FUNCTION finalize_quotation_ownership()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth  -- CORRECTION CTO FINALE
AS $$
DECLARE
  legacy_count INTEGER;
  legacy_uuid UUID := '00000000-0000-0000-0000-000000000000'::uuid;
  fk_exists BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO legacy_count
  FROM quotation_history
  WHERE created_by = legacy_uuid;

  IF legacy_count > 0 THEN
    RETURN format('ERREUR: %s devis legacy existent encore. Exécutez d''abord migrate_legacy_quotations(uuid).', legacy_count);
  END IF;

  -- CORRECTION CTO #2 : Vérifier si FK existe déjà (idempotent)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'quotation_history_created_by_fkey'
      AND table_name = 'quotation_history'
  ) INTO fk_exists;

  IF NOT fk_exists THEN
    ALTER TABLE quotation_history
    ADD CONSTRAINT quotation_history_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id);
  END IF;

  -- Remplacer RLS par ownership STRICT (sans exception legacy)
  DROP POLICY IF EXISTS "quotation_history_owner_select" ON quotation_history;
  CREATE POLICY "quotation_history_owner_select"
  ON quotation_history FOR SELECT TO authenticated
  USING (auth.uid() = created_by);

  DROP POLICY IF EXISTS "quotation_history_owner_update" ON quotation_history;
  CREATE POLICY "quotation_history_owner_update"
  ON quotation_history FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

  DROP POLICY IF EXISTS "quotation_history_owner_delete" ON quotation_history;
  CREATE POLICY "quotation_history_owner_delete"
  ON quotation_history FOR DELETE TO authenticated
  USING (auth.uid() = created_by);

  RETURN 'SUCCESS: FK restaurée, RLS stricte activée. Intégrité complète.';
END;
$$;

-- ================================================================
-- FONCTION 3 : Diagnostic (vérifier l'état actuel)
-- ================================================================
CREATE OR REPLACE FUNCTION check_quotation_ownership_status()
RETURNS TABLE(metric TEXT, value TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth  -- CORRECTION CTO FINALE
AS $$
DECLARE
  legacy_uuid UUID := '00000000-0000-0000-0000-000000000000'::uuid;
  total_count INTEGER;
  legacy_count INTEGER;
  migrated_count INTEGER;
  fk_exists BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO total_count FROM quotation_history;
  SELECT COUNT(*) INTO legacy_count FROM quotation_history WHERE created_by = legacy_uuid;
  migrated_count := total_count - legacy_count;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'quotation_history_created_by_fkey'
    AND table_name = 'quotation_history'
  ) INTO fk_exists;

  RETURN QUERY SELECT 'total_quotations'::TEXT, total_count::TEXT;
  RETURN QUERY SELECT 'legacy_quotations'::TEXT, legacy_count::TEXT;
  RETURN QUERY SELECT 'migrated_quotations'::TEXT, migrated_count::TEXT;
  RETURN QUERY SELECT 'fk_exists'::TEXT, fk_exists::TEXT;
  RETURN QUERY SELECT 'status'::TEXT, 
    CASE 
      WHEN legacy_count > 0 THEN 'MODE_MIXTE'
      WHEN NOT fk_exists THEN 'MIGRATION_DONE_FK_PENDING'
      ELSE 'STRICT_OWNERSHIP'
    END;
END;
$$;

-- ================================================================
-- DURCISSEMENT CTO : empêcher tout appel non-admin
-- ================================================================
REVOKE ALL ON FUNCTION migrate_legacy_quotations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION migrate_legacy_quotations(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION finalize_quotation_ownership() FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_quotation_ownership() FROM authenticated;

REVOKE ALL ON FUNCTION check_quotation_ownership_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION check_quotation_ownership_status() FROM authenticated;
```

---

## 2. Fichiers créés/modifiés

| Fichier | Action | Lignes |
|---------|--------|--------|
| `supabase/migrations/{ts}_lazy_migration_b1.sql` | CRÉER | ~120 |
| `.lovable/plan.md` | METTRE À JOUR | ~15 |

## Fichiers NON modifiés

| Fichier | Statut |
|---------|--------|
| `useQuotationDraft.ts` | Déjà correct (Phase 5D) |
| `CargoLinesForm.tsx` | FROZEN |
| `ServiceLinesForm.tsx` | FROZEN |
| Tous les composants UI | Aucun changement |

---

## 3. Mode opératoire admin (post-déploiement)

```text
┌─────────────────────────────────────────────────────────────┐
│  ÉTAPE 1 — Créer l'admin SODATRA                           │
│                                                             │
│  Via l'interface Auth Lovable Cloud :                      │
│  - Email: admin@sodatra.sn                                 │
│  - Mot de passe sécurisé                                   │
│  - Confirmer l'email                                       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  ÉTAPE 2 — Récupérer l'UUID admin (SQL editor owner)       │
│                                                             │
│  SELECT * FROM check_quotation_ownership_status();         │
│  -- Voir état actuel (devrait être MODE_MIXTE)             │
│                                                             │
│  SELECT id, email, created_at                               │
│  FROM auth.users                                            │
│  ORDER BY created_at DESC LIMIT 5;                         │
│  -- Copier l'UUID de admin@sodatra.sn                      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  ÉTAPE 3 — Migrer les 91 devis legacy                      │
│                                                             │
│  SELECT migrate_legacy_quotations(                         │
│    'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid            │
│  );                                                         │
│                                                             │
│  Résultat attendu:                                         │
│  "SUCCESS: 91 devis legacy migrés vers xxx..."             │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  ÉTAPE 4 — Finaliser (FK + RLS stricte)                    │
│                                                             │
│  SELECT finalize_quotation_ownership();                    │
│                                                             │
│  Résultat attendu:                                         │
│  "SUCCESS: FK restaurée, RLS stricte activée..."           │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  ÉTAPE 5 — Vérification finale                             │
│                                                             │
│  SELECT * FROM check_quotation_ownership_status();         │
│                                                             │
│  Résultat attendu:                                         │
│  ┌──────────────────────┬────────────────────┐             │
│  │ metric               │ value              │             │
│  ├──────────────────────┼────────────────────┤             │
│  │ total_quotations     │ 91                 │             │
│  │ legacy_quotations    │ 0                  │             │
│  │ migrated_quotations  │ 91                 │             │
│  │ fk_exists            │ true               │             │
│  │ status               │ STRICT_OWNERSHIP   │             │
│  └──────────────────────┴────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Points de sécurité validés (tous)

| Point | Implémentation |
|-------|----------------|
| Pas de trigger auth.users | Fonctions manuelles uniquement |
| Admin explicite | UUID passé en paramètre |
| REVOKE authenticated | Fonctions admin-only |
| FK idempotente | Test existence avant ADD |
| search_path complet | `public, auth` sur toutes fonctions |
| SECURITY DEFINER | Accès contrôlé à auth.users |

---

## 5. État final attendu

```text
┌─────────────────────────────────────────────────────────────┐
│               ÉTAT FINAL (STRICT_OWNERSHIP)                 │
│                                                             │
│  quotation_history                                          │
│  ├── created_by UUID NOT NULL DEFAULT auth.uid()           │
│  ├── FK → auth.users(id) ✅ RESTAURÉE                      │
│  └── RLS: auth.uid() = created_by (STRICT)                 │
│                                                             │
│  quotation_documents                                        │
│  ├── created_by UUID                                       │
│  └── RLS: auth.uid() = created_by (STRICT)                 │
│                                                             │
│  91 devis legacy → owner = admin@sodatra.sn                │
│  Nouveaux devis → owner = utilisateur connecté             │
│                                                             │
│  Isolation: Chaque user ne voit que SES devis ✅           │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Critères de sortie Phase 5D-bis

- [ ] Fonction `migrate_legacy_quotations(uuid)` avec `search_path = public, auth`
- [ ] Fonction `finalize_quotation_ownership()` avec FK idempotente
- [ ] Fonction `check_quotation_ownership_status()` diagnostic
- [ ] REVOKE appliqué sur les 3 fonctions
- [ ] Aucune dépendance à trigger sur auth.users
- [ ] Build TypeScript OK (aucun changement frontend)
- [ ] Documentation mode opératoire complète

---

## Section technique : Rollback si nécessaire

```sql
-- Si erreur après finalize_quotation_ownership()
ALTER TABLE quotation_history
DROP CONSTRAINT IF EXISTS quotation_history_created_by_fkey;

-- Remettre RLS mode mixte (temporaire)
DROP POLICY IF EXISTS "quotation_history_owner_select" ON quotation_history;
CREATE POLICY "quotation_history_owner_select"
ON quotation_history FOR SELECT TO authenticated
USING (
  auth.uid() = created_by 
  OR created_by = '00000000-0000-0000-0000-000000000000'::uuid
);
```

