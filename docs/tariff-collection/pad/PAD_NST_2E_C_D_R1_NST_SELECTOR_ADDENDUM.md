# PAD-NST-2E-C-D-R1 — Addendum : Sélecteur NST opérateur

**Date** : 2026-05-08  
**Phase** : PAD-NST-2E-C-D-R1 — Addendum documentaire  
**Statut** : ADDENDUM À `PAD_NST_2E_C_D_UI_OPERATOR_SPEC.md` — Aucun code, aucune migration  
**Auteur** : Cowork / CTO  
**Décision CTO** : Option A validée — sélecteur NST manuel, non persistant, sans écriture DB

---

## 1. Constat — Chaînon manquant identifié

Lors de l'audit du code frontend (`src/`), il a été constaté que :

- `nst_code` et `nst_level` **n'existent comme fact sur aucun dossier** dans le système actuel
- Ces champs n'apparaissent que dans la table `pad_nst_recommendation_rules` (les 88 règles)
- `commodity_categories`, `cargo` et les fact tables n'ont pas de colonne `nst_code`
- Aucun composant React ne référence `nst_code` dans `src/`

**Conséquence** : l'Edge Function `get-pad-nst-suggestions` (C-B) requiert `{ nst_level, nst_code }` en entrée, mais le dossier actuel n'expose que `cargo_description` (texte libre).

La spec originale `PAD_NST_2E_C_D_UI_OPERATOR_SPEC.md` supposait implicitement que `nst_code` était disponible. **Ce n'est pas le cas.**

---

## 2. Tables NST disponibles (SELECT authentifié, RLS active)

Les tables suivantes sont accessibles en lecture depuis le frontend authentifié :

| Table | Contenu | Politique RLS |
|-------|---------|---------------|
| `public.nst_divisions` | Divisions NST 2007 | SELECT pour `authenticated` |
| `public.nst_groups` | Groupes NST 2007, FK → `nst_divisions` | SELECT pour `authenticated` |

**Comptes réels (migration `20260507173726`) :**
- `nst_divisions` : **20 divisions** (codes `01`–`17`, format `^[0-9]{2}$`)
- `nst_groups` : **81 groupes** (codes ex. `01.1`, `08.4`, format `^[0-9]{2}\.[0-9A-Z]$`)

> **Ne pas hardcoder ces nombres.** Charger dynamiquement via SELECT depuis `nst_divisions` et `nst_groups`.

---

## 3. Solution retenue — Option A : Sélecteur NST manuel

### Principe

Le panneau C-D dans `CaseView` embarque un **sélecteur NST** permettant à l'opérateur de choisir le groupe ou la division NST correspondant à la marchandise du dossier. Cette sélection est :

- **Locale** : elle n'est pas persistée en base de données
- **Non persistante** : aucun `cargo.nst_code`, aucun `case_fact`, aucun `set-case-fact`
- **Humaine** : aucun matching automatique description → NST

Ce choix est justifié par :
- ✅ Aucune migration requise
- ✅ Aucun nouveau fact
- ✅ Compatible avec C-B déjà déployé
- ✅ Validation humaine conservée
- ✅ Testable immédiatement sur dossiers réels

### Ce que l'Option B (fact persisté) représenterait

L'ajout d'un champ `nst_code` persisté sur le dossier nécessiterait une migration de schéma (`cargo` ou `case_facts`). Cette décision appartient à une phase séparée, au plus tôt lors du branchement C-C, et requiert un GO CTO dédié.

---

## 4. Flux C-D révisé

```text
CaseView
  └── Panneau "Suggestions PAD-NST" (affiché si aucune catégorie PAD opérateur validée)
        │
        ├── [1] Sélecteur NST
        │     ├── Onglet "Groupe NST" (recommandé — plus précis)
        │     │     └── Dropdown : recherche par code (ex : 08.4) ou label (ex : "Basic plastics")
        │     └── Onglet "Division NST" (fallback — moins précis)
        │           └── Dropdown : recherche par code (ex : 08) ou label
        │
        ├── [2] Bouton "Rechercher suggestions PAD"
        │     └── Déclenché uniquement sur action opérateur explicite
        │
        └── [3] Suggestions retournées par get-pad-nst-suggestions
              └── Affichage conforme à PAD_NST_2E_C_D_UI_OPERATOR_SPEC.md § 4–9
```

---

## 5. Spécification du sélecteur NST

### 5.1 Chargement des données

```
SELECT group_code, label_en, label_fr, division_code
FROM public.nst_groups
ORDER BY group_code ASC

SELECT division_code, label_en, label_fr
FROM public.nst_divisions
ORDER BY division_code ASC
```

Chargement au montage du panneau (une seule fois, pas à chaque frappe).

### 5.2 Interface du sélecteur

- **Mode privilégié** : sélection de groupe NST (plus précis, recommandé en premier)
- **Mode fallback** : sélection de division NST (moins précis, disponible si l'opérateur ne trouve pas de groupe)
- **Recherche** : filtre en temps réel sur `group_code` ET `label_en` ET `label_fr`
- **Affichage** : `group_code — label_fr (label_en)` ex : `08.4 — Plastiques de base et caoutchouc synthétique (Basic plastics and synthetic rubber in primary forms)`

### 5.3 Validation

- L'opérateur doit avoir sélectionné un code NST avant de pouvoir cliquer "Rechercher"
- Le bouton "Rechercher suggestions PAD" est désactivé tant qu'aucun code NST n'est sélectionné

### 5.4 Réinitialisation

- La sélection NST est remise à zéro si l'opérateur ferme le panneau
- Aucune persistance entre sessions

---

## 6. Conditions d'affichage du panneau (révisées)

Remplace la condition de la spec originale (qui supposait `nst_code` disponible) :

| Condition | Valeur |
|-----------|--------|
| Dossier ouvert dans `CaseView` | ✅ requis |
| `cargo.pad_category` opérateur **non encore validée** | ✅ requis |
| Gap `pricing.pad_category` ouvert | Recommandé, mais pas bloquant |
| `nst_code` disponible sur le dossier | ❌ supprimé — remplacé par le sélecteur |

> L'opérateur peut ouvrir le panneau manuellement même sans gap détecté, afin d'explorer les suggestions NST proactivement.

---

## 7. Déclenchement de l'appel C-B

**Appel sur action opérateur explicite uniquement.** Pas d'appel automatique à l'ouverture de `CaseView`.

Séquence :
1. Opérateur ouvre le panneau "Suggestions PAD-NST"
2. Opérateur sélectionne un groupe NST (ou une division en fallback)
3. Opérateur clique "Rechercher suggestions PAD"
4. Appel `POST /get-pad-nst-suggestions` avec `{ nst_level: "group"|"division", nst_code: selectedCode }`
5. Affichage des suggestions retournées

---

## 8. Ce que C-D ne doit pas faire (invariants renforcés)

| Action interdite | Statut |
|-----------------|--------|
| Écrire `cargo.nst_code` | ❌ Interdit — nst_code reste local |
| Écrire `cargo.pad_category` automatiquement | ❌ Interdit |
| Appeler `set-case-fact` | ❌ Interdit |
| Créer ou modifier `pad_designation_aliases` | ❌ Interdit |
| Faire du matching automatique description → NST | ❌ Interdit |
| Appel IA pour identifier le NST code | ❌ Interdit (doctrine PAD-NST-1 §10) |
| Calculer `amount` ou `estimated_amount` | ❌ Interdit |
| Inclure dans `total_ht` / `total_ttc` | ❌ Interdit |
| Branchement `run-pricing` | ❌ Interdit — C-C toujours NO-GO |
| Auto-validation → OFFICIAL | ❌ Interdit |

---

## 9. Préconditions avant implémentation (mise à jour)

| # | Précondition | Statut |
|---|-------------|--------|
| 1 | Commits `708099b` + `37976ff` poussés sur `origin/work` | ✅ Confirmé GitHub |
| 2 | `get-pad-nst-suggestions` accessible en production | À vérifier |
| 3 | `nst_groups` et `nst_divisions` peuplées en production | À vérifier |
| 4 | Emplacement UI cible : `CaseView` | ✅ Confirmé CTO |
| 5 | GO CTO C-D implémentation | 🔒 GO requis après validation de cet addendum |

---

## 10. Vérification des tables NST en production (avant brief Lovable)

Avant de briefer Lovable pour l'implémentation, vérifier que `nst_groups` et `nst_divisions` sont bien peuplées en production :

```sql
SELECT count(*) FROM public.nst_divisions;  -- attendu : 20
SELECT count(*) FROM public.nst_groups;     -- attendu : 81
```

Si les tables sont vides → l'implémentation UI est inutile sans données. Il faut d'abord peupler les tables NST.

---

## Références

| Document | Rôle |
|----------|------|
| `PAD_NST_2E_C_D_UI_OPERATOR_SPEC.md` | Spec C-D originale — cet addendum la complète |
| `PAD_NST_2E_C_B_VERIFICATION_REPORT.md` | Contrat d'interface `get-pad-nst-suggestions` |
| `PAD_NST_P1_C_CONFLICTS_GUIDE.md` | Alertes conflits à afficher dans les suggestions |
| `docs/DEFERRED_BACKLOG.md` | Séquence C-B→C-D→C-B-LOG→C-E→C-C |
| Migration `20260507173726_89d15cf6` | Création tables `nst_divisions` (20) et `nst_groups` (81) |
