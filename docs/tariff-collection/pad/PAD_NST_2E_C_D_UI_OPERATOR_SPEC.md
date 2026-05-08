# PAD-NST-2E-C-D — Spécification UI opérateur

**Date** : 2026-05-08  
**Phase** : PAD-NST-2E-C-D — Spec documentaire UI opérateur  
**Statut** : DOCUMENT DE SPÉCIFICATION — Aucun code, aucune migration, aucun runtime  
**Auteur** : Cowork / CTO  
**GO CTO** : ✅ C-D-SPEC autorisé — C-D implémentation UI = 🔒 pas encore autorisée

---

## Périmètre strict

- ✅ 0 modification `src/`
- ✅ 0 modification `run-pricing/`
- ✅ 0 Edge Function créée ou modifiée
- ✅ 0 migration SQL
- ✅ 0 modification `config.toml`
- ✅ 0 modification des règles R2 dans `pad_nst_recommendation_rules`
- ✅ 0 runtime modifié

---

## 1. Contexte et dépendances

### Dépendances résolues

| Dépendance | Statut |
|------------|--------|
| PAD-NST-2E-C-B | ✅ DÉPLOYÉ — Edge Function `get-pad-nst-suggestions` (SELECT, TO_CONFIRM, requireUser, RLS) |
| PAD-NST-P1-C | ✅ CLOS — Guide des 5 conflits critiques NST→PAD (commit `708099b`) |
| PAD-NST-2E-C-A | ✅ CLOS — Plan runtime documentaire |
| PAD-R1B-GOVERNANCE | ✅ DÉCISION ACTÉE — Option A, doctrine amount C |
| PAD-NST-2E-B-R2 | ✅ CLOS — 88 règles TIER-A/B en base |

### Contrainte de traçabilité GitHub

> Le commit `708099b` (P1-C + décision CTO filtre confidence) est **local** sur la branche `work` au moment de la rédaction de ce document. Un `git push origin work` est **requis avant toute implémentation** pour que Lovable et l'équipe puissent accéder aux fichiers.

### Ce qui reste NO-GO

| Phase | Statut |
|-------|--------|
| C-C run-pricing | 🚫 NO-GO strict — dépend de C-D, C-B-LOG, C-E |
| C-D implémentation UI | 🔒 Pas encore autorisée — GO CTO séparé requis |
| C-B-LOG audit log | 🚫 NO-GO — migration dédiée, GO CTO séparé |
| C-E pilote terrain | 🚫 NO-GO — après C-D ou protocole manuel |

---

## 2. Objectif de l'UI C-D

L'UI C-D permet à l'opérateur de :

1. **Voir** les suggestions PAD-NST retournées par `get-pad-nst-suggestions` pour un dossier donné
2. **Comprendre** la justification de chaque suggestion (code NST, catégorie PAD, evidence, confidence, sources)
3. **Décider manuellement** quelle catégorie PAD retenir ou ignorer
4. **Ne jamais valider automatiquement** aucune suggestion

L'UI C-D **ne calcule pas de devis**, **ne modifie pas les totaux**, et **ne branche pas `run-pricing`**.

---

## 3. Source de données

L'UI appelle exclusivement `get-pad-nst-suggestions` (Edge Function C-B) :

```
POST /get-pad-nst-suggestions
Authorization: Bearer <JWT utilisateur>
Body: { "nst_level": "group"|"division", "nst_code": string }
```

Réponse type :

```json
{
  "ok": true,
  "source_type": "TO_CONFIRM",
  "requires_operator_confirmation": true,
  "suggestions": [
    {
      "rule_id": "uuid",
      "nst_level": "group",
      "nst_code": "08.4",
      "pad_category": "T03",
      "confidence": 0.45,
      "evidence_level": "expert_rule",
      "notes": "Résines plastiques en granules -> T03 : matières premières...",
      "source_document": "PAD_NST_RECOMMENDATION_ENGINE.md",
      "source_reference": "Section 6 — Rapprochement indicatif NST -> familles PAD"
    }
  ]
}
```

---

## 4. Champs affichés par suggestion

Chaque carte de suggestion doit afficher **tous** les champs suivants :

| Champ | Source | Affichage |
|-------|--------|-----------|
| `pad_category` | réponse C-B | Code catégorie (ex : T03) |
| `pad_category_label` | table `pad_categories` ou dictionnaire local | Label réel (ex : « Acides, sucres et matières premières ») |
| `confidence` | réponse C-B | Valeur numérique + indicateur visuel (voir § 6) |
| `evidence_level` | réponse C-B | Libellé traduit (voir § 4.1) |
| `nst_level` | réponse C-B | « Groupe NST » ou « Division NST » |
| `nst_code` | réponse C-B | Code NST (ex : 08.4) |
| `notes` | réponse C-B | Texte justificatif complet |
| `source_document` | réponse C-B | Nom du document source |
| `source_reference` | réponse C-B | Référence précise dans le document |
| `source_type` | réponse C-B | Toujours « TO_CONFIRM » |
| `requires_operator_confirmation` | réponse C-B | Toujours `true` — afficher badge visible |

### 4.1 Traduction `evidence_level`

| Valeur DB | Libellé UI |
|-----------|-----------|
| `expert_rule` | Règle experte PAD-NST |
| `nstr_bridge_inferred` | Inférée par correspondance NST/R→NST |

---

## 5. États UI

L'interface doit gérer les 7 états suivants :

### État 1 — Aucune suggestion

```
⚪ Aucune correspondance NST trouvée pour ce dossier.
   Catégorie PAD à saisir manuellement.
```

Action disponible : saisie manuelle de catégorie PAD (existante dans l'UI actuelle).

### État 2 — Une seule suggestion

Afficher la carte complète (§ 4) avec :
- Indicateur de confiance (§ 6)
- Badge TO_CONFIRM visible
- Alerte conflit si applicable (§ 7)
- Actions opérateur (§ 9)

### État 3 — Plusieurs suggestions

Afficher toutes les suggestions **ordonnées par `confidence DESC`** (l'ordre est garanti par C-B).  
Chaque carte est indépendante. L'opérateur sélectionne celle qu'il retient ou ignore toutes.

### État 4 — Conflit critique P1-C détecté

Voir § 7. Afficher une alerte spécifique au-dessus des cartes.

### État 5 — Suggestion faible (`confidence < 0.60`)

Afficher la carte avec indicateur visuel « Prudence » et mention :  
`Règle à faible confiance — validation opérateur particulièrement recommandée`

### État 6 — Erreur API C-B

```
⚠️ Impossible de récupérer les suggestions NST.
   [Réessayer]   [Saisir manuellement]
```

Ne pas bloquer le dossier. La saisie manuelle reste toujours disponible.

### État 7 — Catégorie PAD opérateur déjà saisie

Si `cargo.pad_category` est déjà défini par l'opérateur, afficher en lecture seule :  
`Catégorie PAD saisie par l'opérateur : [T0X] — [label]`  
Ne pas afficher de suggestions par-dessus une décision opérateur existante.

---

## 6. Règles d'affichage de la confidence

| Plage | Indicateur visuel | Libellé |
|-------|------------------|---------|
| 0.80 – 0.85 | 🟢 Forte | Forte suggestion — validation obligatoire |
| 0.60 – 0.79 | 🟡 Probable | Suggestion probable — à confirmer |
| 0.45 – 0.59 | 🟠 Faible | Suggestion faible — prudence |
| < 0.45 | ❌ (ne doit pas apparaître) | Filtré par les règles R2 (min conf = 0.45) |

> **Rappel** : quelle que soit la confidence, aucune suggestion ne devient automatiquement OFFICIAL. La confidence est un indicateur d'aide à la décision, pas un seuil d'activation.

---

## 7. Conflits critiques P1-C — Alertes UI

Lorsqu'une suggestion appartient à l'une des 5 familles conflictuelles documentées dans `PAD_NST_P1_C_CONFLICTS_GUIDE.md`, l'UI doit afficher une alerte au-dessus des cartes :

| Famille | Codes NST concernés | Alerte |
|---------|---------------------|--------|
| Ciment / Clinker | division 09, group 09.2, group 03.5 | « Ciment ou clinker ? Vérifiez si la marchandise est conditionnée (→ T05) ou en vrac non conditionné (→ T07) » |
| Phosphates / Engrais | group 03.3, group 08.3 | « Phosphates ou engrais formulés ? T08 est recommandé pour les minéraux bruts. T06 uniquement si contexte hydrocarbure confirmé. » |
| Pétrole / Hydrocarbures | division 02, division 07, group 07.3 | « T11 pour pétrole brut/essences/bitumes. T06 pour gasoil/diesel/fuel/butane. Opérateur indispensable si libellé incomplet. » |
| Plastiques | group 08.4, group 08.6, division 08 | « Plastique brut/granule → T03. Tuyau/film/produit fini → T12. Vérifiez le stade de transformation. » |
| Gaz naturel | group 02.3 | « ⚠️ Aucune catégorie PAD dominante pour le gaz naturel. Validation opérateur obligatoire — préciser forme physique (bouteille, vrac, GNL, pipeline). » |

---

## 8. Actions opérateur autorisées

| Action | Description |
|--------|-------------|
| ✅ Copier la suggestion | Copier le code PAD dans le champ de saisie opérateur |
| ✅ Ouvrir la justification | Afficher le détail complet (notes, source_document, source_reference) |
| ✅ Choisir manuellement | Saisir ou corriger la catégorie PAD librement |
| ✅ Ignorer la suggestion | Passer en saisie manuelle sans retenir la suggestion |
| ✅ Demander info client | Marquer le dossier en attente d'information supplémentaire |
| ✅ Relancer pricing | Après saisie manuelle validée → déclencher `set-case-fact` → re-run pricing (flux existant) |

---

## 9. Actions interdites (invariants non négociables)

| Action interdite | Raison |
|-----------------|--------|
| ❌ Bouton « Auto-valider » / « Appliquer » automatique | Toute validation doit être un acte opérateur conscient |
| ❌ Passage automatique en `OFFICIAL` | `source.type = "TO_CONFIRM"` toujours pour les suggestions NST |
| ❌ Écriture automatique dans `pad_designation_aliases` | Seule action opérateur explicite autorise la création d'alias |
| ❌ Écriture automatique dans `cargo.pad_category` | Idem |
| ❌ Création de `amount` | Aucune suggestion NST ne produit un montant |
| ❌ Création de `estimated_amount` | Idem — séparé et jamais automatique |
| ❌ Inclusion dans `total_ht` / `total_ttc` | Les catégories TO_CONFIRM sont exclues des totaux (doctrine PAD-R1B) |
| ❌ Branchement `run-pricing` depuis l'UI C-D | C-C n'est pas autorisé — l'UI ne déclenche pas le moteur de pricing |

---

## 10. Préconditions avant implémentation UI

Toutes les conditions suivantes doivent être vérifiées avant tout code frontend ou Lovable :

| # | Précondition | Vérification |
|---|-------------|-------------|
| 1 | Commit `708099b` poussé sur `work` | `git push origin work` depuis le terminal + vérification GitHub |
| 2 | `get-pad-nst-suggestions` accessible en production | Test curl depuis Lovable ou Supabase dashboard |
| 3 | `PAD_NST_P1_C_CONFLICTS_GUIDE.md` visible sur branche `work` | GitHub UI |
| 4 | Liste des `pad_category_label` disponible côté frontend | Table `pad_categories` ou dictionnaire local — à confirmer avec Lovable |
| 5 | Emplacement UI cible défini | À préciser : page dossier existante ? widget latéral ? onglet dédié ? |
| 6 | GO CTO séparé pour C-D implémentation | Ce document est la spec — le GO d'implémentation est une décision séparée |

---

## 11. Hors périmètre de C-D

Les points suivants **ne font pas partie de C-D** et seront traités dans des phases séparées :

| Sujet | Phase |
|-------|-------|
| Traçabilité des recommandations et décisions opérateur | C-B-LOG (migration `pad_recommendation_audit_log`) |
| Branchement `run-pricing` après catégorie validée | C-C (NO-GO strict) |
| Calibration des seuils de confidence | C-E (pilote terrain) |
| Apprentissage supervisé / création automatique d'alias | PAD-R4 (différé) |

---

## 12. Séquence de validation avant GO C-D implémentation

```text
1. git push origin work (commit 708099b)
2. Vérification GitHub : 3 fichiers visibles sur work
3. Test get-pad-nst-suggestions en production
4. Confirmation emplacement UI cible
5. GO CTO C-D implémentation → brief Lovable
```

---

## Références

| Document | Rôle |
|----------|------|
| `PAD_NST_2E_C_B_VERIFICATION_REPORT.md` | Edge Function C-B — spec interface |
| `PAD_NST_P1_C_CONFLICTS_GUIDE.md` | Doctrine des 5 conflits critiques |
| `PAD_NST_2E_C_A_RUNTIME_PLAN.md` | Architecture runtime — hiérarchie de résolution PAD |
| `PAD_R1B_GOVERNANCE_DECISION.md` | Doctrine amount — TO_CONFIRM + estimated_amount séparé |
| `PAD_NST_RECOMMENDATION_ENGINE.md` | Doctrine NST→PAD (corrigée DOC-R1) |
| `docs/DEFERRED_BACKLOG.md` | Séquence C-B→C-D→C-B-LOG→C-E→C-C |
