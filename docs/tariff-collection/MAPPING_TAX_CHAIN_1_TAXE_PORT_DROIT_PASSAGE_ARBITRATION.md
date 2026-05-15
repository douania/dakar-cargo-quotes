# MAPPING-TAX-CHAIN-1 — Arbitrage “taxe de port” vs “droit de passage PAD”

**Repo audité** : `douania/dakar-cargo-quotes`  
**Branche cible** : `work`  
**Mode** : audit statique uniquement  
**Date** : 2026-05-15  
**Livrable proposé** : `docs/tariff-collection/MAPPING_TAX_CHAIN_1_TAXE_PORT_DROIT_PASSAGE_ARBITRATION.md`

---

## 0. Statut d’exécution

Aucun patch n’a été exécuté.

Aucune migration n’a été créée.

Aucun fichier `src/`, `supabase/functions/` ou `supabase/config.toml` n’a été modifié.

Aucun appel Lovable Agent n’a été utilisé.

Aucun SELECT DB live n’a été jugé indispensable pour cet arbitrage, car les documents MAP-8 / MAP-8B / MAPPING-TAX-CHAIN-0 et le code runtime suffisent à trancher le périmètre sémantique demandé.

---

## 1. Sources statiques relues

### Documents

- `docs/DEFERRED_BACKLOG.md`
- `docs/tariff-collection/MAP_8_RUNTIME_PAD_CATEGORY_TO_PORT_CHARGES_AUDIT.md`
- `docs/tariff-collection/MAPPING_TAX_CHAIN_0_AUDIT_V2.md`

### Code / migrations audités

- `supabase/functions/run-pricing/index.ts`
- `supabase/functions/quotation-engine/index.ts`
- `supabase/functions/create-quotation-email-draft/index.ts`
- `supabase/functions/export-quotation-version-pdf/index.ts`
- `supabase/functions/price-service-lines/index.ts`
- `supabase/migrations/20260114114407_7ebbad4f-37a1-4ac7-a0ca-222507e6b6c7.sql`

### Occurrences recherchées

- `PORT_TAX`
- `DROIT_PASSAGE`
- `PAD_DROIT_PASSAGE`
- `taxe de port`
- `port tax`
- `port_tariffs`
- `carrier_billing_templates`

---

## 2. Faits vérifiés

### 2.1 MAP-8B est clos et a déjà corrigé le maillon critique `pad_category → pad_rate`

`DEFERRED_BACKLOG.md` indique que MAP-8B est clos sous le verdict `MAP_8B_EXEC_MIGRATION_DONE`.

La branche `pad_category` du wrapper `public.propagate_classification_candidate_to_fact(uuid,text)` matérialise désormais `cargo.pad_rate_fcfa_per_ton` depuis `port_tariffs` avec les filtres :

- `provider = PAD`
- `category = DROIT_PASSAGE`
- `operation_type = IMPORT`
- `cargo_type = CONTENEUR`
- `classification = v_value`
- `is_active = true`

Limitation documentée : flux import conteneur standard uniquement.

### 2.2 `run-pricing` consomme bien `cargo.pad_category` et `cargo.pad_rate_fcfa_per_ton`

Dans `run-pricing/index.ts`, les facts suivants sont consommés :

- `cargo.pad_category` → `inputs.padCategory`
- `cargo.pad_rate_fcfa_per_ton` → `inputs.padRateFcfaPerTon`

La ligne runtime `PAD_DROIT_PASSAGE` est émise uniquement si :

- `inputs.padCategory` est présent ;
- `inputs.padRateFcfaPerTon > 0` ;
- `cargoWeight > 0`.

La ligne produite porte :

- `category = PAD_DROIT_PASSAGE`
- `label = Droit de passage PAD <catégorie>`
- `description = Droit de passage PAD <catégorie>`
- `source.type = OFFICIAL`

### 2.3 La branche alias PAD de `run-pricing` cherche explicitement `DROIT_PASSAGE`

Quand aucun `inputs.padCategory` n’est présent et qu’un alias PAD validé est trouvé, `run-pricing` fait un lookup `port_tariffs` avec :

- `provider = PAD`
- `category = DROIT_PASSAGE`
- `operation_type = IMPORT`
- `cargo_type = CONTENEUR`
- `classification = alias.pad_category`
- `is_active = true`

Cela confirme que, côté runtime import conteneur, le barème PAD opérationnel utilisé pour le calcul est `DROIT_PASSAGE`, pas `PORT_TAX`.

### 2.4 `PORT_TAX IMPORT` reste absent dans la documentation récente

`MAPPING_TAX_CHAIN_0_AUDIT_V2.md` indique :

- `PORT_TAX` reste limité à 2 lignes `TRANSIT` ;
- aucune ligne `PORT_TAX IMPORT` n’a été ajoutée ;
- `DROIT_PASSAGE IMPORT` existe et est joignable sur `cargo.pad_category`.

`MAP_8_RUNTIME_PAD_CATEGORY_TO_PORT_CHARGES_AUDIT.md` confirme également :

- `DROIT_PASSAGE IMPORT` : 38 lignes actives ;
- `PORT_TAX IMPORT` : 0 ligne active ;
- `PORT_TAX` : 2 lignes `TRANSIT only`.

### 2.5 La migration historique qui introduit `PORT_TAX` ne l’introduit que pour `TRANSIT`

Dans `supabase/migrations/20260114114407_7ebbad4f-37a1-4ac7-a0ca-222507e6b6c7.sql`, les deux inserts `PORT_TAX` sont :

- `('PAD', 'PORT_TAX', 'TRANSIT', 'Conteneur léger <15t', 'CONTENEUR_20', ...)`
- `('PAD', 'PORT_TAX', 'TRANSIT', 'Conteneur standard 15-25t', 'CONTENEUR_40', ...)`

Aucun insert `PORT_TAX IMPORT` n’est présent dans ce bloc.

### 2.6 `quotation-engine` contient encore une logique générique `Port Tax`

Dans `quotation-engine/index.ts`, les `padTariffs` sont chargés depuis `port_tariffs` selon `effectiveOperationType`.

Puis, pour chaque conteneur, le moteur cherche :

```ts
const portTaxTariff = padTariffs.find(t =>
  t.category === 'PORT_TAX' && t.cargo_type === cargoType
);
```

Si un tarif est trouvé, il pousse une ligne :

- `category = Port (PAD)`
- `description = Port Tax <container.type>`
- `source.type = OFFICIAL`

Conclusion : le moteur sait techniquement afficher `Port Tax`, mais uniquement si des lignes `PORT_TAX` existent pour l’`operation_type` effectif. En import, les documents récents confirment que ces lignes n’existent pas.

### 2.7 `carrier_billing_templates` contient des charges compagnie proches sémantiquement, mais distinctes

La migration contient des charges carrier import telles que :

- HAPAG-LLOYD `TXI` — `Tax Import`
- ONE `COLL` — `Collection Fees`, notes mentionnant `taxes port`
- ONE `TSS_IMP` — `Terminal Security Surcharge`
- ONE `CMF` — `Container Management Fee`

Ces charges sont consommées par `quotation-engine` via `carrier_billing_templates` et affichées sous la catégorie `Compagnie Maritime`.

Elles ne sont pas des lignes `PAD_DROIT_PASSAGE`.

### 2.8 L’export PDF et le draft email projettent les lignes déjà présentes

`export-quotation-version-pdf` rend les lignes depuis `snapshot.lines` et ne semble pas recalculer une taxe portuaire. Il affiche la description, la quantité, le tarif et le montant de chaque ligne.

`create-quotation-email-draft` construit surtout un corps d’email synthétique depuis le snapshot, les totaux, la qualification et les réserves ; il ne crée pas une ligne tarifaire additionnelle.

---

## 3. Hypothèses séparées

### H1 — Hypothèse métier

Dans les factures compagnies, le libellé `taxe de port` peut désigner, en pratique métier, le droit de passage portuaire PAD.

Cette hypothèse est cohérente avec le contexte opérationnel fourni, mais elle n’est pas prouvée par une source réglementaire nouvelle dans cet audit.

### H2 — Hypothèse de normalisation

Pour l’import conteneur standard, l’expression métier/facture `taxe de port` doit probablement être normalisée vers :

- `port_tariffs.category = DROIT_PASSAGE`
- ligne runtime `PAD_DROIT_PASSAGE`

et non vers une nouvelle catégorie `PORT_TAX IMPORT`.

Cette hypothèse est appuyée par le code actuel et les audits MAP-8 / MAPPING-TAX-CHAIN-0 V2.

### H3 — Hypothèse de prudence

La catégorie `PORT_TAX` doit rester réservée aux lignes historiques/transit déjà présentes tant qu’aucune source officielle PAD import ne justifie une catégorie distincte.

---

## 4. Réponses aux questions à trancher

### Q1. “Taxe de port” doit-elle être un alias métier de `DROIT_PASSAGE` ?

**Recommandation CTO : OUI, pour l’import conteneur standard.**

Décision proposée :

- `taxe de port`
- `port tax`
- `taxe port`
- variantes facture équivalentes

doivent être traitées comme des alias métier de `DROIT_PASSAGE` lorsqu’il s’agit d’une charge PAD import conteneur.

La sortie runtime attendue doit rester :

- `PAD_DROIT_PASSAGE`
- libellé affiché : `Droit de passage PAD <catégorie>`

Il ne faut pas créer une ligne parallèle `PORT_TAX IMPORT` uniquement parce qu’une facture utilise le libellé commercial `taxe de port`.

### Q2. `PORT_TAX` doit-il rester transit-only / dormant pour l’import ?

**Recommandation CTO : OUI.**

`PORT_TAX` doit rester :

- actif uniquement pour les données existantes `TRANSIT` ;
- dormant / non utilisé en import ;
- non enrichi en `IMPORT` sans preuve officielle distincte.

### Q3. Existe-t-il un risque de double comptage entre `PAD_DROIT_PASSAGE` et une ligne carrier “taxe de port” ?

**Risque actuel : faible à modéré.**  
**Risque futur : élevé si une normalisation naïve est ajoutée.**

#### Risque actuel

En import, `PORT_TAX IMPORT` est absent, donc le runtime ne devrait pas produire simultanément :

- `PAD_DROIT_PASSAGE`
- `Port Tax IMPORT` PAD

à partir de `port_tariffs`.

#### Risque futur

Un double comptage peut apparaître si un futur patch :

1. ajoute des lignes `PORT_TAX IMPORT` dans `port_tariffs` ;
2. mappe `taxe de port` vers une ligne carrier additionnelle ;
3. conserve simultanément `PAD_DROIT_PASSAGE` ;
4. ne déduplique pas les synonymes facture.

Exemple de scénario dangereux :

- `PAD_DROIT_PASSAGE` est calculé depuis `DROIT_PASSAGE / IMPORT / CONTENEUR`;
- une facture compagnie contient une ligne `taxe de port`;
- l’ingestion la convertit en `PORT_TAX` ou en charge compagnie additionnelle ;
- le devis affiche les deux lignes alors qu’elles représentent potentiellement la même réalité économique.

### Q4. Faut-il documenter un NO-GO sur l’ajout de `PORT_TAX IMPORT` tant que la source officielle ne le justifie pas ?

**Recommandation CTO : OUI.**

NO-GO proposé :

> Ne pas ajouter `PORT_TAX IMPORT` dans `port_tariffs` tant qu’une source officielle ou un arbitrage tarifaire documenté ne démontre pas que `PORT_TAX IMPORT` est une charge import distincte du `DROIT_PASSAGE PAD`.

Ce NO-GO doit éviter :

- la duplication sémantique ;
- l’inflation artificielle des devis ;
- la divergence entre libellé facture et catégorie tarifaire officielle ;
- la régression sur MAP-8B.

### Q5. Quel serait le prochain lot après cet audit, sans l’exécuter ?

**Prochain lot proposé : `MAPPING-TAX-CHAIN-2 — alias facture taxe de port → DROIT_PASSAGE`**

Périmètre recommandé :

- Design-only dans un premier temps.
- Aucun patch runtime sans GO CTO.
- Objectif : définir une règle de normalisation documentaire/facture :
  - `taxe de port` → `DROIT_PASSAGE`
  - `port tax` → `DROIT_PASSAGE`
  - `taxe portuaire` → `DROIT_PASSAGE`
- Ajouter une matrice de non-duplication :
  - si `PAD_DROIT_PASSAGE` existe déjà, ne pas créer une deuxième ligne `PORT_TAX`;
  - si une ligne carrier porte un libellé ambigu, la marquer `TO_REVIEW` ou `semantic_alias_of = PAD_DROIT_PASSAGE` plutôt que de l’inclure automatiquement.
- Vérifier les snapshots devis/PDF/email.
- Tester sur cas MSC / Hapag / Maersk / ONE si des factures réelles sont disponibles.

---

## 5. Options possibles

### Option A — Normaliser `taxe de port` vers `DROIT_PASSAGE`

**Statut recommandé : GO conceptuel, patch futur seulement après GO CTO.**

Avantages :

- cohérent avec MAP-8B ;
- évite une nouvelle catégorie import non sourcée ;
- limite le risque de double comptage ;
- garde `PAD_DROIT_PASSAGE` comme ligne canonique.

Inconvénients :

- nécessite une règle claire pour les factures carrier ambiguës ;
- nécessite une documentation de synonymes facture.

### Option B — Ajouter `PORT_TAX IMPORT`

**Statut recommandé : NO-GO actuellement.**

Avantages :

- pourrait correspondre à certains libellés facture si une source officielle le prouve.

Inconvénients :

- aucune preuve actuelle dans le repo ;
- contredit l’état MAP-8 / MAPPING-TAX-CHAIN-0 V2 ;
- risque fort de double comptage avec `PAD_DROIT_PASSAGE`.

### Option C — Ne rien changer

**Statut recommandé : acceptable à court terme, incomplet métier.**

Avantages :

- zéro risque de régression immédiate ;
- préserve l’état MAP-8B.

Inconvénients :

- les libellés facture `taxe de port` restent ambigus ;
- le futur mapping documentaire peut rester incohérent.

### Option D — Créer une table d’alias facture séparée

**Statut recommandé : à étudier dans MAPPING-TAX-CHAIN-2.**

Principe :

- ne pas modifier `port_tariffs.category`;
- créer ou utiliser une couche d’alias documentaire :
  - `invoice_label = taxe de port`
  - `canonical_charge = PAD_DROIT_PASSAGE`
  - `tariff_category = DROIT_PASSAGE`
  - `dedupe_key = PAD_DROIT_PASSAGE`

Avantage : distingue proprement le vocabulaire facture du modèle tarifaire officiel.

---

## 6. Risques

### R1 — Double comptage

Risque si `PORT_TAX IMPORT` est ajouté sans règle d’exclusion avec `PAD_DROIT_PASSAGE`.

### R2 — Confusion entre charge PAD et charge compagnie

Certaines lignes `carrier_billing_templates` import contiennent des libellés proches : `Tax Import`, `taxes port`, `Terminal Security Surcharge`.

Ces lignes peuvent être des frais compagnie, pas nécessairement le droit de passage PAD.

### R3 — Régression sur MAP-8B

MAP-8B a explicitement matérialisé le taux depuis `DROIT_PASSAGE IMPORT CONTENEUR`.

Ajouter `PORT_TAX IMPORT` sans justification pourrait réintroduire l’ambiguïté que MAP-8B a justement réduite.

### R4 — Libellé PDF/email

Le PDF rend les lignes déjà présentes dans le snapshot. Si le snapshot contient deux lignes sémantiquement équivalentes, le PDF les affichera. Le draft email reprend les totaux et ne corrige pas la structure des lignes.

---

## 7. Recommandation CTO finale

### Verdict

`MAPPING_TAX_CHAIN_1_ARBITRATION_READY_NO_PATCH`

### Décision recommandée

Pour l’import conteneur standard, `taxe de port` doit être traitée comme un alias métier/facture de :

- `port_tariffs.category = DROIT_PASSAGE`
- ligne runtime `PAD_DROIT_PASSAGE`

et non comme justification pour créer :

- `port_tariffs.category = PORT_TAX`
- `operation_type = IMPORT`

### NO-GO

`PORT_TAX IMPORT` est NO-GO tant qu’une source officielle PAD ou un arbitrage tarifaire documenté ne démontre pas qu’il s’agit d’une charge distincte du droit de passage PAD.

### GO conditionnel futur

Un futur GO CTO peut ouvrir `MAPPING-TAX-CHAIN-2` pour documenter et éventuellement implémenter une couche d’alias facture :

- `taxe de port` → `DROIT_PASSAGE`
- `port tax` → `DROIT_PASSAGE`
- déduplication obligatoire contre `PAD_DROIT_PASSAGE`
- pas de double inclusion dans les totaux
- tests devis/PDF/email
- aucun changement FROZEN sans justification `STRUCTURAL_PATCH_ALLOWED`.

---

## 8. Garde-fous

- Aucun patch exécuté.
- Aucun composant FROZEN touché.
- Aucune migration.
- Aucun changement `src/`.
- Aucun changement `supabase/functions/`.
- Aucun changement `supabase/config.toml`.
- Aucun Lovable Agent.
- Aucun runtime DB live utilisé.
- RLS, idempotence, sécurité et intégrité des données préservées.
