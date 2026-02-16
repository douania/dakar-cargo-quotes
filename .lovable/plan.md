
# Audit CTO : Correctifs P0 run-pricing / quotation-engine

## Contexte

L'audit ChatGPT a identifie 2 bugs confirmes par analyse directe du code et 1 validation forensique sur un cas reel.

---

## Verification forensique — cas reel (case acddafa7)

Donnees en base :
- `cargoValue = 4655`, `cargoValueCurrency = EUR`
- Conversion attendue : `4655 * 655.957 = 3,053,479 FCFA`
- `duty_breakdown` : `caf[0]=128,363 + caf[1]=2,925,117 = 3,053,480 FCFA` -- Correct (arrondi 1 FCFA)

Verification TVA article 2 (HS 8507.20) :
- `base_tva = 3,539,391` = `caf(2,925,117) + dd(585,023) + rs(29,251) + surtaxe(0) + tin(0) + tci(0)` = `3,539,391` -- Correct
- `tva = 3,539,391 * 18% = 637,090` -- Correct
- PCS/PCC/COSEC exclus de la base TVA -- Correct

Totaux :
- `debours = 1,341,575` (somme duties articles 1+2 = 34,632 + 1,306,942 = 1,341,574) -- Correct (arrondi 1 FCFA)
- `honoraires = 150,000 HT` + `TVA 18% = 27,000` = `177,000 TTC`
- `total_ttc = 1,341,575 + 177,000 = 1,518,575` -- Correct

**Verdict : Le moteur de calcul est fiable.** Les 2 bugs identifies sont reels mais n'affectent pas les chiffres du duty_breakdown.

---

## Bug 1 (P0) : metadata.caf calcule sans conversion devise

**Fichier** : `supabase/functions/quotation-engine/index.ts`
**Ligne** : ~2298

**Probleme** : Le CAF des metadata est calcule avec `request.cargoValue` brut (potentiellement en EUR), alors que le CAF du duty_breakdown utilise `cargoValueFCFA` (correctement converti).

```text
Ligne 2035 (debours, correct) :  calculateCAF({ invoiceValue: cargoValueFCFA })
Ligne 2298 (metadata, faux)   :  calculateCAF({ invoiceValue: request.cargoValue })
```

**Impact** : `metadata.caf.value` affiche un CAF faux quand la devise n'est pas XOF. Utilise pour debug/UI/audit.

**Correctif** : Remplacer `request.cargoValue` par la valeur convertie en FCFA. La variable `cargoValueFCFA` existe deja dans la fonction `generateQuotationLines()`. Il faut la faire remonter au scope du handler principal.

Approche chirurgicale :
1. Faire retourner `cargoValueFCFA` depuis `generateQuotationLines()` dans l'objet resultat
2. Utiliser cette valeur dans le `calculateCAF` du metadata (ligne 2298)

---

## Bug 2 (P1) : Double break dans run-pricing

**Fichier** : `supabase/functions/run-pricing/index.ts`
**Lignes** : 521-523

**Probleme** : Un `break;` surnumeraire apres le bloc `case "cargo.containers"`.

```text
      inputs.containers = Array.isArray(parsedContainers) ? parsedContainers : [];
      break;      // <-- break du bloc (correct)
    }
      break;      // <-- break orphelin (dead code / erreur)
```

**Impact** : Dead code. Pas d'impact fonctionnel actuellement (le compilateur accepte), mais code incorrect et confusant pour les audits.

**Correctif** : Supprimer la ligne 523 (`break;` surnumeraire).

---

## Resume des modifications

| # | Fichier | Type | Impact |
|---|---------|------|--------|
| 1 | `quotation-engine/index.ts` | Bug CAF metadata | P0 - Valeur CAF fausse en metadata quand devise != XOF |
| 2 | `run-pricing/index.ts` | Dead code break | P1 - Nettoyage, zero impact fonctionnel |

---

## Section technique

### Modification 1 : quotation-engine/index.ts

Etape A : Modifier le retour de `generateQuotationLines()` pour inclure `cargoValueFCFA`.

La fonction retourne actuellement `{ lines, totals, dutyBreakdown, warnings }`. Ajouter `cargoValueFCFA` a cet objet.

Etape B : Dans le handler principal (action `generate`), recuperer `cargoValueFCFA` depuis le resultat et l'utiliser dans le calculateCAF du metadata :

```typescript
// Avant (ligne ~2298)
const caf = calculateCAF({
  incoterm: request.incoterm || 'CIF',
  invoiceValue: request.cargoValue   // BUG: valeur brute, pas convertie
});

// Apres
const caf = calculateCAF({
  incoterm: request.incoterm || 'CIF',
  invoiceValue: result.cargoValueFCFA || request.cargoValue  // Converti si disponible
});
```

### Modification 2 : run-pricing/index.ts

Supprimer la ligne 523 (le `break;` orphelin apres le bloc `cargo.containers`).
