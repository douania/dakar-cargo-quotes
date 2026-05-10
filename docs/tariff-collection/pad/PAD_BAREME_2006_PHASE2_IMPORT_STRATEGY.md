# PAD-BAREME-2006-PHASE2-IMPORT-STRATEGY

> **Statut** : Rapport documentaire d'audit/plan uniquement.
> **GO** : préparation d'une migration brouillon documentaire (hors `supabase/migrations/`).
> **NO-GO** : exécution, migration appliquée, import des 124 lignes, patch runtime, edge function, modification `src/` / CSV / manifest.
>
> Date : 2026-05-10
> Lot : `PAD-BAREME-2006-DROIT-PASSAGE`
> Source : `PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` (SHA-256 `1c34c05f…6be0`)
> Manifest : `PAD_BAREME_2006_MANIFEST.json` (figé)
> Validator : `validate_pad_csv.py` → 24 PASS / 0 FAIL / 0 WARN (exit 0)

---

## 1. Contexte et préconditions

| Préc. | Objet | État |
|-------|-------|------|
| P1 | Validator CSV `PAD-BAREME-2006-CSV-IMPORT-VALIDATOR-1` | ✅ GO |
| P2 | Backfill legacy `PAD-BAREME-2006-LEGACY-BACKFILL-1` (19 lignes IMPORT/CONTENEUR) | ✅ GO |
| P3 | Patch runtime `RT-PREIMPORT-1` (filtre `cargo_type='CONTENEUR'` + `operation_type='IMPORT'` dans `run-pricing` et `recommend-pad-category`) | ✅ GO |
| P4 | DB legacy alignée — 19 lignes `provider=PAD / category=DROIT_PASSAGE / operation_type=IMPORT / cargo_type=CONTENEUR / is_active=true` | ✅ vérifié |
| P5 | Aucune ligne EXPORT / TRANSIT_* / TRANSBORDEMENT / CONVENTIONNEL active dans `port_tariffs` | ✅ vérifié |

---

## 2. Table cible et compatibilité

Schéma `public.port_tariffs` (vérifié read-only) :

| Colonne | Type | Null | Default | Couverte par CSV ? |
|---------|------|------|---------|--------------------|
| `id` | uuid | NO | `gen_random_uuid()` | générée |
| `provider` | varchar | NO | — | littéral `'PAD'` |
| `category` | varchar | NO | — | littéral `'DROIT_PASSAGE'` (CSV `rate_family`) |
| `operation_type` | varchar | NO | — | CSV `operation_type` (5 valeurs) |
| `classification` | varchar | NO | — | CSV `classification` (22 valeurs) |
| `cargo_type` | varchar | YES | — | CSV `cargo_type` (jamais NULL côté Phase 2) |
| `amount` | numeric | NO | — | CSV `amount_fcfa_per_tonne` (Decimal) |
| `unit` | varchar | YES | `'EVP'` | littéral `'PER_TONNE'` (override default DB) |
| `surcharge_percent` | numeric | YES | `0` | non utilisé |
| `surcharge_conditions` | text | YES | — | non utilisé |
| `source_document` | varchar | YES | — | **arbitrage CTO requis — voir §3** |
| `effective_date` | date | NO | — | **`2006-01-01` proposé — décision CTO** |
| `expiry_date` | date | YES | — | non utilisé |
| `is_active` | bool | YES | `true` | `true` (sous réserve §6) |
| `evidence_level` | text | YES | `'official'` | `'official'` (CHECK whitelist 5 valeurs) |

Colonnes CSV **non mappées** (perte documentaire à acter) :

- `source_page` (7 ou 8)
- `source_section`
- `container_size_hint`
- `currency` (XOF implicite — pas de colonne en DB)
- `cell_status` (filtré en amont — voir §4)
- `notes`

**Aucune contrainte UNIQUE composite** sur `(provider, category, operation_type, classification, cargo_type)` — voir §6 pour proposition de garde structurelle.

**Aucune FK référençant `port_tariffs.id`** (vérifié read-only `pg_constraint` — 0 résultat). Désactivation/suppression des lignes legacy n'a pas d'impact transactionnel sur d'autres tables.

---

## 3. Mapping détaillé proposé

### 3.1 Mapping littéral

| Champ DB | Source | Valeur |
|----------|--------|--------|
| `provider` | littéral | `'PAD'` |
| `category` | littéral (CSV `rate_family=DROIT_PASSAGE`) | `'DROIT_PASSAGE'` |
| `operation_type` | CSV | `IMPORT` / `EXPORT` / `TRANSBORDEMENT` / `TRANSIT_IMPORT` / `TRANSIT_EXPORT` |
| `classification` | CSV | `T01..T14`, `P01..P05`, `C01..C03` |
| `cargo_type` | CSV | `CONTENEUR` / `CONVENTIONNEL` (jamais NULL) |
| `amount` | CSV `amount_fcfa_per_tonne` cast Decimal | numeric |
| `unit` | littéral | `'PER_TONNE'` |
| `evidence_level` | littéral | `'official'` |
| `is_active` | littéral | `true` (sauf stratégie alternative §6) |

### 3.2 Arbitrage `source_document` (point CTO #1)

Vérification DB read-only :

```
SELECT DISTINCT source_document, count(*)
FROM public.port_tariffs WHERE provider='PAD' GROUP BY 1;
→ pdf_redevances_portuaires_2006   19 lignes (legacy backfillées)
→ Taleb_Quote_2024                  4 lignes (autre lot)
```

Le CSV propose `source_document = 'REDEVANCES PORTUAIRES 2006'` (texte libre).
La DB legacy utilise déjà `pdf_redevances_portuaires_2006` (snake_case, conventions internes).

| Option | Valeur | Avantage | Inconvénient |
|--------|--------|----------|--------------|
| S1 (recommandée) | `pdf_redevances_portuaires_2006` | Continuité avec legacy ; aucune divergence post-import | Diverge du libellé CSV |
| S2 | `REDEVANCES PORTUAIRES 2006` | Fidélité CSV | Crée un 2ᵉ libellé pour la même source ; pollution requêtes |
| S3 | Renommer legacy + import sous nouveau libellé | Cohérence finale unique | UPDATE supplémentaire sur 19 lignes ; risque audit |

**Recommandation CTO** : **S1** — figer `source_document = 'pdf_redevances_portuaires_2006'` pour les 120 nouvelles lignes, identique aux 19 legacy. **À valider explicitement par CTO.**

### 3.3 `effective_date` (point CTO #5)

Legacy DB : `2006-01-01`.
**Recommandation** : `2006-01-01` pour les 120 nouvelles lignes. **À valider explicitement par CTO.**

---

## 4. Traitement des 4 lignes BLANK_IN_PDF (point CTO #2)

CSV : 124 lignes total, dont **120 PRESENT** et **4 BLANK_IN_PDF**.

| Option | Description | Verdict |
|--------|-------------|---------|
| A (recommandée) | Exclure les 4 lignes BLANK_IN_PDF de l'import. Documentation conservée dans CSV / manifest / rapport validator. Aucun INSERT en DB. | ✅ retenu |
| B | Importer avec `is_active=false` + note. | ❌ rejeté : `amount` est NOT NULL ; aucune valeur sémantiquement neutre disponible |
| C | Importer avec `amount=0`. | ❌ rejeté : `0` ≠ donnée manquante ; conflit sémantique avec T10 légitimement à `0` ; viole la doctrine *Exact Tariffs* |

**Décision retenue** : **Option A**. Import futur = **120 lignes PRESENT**, jamais 124.

Les 4 lignes BLANK_IN_PDF concernées (référence manifest §`critical_spots`) :

1. `page7 / EXPORT / CONVENTIONNEL / T13`
2. `page8 / TRANSBORDEMENT / CONVENTIONNEL / T10`
3. `page8 / TRANSIT_IMPORT / CONVENTIONNEL / T10`
4. `page8 / TRANSIT_EXPORT / CONVENTIONNEL / T10`

→ Ces tarifs resteront `NULL` côté runtime. Comportement attendu : aucun lookup runtime ne les active aujourd'hui (filtre `IMPORT/CONTENEUR`).

---

## 5. Coexistence vs remplacement des 19 lignes legacy (point CTO #3)

Les 19 lignes legacy = exactement le sous-ensemble `page7 / IMPORT / CONTENEUR / PRESENT` du nouveau lot officiel.

| Option | Description | Avantages | Inconvénients |
|--------|-------------|-----------|---------------|
| R1 — DELETE + INSERT 120 | Suppression dure des 19 legacy puis INSERT 120 | DB propre, single source | Perte d'historique d'audit ; rupture des `id` (acceptable car aucune FK) |
| **R2 (recommandée)** | `is_active=false` sur les 19 legacy puis INSERT 120 lignes officielles PRESENT | Audit-friendly ; conservation historique ; rollback trivial (réactiver les 19) | 19 lignes inactives résiduelles (acceptable) |
| R3 | Conservation legacy active + INSERT delta (101 lignes hors page7/IMPORT/CONTENEUR) | Aucun changement sur le périmètre runtime actuel | Incohérence d'`effective_date` possible ; double source pour le même périmètre ; viole l'unicité du lot |

**Recommandation CTO** : **R2** par défaut.

### Préconditions exécution R2

- ✅ **FK scan** : confirmé read-only — **aucune FK ne référence `port_tariffs.id`**. R2 est sûr structurellement.
- ⚠️ **Garde-fou avant exécution future** : refaire le FK scan immédiatement avant la migration (en cas d'évolution schema entre Phase 2 plan et Phase 2 exécution).
- ⚠️ Vérifier qu'aucun snapshot de devis (`quotation_versions.snapshot`) ne stocke un `port_tariffs.id` en référence textuelle (recherche jsonb à programmer dans le pré-check).

---

## 6. Risque de doublons & garde structurelle (point CTO #4)

`port_tariffs` n'a **aucune contrainte UNIQUE composite**. Risque de doublons actifs après import.

### Garde proposée

```sql
CREATE UNIQUE INDEX port_tariffs_active_unique_key
ON public.port_tariffs (provider, category, operation_type, classification, cargo_type)
WHERE is_active = true;
```

**Recommandation CTO** : **OUI**, comme garde structurelle permanente.

### Ordre d'exécution futur (impératif)

```text
1. Pré-check : aucune FK pointant vers port_tariffs.id
2. Pré-check : 0 doublon actif sur (provider, category, operation_type, classification, cargo_type)
3. Désactivation legacy (R2) : UPDATE 19 lignes → is_active=false
4. INSERT 120 lignes PRESENT (BLANK_IN_PDF exclus)
5. CREATE UNIQUE INDEX (garde structurelle)
6. Post-checks cardinalité + hash agrégé montants
```

⚠️ **Interdit absolu** : INSERT avant DESACTIVATION → collision certaine sur les 19 lignes IMPORT/CONTENEUR.
⚠️ **Interdit absolu** : CREATE INDEX avant désactivation → l'index échouera sur les 19 doublons.

---

## 7. Stratégie d'idempotence

- Marquage logique du lot via `(source_document='pdf_redevances_portuaires_2006', effective_date='2006-01-01', evidence_level='official')`.
- Garde G0 (cardinalité courante = 19 IMPORT/CONTENEUR active) avant désactivation.
- Garde G1 SHA-256 CSV figé (manifest).
- Re-exécution interdite : si cardinalité post-import = 120 active, aborter.

---

## 8. Stratégie de rollback

- Migration future enveloppée dans `BEGIN … EXCEPTION WHEN OTHERS THEN ROLLBACK`.
- Snapshot pré-import : export CSV des lignes courantes via `\copy` documenté (fichier `pre_phase2_snapshot.csv`).
- Script de restauration documenté (non généré) : `restore_pre_phase2.sql` = `UPDATE … SET is_active=true WHERE id IN (…19 ids legacy…)` + `DELETE … WHERE source_document='pdf_redevances_portuaires_2006' AND effective_date='2006-01-01' AND id NOT IN (…19 ids legacy…)`.

---

## 9. Garde-fous SQL pré-import (G-checks)

Calqués sur `PAD_BAREME_2006_LEGACY_BACKFILL_1_MIGRATION_DRAFT.sql` :

| ID | Contrôle | Action si KO |
|----|----------|--------------|
| G0 | `count(*) WHERE op=IMPORT AND cargo=CONTENEUR AND active=true == 19` | abort |
| G1 | SHA-256 CSV source == manifest | abort |
| G2 | 0 doublon dans le payload des 120 INSERT | abort |
| G3 | `operation_type ∈ {IMPORT,EXPORT,TRANSBORDEMENT,TRANSIT_IMPORT,TRANSIT_EXPORT}` | abort |
| G4 | `cargo_type ∈ {CONTENEUR,CONVENTIONNEL}` | abort |
| G5 | `amount` Decimal stricte, ≥ 0 | abort |
| G6 | `evidence_level = 'official'` partout | abort |
| G7 | Aucune FK pointant vers `port_tariffs.id` | abort |
| G8 | Aucun `port_tariffs.id` legacy référencé en jsonb dans `quotation_versions.snapshot` | abort |

---

## 10. Post-checks SQL

| ID | Contrôle | Attendu |
|----|----------|---------|
| H1 | `count(*) WHERE active=true AND source_document='pdf_redevances_portuaires_2006'` | 120 |
| H2 | Cardinalité par `(operation_type, cargo_type)` | IMPORT/CONTENEUR=19 ; IMPORT/CONVENTIONNEL=19 ; EXPORT/CONTENEUR=19 ; EXPORT/CONVENTIONNEL=18 ; TRANSBORDEMENT/CONTENEUR=8 ; TRANSBORDEMENT/CONVENTIONNEL=7 ; TRANSIT_IMPORT/CONTENEUR=8 ; TRANSIT_IMPORT/CONVENTIONNEL=7 ; TRANSIT_EXPORT/CONTENEUR=8 ; TRANSIT_EXPORT/CONVENTIONNEL=7 — **à recalculer depuis CSV PRESENT à la création de la migration** |
| H3 | `count(*) WHERE active=false AND source_document='pdf_redevances_portuaires_2006'` | 19 (legacy désactivés) |
| H4 | `sum(amount)` par classification IMPORT/CONTENEUR == sum CSV équivalent | match strict |
| H5 | Lookup runtime équivalent au backfill : `provider=PAD AND category=DROIT_PASSAGE AND op=IMPORT AND cargo=CONTENEUR AND active=true` retourne 19 montants identiques aux 19 valeurs legacy | non-régression RT-PREIMPORT-1 |
| H6 | Index unique partiel présent et valide | `\d port_tariffs` |

---

## 11. Impact runtime (point CTO #6)

| Composant | Impact Phase 2 |
|-----------|----------------|
| `run-pricing` | **Aucun patch requis**. Filtre `cargo_type='CONTENEUR' AND operation_type='IMPORT'` actif post RT-PREIMPORT-1. Les 101 nouvelles lignes (EXPORT/TRANSIT/TRANSBORDEMENT/CONVENTIONNEL) sont invisibles côté runtime. |
| `recommend-pad-category` | **Aucun patch requis**. Idem filtre. |
| `quotation-engine` | Whitelist `evidence_level IN ('official','validated_internal')` — toutes nouvelles lignes (`official`) passent ; sans effet vu les filtres ci-dessus. |
| `analyze-attachments`, `data-query`, `data-admin` | Hors périmètre. |

⚠️ **Risque latent à acter** : tout futur lookup `port_tariffs` qui oublierait le filtre `cargo_type` retournerait désormais 2 lignes (CONTENEUR + CONVENTIONNEL) au lieu d'1. À couvrir dans une revue runtime ultérieure (lot `PAD-BAREME-2006-RUNTIME-EXPAND`).

---

## 12. Traitement futur EXPORT / TRANSIT_IMPORT / TRANSIT_EXPORT / TRANSBORDEMENT

- Données importées et présentes en DB après Phase 2 (sauf 4 BLANK_IN_PDF).
- **Aucun branchement runtime** activé — reportés au lot dédié `PAD-BAREME-2006-RUNTIME-EXPAND` (à inscrire au backlog différé).
- Conditions d'activation futures : décision métier (besoin réel devis EXPORT/TRANSIT), audit lookup-by-cargo, tests E2E, gates `evidence_level`.

---

## 13. Traitement futur C01/C02/C03 et T13 transit/transbordement

| Classification | Présence DB actuelle | Présence CSV Phase 2 | Risque runtime |
|----------------|----------------------|----------------------|----------------|
| `T01..T14` | partielle (legacy) | totale | aucun (filtre CONTENEUR/IMPORT) |
| `P01..P05` | partielle (legacy) | totale | aucun |
| `C01`, `C02`, `C03` | **absente** | présente (page 8) | aucun aujourd'hui (jamais référencée par run-pricing ni recommend-pad-category) |
| `T13` transit/transbordement | absente | partiellement BLANK_IN_PDF (1 ligne T13 EXPORT/CONVENTIONNEL exclue par option A) | aucun |

**Conclusion** : ingestion data-only sans risque pour la stack runtime actuelle.

---

## 14. Verdict

**GO** pour préparer une **migration brouillon documentaire** :

- Fichier visé : `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT.sql`
- **Hors `supabase/migrations/`** (intentionnel — non auto-appliquée).
- Format : DO block transactionnel avec G0..G8 + désactivation legacy + INSERT 120 + CREATE INDEX + H1..H6.
- Doit être suivi d'un GO CTO **séparé** avant toute application.

**NO-GO** :
- Migration appliquée
- Import des 120/124 lignes
- Patch runtime
- Edge function
- Modification `src/`
- Modification CSV / manifest

---

## 15. Risques identifiés (synthèse)

| Risque | Sévérité | Mitigation |
|--------|----------|------------|
| Doublons actifs après import | Haute | Index unique partiel + garde G2 |
| Collision avec 19 legacy si ordre d'exécution non respecté | Haute | Désactivation legacy AVANT INSERT (impératif §6) |
| FK ou jsonb référençant legacy `id` | Faible (vérifié) | Re-check G7 + G8 immédiatement avant migration |
| Divergence `source_document` legacy / nouveau lot | Moyenne | S1 (continuité `pdf_redevances_portuaires_2006`) |
| Perte sémantique BLANK_IN_PDF en DB | Faible | Conservé dans CSV / manifest / rapport validator |
| Lookup runtime futur sans filtre `cargo_type` retournant 2 lignes | Moyenne | Lot `PAD-BAREME-2006-RUNTIME-EXPAND` ultérieur |
| Confusion BLANK vs `0` (ex. T10 légitime) | Haute | Option A confirmée — jamais `0` pour BLANK |

---

## 16. Options rejetées

| Option | Raison |
|--------|--------|
| Importer 124 lignes (BLANK inclus, `amount=0`) | Viole *Exact Tariffs* + collision sémantique T10=0 |
| R1 (DELETE legacy) | Perte d'historique d'audit |
| R3 (coexistence legacy + delta) | Double source pour le même périmètre |
| `source_document = 'REDEVANCES PORTUAIRES 2006'` (texte CSV) | Crée un 2ᵉ libellé ; pollution requêtes |
| Migration directe `supabase/migrations/` sans brouillon documentaire | Court-circuite gouvernance Surgical Stabilization |
| Patch runtime EXPORT/TRANSIT dans la même phase | Élargit le périmètre ; viole audit/plan only |

---

## 17. Ordre d'exécution recommandé (séquence Phase 2)

```text
2a. Brouillon documentaire SQL (hors supabase/migrations/)         ← après validation de CE rapport
2b. Dry-run logique : revue SQL ligne à ligne par CTO
2c. GO CTO séparé (formel)
2d. Migration appliquée via supabase--migration (DO block transactionnel)
2e. Post-checks H1..H6 + audit doc (PAD_BAREME_2006_PHASE2_IMPORT_REPORT.md)
2f. (différé) PAD-BAREME-2006-RUNTIME-EXPAND
```

---

## 18. Points nécessitant validation CTO explicite

| # | Point | Recommandation |
|---|-------|----------------|
| 1 | `source_document` final | **S1** : `pdf_redevances_portuaires_2006` |
| 2 | Sort des 4 BLANK_IN_PDF | **A** : exclus de l'import |
| 3 | Stratégie legacy | **R2** : désactivation 19 + INSERT 120 |
| 4 | Index unique partiel | **OUI** + ordre d'exécution §6 |
| 5 | `effective_date` | `2006-01-01` |
| 6 | Patch runtime supplémentaire | **NON requis** Phase 2 ; reporté à `PAD-BAREME-2006-RUNTIME-EXPAND` |
| 7 | Création du brouillon documentaire SQL | GO conditionné à validation CTO de ce rapport |

---

## Rappel gouvernance

- Ce rapport ne vaut **pas** GO migration data.
- Ce rapport ne vaut **pas** GO import 124 (ni 120) lignes.
- Ce rapport ne vaut **pas** GO patch runtime.
- Ce rapport ne vaut **pas** GO edge function.
- Toute exécution future requiert un **GO CTO séparé** par étape (2c, 2d, 2f).
