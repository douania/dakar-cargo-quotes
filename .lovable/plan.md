

# Plan : Archiver la validation + créer la checklist proportionnalité HS

## Contexte

Le fix Taleb est validé à 100% par le CTO. Deux livrables demandés :

1. **Archiver la trace audit** dans les notes de release du projet
2. **Créer la checklist standard "proportionnalité HS"** réutilisable pour tout futur dossier multi-HS sortant en "équitable"

## Actions

### 1 — Créer/mettre à jour le fichier `.lovable/PHASE_15_NOTES.md`

Ajouter une section "Fix Taleb — Proportionnalité HS" avec :
- Case ID : `57f0043c-1316-4837-a38e-c07e055d2373`
- Run validé : #8
- Cause racine : ordre d'exécution M3.4c/M3.4b + match exact 10 digits
- Fix : pré-enrichissement `hsSet` avec SH6+0000 depuis `docTexts`
- Fichier modifié : `build-case-puzzle/index.ts` (L1609-1619)
- Aucune modification du `quotation-engine`

### 2 — Créer le fichier `audit/checklists/proportionnalite_hs.md`

Checklist en 5 items applicable par tout opérateur/dev quand un dossier multi-HS sort en répartition équitable :

1. Vérifier `cargo.hs_code` — contient-il bien N codes (N >= 2) ?
2. Vérifier `cargo.articles_detail` — existe-t-il avec `is_current = true` ? Si absent → relancer `build-case-puzzle`
3. Comparer les HS des articles vs les HS du dossier — match exact 10 digits ? Si mismatch (ex: `...1000` vs `...0000`) → le pré-enrichissement SH6 n'a pas fonctionné ou le fact n'a pas été rafraîchi
4. Si fact existant bloque la ré-extraction → désactiver `cargo.articles_detail` (`is_current = false`) puis relancer `build-case-puzzle`
5. Après `run-pricing` → vérifier que `duty_breakdown` contient des CAF différents entre HS et que la note mentionne "proportionnelle"

### 3 — Hardening futur (Option B — documenté, pas implémenté)

Documenter dans les notes qu'un flag `force_articles_detail: true` serait utile pour éviter les manipulations SQL manuelles. Non prioritaire.

## Fichiers concernés

| Fichier | Action |
|---------|--------|
| `.lovable/PHASE_15_NOTES.md` | Mise à jour (ajout section) |
| `audit/checklists/proportionnalite_hs.md` | Création |

