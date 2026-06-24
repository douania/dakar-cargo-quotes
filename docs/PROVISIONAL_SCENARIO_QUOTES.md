# PROVISIONAL SCENARIO QUOTES — Doctrine produit

> **Statut du document** : doctrine produit canonique.
> **Portée** : générale, applicable à tous les dossiers Dakar Cargo Quotes — pas spécifique à un cas particulier.
> **Subordination** : ce document est subordonné à `docs/MASTER_CONTEXT.md` (source de vérité architecture). En cas de conflit, `MASTER_CONTEXT.md` prime.
> **Nature** : ce fichier décrit une **doctrine**. Il distingue explicitement ce qui existe en runtime aujourd'hui (voir §16) de ce qui constitue la cible doctrinale. Aucune affirmation de capacité runtime n'est faite sans renvoi à un artefact réel documenté dans `MASTER_CONTEXT.md`.

---

## 1. Objectif

Donner un cadre unique pour produire des **cotations provisoires par scénario**, **guidées par l'opérateur**, sur des dossiers **incomplets**, sans jamais transformer une hypothèse en fait, ni un devis provisoire en devis ferme.

Le but est qu'un opérateur SODATRA puisse, face à un dossier partiellement documenté :

- avancer commercialement sur ce qui est raisonnablement traitable ;
- isoler ce qui ne l'est pas, sans le contaminer ;
- garder une traçabilité totale entre ce qui est connu, supposé et manquant.

Cette doctrine ne remplace pas le **Quote qualification model** existant (`firm` / `provisional` / `partial`, voir `docs/MASTER_CONTEXT.md` § *Quote qualification model*) : elle le complète en décrivant **comment plusieurs scénarios provisoires peuvent coexister au sein d'un même dossier composite** et **comment l'opérateur les guide**.

---

## 2. Problème métier

Un dossier réel arrive souvent **incomplet et hétérogène** :

- une partie du périmètre est raisonnablement documentée (assez pour une estimation prudente) ;
- une autre partie manque d'informations critiques (valeur marchandise, code HS, droits, taxes, poids, PAD…) ;
- le client attend une réponse rapide, au moins partielle.

Les deux écueils symétriques à éviter :

1. **Tout bloquer** jusqu'à complétude — on perd le client et on ne valorise pas l'information déjà disponible.
2. **Tout inventer** pour produire un devis ferme complet — on fabrique des chiffres faux, on s'engage commercialement sur du vent, on contamine les faits du dossier.

La doctrine des cotations provisoires par scénario est la troisième voie : **avancer partiellement, prudemment, et de façon traçable**, sous le contrôle explicite de l'opérateur.

---

## 3. Définitions

### Fact confirmé

Donnée **établie**, portée par une source démontrée et validée selon les règles du système (extraction client validée, validation opérateur explicite, document officiel). Dans le modèle de données, un fact confirmé est ce qui peut légitimement alimenter le pricing comme une vérité.

Caractéristiques :

- a une provenance qualifiée (`client`, document officiel, validation interne signée) ;
- n'a pas été « deviné » pour combler un trou ;
- est le seul matériau autorisé pour un **total ferme**.

### Hypothèse opérateur

Affirmation **provisoire, assumée et étiquetée comme telle**, posée par un opérateur humain pour permettre une estimation, en l'absence d'un fact confirmé.

Exemple de forme : « *en supposant que les N unités non documentées sont comparables aux M unités déjà documentées* ».

Caractéristiques :

- **n'est jamais** un fact confirmé ;
- est **toujours** rattachée à un opérateur identifié et à une justification ;
- est **réversible** : elle peut être infirmée par une information client ultérieure ;
- ne doit **jamais** être promue silencieusement en fact (voir §10).

> **Insistance doctrinale** : `hypothèse opérateur ≠ fact confirmé`. C'est la frontière la plus importante de tout ce document.

### Gap client

Information **manquante et requise**, qui doit être obtenue auprès du client (ou d'un partenaire) pour lever une incertitude. C'est la notion déjà portée en runtime par `quote_gaps` et `client_gap_requests` (cycle `drafted → sent → answered → validated`, voir `docs/MASTER_CONTEXT.md` § *Module CL1*).

Un gap est **ouvert** tant que l'information n'a pas été obtenue et validée.

### Scénario provisoire

Unité de travail commerciale **bornée**, couvrant un sous-périmètre du dossier, produite à partir :

- de **facts confirmés** disponibles sur ce sous-périmètre, et/ou
- d'**hypothèses opérateur** explicitement posées et étiquetées,

et assortie de **réserves intelligibles** sur ce qui reste incertain.

Un scénario provisoire :

- a un périmètre clairement délimité (un lot, un groupe de marchandises, un service) ;
- porte une qualification commerciale (`provisional` ou `partial`, jamais `firm` s'il repose sur une hypothèse non confirmée) ;
- **peut coexister avec des gaps ouverts** sur le dossier global ;
- n'engage commercialement que sous les réserves qu'il formule.

### Cotation finale

Devis **ferme** (`firm`), produit lorsque l'ensemble des éléments de coût du périmètre concerné sont résolus à partir de **facts confirmés**, sans réserve critique ouverte.

> **Insistance doctrinale** : `cotation provisoire ≠ devis final`. Une cotation provisoire est informative et réservée ; une cotation finale est engageante. Le passage de l'un à l'autre exige la **résolution des gaps** et la **validation explicite des hypothèses en facts**.

---

## 4. Principes non négociables

1. **Vérité d'abord** — aucune valeur, aucun HS, aucun droit, aucune taxe, aucun poids, aucun PAD n'est inventé pour combler un trou.
2. **Hypothèse ≠ fact** — une hypothèse opérateur est toujours étiquetée, justifiée, réversible, et n'entre jamais dans un total ferme.
3. **Provisoire ≠ final** — une cotation provisoire porte toujours ses réserves ; elle n'est jamais présentée comme engageante.
4. **Coexistence** — un scénario provisoire peut exister alors que des gaps restent ouverts ailleurs dans le dossier.
5. **Le dossier complet peut rester bloqué** — produire un scénario provisoire ne « débloque » pas le dossier global. Le dossier complet reste bloqué tant que les informations client manquent.
6. **Opérateur souverain, validation explicite** — l'opérateur peut guider l'application (poser des hypothèses, choisir un périmètre, déclencher une estimation partielle), mais toute promotion d'hypothèse en fact, et tout passage en devis ferme, exigent une **validation humaine explicite**.
7. **Aucune promotion automatique** — jamais de promotion automatique d'une valeur, d'un HS, d'un PAD ou d'un poids depuis une hypothèse.
8. **Aucun run-pricing global sur dossier composite incomplet** — on ne lance jamais un pricing global engageant sur un dossier composite tant que des sous-périmètres reposent sur des hypothèses non confirmées ou des gaps ouverts.
9. **Traçabilité totale** — chaque hypothèse, chaque réserve, chaque scénario est traçable (qui, quoi, pourquoi, quand).
10. **Assistant structurant, pas décideur** — cohérent avec la philosophie du produit : « L'application est un assistant traçable, pas un décideur automatique. »

---

## 5. Operator-guided provisional quotes

La doctrine est **guidée par l'opérateur** (*operator-guided*) : l'humain reste au centre, l'application structure et trace.

### Ce que l'opérateur peut faire

- **Délimiter un périmètre** traitable partiellement (ex. un sous-ensemble de lots/marchandises).
- **Poser une hypothèse explicite** sur ce périmètre, avec sa justification.
- **Demander une estimation provisoire** sur ce périmètre, sous réserves.
- **Choisir de laisser bloqué** un autre périmètre faute d'information.
- **Communiquer au client** une cotation provisoire clairement réservée.

### Ce que l'opérateur doit valider explicitement

- La **promotion d'une hypothèse en fact** (jamais automatique).
- Le **passage en cotation finale** (`firm`).
- L'**envoi** de toute cotation au client (cohérent avec la doctrine « pas d'auto-send » du produit : le système produit des brouillons, l'opérateur envoie).

### Ce que l'application fait

- Structure les scénarios, hypothèses et réserves.
- Trace tout (assumption ledger, §7).
- **Empêche** les promotions silencieuses et les pricings globaux engageants sur dossier incomplet (§10).
- N'agit jamais à la place de l'opérateur sur les décisions engageantes.

---

## 6. Modèle général des scénarios

Un dossier peut porter **un ou plusieurs scénarios provisoires**, plus l'état du **dossier complet**.

```
Dossier composite (incomplet)
├── Scénario provisoire A   (périmètre P_A)
│     ├── facts confirmés sur P_A
│     ├── hypothèses opérateur sur P_A (étiquetées)
│     ├── réserves (reservation reasons)
│     └── qualification : provisional | partial
├── Scénario provisoire B   (périmètre P_B)
│     └── … (idem)
└── Dossier complet
      ├── gaps ouverts (client / partenaire)
      └── statut : BLOQUÉ tant que gaps non résolus
```

Règles du modèle :

- Les périmètres des scénarios sont **disjoints et explicites** (pas de chevauchement implicite).
- Chaque scénario est **autonome** dans sa qualification et ses réserves.
- L'existence d'un scénario provisoire **n'altère pas** l'état des gaps du dossier complet.
- Le **dossier complet** n'est jamais `firm` tant qu'un sous-périmètre repose sur hypothèse non confirmée ou gap ouvert.

> Ce modèle s'appuie sur la structure multi-lot déjà existante (`quote_request_lines`, pricing par lot, `outputs_json.lots[]`, voir `docs/MASTER_CONTEXT.md` § *Support multi-lot*) comme support naturel de découpage de périmètre. Toutefois, la notion de « scénario provisoire opérateur » telle que décrite ici est **doctrinale** et n'est pas, à ce jour, un objet runtime de premier rang (voir §16).

---

## 7. Assumption ledger

L'**assumption ledger** est le registre traçable des hypothèses opérateur d'un dossier. C'est l'instrument qui garantit que `hypothèse ≠ fact`.

### Rôle

- Enregistrer chaque hypothèse opérateur **comme hypothèse**, jamais comme fact.
- Garder le lien hypothèse → scénario → réserve.
- Permettre l'audit complet : qui a supposé quoi, pourquoi, quand, et sur quel périmètre.
- Permettre la **réversibilité** : quand un gap est résolu, l'hypothèse correspondante est infirmée ou confirmée — et seule une **promotion explicite** la transforme en fact.

### Forme conceptuelle d'une entrée de ledger

| Champ | Description |
|-------|-------------|
| `assumption_id` | Identifiant de l'hypothèse |
| `scope` | Périmètre concerné (lot, groupe, service) |
| `statement` | Énoncé lisible de l'hypothèse (« N unités supposées comparables à M documentées ») |
| `basis` | Justification / source de l'analogie |
| `operator` | Opérateur ayant posé l'hypothèse |
| `created_at` | Horodatage |
| `linked_gap_keys` | Gaps que l'hypothèse contourne provisoirement |
| `linked_reservation_codes` | Réserves émises dans le scénario (voir §13) |
| `status` | `active` (en vigueur) → `confirmed` (promue en fact, explicitement) / `refuted` (infirmée par info client) |
| `promoted_fact_id` | Renseigné **uniquement** lors d'une promotion explicite en fact |

> **Garde doctrinale** : une entrée du ledger ne devient `confirmed` et ne renseigne `promoted_fact_id` que par **action humaine explicite**. Aucune transition automatique `active → confirmed`.

> **Statut runtime** : l'assumption ledger tel que décrit ici est **doctrinal**. Le système trace déjà certaines hypothèses via la timeline (`assumption_applied`, voir `docs/DECISIONS.md` D5) et les réserves via les *reservation reason codes* du snapshot de version, mais un registre d'hypothèses de premier rang, réversible et lié aux scénarios, n'existe pas encore comme objet dédié (voir §16).

---

## 8. Statuts des scénarios

Chaque scénario provisoire porte un statut. Les statuts ci-dessous sont **doctrinaux** et s'articulent avec la qualification commerciale existante (`provisional` / `partial` / `firm`).

| Statut scénario | Signification | Qualification commerciale associée |
|-----------------|---------------|-------------------------------------|
| `draft` | Périmètre et hypothèses en cours de définition par l'opérateur | — (non communiqué) |
| `provisional_estimated` | Estimation produite sous hypothèses + réserves | `provisional` |
| `partial_scoped` | Sous-périmètre volontairement couvert, reste exclu | `partial` |
| `blocked` | Estimation impossible même sous réserve intelligible (information trop manquante) | — (non communicable) |
| `superseded` | Remplacé par un scénario plus récent (nouvelle info, nouvelle hypothèse) | — |
| `promoted_to_final` | Toutes les hypothèses du périmètre ont été promues en facts, gaps résolus | `firm` (cotation finale) |

Règles de statut :

- Le passage à `promoted_to_final` **exige** : (a) résolution de tous les gaps du périmètre, (b) promotion explicite de toutes les hypothèses en facts, (c) validation opérateur.
- `blocked` est un statut **assumé et légitime** : il est préférable de déclarer un périmètre non cotable que d'inventer.
- Un dossier composite peut simultanément porter un scénario `provisional_estimated` et un périmètre `blocked`.

---

## 9. Règles de révision

Les scénarios provisoires sont **vivants** : ils évoluent avec l'information.

1. **Arrivée d'une information client** sur un gap lié → réévaluation des hypothèses qui contournaient ce gap :
   - si l'information **confirme** l'hypothèse → l'opérateur peut la **promouvoir explicitement** en fact ;
   - si l'information **infirme** l'hypothèse → l'hypothèse passe `refuted`, le scénario est révisé ou `superseded`.
2. **Révision = nouveau scénario** lorsque l'écart est substantiel : on ne réécrit pas silencieusement un scénario communiqué ; on en produit une nouvelle version traçable (cohérent avec l'immutabilité des snapshots de version, voir `docs/MASTER_CONTEXT.md` § *Garanties d'intégrité Lot 4-A*).
3. **Aucune révision ne promeut automatiquement** une hypothèse en fact. La promotion reste un acte humain explicite.
4. **Toute révision est tracée** : l'assumption ledger conserve l'historique `active → confirmed/refuted` et les liens vers les scénarios.
5. **Cohérence inter-scénarios** : une information confirmée sur un périmètre ne se propage pas implicitement à un autre périmètre porteur d'une hypothèse analogue ; chaque analogie reste une hypothèse propre à son périmètre jusqu'à confirmation.

---

## 10. Interdictions

Interdictions **absolues** dans le cadre de cette doctrine :

- ❌ **Promotion automatique** d'une **valeur** marchandise depuis une hypothèse.
- ❌ **Promotion automatique** d'un **code HS** depuis une hypothèse.
- ❌ **Promotion automatique** d'un **PAD** (catégorie / taux droit de passage) depuis une hypothèse.
- ❌ **Promotion automatique** d'un **poids** depuis une hypothèse.
- ❌ **Run-pricing global engageant** sur un dossier composite incomplet (sous-périmètres à hypothèses ou gaps ouverts).
- ❌ Présenter une cotation provisoire comme un **devis ferme**.
- ❌ Inclure un élément reposant sur une hypothèse dans un **total ferme**.
- ❌ Inventer une valeur, un HS, un droit, une taxe, un PAD ou un poids pour « compléter » un dossier.
- ❌ **Auto-send** d'une cotation (le système produit des brouillons, l'opérateur envoie).
- ❌ Considérer qu'un scénario provisoire **débloque** le dossier complet.

> Ces interdictions sont cohérentes avec les gardes runtime existantes : SOURCE-GUARD (anti-contamination des facts monétaires, voir `MASTER_CONTEXT.md` § *SOURCE-GUARD*), l'absence d'auto-update des facts, et la garde QQM qui interdit un snapshot `firm` contenant une ligne `TO_CONFIRM`.

---

## 11. Exemple générique (inspiré bus + médical)

> Exemple **illustratif**, anonymisé et généralisé. Il sert uniquement à montrer la doctrine en action ; il n'est pas une spécification d'un dossier particulier.

Un dossier composite arrive avec deux familles de marchandises et une documentation inégale :

**Famille 1 — un lot d'unités homogènes partiellement documenté**
Un sous-ensemble d'unités est documenté ; le reste ne l'est pas, mais l'opérateur juge raisonnable de le supposer **comparable** au sous-ensemble documenté.

- L'opérateur pose une **hypothèse explicite** dans l'assumption ledger : « les unités non documentées sont supposées comparables aux unités documentées ».
- Un **scénario provisoire** est produit pour cette famille (ex. régime DDP), qualifié `provisional`, portant la réserve « volumétrie/caractéristiques des unités non documentées supposées ».
- Statut scénario : `provisional_estimated`.

**Famille 2 — équipements à forte incertitude réglementaire**
Les codes HS, valeurs, droits et taxes ne sont **pas** connus.

- L'opérateur **ne les invente pas**.
- Un **scénario provisoire** est produit pour cette famille (ex. régime DAP), qualifié `provisional` ou `partial`, avec les postes droits/taxes matérialisés en **réserve** (« À confirmer », jamais « 0 FCFA »).
- Statut scénario : `provisional_estimated` ou `partial_scoped` selon ce qui est présentable sous réserve.

**Dossier complet**
- Les gaps client (caractéristiques des unités non documentées, HS/valeurs des équipements) restent **ouverts**.
- Le **dossier complet reste BLOQUÉ** : aucune cotation finale ferme globale n'est produite.
- Les deux scénarios provisoires **coexistent** avec les gaps ouverts.

**Évolution**
- Quand le client répond, chaque gap résolu permet à l'opérateur de **confirmer ou infirmer explicitement** l'hypothèse liée.
- Les hypothèses confirmées sont **promues en facts** (acte humain), les scénarios sont révisés, et seulement alors un périmètre peut passer en **cotation finale** `firm`.

---

## 12. Relation avec les gaps

- Les **gaps** (`quote_gaps`) et les **demandes de clarification** (`client_gap_requests`) restent la **source de vérité** de l'information manquante.
- Une **hypothèse opérateur contourne provisoirement un gap** : elle ne le résout pas. Le gap reste ouvert dans le système.
- L'assumption ledger lie chaque hypothèse aux `gap_key` qu'elle contourne (`linked_gap_keys`).
- La résolution d'un gap (cycle `drafted → sent → answered → validated`) est le **déclencheur** de la réévaluation de l'hypothèse correspondante (§9).
- **Un scénario provisoire peut coexister avec des gaps ouverts** — c'est le cœur de la doctrine. Produire un scénario ne ferme ni ne masque les gaps.
- Cohérence avec l'existant : la synchronisation gaps → actions client (`sync-gap-client-actions`) et la fermeture des `client_gap_requests` lors de la résolution effective d'un gap (P1-CGR-SYNC) restent inchangées et ne doivent pas être détournées pour « clôturer » un gap qu'une hypothèse n'a fait que contourner.

---

## 13. Relation avec les PDFs provisoires

- Un PDF (ou email) issu d'un scénario provisoire est un **document réservé**, pas un devis ferme.
- Les postes non résolus sont rendus **« À confirmer »**, jamais « 0 FCFA » — cohérent avec la garde existante `CUSTOMS_RESERVE` / `TO_CONFIRM` (voir `MASTER_CONTEXT.md` § *Garanties d'intégrité Lot 4-A*).
- Le **total ferme** d'une version provisoire applique `firmTotalPolicy: "excludes_reserved_items"` : les éléments en réserve sont **exclus** du total ferme affiché au client.
- Les **réserves** s'appuient sur les *reservation reason codes* déjà définis (whitelist initiale) :

  | Code | Signification |
  |------|--------------|
  | `MISSING_CARGO_VALUE` | Valeur marchandise absente (impact CAF/customs) |
  | `MISSING_HS_CODE` | Code HS non résolu (impact droits/taxes) |
  | `PAD_CATEGORY_UNRESOLVED` | Catégorie marchandise PAD non déterminée |
  | `PARTNER_COST_PENDING` | Coût partenaire en attente de réponse |
  | `RATE_PENDING_CONFIRMATION` | Tarif marqué « À confirmer » |

- Une version provisoire respecte l'**immutabilité des snapshots** : toute correction passe par la **création d'une nouvelle version**, jamais par réécriture.
- Aucune génération de PDF/template n'est requise par ce document ; la doctrine s'aligne sur le pipeline de sortie existant (`generate-quotation-version → export-quotation-version-pdf → create-quotation-email-draft → send-quotation`) sans le modifier.

---

## 14. Phases de mise en œuvre

> Les phases ci-dessous sont une **proposition de séquencement doctrinal**. Aucune n'est engagée sans GO CTO explicite. Aucune n'est réputée réalisée tant qu'elle n'est pas inscrite dans `docs/MASTER_CONTEXT.md` avec ses artefacts réels.

- **Phase 0 — Doctrine (ce document)** : poser le vocabulaire, les principes et les interdictions. *Documentation uniquement.*
- **Phase 1 — Hypothèses tracées** : matérialiser l'assumption ledger comme objet de premier rang (hypothèses opérateur explicites, réversibles, liées aux gaps), au-delà de la timeline `assumption_applied` actuelle.
- **Phase 2 — Scénarios comme objets** : représenter explicitement un scénario provisoire (périmètre, hypothèses, réserves, statut) au-dessus de la structure multi-lot existante.
- **Phase 3 — Promotion explicite** : flux opérateur de promotion hypothèse → fact (avec validation, traçabilité, et garde anti-promotion automatique).
- **Phase 4 — Cotation finale par périmètre** : passage `provisional → firm` périmètre par périmètre, dossier complet débloqué uniquement quand tous les périmètres sont fermes.

Chaque phase devra respecter : périmètre réduit, corrections chirurgicales, zones FROZEN intactes (`quotation-engine`, `build-case-puzzle`, `set-case-fact`, pricing logic), idempotence, traçabilité et intégrité des données.

---

## 15. Backlog futur

Sujets à inscrire / arbitrer dans `docs/DEFERRED_BACKLOG.md` (et non dans ce document) lorsqu'ils seront engagés :

- **Assumption ledger de premier rang** — modèle de données dédié aux hypothèses opérateur réversibles.
- **Objet « scénario provisoire »** — représentation explicite au-dessus du multi-lot.
- **Flux de promotion hypothèse → fact** — UI + edge function, validation humaine obligatoire, garde anti-auto-promotion.
- **Propagation contrôlée inter-périmètres** — règles si une confirmation sur un périmètre éclaire une hypothèse analogue ailleurs (par défaut : aucune propagation implicite).
- **Reservation reason codes étendus** — au-delà de la whitelist initiale, si de nouveaux types de réserve apparaissent.
- **Déblocage progressif du dossier complet** — sémantique d'agrégation des statuts de scénarios vers le statut du dossier.

> Tout sujet ci-dessus reste **dormant** tant qu'il n'est pas explicitement engagé par un ticket produit avec GO CTO.

---

## 16. Ce que le système ne sait pas encore faire aujourd'hui

> Section de vérité. Pour éviter toute confusion entre doctrine et runtime.

À ce jour, **vérifié dans `docs/MASTER_CONTEXT.md`**, le système :

- ✅ porte un **Quote qualification model** `firm` / `provisional` / `partial` au niveau du snapshot de version ;
- ✅ matérialise des **réserves** via les *reservation reason codes* et les lignes `TO_CONFIRM` / `CUSTOMS_RESERVE` (« À confirmer », jamais « 0 FCFA ») ;
- ✅ gère des **gaps** et des **clarifications client** (`quote_gaps`, `client_gap_requests`, cycle `drafted → … → validated`) ;
- ✅ supporte le **multi-lot** (détection, pricing par lot, sortie multi-lot) ;
- ✅ trace certaines **hypothèses appliquées** via la timeline (`assumption_applied`) ;
- ✅ protège contre la **contamination des facts** (SOURCE-GUARD) et interdit l'**auto-update des facts** et l'**auto-send**.

En revanche, **le système ne sait PAS encore** (cible doctrinale, non livrée) :

- ❌ représenter un **scénario provisoire opérateur** comme un objet de premier rang (périmètre + hypothèses + réserves + statut) distinct du simple lot ;
- ❌ tenir un **assumption ledger réversible** liant hypothèses ↔ gaps ↔ scénarios avec statuts `active / confirmed / refuted` ;
- ❌ offrir un **flux explicite de promotion hypothèse → fact** distinct des promotions de gaps existantes ;
- ❌ gérer la **révision versionnée de scénarios** (`superseded`) au sens de cette doctrine ;
- ❌ piloter un **déblocage progressif périmètre par périmètre** du dossier complet basé sur les statuts de scénarios.

> Conséquence pratique : tant que ces capacités ne sont pas livrées et inscrites dans `MASTER_CONTEXT.md`, la doctrine s'applique **manuellement, sous discipline opérateur**, en s'appuyant sur les briques existantes (qualification de version, réserves, gaps, multi-lot, timeline). Aucune capacité décrite ici ne doit être présentée comme automatique.

---

*Fin du document — doctrine produit, documentation uniquement. Aucune modification de code, edge function, composant, migration, PDF/template ou DB n'est induite par ce fichier.*
