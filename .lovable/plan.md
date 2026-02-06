

# PHASE M1.2 — Normalisation des regles metier critiques

## Objectif
Eliminer les fallbacks non normatifs, connecter les tables existantes, et supprimer les duplications prompt/code/DB. Zero refactor global, zero changement d'API, zero modification UI.

---

## Tache M1.2.1 — Neutralisation des fallbacks non normatifs

**Fichier:** `supabase/functions/quotation-engine/index.ts`

4 fallbacks a neutraliser :

| Fallback | Ligne | Avant | Apres |
|----------|-------|-------|-------|
| THC fallback | ~L879 | `110000 / 220000` avec `type: 'CALCULATED'` | `amount: null`, `type: 'TO_CONFIRM'`, `reason: 'THC non trouve en base'` |
| Transport Mali fallback | ~L1145 | `2600000` avec `type: 'TO_CONFIRM'` | `amount: null` (au lieu d'un montant invente) |
| Transport local fallback | ~L1228 | `350000 * zone.multiplier` avec `type: 'TO_CONFIRM'` | `amount: null` |
| Droits sans HS | ~L1496 | `cafValue * 0.45` avec `type: 'TO_CONFIRM'` | `amount: null` |

**Detail technique :**
- Les 4 lignes gardent leur structure `QuotationLine` existante
- `amount` passe a `null` (deja supporte par le type `amount: number | null`)
- `source.type` = `'TO_CONFIRM'`
- `source.confidence` = `0`
- `notes` = message explicite ("Aucune donnee normative — confirmation humaine requise")
- Le THC fallback (L879) change de `CALCULATED` a `TO_CONFIRM` et `amount: null`

---

## Tache M1.2.2 — Connexion de warehouse_franchise

**Fichier:** `supabase/functions/quotation-engine/index.ts`

Ajouter une nouvelle section apres le bloc "SODATRA FEES" (section 8) :

1. Requeter `warehouse_franchise` avec filtres :
   - `is_active = true`
   - `cargo_type` selon le type d'operation (import/transit/vehicule)
   - `container_type` si applicable
2. Generer une ligne informative `QuotationLine` :
   - `bloc: 'operationnel'`
   - `category: 'Magasinage'`
   - `description: 'Franchise magasinage: X jours (tarif: Y FCFA/tonne/jour apres franchise)'`
   - `amount: 0` (informatif — pas de surcout tant que franchise non depassee)
   - `source.type: 'OFFICIAL'`
3. Si aucune regle trouvee : ligne `TO_CONFIRM` avec `amount: null`

**Tables utilisees :** `warehouse_franchise` (16 enregistrements existants)

---

## Tache M1.2.3 — Connexion de demurrage_rates

**Fichier:** `supabase/functions/quotation-engine/index.ts`

Ajouter une section apres warehouse_franchise :

1. Si `cargoType` = conteneur, requeter `demurrage_rates` :
   - `is_active = true`
   - `carrier` = armateur detecte (ou generique)
   - `container_type` correspondant
2. Generer une ligne `QuotationLine` :
   - `bloc: 'operationnel'`
   - `category: 'Surestaries'`
   - `description: 'Surestaries armateur (franchise X jours, puis Y USD/jour)'`
   - `amount: null` (toujours TO_CONFIRM car depend du temps reel)
   - `source.type: 'TO_CONFIRM'`
   - `notes` detaillant les paliers (jour 1-7, 8-14, 15+)
3. Si aucune donnee : ligne `TO_CONFIRM` generique

**Tables utilisees :** `demurrage_rates` (29 enregistrements existants)

---

## Tache M1.2.4 — Connexion de holidays_pad

**Fichier:** `supabase/functions/quotation-engine/index.ts`

Integration legere dans la section franchise (M1.2.2) :

1. Au moment de generer la ligne franchise, requeter `holidays_pad` :
   - `holiday_date` dans les 30 prochains jours (ou annee en cours pour `is_recurring`)
2. Ajouter dans les `notes` de la ligne franchise : "X jours feries PAD dans les 30j — franchise effective peut etre reduite"
3. Pas de modification du calcul de franchise lui-meme (reste informatif)

**Tables utilisees :** `holidays_pad`

---

## Tache M1.2.5 — Suppression des duplications prompt

**Fichier:** `supabase/functions/_shared/prompts.ts`

Remplacer les lignes 121-154 (section "GRILLES TARIFAIRES OFFICIELLES" + "FRANCHISES MAGASINAGE" + "HONORAIRES SODATRA") par :

```
GRILLES TARIFAIRES ET RÈGLES DE CALCUL

Les montants (THC, franchises magasinage, honoraires, droits et taxes)
sont calculés automatiquement par le moteur de cotation à partir des
grilles tarifaires officielles présentes dans le système.

Tu ne dois JAMAIS inventer ou estimer un montant.
Si le moteur retourne une ligne "À CONFIRMER", tu dois le signaler
clairement au client et demander les informations manquantes.
```

Cela supprime :
- Les 6 lignes THC chiffrees (C1 a C6)
- Les 3 lignes de franchise chiffrees
- Les 3 lignes d'honoraires chiffrees

---

## Ordre d'execution

1. **M1.2.1** — Neutraliser les 4 fallbacks dans `quotation-engine/index.ts`
2. **M1.2.2** — Ajouter section `warehouse_franchise` dans `quotation-engine/index.ts`
3. **M1.2.4** — Integrer `holidays_pad` dans la section franchise (M1.2.2)
4. **M1.2.3** — Ajouter section `demurrage_rates` dans `quotation-engine/index.ts`
5. **M1.2.5** — Nettoyer `prompts.ts`
6. **Deployer** la edge function `quotation-engine`
7. **Tester** via appels directs a la edge function

## Fichiers modifies (2 seulement)

| Fichier | Nature du changement |
|---------|---------------------|
| `supabase/functions/quotation-engine/index.ts` | Neutraliser 4 fallbacks + ajouter 3 sections (franchise, demurrage, holidays) |
| `supabase/functions/_shared/prompts.ts` | Supprimer valeurs chiffrees L121-154 |

## Tests de validation

Apres deploiement, appeler `quotation-engine` via curl avec :

1. **Sans HS code** : verifier ligne droits avec `amount: null` et `TO_CONFIRM`
2. **Conteneur import Dakar** : verifier ligne franchise depuis `warehouse_franchise`
3. **Armateur connu (MSC)** : verifier ligne demurrage `TO_CONFIRM` avec paliers
4. **Mali sans zone** : verifier transport avec `amount: null` et `TO_CONFIRM`
5. **Prompt** : verifier absence de THC, franchises, honoraires chiffres

## Ce qui ne change PAS

- Aucune API modifiee (meme interface `QuotationRequest` / `QuotationResult`)
- Aucune table DB creee ou modifiee
- Aucun fichier UI touche
- Les calculs normatifs existants (THC officiel, transport Mali avec formule, droits avec HS) restent identiques

