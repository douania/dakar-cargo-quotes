# MAP-8 — Audit Runtime `cargo.pad_category` → DROIT_PASSAGE / THD / PORT_TAX

**Date** : 2026-05-14  
**Type** : Audit read-only — aucune écriture DB, aucun patch runtime, aucune modification `src/` ni `supabase/functions/` ni `supabase/config.toml`, aucun seed, aucun dossier client touché.  
**Périmètre** : Vérifier la chaîne runtime effective entre le pivot `cargo.pad_category` (propagé par MAP-7B) et les charges portuaires / compagnie (`DROIT_PASSAGE`, `THD`, `PORT_TAX`) dans `run-pricing`.  
**Verdict** : `MAP_8_RUNTIME_PAD_CATEGORY_TO_PORT_CHARGES_AUDIT_READY`

---

## §1 — Runtime chain `cargo.pad_category` dans `run-pricing`

| Étape | Fichier / Ligne | Description |
|-------|-----------------|-------------|
| Lecture pivot | `run-pricing/index.ts` L2913 | `inputs.padCategory = facts['cargo.pad_category']?.value` |
| Requête tarif | `run-pricing/index.ts` L1959–2070 | Branche autonome « PAD Droit de Passage » : query `port_tariffs` `category='DROIT_PASSAGE'` filtré sur `classification = inputs.padCategory` ET `operation_type = 'IMPORT'` ET `cargo_type = 'CONTENEUR'` |
| Émission ligne | `run-pricing/index.ts` L2200 | `PAD_DROIT_PASSAGE` émis **uniquement si** `padRateFcfaPerTon > 0` |
| Dépendances | `run-pricing/index.ts` L2180–2195 | `padRateFcfaPerTon` dérivé de `facts['cargo.pad_rate_fcfa_per_ton']?.value` (2nd fact obligatoire) ; `cargoWeight` = poids total container (3ème fact requis pour le calcul montant) |

**Verdict §1** : `cargo.pad_category` est bien **lu** par `run-pricing`, mais il ne **suffit pas seul**. L'émission `PAD_DROIT_PASSAGE` est conditionnée par l'existence conjointe de **3 facts** :
1. `cargo.pad_category` (T01..T14)
2. `cargo.pad_rate_fcfa_per_ton` (montant FCFA/tonne)
3. `cargoWeight` (poids total marchandise en kg)

---

## §2 — DB facts actuels (production)

| `fact_key` | Total facts | `is_current` | Sources observées |
|------------|-------------|--------------|-------------------|
| `cargo.pad_category` | 5 | 3 | `manual_input`, `operator` |
| `cargo.pad_rate_fcfa_per_ton` | 5 | 3 | `manual_input`, `operator` |

**Correspondance croisée** : les 3 dossiers actuellement `is_current=true` avec `cargo.pad_category` ont **tous** également `cargo.pad_rate_fcfa_per_ton` (HAS_RATE_FACT). Aucun dossier n'a `cargo.pad_category` sans `cargo.pad_rate_fcfa_per_ton`.

Exemples de valeurs `cargo.pad_category` actives :
- T07
- T12
- T01

---

## §3 — DB tariffs `port_tariffs` — joignabilité sur `classification`

### 3.1 `DROIT_PASSAGE IMPORT`

- **Nombre de lignes actives** : 38
- **Provider** : PAD (100 %)
- **Unité** : PER_TONNE (100 %)
- **Cargo type** : CONTENEUR + CONVENTIONNEL
- **Classification** : T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, P01, P02, P03, P04, P05
- **Format** : brut (`T01`, `T07`, `T12`) — **match direct** avec `cargo.pad_category`

**Verdict 3.1** : les 3 dossiers actuels (T07, T12, T01) **matchent** chacun 2 lignes `DROIT_PASSAGE IMPORT` (CONTENEUR + CONVENTIONNEL). La jointure théorique est **possible**.

### 3.2 `THD IMPORT`

- **Nombre de lignes actives** : 19
- **Provider** : HAPAG_LLOYD (100 %)
- **Unité** : FCFA/TONNE (100 %)
- **Classification** : texte long, ex. `T01 - Drinks, liquids, oils in barrels and boxes`, `T07 - Cereals in bulk in containers`, `T12 - Ores and metals in bulk in containers`
- **Format** : texte descriptif — **ne matche pas** `cargo.pad_category` brut (`T01`, `T07`, `T12`)

**Verdict 3.2** : `THD IMPORT` ne peut pas être joint directement sur `cargo.pad_category` en l'état. La chaîne THD est une **chaîne carrier/description séparée** (HAPAG_LLOYD), pas un usage de `cargo.pad_category`.

### 3.3 `PORT_TAX IMPORT`

- **Nombre de lignes actives** : **0**
- `PORT_TAX` = 2 lignes TRANSIT only (CONTENEUR_20 <15t, CONTENEUR_40 15-25t)

**Verdict 3.3** : le pivot `pad_category × PORT_TAX × IMPORT` reste **vide** (inchangé depuis V1).

---

## §4 — Chaîne THD : carrier/description séparée

`THD` (Terminal Handling — compagnie) est géré dans `quotation-engine/index.ts` (L1085) comme une charge compagnie, pas comme une taxe portuaire PAD. Les lookups utilisent :
- `category = 'THD'`
- `provider = carrier_name` (ex. HAPAG_LLOYD)
- `classification = cargo_description_text` (texte long PAD 2006)

→ `cargo.pad_category` n'est **pas** le pivot naturel de THD. Le match se fait sur la désignation textuelle brute de la marchandise, pas sur le code T-class.

---

## §5 — Risque principal identifié

**MAP-7B propage `cargo.pad_category` mais ne propage pas automatiquement `cargo.pad_rate_fcfa_per_ton`.**

Scénario de blocage :
1. Opérateur clique « Propager au dossier » sur un candidat `pad_category` (T07).
2. MAP-7B crée/majore `cargo.pad_category = T07`.
3. `run-pricing` lit `cargo.pad_category = T07` et trouve un match `DROIT_PASSAGE IMPORT`.
4. Mais `cargo.pad_rate_fcfa_per_ton` est **absent** → `padRateFcfaPerTon = 0` → condition L2200 échoue.
5. **Résultat** : `PAD_DROIT_PASSAGE` n'est **pas émis**. Un blocage silencieux (`pricing.pad_category` avec un écart non résolu).

**Ce risque est actuellement masqué** car les 3 dossiers en production ont été créés manuellement avec les 2 facts conjoints (opérateur a saisi à la fois la catégorie PAD et le taux FCFA/tonne). Si MAP-7B est activé en runtime client sur un dossier sans `cargo.pad_rate_fcfa_per_ton` préexistant, le pricing DROIT_PASSAGE sera bloqué.

---

## §6 — Recommandation

**Ouvrir MAP-8B** en plan séparé pour :  
**Matérialiser `cargo.pad_rate_fcfa_per_ton` automatiquement depuis `port_tariffs` `DROIT_PASSAGE IMPORT CONTENEUR` lors de la propagation `pad_category`.**

Principe : si le wrapper MAP-7B propage `cargo.pad_category`, il devrait — sous réserve d'un GO CTO séparé — également requêter `port_tariffs` pour le taux correspondant (classification + IMPORT + CONTENEUR) et propager le taux comme `cargo.pad_rate_fcfa_per_ton`. Cela rendrait la chaîne MAP-7B → DROIT_PASSAGE **autonomement complète** côté runtime, sans action manuelle supplémentaire de l'opérateur.

Garde-fous à définir dans le plan MAP-8B :
- Quel taux choisir si CONTENEUR et CONVENTIONNEL coexistent ?
- Quel provider source of truth (PAD = unique provider DROIT_PASSAGE, donc pas d'ambiguïté provider) ?
- Comment gérer l'absence de taux (classification P01..P05 non couverte par DROIT_PASSAGE) ?
- Idempotence et supersede si le taux est déjà saisi manuellement.

---

## §7 — État de MAPPING-TAX-CHAIN-0

**MAPPING-TAX-CHAIN-0 reste OUVERT.**

- Aucune Option A/B/C/D n'est tranchée par cet audit.
- MAP-8 est un **audit runtime spécifique** (pivot → charges portuaires), pas une décision sur les bridges amont CN/NHM/NSTR/NST.
- MAP-8B (si ouvert) sera un **plan d'exécution séparé**, distinct de MAPPING-TAX-CHAIN-0.

---

## §8 — Garde-fous respectés

| Garde-fou | Statut |
|-----------|--------|
| Aucun `src/` modifié | ✅ |
| Aucune Edge Function modifiée | ✅ |
| Aucune migration | ✅ |
| Aucun `config.toml` modifié | ✅ |
| Aucun `run-pricing` exécuté | ✅ |
| Aucune écriture DB | ✅ |
| Aucun seed | ✅ |
| Aucun GRANT modifié | ✅ |
| Aucune modification `public.supersede_fact` | ✅ |
| Aucun dossier client touché | ✅ |
| Aucune décision Option A/B/C/D | ✅ |
| MAPPING-TAX-CHAIN-0 non clôturé | ✅ |

---

*Document créé en mode audit read-only. Aucun patch exécuté.*
