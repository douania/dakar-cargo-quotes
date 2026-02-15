

# Fix: Forcer la re-analyse de l'attachment avec le nouveau prompt

## Diagnostic factuel

| Element | Etat |
|---|---|
| Prompt enrichi (analyze-attachments) | Deploye OK |
| Moteur CAF proportionnel (quotation-engine) | Correct |
| build-case-puzzle mapping articles | Correct |
| Attachment `c0a2d839` | Analyse avec ANCIEN prompt, `is_analyzed = true` |
| Fait `cargo.articles_detail` | INEXISTANT dans quote_facts |
| Pricing runs (5 executions) | Toutes avec `articlesDetail: null` |

Le probleme est un probleme de **donnees** et non de code. L'attachment doit etre re-analyse avec le nouveau prompt pour extraire les prix par article.

## Plan en 2 etapes

### Etape 1 — Reset de l'attachment pour forcer re-analyse

Remettre `is_analyzed = false` et vider `extracted_data` sur l'attachment `c0a2d839` pour que la prochaine execution de `analyze-attachments` utilise le nouveau prompt enrichi.

Egalement reset le second attachment `245c01e8` au cas ou il contiendrait aussi des donnees utiles.

### Etape 2 — Re-executer le pipeline

Apres le reset :

1. Appeler `analyze-attachments` sur l'email `3b5310ee` → le nouveau prompt extraira les `articles` avec `unit_price` et `total`
2. Appeler `build-case-puzzle` sur le case `acddafa7` → mappera les articles extraits vers `cargo.articles_detail`
3. Appeler `run-pricing` → le moteur utilisera la repartition proportionnelle

## Resultat attendu

```text
Avant (equal split) :
  Article 1 (8525.50): CAF = 1,526,740 FCFA
  Article 2 (8507.20): CAF = 1,526,740 FCFA

Apres (proportional) :
  EXW Article 1 = 165 EUR → 108,233 FCFA (4.2%)
  EXW Article 2 = 3,760 EUR → 2,466,398 FCFA (95.8%)
  Transport 730 EUR = 478,849 FCFA reparti proportionnellement
  Article 1 CAF = 165 * 655.957 + (478,849 * 165/3925) = ~128,375 FCFA
  Article 2 CAF = 3,760 * 655.957 + (478,849 * 3760/3925) = ~2,925,105 FCFA
```

## Ce qui est modifie

| Action | Type |
|---|---|
| Reset `is_analyzed` sur 2 attachments | Donnees uniquement |
| Re-execution analyze-attachments | Pipeline existant |
| Re-execution build-case-puzzle | Pipeline existant |
| Re-execution run-pricing | Pipeline existant |

Aucune modification de code. Le correctif du prompt est deja deploye.

## Section technique

Les requetes SQL a executer :

```text
UPDATE email_attachments 
SET is_analyzed = false, extracted_data = null
WHERE id IN ('c0a2d839-...', '245c01e8-...')
```

Puis appels sequentiels des 3 edge functions sur le case `acddafa7`.

