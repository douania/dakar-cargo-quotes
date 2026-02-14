

# Patch M3.4.1 — 3 corrections chirurgicales

## Contexte

Le test de regression (`pricing_engine_regression.test.ts`) contient deja la logique cible. Les 3 corrections alignent le code de production sur cette reference.

---

## Correction 1 — Conversion devise article en FCFA

**Fichier** : `supabase/functions/quotation-engine/index.ts`

**Probleme** : Ligne 2057, `art.value` est utilise brut sans conversion devise. Si un article est en EUR, la repartition CAF est faussee.

**Action** : Ajouter une fonction helper `convertArticleValueToFCFA` (identique a celle du test) et l'appliquer dans la boucle de construction du `detailMap`.

```text
// Ajouter avant la section CAF distribution (~ligne 2048) :
function convertArticleValueToFCFA(value: number, currency: string): number {
  const cur = (currency || 'XOF').toUpperCase();
  if (cur === 'XOF' || cur === 'FCFA' || cur === 'CFA') return value;
  if (cur === 'EUR') return value * 655.957;
  return value; // devise non supportee, fallback brut
}

// Ligne 2057, remplacer :
detailMap.set(normKey, (detailMap.get(normKey) || 0) + art.value);

// Par :
const valueFCFA = convertArticleValueToFCFA(art.value, art.currency);
detailMap.set(normKey, (detailMap.get(normKey) || 0) + valueFCFA);
```

Et recalculer `totalEXW` depuis le `detailMap` converti (pas depuis `request.articlesDetail` brut) :

```text
// Ligne 2060, remplacer :
const totalEXW = request.articlesDetail.reduce((sum, a) => sum + a.value, 0);

// Par :
const totalEXW = Array.from(detailMap.values()).reduce((sum, v) => sum + v, 0);
```

---

## Correction 2 — Guard `coveredCount` pour repartition proportionnelle

**Fichier** : `supabase/functions/quotation-engine/index.ts`

**Probleme** : Ligne 2084, le guard `cafDistribution.length !== hsCodes.length` ne detecte pas les HS codes sans valeur EXW. Si un HS code est present dans `hsCodes` mais absent de `articlesDetail`, il recoit un ratio de 0, faussant la repartition.

**Action** : Remplacer le bloc lignes 2062-2081 par la logique `coveredCount` du test de regression :

```text
if (totalEXW > 0) {
  // Coverage guard: verifier combien de HS sont couverts
  const coveredCount = hsCodes.filter(h => {
    const hsNorm = h.replace(/\D/g, '');
    return (detailMap.get(hsNorm) || 0) > 0;
  }).length;

  if (coveredCount !== hsCodes.length) {
    // Couverture incomplete → fallback equal
    console.log(`[Engine] Incomplete coverage: ${coveredCount}/${hsCodes.length} — equal distribution`);
    cafDistribution = hsCodes.map(() => caf.cafValue / hsCodes.length);
    distributionMethod = 'equal';
  } else {
    // Proportional distribution
    let distributedSum = 0;
    for (let i = 0; i < hsCodes.length; i++) {
      const hsNorm = hsCodes[i].replace(/\D/g, '');
      const exwValue = detailMap.get(hsNorm) || 0;
      if (i === hsCodes.length - 1) {
        cafDistribution.push(caf.cafValue - distributedSum);
      } else {
        const ratio = exwValue / totalEXW;
        const cafArticle = Math.round(caf.cafValue * ratio);
        cafDistribution.push(cafArticle);
        distributedSum += cafArticle;
      }
    }
    distributionMethod = 'proportional';
    console.log(`[Engine] Proportional CAF: totalEXW=${totalEXW}, distribution=${cafDistribution.join(',')}`);
  }
}
```

Et supprimer le fallback redondant lignes 2083-2087 (le `coveredCount` le gere deja internalement).

---

## Correction 3 — Whitelist `cargo.articles_detail` dans set-case-fact

**Fichier** : `supabase/functions/set-case-fact/index.ts`

**Probleme** : L'operateur ne peut pas injecter manuellement le detail des articles car `cargo.articles_detail` n'est pas dans la whitelist.

**Action** : Ligne 18, ajouter l'entree :

```text
const ALLOWED_FACT_KEYS = new Set([
  "client.code",
  "cargo.caf_value",
  "cargo.weight_kg",
  "cargo.chargeable_weight_kg",
  "cargo.articles_detail",      // <-- ajout
  "routing.incoterm",
]);
```

---

## Resume des modifications

| Fichier | Lignes | Modification |
|---|---|---|
| `quotation-engine/index.ts` | ~2048 | Ajout helper `convertArticleValueToFCFA` |
| `quotation-engine/index.ts` | 2057 | Conversion `art.value` via helper |
| `quotation-engine/index.ts` | 2060 | `totalEXW` calcule depuis `detailMap` |
| `quotation-engine/index.ts` | 2062-2087 | Remplacement par logique `coveredCount` |
| `set-case-fact/index.ts` | 18 | Ajout `cargo.articles_detail` |

## Deploiement

Les deux edge functions (`quotation-engine` et `set-case-fact`) seront redeployees apres modification.

## Risque

Faible. Les 3 corrections sont alignees sur le test de regression existant. Aucune modification de schema DB, aucun changement de contrat API.

