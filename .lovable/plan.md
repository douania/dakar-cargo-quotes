

# Correctif : Prise en compte de tous les articles (multi-HS codes)

## Diagnostic

Le probleme est une chaine de 3 limitations :

1. **Extraction correcte** : L'analyse de la piece jointe detecte bien 2 codes HS : `["8525.50.00.00", "8507.20.00.00"]`
2. **Stockage aplati** : `build-case-puzzle` les joint en string : `"8525.50.00.00, 8507.20.00.00"` (correct)
3. **Moteur incomplet** : `quotation-engine` (ligne 2040) ne traite que le **premier** code HS et ignore les suivants

```text
Flux actuel :
  attachment: ["8525.50.00.00", "8507.20.00.00"]
       |
  fact: "8525.50.00.00, 8507.20.00.00"
       |
  engine: hsCodes = ["8525.50.00.00", "8507.20.00.00"]
  primaryHsCode = hsCodes[0]  <-- STOP, le 2eme est ignore
```

### Sous-probleme : repartition de la valeur CAF

La piece jointe ne fournit pas de valeur unitaire par article. Le total est de 4 655 EUR pour les 2 articles confondus. Sans repartition, on ne peut pas calculer les droits correctement par article.

**Strategie retenue** : repartition equitable de la valeur CAF entre les articles (CAF / nombre d'articles). C'est une approximation acceptable qui :
- permet de calculer les droits pour chaque code HS avec ses taux specifiques
- produit un total global correct si les taux sont identiques
- signale explicitement l'approximation dans les notes

## Plan d'implementation

### Etape 1 — quotation-engine : boucle sur tous les HS codes

**Fichier** : `supabase/functions/quotation-engine/index.ts` (lignes 2037-2113)

Remplacer le traitement du seul `primaryHsCode` par une boucle sur tous les codes HS :

```text
Avant :
  const hsCodes = request.hsCode.split(...)
  const primaryHsCode = hsCodes[0]    // un seul
  // calcul + push dutyBreakdown + push duties_total

Apres :
  const hsCodes = request.hsCode.split(...)
  const cafPerArticle = caf.cafValue / hsCodes.length  // repartition
  let totalAllDuties = 0

  for (const [idx, hsCode] of hsCodes.entries()) {
    // lookup HS dans la base
    // calcul des droits avec cafPerArticle
    // push dutyBreakdown pour cet article
    // totalAllDuties += articleDuties
  }

  // Une seule ligne duties_total avec le cumul
  lines.push({ id: 'duties_total', amount: totalAllDuties, ... })
```

Points cles :
- La valeur CAF est repartie equitablement entre les articles
- Chaque article a son propre lookup HS et ses propres taux
- Le total global (`duties_total`) est la somme de tous les articles
- Les notes mentionnent "CAF repartie sur N articles"
- Si un code HS n'est pas trouve, un warning est emis pour cet article specifique

### Etape 2 — Aucun changement sur run-pricing

Le champ `duty_breakdown` est deja transmis comme tableau dans `outputs_json`. La boucle produit naturellement plusieurs elements dans le tableau.

### Etape 3 — Aucun changement frontend

Le composant `DutyBreakdownTable` affiche deja tous les elements du tableau `duty_breakdown`. Le badge "1 article" deviendra automatiquement "2 articles".

## Resultat attendu

Apres correctif et relance du pricing sur le dossier LCL 25607 :

```text
duty_breakdown: [
  {
    article_index: 1,
    hs_code: "8525.50.00.00",
    caf: 1526740,          // 4655 EUR / 2 * 655.957
    dd_rate: 5, dd_amount: 76337,
    ...
  },
  {
    article_index: 2,
    hs_code: "8507.20.00.00",
    caf: 1526740,
    dd_rate: 20, dd_amount: 305348,   // taux DD different !
    ...
  }
]
```

Le tableau UI affichera les 2 articles avec leurs taux respectifs.

## Ce qui ne change PAS

- Aucune modification de `run-pricing`
- Aucune modification du frontend
- Aucune modification de la base de donnees
- Les totaux globaux restent corrects (somme des articles)
- La logique CAF reste identique (seule la repartition est ajoutee)

## Fichier modifie

| Fichier | Nature |
|---|---|
| `supabase/functions/quotation-engine/index.ts` | Boucle sur tous les HS codes au lieu du premier seul (~40 lignes modifiees) |

## Limitation connue

La repartition equitable CAF/N est une approximation. Pour une ventilation exacte, il faudrait que l'extraction de la piece jointe (`analyze-attachments`) retourne les valeurs unitaires par article. C'est une amelioration future possible.

