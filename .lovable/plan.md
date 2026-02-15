

# P0 — Correction agregation totals HT / TTC (version CTO-validated)

## Erreur identifiee dans le patch initial

Le patch initial utilisait `engineTotals?.dap` comme base des honoraires HT.

```text
DAP = operationnel + honoraires + border + terminal
```

Appliquer la TVA 18% sur DAP revient a taxer des frais portuaires et terminaux, ce qui est fiscalement incorrect. Seuls les honoraires SODATRA sont soumis a TVA.

Sur le cas `acddafa7`, le bug etait masque car `operationnel = 0`, `border = 0`, `terminal = 0`, donc `dap == honoraires == 150,000`. Mais la correction doit etre structurellement correcte pour tous les cas.

## Donnees factuelles (run #17)

| Champ | Valeur |
|---|---|
| honoraires | 150,000 FCFA |
| operationnel | 0 |
| border | 0 |
| terminal | 0 |
| dap | 150,000 (= somme des 4) |
| debours | 1,341,575 |
| ddp | 1,491,575 |

## Correction chirurgicale

### Fichier unique : `supabase/functions/run-pricing/index.ts`

**Bloc 1 — Lignes 315-323 : Remplacer le calcul totalHt/totalTtc**

Code actuel :
```text
const incotermUpper = (inputs.incoterm || "").toUpperCase();
const totalHt = engineTotals?.ddp
    ?? tariffLines.reduce((sum, l) => sum + (l.amount || l.total || 0), 0);
const totalTtc = engineResponse.totalTtc || engineResponse.total_ttc || totalHt;
const currency = engineResponse.currency || "XOF";
```

Nouveau code :
```text
const incotermUpper = (inputs.incoterm || "").toUpperCase();

// --- P0 FIX: Agregation correcte HT / TTC ---
// Honoraires SODATRA = HT, soumis a TVA 18%
// Debours douaniers = deja TTC (TVA incluse dans duty_breakdown)
// DAP = operationnel + honoraires + border + terminal (NE PAS utiliser comme base TVA)
const honoraires_ht  = engineTotals?.honoraires ?? 0;
const debours        = engineTotals?.debours ?? 0;
const TVA_RATE       = 0.18;
const honoraires_tva = Math.round(honoraires_ht * TVA_RATE);
const honoraires_ttc = honoraires_ht + honoraires_tva;

const totalHt  = honoraires_ht;
const totalTtc = debours + honoraires_ttc;
const currency = engineResponse.currency || "XOF";
```

**Bloc 2 — Ligne ~327 : Enrichir outputsJson.totals**

Remplacer le bloc totals dans outputsJson par :
```text
totals: {
  ht: totalHt,
  ttc: totalTtc,
  honoraires_tva: honoraires_tva,
  currency,
  dap: engineTotals?.dap,
  ddp: engineTotals?.ddp,
  debours: engineTotals?.debours,
  incoterm_applied: incotermUpper || "N/A",
},
```

## Ce qui ne change PAS

- `quotation-engine/index.ts` : aucune modification
- `duty_breakdown` : intact
- Lignes tarifaires : intactes
- Split CAF : intact
- Couche domaine `src/features/quotation/` : intacte

## Verification post-deploiement

Relancer le pricing sur `acddafa7` et verifier :

```text
totals.ht             = 150,000 (honoraires SODATRA)
totals.honoraires_tva = 27,000 (150,000 * 0.18)
totals.ttc            = 1,518,575 (1,341,575 + 150,000 + 27,000)
totals.ht != totals.ttc ✓
```

## Section technique

### Impact
- 1 seul fichier modifie
- 1 variable renommee (`dap` remplacee par `honoraires`)
- Aucune nouvelle dependance
- Aucune migration DB

### Risque
- **Minimal** : la correction est plus restrictive que le patch initial (base TVA plus petite = moins de risque de surcharge)
- Les champs `dap` et `ddp` restent disponibles dans outputsJson pour tracabilite

