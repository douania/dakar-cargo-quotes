# CARRIER-PORT-TAX-1B — Audit read-only

**Date** : 2026-05-09
**Auteur** : Lovable (audit automatisé, lectures uniquement)
**Statut** : Rapport diagnostic — aucune modification de code, aucune migration, aucun commit
**Périmètre** : taxes portuaires compagnie IMPORT (TXI, HTF, ISPS, taxe portuaire, etc.) et leur injection effective dans le moteur de cotation

---

## 0. Conclusion exécutive

L'ancien diagnostic — *« pour les dossiers IMPORT, les charges carrier ne sont jamais injectées car `quotation-engine` ne les active que si `isTransit` »* — **est obsolète**.

Le code actuel (`supabase/functions/quotation-engine/index.ts`) appelle `fetchCarrierCharges` **inconditionnellement** pour toute opération (IMPORT / EXPORT / TRANSIT) et le bloc d'injection (`if (carrierCharges.length > 0)`) tourne aussi en IMPORT.

Le vrai trou fonctionnel actuel est triple :

| ID | Trou | Impact |
|----|------|--------|
| **G1** | Whitelist `evidence_level` stricte (`official`, `validated_internal`) | Exclut MSC (HTF, ISPS, ANF, CEF, EBAD, EMANIF, TBL, THO, FAI), GRIMALDI (EMANIF, TRL), MAERSK (FAI, SCAN), CMA_CGM (ISPS_TERM, LOC_TERM, SVC, TBL, THO) |
| **G2** | `operation_type='ALL'` jamais lu | 23 lignes orphelines (CMA_CGM 9, GRIMALDI 6, HAPAG_LLOYD 7, ONE 1) — dont taxes structurelles (ISPS, COMM, TBL) |
| **G3** | `is_variable=true` + `default_amount=null` | Lignes silencieuses (THO, FAI) sans signal "TO_CONFIRM" côté UI |

Ces trous frappent en priorité MSC et GRIMALDI sur dossiers IMPORT, et tous les carriers sur les charges classées `operation_type='ALL'`.

Aucun patch n'est appliqué dans ce rapport. Trois options sont proposées en §5 pour décision CTO.

---

## 1. État du code actuel (extrait commenté)

### 1.1 `fetchCarrierCharges` — `quotation-engine/index.ts` L998-1026

```ts
async function fetchCarrierCharges(supabase, carrier, operationType = 'IMPORT') {
  let query = supabase
    .from('carrier_billing_templates')
    .select('*')
    .eq('is_active', true)
    .eq('operation_type', operationType)            // ⚠️ G2 — jamais 'ALL'
    .in('evidence_level', ['official', 'validated_internal']); // ⚠️ G1

  if (carrier) {
    query = query.or(`carrier.eq.${carrier.toUpperCase()},carrier.eq.GENERIC`);
  } else {
    query = query.eq('carrier', 'GENERIC');         // ⚠️ G4 — pas de TO_CONFIRM si carrier inconnu
  }
  ...
}
```

### 1.2 Appel — L1314

```ts
const carrierCharges = await fetchCarrierCharges(
  supabase, carrier, effectiveOperationType as any
);
```

`effectiveOperationType` vaut `'TRANSIT'` si `isTransit`, sinon `'IMPORT'`. **Aucune restriction `isTransit`** sur l'appel.

### 1.3 Injection — L1466-1513

```ts
if (carrierCharges.length > 0) {                    // ⚠️ tourne aussi en IMPORT
  for (const charge of carrierCharges) {
    let amount = 0;
    switch (charge.calculation_method) {
      case 'PER_CNT': ...
      case 'PER_TEU': ...
      case 'PER_BL':  amount = charge.default_amount; break;
      default:        amount = charge.default_amount;
    }
    if (amount > 0) {                                // ⚠️ G3 — null/0 silencieux
      lines.push({
        bloc: 'operationnel',
        category: 'Compagnie Maritime',
        description: charge.charge_name,
        amount,
        source: { type: 'OFFICIAL', confidence: 0.9 },
        isEditable: false,
      });
    }
  }
}
```

Méthodes non gérées : `PER_CONTAINER`, `PER_TONNE`, `PER_UNIT`, `PERCENTAGE` → tombent dans `default` et utilisent `default_amount` brut, sans tonnage ni base de référence. Pour `PERCENTAGE` (COMM, COLL) cela donne un montant aberrant (2.8 ou 3.5 FCFA).

### 1.4 `run-pricing/index.ts`

`grep "carrier"` → 6 occurrences. Aucun bloc d'enrichissement post-engine pour les charges carrier. Le carrier est uniquement passé en input au moteur (`inputs.carrier`) et lu dans deux requêtes SQL ciblées (`operation_type='IMPORT'`) qui concernent d'autres usages (PAD-NST, pas les carrier_billing_templates).

**Conclusion code** : le moteur applique correctement IMPORT, mais filtre trop strictement la donnée disponible.

---

## 2. État de la donnée — `carrier_billing_templates`

### 2.1 Distribution par `operation_type × evidence_level × is_active`

| operation_type | evidence_level       | is_active | nb |
|----------------|----------------------|-----------|----|
| ALL            | historical_only      | false     | 3  |
| ALL            | historical_only      | true      | 6  |
| ALL            | observed             | true      | 1  |
| ALL            | to_confirm           | false     | 6  |
| ALL            | validated_internal   | true      | 7  |
| EXPORT         | to_confirm           | false     | 1  |
| EXPORT         | validated_internal   | true      | 2  |
| **IMPORT**     | historical_only      | true      | **3**  |
| **IMPORT**     | observed             | true      | **9**  |
| **IMPORT**     | to_confirm           | false     | 1  |
| **IMPORT**     | validated_internal   | true      | **11** |
| TRANSIT        | to_confirm           | true      | 6  |
| TRANSIT        | validated_internal   | true      | 3  |

**Lecture** : sur 24 lignes IMPORT actives, seulement **11 sont injectées** (validated_internal). 12 lignes IMPORT actives `observed` ou `historical_only` sont **silencieusement ignorées**.

### 2.2 IMPORT — détail par carrier (lignes actives)

| Carrier      | Charges injectées (validated_internal)                                  | Charges ignorées (observed / historical_only)                                          |
|--------------|--------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| HAPAG_LLOYD  | TXI 25 000, EDO 15 000, ETD_20 90 000, ETD_40 150 000                    | —                                                                                      |
| ONE          | CMF 115 000, COLL 2.8 %, DG_HANDLING 5 000, DOF 18 000, MNF 600, TBL 10 000, TSS_IMP 25 000 | —                                                                       |
| **MSC**      | —                                                                        | **HTF 3 283, ISPS_COMM 0.63, ISPS_IMP 22.42, ANF 18 000, CEF 22, EBAD 5 000, TBL 25 000, EMANIF 550, THO (variable)** |
| **GRIMALDI** | —                                                                        | **EMANIF 550, TRL 15 000**                                                             |
| **MAERSK**   | —                                                                        | **FAI (variable, observed)**                                                           |

**Impact métier** : un dossier IMPORT MSC ressort sans aucune charge carrier alors que la base en contient 9 lignes documentées (taxes ISPS, HTF, manifeste, BL, etc.).

### 2.3 `operation_type='ALL'` — lignes orphelines

23 lignes (14 actives, 9 inactives) classées "ALL" — par définition applicables aux deux sens — ne sont **jamais lues** par `fetchCarrierCharges`.

| Carrier      | Codes 'ALL' actifs                                              |
|--------------|-----------------------------------------------------------------|
| CMA_CGM      | CMDF, CMF, COMM, DOF, ISPS_TERM, LOC_TERM, SVC, TBL             |
| GRIMALDI     | COMM, SVC, TBL                                                  |
| HAPAG_LLOYD  | COLL, DOC, MNF                                                  |
| ONE          | (1 ligne)                                                       |

C'est notamment ici que vivent les **commissions débours, ISPS terminal, manifeste, timbre BL** qui devraient apparaître à chaque dossier.

### 2.4 `port_tariffs` — couverture côté PAD/DPW

| Provider | Catégorie           | Cargo type     | Op_type | Montant     | Statut |
|----------|---------------------|----------------|---------|-------------|--------|
| PAD      | PORT_TAX            | CONTENEUR_20   | TRANSIT | 11 308      | actif  |
| PAD      | PORT_TAX            | CONTENEUR_40   | TRANSIT | 16 962      | actif  |
| PAD      | REDEVANCE_VARIABLE  | CONTENEUR_20   | TRANSIT | 9 183       | actif  |
| PAD      | REDEVANCE_VARIABLE  | CONTENEUR_40   | TRANSIT | 18 366      | actif  |
| DPW      | THC                 | (multiples)    | IMPORT/EXPORT/TRANSIT | 70 000–310 000 | actifs |

**Observation critique** : `port_tariffs.PORT_TAX` n'existe **que pour TRANSIT**. Aucun PORT_TAX IMPORT côté PAD. Pour les dossiers IMPORT, la "taxe portuaire" attendue passe donc par les charges carrier (TXI, HTF, etc.), confirmant l'importance de combler G1/G2.

---

## 3. Trous fonctionnels confirmés

### G1 — Whitelist evidence_level trop stricte
`fetchCarrierCharges` accepte uniquement `official` et `validated_internal`. Or :
- 0 ligne IMPORT a `evidence_level='official'` ;
- les charges `observed` (MSC) et `historical_only` (GRIMALDI, CMA_CGM) sont des charges réelles, vues sur factures, simplement non promues administrativement.

**Conséquence** : silence tarifaire complet pour MSC/GRIMALDI/MAERSK en IMPORT.

### G2 — `operation_type='ALL'` jamais résolu
La requête `.eq('operation_type', operationType)` exclut toutes les lignes "ALL" qui sont par construction valides pour IMPORT et EXPORT.

**Conséquence** : 14 lignes actives 'ALL' (commissions, ISPS terminal, manifeste, timbre BL) ne sont jamais ajoutées.

### G3 — `is_variable=true` + `default_amount=null` silencieux
Le test `if (amount > 0)` saute la ligne sans avertir. La mémoire `carrier-variable-fees` exige un override opérateur — mais **rien dans l'engine ne génère une ligne TO_CONFIRM** correspondante.

**Conséquence** : THO, FAI disparaissent sans que l'opérateur soit averti.

### G4 — Carrier inconnu → silence (pas TO_CONFIRM)
Quand `carrier` n'est pas fourni, la requête se rabat sur `carrier='GENERIC'` (qui n'existe pas en base). Aucune ligne TO_CONFIRM n'est émise alors que la mémoire `carrier-import-charges-activation-v2` impose explicitement ce comportement.

**Conséquence** : non-respect de la mémoire de gouvernance.

### G5 — `calculation_method` non géré
`PER_CONTAINER`, `PER_TONNE`, `PER_UNIT`, `PERCENTAGE` tombent dans `default` et appliquent `default_amount` brut, sans base. Pour `PERCENTAGE` (COMM 2.8, COLL 3.5) le montant inséré devient *2.8 FCFA*, ce qui est manifestement faux.

**Conséquence** : risques d'amounts erronés pour ONE.COLL et toute future ligne PERCENTAGE.

### G6 — Confidence figée à 0.9 quel que soit `evidence_level`
Toutes les lignes carrier sortent avec `source.type='OFFICIAL'` et `confidence: 0.9`, alors que la donnée peut être `observed` ou `historical_only`. Pas de cohérence avec la mémoire `ui-reliability-indicators-v2`.

---

## 4. Risques de doublon

| Source A                                | Source B                            | Risque                              |
|-----------------------------------------|-------------------------------------|--------------------------------------|
| `port_tariffs.PORT_TAX` (PAD, TRANSIT)  | carrier `TXI` (HAPAG_LLOYD, IMPORT) | Périmètres disjoints (op_type différents) — **pas de doublon actuel**, mais risque si on étend PORT_TAX à IMPORT |
| `port_tariffs.THC` (DPW)                | carrier `THO` (THO MSC/CMA, all)    | **Risque réel** — la mémoire `terminal-handling-deduplication-policy` couvre déjà ce cas mais le code ne dédoublonne pas explicitement par `charge_code` |
| `port_tariffs.REDEVANCE_VARIABLE` (PAD) | aucune                              | Pas de doublon                      |
| Carrier `ISPS_TERM` (CMA, ALL)          | Carrier `ISPS_IMP` (MSC, IMPORT)    | **Risque sémantique** — deux ISPS terminal pour deux carriers, à ne pas additionner si carrier mixte |
| Carrier `EMANIF` × 3 (MSC, GRIMALDI, HAPAG en différents op_types) | manifeste PAD éventuel | À surveiller si une ligne "manifeste PAD" est ajoutée |

Toute future activation de G1/G2 doit donc inclure une **clé de déduplication** `(carrier, charge_code)` et un mapping explicite `charge_code → port_tariffs.category` lorsqu'il y a recoupement.

---

## 5. Options de patch (sans exécution — décision CTO requise)

### Option A — Enrichissement post-engine dans `run-pricing` (recommandée)

**Principe** : `quotation-engine` reste FROZEN. Après retour moteur, `run-pricing` :
1. Détecte `flow=IMPORT` + carrier connu.
2. Re-requête `carrier_billing_templates` avec un filtre **élargi** : `evidence_level IN ('official','validated_internal','observed','historical_only')` ET `operation_type IN (op, 'ALL')`.
3. Compare au snapshot moteur via `(carrier, charge_code)` → injecte uniquement les manquantes.
4. Marque chaque ligne ajoutée :
   - `source.type = 'TO_CONFIRM'` si `evidence_level ∈ {observed, historical_only}` ou `is_variable=true`,
   - `source.type = 'OFFICIAL'` si `validated_internal`/`official`,
   - `confidence` proportionnée (`0.9 / 0.6 / 0.4`).
5. Carrier inconnu → ligne explicite TO_CONFIRM "Charges carrier non vérifiées" avec `amount=null`.

**Pour** : aucune modif moteur (FROZEN), traçabilité maximale, conforme `surgical-stabilization-philosophy`, conforme `carrier-import-charges-activation-v2`, contrôle total de la déduplication.
**Contre** : duplication partielle de logique de calcul (`PER_CNT`, `PER_TEU`…) à factoriser.

### Option B — Élargir la whitelist dans `fetchCarrierCharges`

**Principe** : modifier `quotation-engine` pour accepter `observed`/`historical_only` et `operation_type IN (op, 'ALL')`, en taggant la confidence selon l'evidence_level.

**Pour** : un seul point de modification, pas de duplication de logique.
**Contre** : touche `quotation-engine` (FROZEN), risque de régression (calculs PERCENTAGE/PER_TONNE actuellement cassés en G5), modification atomique difficile à dérouler sans backup R-grade.

### Option C — Promotion data uniquement

**Principe** : revue opérateur de chaque ligne `observed`/`historical_only` MSC/GRIMALDI ; promotion sélective vers `validated_internal` après validation manuelle (UI `CarrierBillingTemplates` existante).

**Pour** : aucun code touché, pure curation de données, traçabilité par `effective_date`.
**Contre** : très lent, ne résout pas G2 (op_type='ALL'), ne résout pas G3 (variable null), ne résout pas G4 (carrier inconnu), ne résout pas G5 (méthodes manquantes).

### Recommandation préliminaire

**A + C combinés**, B écartée tant que `quotation-engine` reste FROZEN.
- A traite immédiatement les trous structurels (G1, G2, G3, G4, partiellement G5 dans le post-traitement).
- C améliore graduellement la qualité des données pour faire passer plus de lignes en `validated_internal`.
- B reste une cible long terme une fois l'engine dégelé.

---

## 6. Décision attendue

CTO doit arbitrer :
1. **GO/NO-GO** sur l'option A (patch chirurgical `run-pricing` uniquement).
2. **Périmètre v1** d'A : inclut-on G3 (variable null) et G4 (carrier inconnu) dès la première itération, ou phasage ?
3. **Politique de déduplication** : clé `(carrier, charge_code)` confirmée ?
4. **Politique de confidence/source.type** par evidence_level : grille proposée 0.9/0.6/0.4 acceptée ?

Aucune action runtime tant que ces points ne sont pas tranchés.

---

## 7. Garde-fous respectés pendant l'audit

- ✅ Aucune écriture en base (queries SELECT uniquement via `supabase--read_query`).
- ✅ Aucune migration créée.
- ✅ Aucune modification `src/`, `supabase/functions/`, `config.toml`.
- ✅ Aucun commit/push.
- ✅ Aucun C-D ni C-C.
- ✅ Création documentaire uniquement : ce rapport + entrée backlog.

---

## 8. Annexes — requêtes SQL utilisées

```sql
-- Cartographie complète
SELECT carrier, charge_code, charge_name, operation_type, calculation_method,
       default_amount, currency, evidence_level, is_active, is_variable,
       invoice_type, base_reference
FROM carrier_billing_templates
ORDER BY operation_type, carrier, charge_code;

-- Distribution
SELECT operation_type, evidence_level, is_active, COUNT(*)
FROM carrier_billing_templates
GROUP BY 1,2,3 ORDER BY 1,2,3;

-- Couverture port_tariffs
SELECT provider, category, cargo_type, amount, source_document,
       operation_type, is_active
FROM port_tariffs
WHERE category IN ('PORT_TAX','REDEVANCE_VARIABLE','REDEVANCE_FIXE','THC','RELEVAGE')
   OR category ILIKE '%PORT%' OR category ILIKE '%TAX%'
ORDER BY provider, category, cargo_type;
```

---

**Fin du rapport.** En attente d'arbitrage CTO avant toute exécution.
