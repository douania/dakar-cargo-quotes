

# Diagnostic confirme : le bug est dans la detection de l'ancre

## Cause racine identifiee (logs runtime)

```
[cargo-value doc-regex] Stacked anchor at line 33: "Designation\tQuantite\tPrix Unit. HT\tTVA\tTotal HT EUR"
[cargo-value doc-regex] Label block: 3 labels, amounts: 1 {"labels":["totalValue","?","?"],"amounts":[101]}
[cargo-value doc-regex] No candidate found in any document
```

L'ancre se fixe sur la **ligne d'en-tete du tableau** ("Designation\tQuantite\tPrix Unit. HT\tTVA\tTotal HT EUR") au lieu du **bloc recapitulatif** ("Sous-total HT", "Transport Export", etc.) situe plus bas dans le document.

Le regex `/(Montant|Total)\s+HT/i` matche "Total HT EUR" dans cette ligne de colonnes. C'est la premiere occurrence, donc l'ancre s'y arrete. Le labelBlock construit a partir de la est absurde (lignes de detail produit), et les montants extraits sont faux (101 = une quantite).

## Probleme secondaire : cargo.value absent

`cargo.freight_cost = 19500` et `cargo.freight_currency = EUR` existent deja (source `ai_extraction`), mais `cargo.value` n'est pas injecte parce que `bestCandidate` reste null (extraction echouee).

## Correction : 3 points

### 1. Exclure les lignes tabulees de l'ancre

Les en-tetes de tableau PDF contiennent des tabulations (`\t`). Une ligne avec 2+ colonnes tabulees n'est jamais un label recapitulatif. Ajouter un guard :

```typescript
// Skip tabulated lines (table headers like "Designation\tQuantite\t...")
if (lines[i].includes('\t') && lines[i].split('\t').length >= 3) continue;
```

### 2. Privilegier Sous-total HT comme ancre primaire

Au lieu de s'arreter au premier match de n'importe quel pattern, chercher d'abord `Sous-total HT` specifiquement. Ne fallback sur les autres patterns que si "Sous-total HT" n'est pas trouve.

```typescript
// Priority: look for "Sous-total HT" first (most specific anchor)
let anchorIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\t') && lines[i].split('\t').length >= 3) continue;
  if (/Sous[- ]?total\s+HT/i.test(lines[i])) {
    anchorIdx = i;
    break;
  }
}
// Fallback: any label pattern (excluding tabulated lines)
if (anchorIdx < 0) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('\t') && lines[i].split('\t').length >= 3) continue;
    if (labelPatterns.some(lp => lp.regex.test(lines[i]))) {
      anchorIdx = i;
      break;
    }
  }
}
```

### 3. Exclure les lignes tabulees du label block

Meme garde dans la boucle de construction du labelBlock : ignorer les lignes multi-colonnes tabulees.

## Fichier modifie

| Fichier | Lignes | Action |
|---------|--------|--------|
| `supabase/functions/build-case-puzzle/index.ts` | ~470-498 | Ajout garde anti-tab dans ancre + priorite Sous-total HT + garde dans labelBlock |

## Resultat attendu

Avec le texte reel du document Taleb :
- L'ancre saute la ligne 33 (en-tete tabule) et trouve "Sous-total HT" plus bas
- LabelBlock : Sous-total HT, Transport Export, Montant HT, Total TTC...
- Amounts : 945995.26, 19500.00, 965495.26, 965495.26
- `bestCandidate.goodsValue = 945995.26`
- Injection : `cargo.value = 945995.26`, `cargo.value_currency = EUR`

## Securite

- Zero changement de logique d'injection ou de guard
- Le garde `\t` count >= 3 est specifique aux en-tetes de tableau PDF
- Le premier pass (ligne par ligne) reste inchange
- Redeploiement force apres modification

