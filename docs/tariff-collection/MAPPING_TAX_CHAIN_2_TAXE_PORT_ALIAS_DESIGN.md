# MAPPING-TAX-CHAIN-2 — Design alias facture “taxe de port” → DROIT_PASSAGE

**Repo audité** : `douania/dakar-cargo-quotes`  
**Branche cible** : `work`  
**Mode** : design-only / documentation-only  
**Date** : 2026-05-15  
**Livrable** : `docs/tariff-collection/MAPPING_TAX_CHAIN_2_TAXE_PORT_ALIAS_DESIGN.md`

---

## 0. Statut d’exécution

Ce lot documente le design CTO strict pour reconnaître les libellés facture liés à la “taxe de port” et les rattacher à la famille canonique `DROIT_PASSAGE` / ligne runtime `PAD_DROIT_PASSAGE`, sans créer de catégorie `PORT_TAX IMPORT` et sans double comptage.

Exécution effectuée :

- création de ce rapport Markdown uniquement ;
- aucun changement `src/` ;
- aucun changement `supabase/functions/` ;
- aucune migration ;
- aucun changement `supabase/config.toml` ;
- aucun patch runtime ;
- aucun appel Lovable Agent ;
- aucun SELECT DB live ;
- aucun dossier client touché ;
- aucun composant FROZEN modifié.

---

## 1. Sources statiques relues

### Documents obligatoires

- `docs/tariff-collection/MAPPING_TAX_CHAIN_1_TAXE_PORT_DROIT_PASSAGE_ARBITRATION.md`
- `docs/DEFERRED_BACKLOG.md`
- `docs/tariff-collection/MAP_8_RUNTIME_PAD_CATEGORY_TO_PORT_CHARGES_AUDIT.md`
- `docs/tariff-collection/MAPPING_TAX_CHAIN_0_AUDIT_V2.md`

### Code / données statiques audités

- `supabase/functions/run-pricing/index.ts`
- `supabase/functions/quotation-engine/index.ts`
- `supabase/functions/analyze-attachments/index.ts`
- `supabase/functions/create-quotation-email-draft/index.ts`
- `supabase/functions/export-quotation-version-pdf/index.ts`
- `supabase/functions/_shared/pad/resolvePadClassification.ts`
- `supabase/functions/_shared/pad/invoiceLabelAliases.ts`
- `supabase/functions/_shared/pad/types.ts`
- `supabase/migrations/20251219124458_99931897-8b99-4c46-ad9b-dae86a51acde.sql`
- `supabase/migrations/20260114114407_7ebbad4f-37a1-4ac7-a0ca-222507e6b6c7.sql`

### Occurrences recherchées

- `taxe de port`
- `port tax`
- `taxe portuaire`
- `taxes port`
- `taxes de port`
- `port dues`
- `port charges`
- `PORT_TAX`
- `DROIT_PASSAGE`
- `PAD_DROIT_PASSAGE`
- `carrier_billing_templates`
- `invoiceLabelAliases`
- `resolvePadClassification`

---

## 2. Faits vérifiés

### 2.1 MAPPING-TAX-CHAIN-1 a déjà arbitré la sémantique principale

Le rapport MAPPING-TAX-CHAIN-1 conclut que, pour l’import conteneur standard, le libellé métier/facture `taxe de port` doit être traité comme alias de :

- `port_tariffs.category = DROIT_PASSAGE` ;
- ligne runtime `PAD_DROIT_PASSAGE`.

Il conclut aussi que `PORT_TAX IMPORT` reste NO-GO sans source officielle distincte, et que le risque principal à éviter est le double comptage entre `PAD_DROIT_PASSAGE` et une ligne facture/carrier libellée “taxe de port”.

### 2.2 MAP-8B a clos le maillon `pad_category → pad_rate`

`DEFERRED_BACKLOG.md` indique que MAP-8B est clos sous le verdict `MAP_8B_EXEC_MIGRATION_DONE`.

Le wrapper `public.propagate_classification_candidate_to_fact(uuid,text)` matérialise maintenant `cargo.pad_rate_fcfa_per_ton` depuis `port_tariffs` avec le filtre strict :

- `provider = PAD`
- `category = DROIT_PASSAGE`
- `operation_type = IMPORT`
- `cargo_type = CONTENEUR`
- `classification = v_value`
- `is_active = true`

Limitation explicitement documentée : flux import conteneur standard uniquement.

### 2.3 `run-pricing` produit la ligne canonique `PAD_DROIT_PASSAGE`

Dans `run-pricing/index.ts`, les facts consommés sont :

- `cargo.pad_category` → `inputs.padCategory` ;
- `cargo.pad_rate_fcfa_per_ton` → `inputs.padRateFcfaPerTon`.

La ligne `PAD_DROIT_PASSAGE` est émise uniquement si :

- `inputs.padCategory` est présent ;
- `inputs.padRateFcfaPerTon > 0` ;
- `cargoWeight > 0`.

La ligne produite porte :

- `category = PAD_DROIT_PASSAGE` ;
- `label = Droit de passage PAD <catégorie>` ;
- `description = Droit de passage PAD <catégorie>` ;
- `source.type = OFFICIAL`.

### 2.4 `PORT_TAX IMPORT` reste absent / non canonique

`MAPPING_TAX_CHAIN_0_AUDIT_V2.md` et `MAP_8_RUNTIME_PAD_CATEGORY_TO_PORT_CHARGES_AUDIT.md` indiquent que :

- `PORT_TAX IMPORT` = 0 ligne active ;
- `PORT_TAX` reste limité à 2 lignes `TRANSIT only` ;
- `DROIT_PASSAGE IMPORT` existe et est joignable sur `cargo.pad_category`.

La migration historique `20260114114407_7ebbad4f-37a1-4ac7-a0ca-222507e6b6c7.sql` confirme que les deux inserts `PORT_TAX` sont en `operation_type = TRANSIT`, pas `IMPORT`.

### 2.5 `quotation-engine` peut créer une ligne `Port Tax` si `PORT_TAX` existe

`quotation-engine/index.ts` charge les tarifs PAD selon l’`effectiveOperationType`, puis cherche :

```ts
const portTaxTariff = padTariffs.find(t =>
  t.category === 'PORT_TAX' && t.cargo_type === cargoType
);
```

Si un tarif est trouvé, il ajoute une ligne :

- `category = Port (PAD)` ;
- `description = Port Tax <container.type>` ;
- `source.type = OFFICIAL`.

Conclusion : ajouter un jour `PORT_TAX IMPORT` dans `port_tariffs` pourrait produire une deuxième ligne PAD en plus de `PAD_DROIT_PASSAGE`. C’est le point de double comptage le plus dangereux.

### 2.6 Les lignes `carrier_billing_templates` sont sémantiquement proches mais distinctes

La migration historique contient des lignes carrier proches de la sémantique portuaire :

- HAPAG-LLOYD `TXI` — `Tax Import` ;
- HAPAG-LLOYD `Port Dues Transit` ;
- HAPAG-LLOYD `Port Tax Transit Export` ;
- ONE `COLL` — note : `Commission sur fret et taxes port` ;
- ONE `TSS_IMP` — `Terminal Security Surcharge` ;
- ONE `CMF` — `Container Management Fee`.

Ces lignes appartiennent à `carrier_billing_templates`, pas à la ligne canonique `PAD_DROIT_PASSAGE`. Elles doivent être traitées comme des débours/charges compagnie ou signaux à revoir, pas comme preuve suffisante d’un `PORT_TAX IMPORT` officiel.

### 2.7 Une couche alias facture existe déjà

`supabase/functions/_shared/pad/invoiceLabelAliases.ts` existe déjà.

Ce fichier définit des alias facture pour la redevance “DROITS DE PASSAGE DES MARCHANDISES”. Il fixe les règles suivantes :

- tous ces libellés pointent vers `canonical_rate_family = DROIT_PASSAGE` ;
- aucun libellé facture ne suffit seul à choisir une classification PAD T01..T14/P01..P05/C01..C03 ;
- `PORT_TAX` est un alias legacy à revoir, pas une famille canonique parallèle.

Alias déjà présents :

- `taxe de port`
- `port tax`
- `taxe pad`
- `frais de passage portuaire`
- `droit de passage`
- `droits de passage`
- `port_tax`
- `txi`
- `port charges`
- `port dues`

### 2.8 Le resolver PAD interdit déjà `PORT_TAX` comme famille canonique

`supabase/functions/_shared/pad/resolvePadClassification.ts` fixe `CANONICAL_FAMILY = DROIT_PASSAGE`.

Le commentaire de garde-fou indique explicitement :

- famille canonique invariante : `DROIT_PASSAGE` ;
- `PORT_TAX` n’est jamais retourné comme `canonical_rate_family` ;
- le helper ne calcule jamais de montant ;
- le helper ne lit jamais `port_tariffs`.

### 2.9 Un `invoice_label` ne classifie jamais seul

Dans `resolvePadClassification.ts`, la fonction `matchValidatedAliases` ignore volontairement les alias de type `invoice_label` comme source de classification.

Commentaire vérifié :

```ts
// Garde-fou : un invoice_label ne peut JAMAIS classifier seul.
// On l'ignore comme source de classification.
// (Il a déjà ajouté un warning DROIT_PASSAGE dans le préchecks.)
```

Conclusion : le code partagé existant protège déjà contre une classification automatique basée uniquement sur “taxe de port”.

### 2.10 L’ingestion documentaire extrait des factures mais ne normalise pas encore ces libellés en ligne comptée

`analyze-attachments/index.ts` détecte les documents de type `invoice` et `quotation`, puis extrait des structures telles que :

- `items` pour facture commerciale ;
- `cost_breakdown` pour cotation/devis logistique.

Aucune logique vérifiée dans ce lot ne transforme automatiquement une ligne facture “taxe de port” en ligne tarifaire comptée `PAD_DROIT_PASSAGE`.

### 2.11 PDF/email projettent les lignes déjà présentes

Les fonctions d’export PDF et de draft email exploitent les lignes/snapshots générés en amont. Elles ne doivent pas être considérées comme couche de déduplication primaire.

Si le snapshot contient deux lignes sémantiquement équivalentes, PDF/email risquent de les refléter. Le contrôle anti-double comptage doit donc être fait avant ou pendant la construction des lignes tarifaires, pas dans la présentation finale.

---

## 3. Hypothèses séparées

### H1 — Hypothèse métier validée par arbitrage interne

Pour l’import conteneur standard, `taxe de port`, `port tax` et variantes proches désignent généralement la redevance PAD de droits de passage des marchandises.

Cette hypothèse est appuyée par MAPPING-TAX-CHAIN-1 et par l’existence de `invoiceLabelAliases.ts`.

### H2 — Hypothèse de prudence sur les libellés génériques

Les libellés `port dues`, `port charges`, `taxes port`, `TXI` et `Tax Import` peuvent recouvrir des frais différents selon la compagnie.

Ils doivent donc être reconnus comme signaux sémantiques, mais jamais comptés automatiquement comme une nouvelle ligne.

### H3 — Factures compagnies réelles

Des factures compagnies réelles ou fichiers de validation internes peuvent aider à durcir la matrice d’alias et à distinguer :

- débours compagnie ;
- redevance PAD refacturée ;
- frais carrier distinct ;
- commission sur débours.

Ces pièces doivent ouvrir un lot séparé, car elles relèvent davantage de `carrier_billing_templates` et du risque de double comptage réel que du design générique d’alias facture.

### H4 — Source officielle externe

Aucune source officielle externe nouvelle n’a été vérifiée dans ce lot. En l’état du repo, il n’existe pas de preuve justifiant `PORT_TAX IMPORT` comme charge import distincte de `DROIT_PASSAGE`.

---

## 4. Questions à trancher

### Q1. Où placer la couche d’alias facture ?

**Réponse CTO : utiliser la couche existante `_shared/pad/invoiceLabelAliases.ts` comme couche conceptuelle cible, sans patch runtime dans ce lot.**

Justification :

- elle existe déjà ;
- elle est pure et déterministe ;
- elle impose déjà `DROIT_PASSAGE` comme famille canonique ;
- elle interdit déjà `PORT_TAX` comme famille canonique ;
- elle sépare le libellé facture de la classification PAD ;
- elle évite une table DB prématurée.

La table dédiée `invoice_charge_aliases` reste une option future, mais elle n’est pas nécessaire pour le design actuel.

### Q2. Comment éviter le double comptage si `PAD_DROIT_PASSAGE` existe déjà ?

**Règle CTO : un alias facture ne crée jamais de ligne comptée.**

Si `PAD_DROIT_PASSAGE` existe déjà dans les lignes runtime ou le snapshot, alors toute ligne facture dont le libellé est reconnu comme alias de droit de passage doit être traitée comme :

```text
semantic_alias_of = PAD_DROIT_PASSAGE
canonical_rate_family = DROIT_PASSAGE
dedupe_key = PAD_DROIT_PASSAGE
amount_policy = DO_NOT_COUNT_FROM_LABEL
review_status = TO_REVIEW si montant séparé détecté
```

Le libellé facture peut expliquer, confirmer ou signaler une ligne, mais ne doit pas produire une deuxième charge.

### Q3. Faut-il marquer les lignes carrier ambiguës en `TO_REVIEW` ?

**Réponse CTO : oui.**

Les libellés suivants doivent être prudents :

- `port dues`
- `port charges`
- `taxes port`
- `taxes de port`
- `taxe portuaire`
- `TXI`
- `Tax Import`
- `THO` / `FAI` si utilisés comme débours variable compagnie

Raison : ces libellés peuvent désigner une refacturation du droit de passage, mais aussi des frais compagnie ou une base de commission. Ils ne doivent pas être inclus automatiquement dans les totaux sans arbitrage.

### Q4. Quel modèle de données minimal proposer sans toucher au runtime ?

Modèle documentaire minimal :

```text
normalized_label
original_label
canonical_rate_family = DROIT_PASSAGE
canonical_charge_key = PAD_DROIT_PASSAGE
scope_operation_type = IMPORT
scope_cargo_type = CONTENEUR
requires_review
confidence
amount_policy = NEVER_AUTO_COUNT_FROM_LABEL
dedupe_key = PAD_DROIT_PASSAGE
notes
```

Ce modèle reste documentaire dans ce lot. Aucune table créée.

### Q5. Quel patch chirurgical futur recommander après GO CTO ?

Patch futur recommandé en trois temps :

1. étendre la constante pure `invoiceLabelAliases.ts` avec les variantes manquantes ;
2. ajouter des tests unitaires du resolver / alias ;
3. éventuellement brancher une observation-only dans l’ingestion ou le pricing, sans créer de montant et sans modifier les totaux.

Aucun patch dans `quotation-engine` ou `run-pricing` ne doit être fait sans design dédié et tests anti-double comptage.

---

## 5. Matrice d’alias recommandée

| Libellé | Présence actuelle | Décision | Revue humaine |
|---|---:|---|---:|
| `taxe de port` | déjà présent | alias fort de `DROIT_PASSAGE` / `PAD_DROIT_PASSAGE` | non, sauf conflit montant |
| `port tax` | déjà présent | alias fort de `DROIT_PASSAGE` / `PAD_DROIT_PASSAGE` | non, sauf conflit montant |
| `taxe pad` | déjà présent | alias fort de `DROIT_PASSAGE` | non |
| `droit de passage` | déjà présent | libellé canonique | non |
| `droits de passage` | déjà présent | libellé canonique | non |
| `frais de passage portuaire` | déjà présent | alias de `DROIT_PASSAGE` | non, sauf conflit montant |
| `port_tax` | déjà présent | alias legacy, jamais famille canonique | oui |
| `txi` | déjà présent | signal carrier probable, jamais auto-count | oui |
| `port charges` | déjà présent | libellé générique, signal seulement | oui |
| `port dues` | déjà présent | libellé générique, signal seulement | oui |
| `taxe portuaire` | à ajouter après GO | alias probable, plus générique que “droit de passage” | oui au départ |
| `taxes port` | à ajouter après GO | signal observé en contexte carrier | oui |
| `taxes de port` | à ajouter après GO | variante linguistique | oui au départ |
| `taxe port` | à ajouter après GO | variante courte | oui au départ |

---

## 6. Risques

### R1 — Double comptage `PAD_DROIT_PASSAGE` + ligne carrier

Risque critique :

```text
PAD_DROIT_PASSAGE calculé officiellement
+
ligne facture “taxe de port” ou “port tax” incluse comme débours séparé
=
total artificiellement gonflé
```

Mitigation : `dedupe_key = PAD_DROIT_PASSAGE` et `amount_policy = NEVER_AUTO_COUNT_FROM_LABEL`.

### R2 — Création injustifiée de `PORT_TAX IMPORT`

Ajouter `PORT_TAX IMPORT` dans `port_tariffs` déclencherait potentiellement la logique `quotation-engine` existante `Port Tax`, en parallèle de `PAD_DROIT_PASSAGE`.

Mitigation : NO-GO strict sur `PORT_TAX IMPORT` sans source officielle distincte.

### R3 — Confusion carrier / PAD

Les frais carrier peuvent contenir des libellés proches du droit de passage, mais représenter des frais compagnie, commissions, sécurités terminal, BL, equipment ou autres.

Mitigation : `TO_REVIEW` pour les libellés génériques et codes carrier.

### R4 — PDF/email ne dédupliquent pas

PDF/email projettent les lignes déjà présentes. Ils ne doivent pas être le point principal de correction.

Mitigation : déduplication avant snapshot / pricing lines.

### R5 — Activation prématurée du resolver

Même si `invoiceLabelAliases.ts` existe, brancher son résultat pour créer des montants serait dangereux.

Mitigation : observation-only d’abord.

---

## 7. Options

### Option A — Documentation-only

**Statut : GO — réalisé par ce rapport.**

Avantages :

- zéro risque runtime ;
- trace l’arbitrage ;
- prépare le patch futur ;
- respecte le périmètre no-patch initial.

### Option B — Extension pure de `invoiceLabelAliases.ts`

**Statut : GO futur après validation CTO.**

Patch chirurgical possible : ajouter uniquement les variantes manquantes.

Aucun montant. Aucun changement `run-pricing`. Aucun changement `quotation-engine`.

### Option C — Table dédiée `invoice_charge_aliases`

**Statut : option future, pas recommandée maintenant.**

Avantages : gouvernance DB, édition admin future.

Inconvénients : migration, RLS, UI/admin, tests, surface de régression.

### Option D — Brancher dans `run-pricing` en observation-only

**Statut : possible plus tard, après tests.**

Objectif : warning / review / audit trace seulement.

NO-GO : créer une ligne comptée depuis `invoice_label`.

### Option E — Ajouter `PORT_TAX IMPORT`

**Statut : NO-GO.**

Raison : aucune preuve officielle distincte vérifiée ; risque de double comptage élevé.

---

## 8. Conditions GO / NO-GO

### GO conceptuel

- `taxe de port` = alias facture de `DROIT_PASSAGE` pour import conteneur standard.
- `PAD_DROIT_PASSAGE` reste la ligne canonique.
- Les alias facture ne calculent jamais un montant.
- Les libellés carrier ambigus passent en `TO_REVIEW`.
- Les tests anti-double comptage sont obligatoires avant toute activation runtime.

### NO-GO

- créer `PORT_TAX IMPORT` ;
- compter automatiquement une ligne “taxe de port” en plus de `PAD_DROIT_PASSAGE` ;
- utiliser un `invoice_label` seul pour choisir T01..T14 ;
- modifier `quotation-engine` sans justification `STRUCTURAL_PATCH_ALLOWED` ;
- corriger PDF/email sans corriger les lignes source ;
- mélanger ce lot avec l’audit des débours compagnies réels.

---

## 9. Plan de tests futur

### T1 — Alias forts

Entrées :

- `taxe de port`
- `port tax`
- `taxe pad`
- `droit de passage`
- `droits de passage`

Attendu :

- `canonical_rate_family = DROIT_PASSAGE`
- pas de `PORT_TAX`
- pas de montant calculé depuis le libellé seul.

### T2 — Alias génériques

Entrées :

- `port dues`
- `port charges`
- `taxe portuaire`
- `taxes port`
- `taxes de port`

Attendu :

- signal reconnu ;
- `requires_review = true` au départ ;
- aucune ligne comptée.

### T3 — Anti-double comptage

Contexte :

- `PAD_DROIT_PASSAGE` existe déjà ;
- une facture contient `taxe de port` avec montant.

Attendu :

- total inchangé ;
- ligne facture marquée alias / review ;
- aucune deuxième ligne `PORT_TAX`.

### T4 — `PORT_TAX IMPORT` absent

Attendu :

- aucun patch ne crée `PORT_TAX IMPORT` ;
- `quotation-engine` ne produit pas `Port Tax IMPORT` en import standard.

### T5 — PDF/email

Attendu :

- snapshot avec une seule ligne canonique ;
- PDF/email reflètent le total non doublé ;
- aucune mention trompeuse d’une deuxième taxe officielle.

### T6 — Régression resolver

Attendu :

- `invoice_label` ne classifie jamais seul ;
- classification PAD reste déterminée par opérateur, alias marchandise validé, HS/NST/règle validée ou autre source explicitement prévue.

---

## 10. Lot séparé recommandé : débours compagnies

Les factures compagnies réelles doivent faire l’objet d’un lot séparé :

```text
CARRIER-DEBOURS-TAXE-PORT-1 — audit des débours compagnies facturant taxe de port / THO / FAI / TXI / port dues
```

Objectif : distinguer précisément :

- redevance PAD refacturée ;
- débours compagnie ;
- commission sur débours ;
- frais carrier distinct ;
- ligne variable à confirmer ;
- ligne à exclure si `PAD_DROIT_PASSAGE` existe déjà.

Sources utiles futures : factures MSC, Maersk, Grimaldi, Hapag-Lloyd, ONE, CMA CGM si disponibles.

Ce lot ne doit pas bloquer MAPPING-TAX-CHAIN-2.

---

## 11. Patch chirurgical futur recommandé après GO CTO

### Phase F1 — Extension alias pure

Modifier uniquement :

```text
supabase/functions/_shared/pad/invoiceLabelAliases.ts
```

Ajouter :

```text
taxe portuaire
taxes port
taxes de port
taxe port
```

Chaque entrée devra préciser :

- `canonical_rate_family = DROIT_PASSAGE`
- `requires_review = true` pour les variantes génériques au départ
- `confidence` prudente
- raison documentaire claire

### Phase F2 — Tests unitaires

Ajouter ou compléter tests resolver/alias :

- alias reconnus ;
- warning `port_tax_alias_treated_as_droit_passage` ;
- `invoice_label` ne classifie jamais seul ;
- aucune famille `PORT_TAX` retournée.

### Phase F3 — Observation-only éventuelle

Seulement après tests : brancher la détection comme warning / review, jamais comme montant automatique.

Aucun changement dans `quotation-engine` ou `run-pricing` sans GO CTO séparé.

---

## 12. Verdict final

`MAPPING_TAX_CHAIN_2_ALIAS_DESIGN_READY_DOC_ONLY`

Décision CTO :

```text
“taxe de port” / “port tax” / “taxe portuaire” / “taxes port” / “port dues”
→ alias facture de DROIT_PASSAGE
→ canonical_charge_key = PAD_DROIT_PASSAGE
→ aucun PORT_TAX IMPORT
→ aucun montant depuis libellé seul
→ anti-double comptage obligatoire
→ lignes carrier ambiguës = TO_REVIEW
```

Ce rapport clôt le design MAPPING-TAX-CHAIN-2. Toute implémentation runtime ou DB nécessite un GO CTO séparé.
