# File d'attente CTO — Dakar Cargo Quotes

Convention (mode autopilot) : quand Claude Code, en exécution automatique planifiée, atteint une
stop condition ou termine un lot nécessitant un verdict CTO non encore donné, il consigne une
entrée ici au lieu d'attendre une réponse synchrone, puis passe au lot sûr suivant (ou s'arrête
proprement s'il n'y en a pas). Codex (ou l'utilisateur) traite les entrées `PENDING` en priorité à
l'ouverture de session, puis met à jour le statut : `GO` / `NO-GO` / `INFO_MANQUANTE` / `TRAITÉ`.

Ne jamais committer ce fichier avec autre chose que lui-même (commit docs-only dédié).

---

<!-- Nouvelle entrée : copier le bloc ci-dessous, remplir, ajouter en haut de la liste. -->

## [AAAA-MM-JJ HH:MM UTC] PENDING — <titre court>
**Origine** : autopilot quotidien (planifié) | session interactive
**Type** : demande de GO avant travail | branche/PR prête pour verdict | blocage / divergence Git
**Objectif** :
**Fichiers concernés** :
**Pourquoi une décision CTO est nécessaire** :
**Risques** :
**Recommandation de Claude Code** :
**Référence** (branche / commit local / lien) :

---

## [2026-09-10 17:09 UTC] PENDING — DTHC-4 : cumul « conteneur spécial × marchandise dangereuse »

**Origine** : session interactive
**Type** : décision CTO rendue, GO d'implémentation en attente

**DÉCISION CTO DU 2026-09-10** — un conteneur qui est **à la fois** hors gabarit / spécial **et**
IMDG classe 1 à 9 se tarife au **taux conteneur spécial majoré de 50 %**, soit
**310 000 × 1,5 = 465 000 FCFA par EVP** (manutention DP World Dakar).

Cette décision lève l'ambiguïté que le dépliant DP World ne tranche pas : il présente « Produits
dangereux 155 000 + 50 % » et « Autres conteneurs spéciaux 310 000, surcharge Néant » comme deux
lignes distinctes, sans dire ce qui s'applique au cumul. Le code refusait de trancher
(`dpw-dthc-tariff.ts:366-368`, `FAMILY_AMBIGUOUS`) — comportement correct jusqu'ici.

**Lecture structurelle qu'elle induit** (hypothèse, à confirmer) : les 50 % ne sont pas une famille
mais une **surcharge appliquée au taux de base de l'équipement**. Cela rend cohérente la ligne
« dangereux » du dépliant, qui vaut exactement STANDARD (155 000) + 50 %.

**Questions restant ouvertes, à trancher avant écriture** :
1. **Niveau de preuve** : `official` (si confirmation écrite de DP World disponible) ou
   `validated_internal` (décision CTO). Les deux sont acceptés par le résolveur
   (`DPW_DTHC_EVIDENCE_WHITELIST`), mais inscrire `official` sans document serait faux.
2. **Portée** : la majoration de 50 % s'étend-elle à `REEFER` (170 500 → 255 750) et à `BASIC`
   (70 000 → 105 000), ou vaut-elle uniquement pour `STANDARD` et `SPECIAL` ? Ne rien généraliser
   sans réponse.

**Encodage recommandé** : ajouter une 6e famille `SPECIAL_DANGEROUS` (`amount` 310 000,
`surcharge_percent` 50) plutôt qu'une surcharge orthogonale appliquée après coup — la ligne
`DANGEROUS` porte déjà ses 50 %, une surcharge transverse les appliquerait deux fois. L'ajout d'une
famille préserve le contrat « cargo_type exact + classification exacte » sur lequel repose tout le
résolveur.

**Fichiers concernés** : `supabase/functions/_shared/dpw-dthc-tariff.ts` (non FROZEN) + son test,
migration d'ajout de ligne dans `port_tariffs`. Sous-lot du lot `DTHC-4` décrit ci-dessous.

**Enjeu chiffré, dossier GoTrans `5e9cd222`** : 39 unités BESS à 1 EVP. Au taux standard
6 045 000 FCFA, au taux cumulé **18 135 000 FCFA**. Écart **12 090 000 FCFA** sur la seule
manutention terminal.

**PREUVE DE FACTURATION (reçue le 2026-09-10)** — facture DP World Dakar n° 3384292 du 31/07/2026,
client 2HL SARL (compte 4111000) P/C NEW ENERGY AFRICA-KOLDA SA, BL SHZ8041934, navire LION réf
22323I, SHEKOU → DAKAR, DO import DPWHJ2307774. Quatre conteneurs **20FL** (HDTU5200312, 333, 349,
354), marchandise déclarée « MATERIELS ELECTRIQUES », **33,050 T chacun**.

| Ligne facturée | Unités | Taux | Montant |
|---|---|---|---|
| IMPRIMES | 1 | 1 400 | 1 400 |
| RELEVAGE | 4 | **18 280** | 73 120 |
| **ACCONAGE C7** | 4 × 1 | **310 000** | 1 240 000 |
| Total HT | | | 1 314 520 |
| TVA 18 % | | | 236 614 |
| Net à payer | | | 1 551 134 |

Ce que la facture établit :
- le taux « conteneurs spéciaux » de 310 000 est bien appliqué en facturation réelle, sous le libellé
  DP World **« ACCONAGE C7 »**, **par conteneur** (1 unité pour un 20 pieds) ;
- la majoration de 50 % n'a pas été appliquée sur cette facture, la marchandise étant déclarée
  « matériels électriques » ;
- 33,050 T sur un 20 pieds dépasse la masse brute ISO de 30 480 kg, d'où le flat rack et le
  classement spécial : ces unités ne sont pas classées spéciales par excès de zèle du terminal ;
- coter ces quatre conteneurs au tarif standard aurait donné 620 000 au lieu de 1 240 000 facturés,
  soit **une sous-cotation de 100 %** sur la seule manutention.

Constats nouveaux issus de cette facture :
- **E** — le code conteneur **`20FL`** n'existe nulle part dans le produit. `CONTAINER_PROFILES`
  connaît `20FR` mais pas `20FL` ; le seul alias `20FLATRACK → 20FR` vit dans `audit-coherence`, qui
  n'alimente pas le résolveur DTHC. Une facture réelle prouve que DP World émet ce code.
- **F** — `RELEVAGE`. **DÉCISION CTO DU 2026-09-10 : le relevage vaut 18 280 FCFA par EVP, soit le
  double pour un 40 pieds (36 560).** La facture 3384292 le confirme (4 × 18 280 = 73 120 pour quatre
  20 pieds). La base porte `CONTENEUR_20 = 36 560` et `CONTENEUR_40 = 73 120`, soit **exactement le
  double du barème dans les deux cas**, sur une source `Taleb_Quote_2024` (un devis, pas le tarif
  officiel). `quotation-engine:1515` calcule `amount × quantity` : chaque ligne de relevage émise
  jusqu'ici est **surévaluée de 100 %**.
  Deuxième défaut, indépendant : le bloc est encadré par `if (isTransit)` (`quotation-engine:1505`),
  alors que la facture 3384292 est un **import** et porte bien une ligne relevage. En import, la
  ligne est donc **totalement omise** — l'erreur inverse.
  Troisième défaut : la ligne émise porte `source.type: 'OFFICIAL'` et `confidence: 0.95` en dur
  (`:1519-1522`), quel que soit le niveau de preuve réel de la ligne tarifaire. Un devis est présenté
  au client comme un tarif officiel. `evidence_level` des deux lignes non vérifié à ce jour (MCP
  Lovable indisponible au moment du constat).
  **CORRECTIF F1 APPLIQUÉ le 2026-09-10 (GO CTO)** — migration
  `20260910180000_dthc4_f1_relevage_official_rate.sql`, commit `dc588eed`, appliquée en base live et
  vérifiée : 18 280 / 36 560 / 41 130 FCFA, `unit` `FCFA/CNT`, `evidence_level` `official`, source
  « Facture DP World Dakar n° 3384292 du 31/07/2026 ». Ligne 45 pieds créée sur GO CTO.
  **Découverte faite à l'exécution** : les deux lignes étaient en `evidence_level = 'observed'`, hors
  de la whitelist de provenance du runtime — elles étaient donc **invisibles au moteur**, et le
  relevage n'était chiffré nulle part. Le diagnostic « surévalué de 100 % en transit » était
  inexact : la ligne n'était pas émise du tout. Le correctif l'ACTIVE pour la première fois.

  **Correction initialement proposée (conservée pour mémoire)** :
  `CONTENEUR_20` 36 560 → **18 280**, `CONTENEUR_40` 73 120 → **36 560**, `unit` harmonisée en
  `FCFA/CNT`, `source_document` → « Facture DP World Dakar n° 3384292 du 31/07/2026 + décision CTO
  2026-09-10 », `evidence_level` → `validated_internal` tant que la page tarif officielle n'est pas
  fournie. Ligne 45 pieds absente : 2,25 EVP × 18 280 = 41 130 — **dérivée de la règle EVP, à
  confirmer avant écriture**, pas encodée sans accord.
  **Sous-lot F2 (touche `quotation-engine`, FROZEN, GO distinct)** : ouvrir le relevage à l'import, et
  à terme remplacer les deux lignes par un taux unique de 18 280/EVP multiplié au même endroit que le
  DTHC — un seul point d'application du facteur EVP dans toute la chaîne.
- **G** — `ACCONAGE` et `IMPRIMES` (1 400) n'existent pas dans le produit. L'acconage est le DTHC sous
  son nom de facturation DP World : utile pour le rapprochement facture / devis.
- **H** — TVA 18 % appliquée sur l'ensemble des lignes DP World ; à vérifier côté devis.
- **I** — recoupement possible avec les tickets de pesage du 15/08/2026 (tous vers KOLDA, dont un
  « produit : BATTERIE » à 49 115 kg sur un T11S4). Si ce ticket portait l'un de ces conteneurs, la
  tare de l'ensemble T11S4 vaut 49 115 − 33 050 = **16 065 kg** — le chiffre manquant du lot
  `ROAD-LOAD-1`. À confirmer avec 2HL : deux semaines séparent les deux documents et rien ne prouve
  la correspondance.

**Reste du lot `DTHC-4`, audité le 2026-09-10, aucun fichier modifié** :
- **A** — `cargo.dangerous_goods` n'atteint jamais le DTHC : `isIMO`/`isHazmat` sont déclarés
  (`quotation-engine:421,425`), lus (`:1460`) et **jamais renseignés** par `run-pricing`
  (`engineParams`, `:3072-3093`). La majoration de 50 % ne part donc jamais automatiquement.
- **B** — `20HQ`/`20HC` absents de `CONTAINER_PROFILES` alors que `40HC`/`40HQ` y sont : les
  52 conteneurs du dossier tombent en `CONTAINER_TYPE_UNSUPPORTED`.
- **C** — aucun fait ne route une unité hors gabarit ou en surpoids vers `SPECIAL` : un dry OOG reste
  `DRY`. S'appuiera sur `cargo.weight_per_container_kg`, qui existe déjà (TRUCKING-22T).
- **D** — ✅ **TRAITÉ le 2026-09-11 (GO CTO), commit `8cc21a40`.** Cinq lignes actives de
  `port_tariffs` étaient absentes du dépliant (`CONTENEUR_40` à 232 500, `CONTENEUR_VIDE` et
  `CONTENEUR_20 Transbordement` à 75 000, en import et export). Le résolveur les ignorait, mais
  `generate-response` les envoyait toutes au modèle rédacteur sous « UTILISER CES MONTANTS EXACTS ».
  **D1** (migration `20260911090000_dthc4_d1_retire_non_canonical_thc_rows.sql`) les désactive —
  grille THC active réduite aux 11 lignes canoniques, vérifié en base live. **D2** ajoute la colonne
  `Unité` au tableau transmis au modèle et y rappelle la règle de conversion EVP du dépliant : sans
  elle, un montant en EVP se lisait comme un prix par conteneur et un 40 pieds était annonçable à
  moitié prix. Aucun impact sur le devis structuré.
  **Reste ouvert** : obtenir la **page 2 du dépliant DP World** (le document reçu est marqué « 1_2 »).
  Si elle documente les services « conteneur vide » et « transbordement », réintroduire ces lignes
  avec leur montant et leur source exacts — la désactivation est réversible.
- **Hors lot** : le résolveur est limité à l'import (`dpw-dthc-tariff.ts:382`) alors que les grilles
  EXPORT et TRANSIT existent en base et sont conformes au dépliant. Donnée morte.

**Vérifié le 2026-09-10** : les cinq familles de `port_tariffs` (import, export, transit) concordent
au franc près avec le dépliant DP World « Nouveaux tarifs de manutention de conteneurs » 2024
(70 000 / 155 000 / 170 500 / 155 000 + 50 % / 310 000 ; transit 110 000 ; 20' = 1 EVP, 40' = 2 EVP,
45' = 2,25 EVP). Page 2 du dépliant non fournie.

**Référence** : branche `work`, HEAD `c0304c65`. Pièce reçue : `DPWDakarLandsideTariff2024_1_2.pdf`.

---

## [2026-09-10 16:49 UTC] PENDING — Contradiction pont-bascule / dépliant officiel sur les limites d'essieux T12S4

**Origine** : session interactive
**Type** : demande de GO avant travail (lot `ROAD-LOAD-1`), suspendue en attente d'une réponse externe
**Objectif** : doter le devis d'un référentiel de charge routière (classes de véhicules, limites par
groupe d'essieux, PTRA) pour qu'il sache quel mode de transport est requis et n'expose pas SODATRA à
une sanction au pont-bascule.

**Fait bloquant** — pour la classe **T12S4**, les deux sources officielles divergent :

| Groupe | Dépliant Afrique Pesage / Direction des Routes (oct. 2022) | Tickets Diamniadio 1 (15/08/2026) | Écart |
|---|---|---|---|
| Essieu avant | 6 900 | 6 900 | — |
| Tandem | **23 000** | 20 700 | −2 300 |
| Quadem | **42 550** | 34 500 | −8 050 |
| Somme des groupes | 72 450 | 62 100 | −10 350 |
| PTRA imprimé | 72 450 | 72 450 | — |

Le ticket se contredit lui-même : il affiche un PTRA de 72 450 kg que ses propres limites de groupe
(62 100 kg) rendent inatteignable. Le dépliant, lui, est cohérent sur ses 11 lignes de véhicules
articulés (PTRA = somme des groupes ; colonne appliquée = base UEMOA × 1,15). Le ticket **T11S4**
(F119038, produit BATTERIE) concorde exactement avec le dépliant : 6 900 / 13 800 / 34 500 = 55 200.
Lecture alternative non écartée : les tickets qualifient les essieux 2 et 3 de « roue simple », ce
qui pourrait justifier un tandem abaissé — mais n'explique pas le quadem.

**En attente de** : réponse écrite d'Afrique Pesage Sénégal S.A. et/ou de la Direction des Routes
(Ministère des Infrastructures, des Transports terrestres et du Désenclavement). Demande portée par
le CTO. **Reprendre ce lot dès réception.**

**Fichiers concernés** : aucun modifié à ce jour. À créer sous GO —
`supabase/functions/_shared/road-axle-limits.ts` + son test (sous-lot A), migration
`road_vehicle_classes` (sous-lot B), puis branchement `run-pricing` en couche additive
`enrichment_road_legality` (sous-lot C, module FROZEN → exception structurelle explicite requise).

**Pourquoi une décision CTO est nécessaire** : retenir 42 550 ou 34 500 change de 8 050 kg la charge
utile admise, donc le mode de transport retenu et le prix. Se tromper, c'est sous-facturer un débours
ou refuser à tort un transport légal.

**Risques** : dossier GoTrans `5e9cd222` — 39 unités annoncées à 55 t/unité en 20HQ SOC, UN3536
classe 9, destination N'Dioum. Avec 42 550 au quadem, 55 t passe tout juste ; avec 34 500, non. La
faisabilité en semi-remorque bascule selon la valeur retenue.

**Recommandation de Claude Code** : sans réponse, encoder la valeur la plus restrictive (34 500) avec
un avertissement citant le dépliant — fail-closed, conforme à la doctrine du dépôt. Ne pas encoder
les tableaux « porteurs », « hydrocarbures » et « transport de conteneurs » : le scan disponible est
illisible sur ces trois tableaux.

**Données encore manquantes, à réclamer en parallèle** :
- pesée à vide d'un T12S4 et d'un T11S4 (tare réelle) — chiffre qui décide de la faisabilité des 55 t ;
- plaque CSC des unités BESS GoTrans (un 20HQ est plaqué à 30 480 kg) ;
- packing list GoTrans : dimensions externes réelles et VGM par unité ;
- déclaration de marchandise dangereuse confirmant UN3536 / classe 9 ;
- scan net des trois autres tableaux du dépliant.

**Constats connexes relevés en séance, non encore arbitrés** :
- `quotation-engine` déclare `cocSoc` (ligne 375) sans jamais le lire : les surestaries §8c
  s'appliquent aux conteneurs SOC comme aux COC. 52 des 55 conteneurs du dossier GoTrans sont SOC.
- `local-transport-destination.ts` ne reconnaît ni `20HQ`/`20HC` ni la destination N'Dioum : les
  52 conteneurs et la destination du dossier tombent en `TARIF_TRANSPORT_A_CONFIRMER`.
- 3 tickets sur 8 dépassent la limite de l'essieu avant (6 900 kg) de 377 à 453 kg, indépendamment du
  fret — caractéristique des tracteurs, à signaler à 2HL.

**Référence** : branche `work`, HEAD `1e6abc1c`. Pièces reçues en session : 8 tickets de pesage
(2 PDF), dépliant Afrique Pesage / Direction des Routes d'octobre 2022.
