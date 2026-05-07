# Rapport d'Audit CTO — Chantier PAD-NST / Taxe de port PAD

**Date de référence** : 07 mai 2026  
**Projet** : Dakar Cargo Quotes  
**Dépôt** : `douania/dakar-cargo-quotes` (Branche : `work`)  
**Auteur** : Manus AI (Audit indépendant)

---

## A. Résumé exécutif

L'audit complet de la chaîne PAD-NST révèle une **divergence critique** lors de la phase d'import final des règles de recommandation (PAD-NST-2E-B). 

**Ce qui est correct :**
Les phases préparatoires (1B, 1C, 2B, 2C, 2D, 2E-A, 2E-AUDIT) ont été exécutées avec une grande rigueur. Les sources officielles UNECE sont intègres et documentées. Les tables structurelles NST ont été créées et peuplées correctement. Le manifeste des 112 règles candidates et l'audit de recalibration R1 (qui valide 88 règles TIER-A/B) sont cohérents. Le script de génération SQL (`pad_nst_2e_import.py`) produit un fichier SQL parfaitement aligné avec la doctrine R1.

**Ce qui est incohérent et bloquant :**
La migration réellement appliquée (`20260507192300_4b2c5072-8c20-411b-bc09-f8ca1a2139c2.sql`) **ne correspond pas** au SQL généré par le script. Bien qu'elle contienne 88 règles, elle omet 32 règles légitimes (TIER-A/B) et importe à tort 32 règles non autorisées, dont 6 règles explicitement rejetées (TIER-C / defer / remove). De plus, les confidences et niveaux de preuve ont été altérés manuellement.

**Le faux positif de la correction R1 :**
Le rapport de réconciliation `PAD_NST_2E_B_R1_RECONCILIATION_REPORT.md` affirme qu'une correction a été appliquée en base. Cependant, **aucune trace de cette correction n'existe dans le dépôt Git** (aucune nouvelle migration corrective, aucune modification de la migration initiale). L'état déclaratif du dépôt est donc désynchronisé de la réalité supposée de la base de données.

**Ce qui ne doit pas être fait maintenant :**
Il est **strictement interdit** de passer à la phase d'intégration runtime (PAD-NST-2E-C-A) ou de brancher le moteur de pricing tant que l'état de la base de données n'a pas été formellement réconcilié avec le dépôt via une migration corrective traçable.

---

## B. Timeline du chantier du 07 mai 2026

L'historique des opérations documentées dans le dépôt s'établit comme suit :

1. **PAD-NST-1B / 1C** : Téléchargement et documentation des tables de correspondance UNECE (CPA, CN, NHM, NSTR).
2. **PAD-NST-2B / 2C** : Création des 7 tables NST et import de 26 600+ correspondances.
3. **PAD-NST-2D** : Création de la table `pad_nst_recommendation_rules` (vide, avec contraintes strictes).
4. **PAD-NST-2E-A** : Génération du manifeste initial de 112 règles candidates.
5. **PAD-NST-2E-AUDIT** : Audit métier des 112 règles (classification en TIER-A, B, C).
6. **PAD-NST-2E-AUDIT-R1** : Recalibration des confidences (0.45 à 0.85) et filtrage (88 règles retenues).
7. **PAD-NST-2E-B** : Génération du SQL d'import via script, mais **application d'une migration manuelle erronée** (32 règles divergentes).
8. **PAD-NST-2E-B-R1** : Rédaction d'un rapport affirmant la correction de la base, mais **sans aucun commit de migration corrective** dans le dépôt (commit `316db26`).
9. **État actuel (avant PAD-NST-2E-B-R2)** : Le dépôt contient une migration erronée et un rapport affirmant qu'elle a été corrigée hors-piste.

---

## C. Tableau des fichiers vérifiés

| Chemin du fichier | Rôle | Statut | Observation |
|-------------------|------|--------|-------------|
| `docs/tariff-collection/pad/unece-sources/*` | Sources officielles UNECE | ✅ Conforme | SHA256 identiques aux fichiers fournis. |
| `docs/tariff-collection/pad/PAD_NST_1B_EVIDENCE_PACKAGE.md` | Preuve d'intégrité des sources | ✅ Conforme | Documente correctement les limites des tables. |
| `supabase/migrations/20260507173726_...sql` | Création des tables NST (2B) | ✅ Conforme | 7 tables créées, RLS SELECT-only. |
| `docs/tariff-collection/pad/scripts/pad_nst_2c_import.py` | Script d'import des correspondances | ✅ Conforme | Logique d'idempotence et de normalisation correcte. |
| `supabase/migrations/20260507183406_...sql` | Création table des règles (2D) | ✅ Conforme | Contraintes strictes (confidence 0..1, status, etc.). |
| `docs/tariff-collection/pad/rules/pad_nst_2e_rule_candidates.csv` | Manifeste initial (2E-A) | ✅ Conforme | 112 règles, aucune validée, confidences < 0.65. |
| `docs/tariff-collection/pad/rules/pad_nst_2e_audit_results.csv` | Audit et recalibration (R1) | ✅ Conforme | 88 règles éligibles (TIER-A/B, action != defer/remove). |
| `docs/tariff-collection/pad/scripts/pad_nst_2e_import.py` | Générateur SQL d'import | ✅ Conforme | Logique stricte, génère exactement les 88 règles R1. |
| `docs/tariff-collection/pad/rules/pad_nst_2e_import.sql` | SQL généré par le script | ✅ Conforme | 88 INSERT corrects, correspond à l'audit R1. |
| `supabase/migrations/20260507192300_...sql` | Migration réellement appliquée | ❌ **Incohérent** | 88 INSERT, mais 32 règles erronées (dont 6 TIER-C). |
| `docs/tariff-collection/pad/PAD_NST_2E_B_R1_RECONCILIATION_REPORT.md` | Rapport de correction R1 | ❌ **Non vérifiable** | Affirme une correction DB sans migration Git associée. |

---

## D. Vérification des compteurs

Les compteurs extraits des fichiers du dépôt confirment la divergence lors de la phase d'import :

- **Manifest total (2E-A)** : 112 règles
- **Audit total (2E-AUDIT)** : 112 règles
- **Répartition TIER** : TIER-A (35), TIER-B (53), TIER-C (24)
- **ready_for_import_count** : 88 règles (TIER-A + TIER-B)
- **deferred_count** : 20 règles
- **removed_count** : 4 règles
- **SQL généré count (`pad_nst_2e_import.sql`)** : 88 règles (exactement les 88 attendues)
- **Migration appliquée count (`20260507192300_...sql`)** : 88 règles (mais pas les bonnes)
- **DB count** : *Non vérifiable (accès direct à la base de données Supabase indisponible).* Je ne peux pas confirmer l'état réel de la table `pad_nst_recommendation_rules` sans accès DB.

---

## E. Incohérences détectées

La comparaison entre l'audit R1 (source de vérité) et la migration appliquée révèle des écarts majeurs :

1. **Règles TIER-C importées à tort (6 règles)** :
   - `group|01.9|T02` (action=remove)
   - `group|02.3|T11` (action=defer)
   - `group|03.6|T03` (action=remove)
   - `group|08.7|T03` (action=remove)
   - `group|16.1|T09` (action=defer)
   - `group|17.1|T02` (action=defer)

2. **Règles TIER-A/B manquantes (32 règles)** :
   - Exemples notables : `group|01.5|T04` (TIER-A, conf=0.80), `group|01.B|P05` (TIER-A, conf=0.80), `group|07.1|T07` (TIER-A, conf=0.80), `group|11.7|T01` (TIER-A, conf=0.80).

3. **Règles inventées (26 règles)** :
   - 26 `rule_keys` présentes dans la migration n'existent même pas dans le fichier d'audit R1 (ex: `group|01.3|T02`, `group|10.2|T14`).

4. **Divergences de confidence et d'evidence_level (25 règles)** :
   - Pour les règles communes, les valeurs ont été altérées. Exemple : `group|03.3|T08` est attendu avec `confidence=0.6` et `evidence_level=expert_rule`, mais a été importé avec `confidence=0.85` et `evidence_level=nstr_bridge_inferred`.

---

## F. Cause racine probable

Le script `pad_nst_2e_import.py` et le SQL qu'il génère (`pad_nst_2e_import.sql`) sont **parfaitement corrects**. 

La cause racine est que **la migration appliquée a été reconstruite indépendamment** (probablement à la main ou via un autre script non committé), en utilisant une version obsolète ou erronée des candidats, sans appliquer les filtres de l'audit R1. 

La tentative corrective R1 (`PAD_NST_2E_B_R1_RECONCILIATION_REPORT.md`) a échoué d'un point de vue d'ingénierie logicielle car elle a supposément corrigé la base de données en direct (via la console SQL Supabase) **sans commiter de fichier de migration** dans le dépôt Git. Le dépôt est donc resté dans un état corrompu.

---

## G. Risque CTO

- **Risque data (Critique)** : Désynchronisation totale entre l'état déclaratif du code (Git) et l'état réel de la base de données. Si la base est réinitialisée ou qu'un nouvel environnement est monté, les mauvaises règles seront réimportées.
- **Risque métier futur (Élevé)** : Des règles TIER-C (faible fiabilité, hors périmètre comme les conteneurs vides) risquent de polluer les recommandations de taxation PAD.
- **Risque runtime actuel (Bloquant)** : Si `run-pricing` est branché sur cette table en l'état, le moteur de recommandation utilisera des règles non auditées et des confidences faussées, générant des erreurs de facturation.

---

## H. Recommandation

1. **Ne pas passer à PAD-NST-2E-C-A (runtime)**.
2. **Faire PAD-NST-2E-B-R2** est **strictement nécessaire** pour réconcilier le dépôt Git et la base de données.
3. La migration R2 doit être **générée automatiquement par script**, sans aucune intervention manuelle sur le SQL.
4. La source de vérité unique doit rester le CSV d'audit R1 filtré couplé au script `pad_nst_2e_import.py`.

---

## I. Plan R2 proposé (Non exécuté)

Si un GO explicite est donné, le plan d'action sera le suivant :

1. Créer le script `docs/tariff-collection/pad/scripts/pad_nst_2e_b_r2_corrective.py` (basé sur l'original).
2. Générer automatiquement la migration `supabase/migrations/<timestamp>_pad_nst_2e_b_r2_corrective.sql`.
3. La migration contiendra :
   ```sql
   BEGIN;
   DELETE FROM public.pad_nst_recommendation_rules;
   -- 88 INSERT générés automatiquement
   -- Contrôles post-insert (count=88, pas de TIER-C, etc.)
   COMMIT;
   ```
4. Vérifier que le SQL généré correspond exactement aux 88 règles attendues.

---

## Verdict Final

- **PAD-NST-1B / 2C** : ✅ Accepté
- **PAD-NST-2D** : ✅ Accepté
- **PAD-NST-2E-A** : ✅ Accepté
- **PAD-NST-2E-AUDIT** : ✅ Accepté
- **PAD-NST-2E-AUDIT-R1** : ✅ Accepté
- **PAD-NST-2E-B** : ❌ **Non accepté** (Divergence majeure entre script et migration)
- **PAD-NST-2E-B-R1** : ❌ **Échoué / Non vérifiable** (Correction prétendue sans trace Git)
- **PAD-NST-2E-B-R2** : ⚠️ **Nécessaire** (Pour réconcilier Git et DB)
