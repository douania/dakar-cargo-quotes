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

## [2026-09-11 17:30 UTC] ✅ TRAITÉ — T6 + T1 livrés ; point de reprise de la session du 11 septembre

**Origine** : session interactive
**Type** : lot terminé + orientation de reprise pour la prochaine session (Codex, Claude Code ou autre)

**Livré et poussé sur `work` ce jour** (au-delà du pack DTHC-4 déjà consigné dans les entrées ci-dessous) :
`a34bd893` T6a — `EVP_CONVERSION` réaligné sur `CONTAINER_PROFILES` : DTHC-4-C avait ajouté `20FL`/`40FL` aux profils sans les inscrire dans la table d'EVP, alors que le code déclare les deux listes « strictement » identiques ; les clés tombaient dans le repli par taille de `getEVPMultiplier`, qui rendait le bon chiffre par accident. `7bccf58e` T6b/T1 — filet de cohérence `_shared/container-type-consistency_test.ts` (4 invariants, exclusion 45 pieds nommée et testée) + les cinq orthographes high cube du 20 pieds et les formes courtes `20ST`/`40ST` ajoutées au barème de livraison. Le filet a été **vérifié en échec** sur les sources d'avant le lot : 3 tests sur 5 tombent.
Preuves : 282 Deno `_shared` PASS, 323 vitest PASS, typecheck PASS, `check:function-config` PASS, lint baseline 737/16 inchangé, build PASS. `typecheck:deno` **NOT_RUN** — imports distants injoignables depuis l'environnement agent, échec sur un fichier préexistant ; compensé par `deno check` local sur le périmètre du lot, PASS. Aucune migration, aucun composant FROZEN, aucun montant modifié.

**Constat structurant à connaître avant tout travail sur les types de conteneur** : un type est déclaré dans **quatre tables indépendantes** réparties sur trois modules (`CONTAINER_PROFILES` et `DTHC_CONTAINER_TYPE_ALIASES` dans `_shared/dpw-dthc-tariff.ts`, `EVP_CONVERSION` dans `_shared/quotation-rules.ts`, `LOCAL_TRANSPORT_CONTAINER_ALIASES` dans `_shared/local-transport-destination.ts`), plus `container_specifications` en base. Rien ne les relie. Le filet de T6b échoue désormais si elles divergent — **ne pas le contourner par une liste d'exceptions.**

**Ce qui reste à faire, par ordre de priorité** (détail complet dans `docs/DEFERRED_BACKLOG.md`, deux entrées ouvertes) :
1. `EMAIL-INGEST-SECURITY-1` — **gravité élevée, différé sur décision CTO explicite.** S0 : trois comptes `*@test.local` résiduels dans `auth.users`, dont un confirmé et authentifié (suppression manuelle UI Cloud, ne nécessite aucun lot). S1 : `search-emails`, `force-download-attachment`, `hydrate-email-body`, `import-thread` et `sync-emails` gardés par `requireUser` sans contrôle de rôle — tout compte authentifié lit la boîte. S2 à S4, E1-a/b/c, M1 : voir l'entrée.
2. `TRANSPORT-SPECIAL-CASE-1` — T2 (le barème sature au tarif 40 pieds, aucun palier au-dessus), T3 (aucune notion de véhicule requis), T4 (aucun code ISO 6346 reconnu en entrée), T5 (`isOOG` est du code mort, sans écrivain).

**Arbitrages CTO encore en attente, sans lot rattaché** : niveau de preuve du cumul 465 000 (recommandation Claude Code : `validated_internal`, l'arrêté disant « Néant ») · extension éventuelle de la majoration 50 % aux familles `REEFER` (255 750) et `BASIC` (105 000) · sous-lot F2, relevage à l'import C1–C5, qui toucherait le composant FROZEN `quotation-engine` · famille d'équipement DP World pour les BESS : marquage ISO ou usage négocié (écart chiffré 13 485 000 vs 26 970 000 FCFA sur le dossier GoTrans) · source du seuil de poids pour compléter `container_specifications` · contradiction tickets de pesage / dépliant Afrique Pesage contre le Règlement UEMOA 14, toujours parkée en attente de réponse d'Afrique Pesage · page 2 du dépliant DP World non fournie · écriture de `cargo.un_number` / `cargo.imo_class` sur le dossier `5e9cd222` · propagation aux dossiers des faits extraits des pièces jointes, aujourd'hui analysées sans jamais devenir des faits.

**Référence** : `work` @ `7bccf58e`, aligné avec `origin/work`. Edge functions redéployées le 2026-09-11 après T6a/T6b.

---

## [2026-09-11 10:05 UTC] ✅ TRAITÉ — ERREUR F1 CORRIGÉE : le relevage transit est restauré

**Correctif appliqué le 2026-09-11 (GO CTO)** — migration
`20260911103000_dthc4_f1b_restore_transit_relevage.sql`, appliquée en base live et vérifiée :
`CONTENEUR_20` 36 560, `CONTENEUR_40` 73 120, `CONTENEUR_45` 82 260, `unit` `FCFA/CNT`,
`evidence_level` `official`, source « Arrêté portant homologation des tarifs de manutention de
conteneurs (Ministère du Commerce, Sénégal, 2015) — annexe, RELEVAGE C6 : 36 560 FCFA par TEU ».
Reste ouvert sous GO distinct : créer les lignes `RELEVAGE` IMPORT/EXPORT au barème C1–C5
(18 280 / 36 560 / 41 130), dormantes tant que F2 n'aura pas ouvert le relevage hors transit.

**Constat d'origine, conservé pour mémoire :**

**Origine** : session interactive — **erreur introduite par Claude Code le 2026-09-10**
**Type** : correctif urgent sur donnée live, GO requis

**Ce qui s'est passé.** L'arrêté d'homologation des tarifs de manutention de conteneurs (Ministère du
Commerce, Sénégal, 2015), reçu le 2026-09-11, fixe le relevage **par TEU et par classification** :

| Classification | Relevage par TEU |
|---|---|
| C1 à C5 (coton, frigo, standards export, produits de base import, standards import) | **18 280** |
| **C6 — transit (Imp/Exp sauf coton)** | **36 560** |

Les deux lignes `RELEVAGE` de `port_tariffs` portaient `operation_type = 'TRANSIT'`, donc la
classification **C6** : 20 pieds = 1 TEU × 36 560 = **36 560**, 40 pieds = 2 TEU × 36 560 = **73 120**.
**Ces valeurs étaient exactes.** La facture DP World 3384292, qui donne 18 280, est un **import**
(C1–C5) — un autre tarif, pas le même.

J'ai comparé une facture d'import à des lignes de transit sans voir que la différence d'opération
portait une différence de barème, et j'ai conclu à tort à un doublement. La migration
`20260910180000_dthc4_f1_relevage_official_rate.sql` (commit `dc588eed`) a donc **appliqué le tarif
import à des lignes de transit**, divisant par deux le relevage transit.

**Exposition réelle, limitée** : avant F1 les deux lignes étaient en `evidence_level = 'observed'`,
hors whitelist runtime — aucune cotation n'a jamais porté de relevage. Depuis F1 elles sont actives,
donc toute cotation **transit** émise depuis le 2026-09-10 sous-évalue le relevage de 50 %.

**Correction proposée (GO requis)** — restaurer le barème C6 sur les lignes transit :

| `cargo_type` | Actuel (faux) | Cible C6 | Base |
|---|---|---|---|
| `CONTENEUR_20` | 18 280 | **36 560** | 1 TEU |
| `CONTENEUR_40` | 36 560 | **73 120** | 2 TEU |
| `CONTENEUR_45` | 41 130 | **82 260** | 2,25 TEU |

Ce qui est acquis de F1 et reste valable : la provenance (`official`, source facture + arrêté),
l'unité explicite, la ligne 45 pieds, et surtout l'activation de la ligne — le relevage n'était
chiffré nulle part avant.

**Question au CTO** : votre règle du 2026-09-10 (« 18 280 par EVP, le double pour un 40 pieds ») est
exacte pour l'**import/export** (C1–C5). Confirmez-vous que le **transit** suit bien le C6 de
l'arrêté à 36 560 par TEU ? Si oui je restaure ; si le barème transit a changé depuis 2015, il me
faut le document.

**À créer séparément** : des lignes `RELEVAGE` en `IMPORT` et `EXPORT` à 18 280 / 36 560 / 41 130
(C1–C5). Elles resteront dormantes tant que le sous-lot F2 n'aura pas ouvert le relevage hors
transit, mais la facture 3384292 prouve que DP World le facture à l'import.

**Référence** : branche `work`, HEAD `479208f7`. Pièce reçue : `dpw_dakar_landside_tariff.pdf`
(arrêté d'homologation, Ministère du Commerce, 2015), publié par DP World Dakar.

---

## [2026-09-11 11:20 UTC] PENDING — L'arrêté en vigueur est identifié : n° 035532 du 28 novembre 2023

**Origine** : session interactive
**Type** : demande de GO avant travail (correction de provenance)

**Texte trouvé** : **Arrêté ministériel n° 035532 du 28 novembre 2023 portant révision des tarifs de
manutention de conteneurs**, Ministère du Commerce, de la Consommation et des Petites et Moyennes
Entreprises — publié au **Journal officiel de la République du Sénégal n° 7723 du 6 avril 2024,
page 471**. Fondement : articles 6 et 7 du décret n° 2022-89 du 17 janvier 2022. Sanctions :
loi n° 2021-25 sur les prix et la protection du consommateur.

**Son annexe reproduit exactement la grille que porte l'application** (export et import : 70 000 /
155 000 / 170 500 / 155 000 + 50 % dangereux / 310 000 ; transit 110 000, taux par EVP). Le dépliant
DP World « Nouveaux tarifs de manutention de conteneurs » en est la reprise commerciale fidèle. Les
cinq familles canoniques sont donc **opposables**, et `evidence_level = 'official'` est pleinement
justifié — mais leur `source_document` cite aujourd'hui `DPW_TARIFS_2025_0001.pdf` ou
« Arrêté DPW 2025 », deux références qui n'existent pas.

**Article 3 — « Les tarifs de magasinage et de relevage, ainsi que des autres opérations annexes,
restent inchangés. »** Le barème de relevage de l'arrêté 2015 (C1–C5 : 18 280/TEU ; C6 transit :
36 560/TEU) est donc toujours en vigueur. **Le correctif F1b appliqué ce jour est confirmé par le
texte.**

**Les deux surcharges de poids de 2015 ont disparu.** L'annexe 2023 porte « Néant » en surcharge sur
toutes les lignes sauf les dangereux : la surcharge colis lourds de 20 % (20' > 15 T, 40' > 26 T) et
la pénalité de 50 % (20' > 20 T, 40' > 30 T) ne sont pas reconduites. La révision portant sur les
tarifs de manutention, leur colonne « Surcharge » remplace celle de 2015. **Rien à encoder.**

**Correction d'une hypothèse du 2026-09-11 matin** : l'arrêté ne codifie pas C1 à C7, il nomme les
classifications en clair. Le « ACCONAGE **C7** » de la facture 3384292 est le **code interne de
facturation DP World** pour la ligne « Autres conteneurs spéciaux » — catégorie effectivement créée
par cet arrêté, absente de celui de 2015. Ce n'est donc pas la preuve d'un texte encore plus récent.

**POINT DE GOUVERNANCE — cumul spécial × dangereux à 465 000.** L'arrêté porte **« Néant »** en
surcharge sur la ligne « Autres Conteneurs spéciaux » à 310 000, et attache le supplément de 50 % à
la seule ligne « Produits dangereux ». **Il n'écrit nulle part le cumul.** La décision CTO du
2026-09-10 (465 000) reste donc une décision de gestion, appuyée sur la pratique de facturation de
DP World, et non sur le texte. `evidence_level` doit être **`validated_internal`**, pas `official`
comme indiqué le 2026-09-10 — sauf confirmation écrite de DP World, qui rendrait `official`
légitime. **À trancher avant d'écrire la ligne.**

**✅ PROVENANCE CORRIGÉE le 2026-09-11 (GO CTO), commit `c48f0119`.** Migration
`20260911120000_dthc4_provenance_arrete_035532.sql` appliquée en base live et vérifiée : les
11 lignes citent l'arrêté n° 035532, `effective_date` = 2024-04-06 (publication au JO, retenue par
le CTO). La migration vérifie l'annexe ligne à ligne — montant ET surcharge — avant d'apposer la
référence. Les lignes RORO, BREAKBULK, magasinage et RELEVAGE conservent leur source, conformément
à l'article 3.
**Changement couplé, à ne pas oublier** : `DPW_DTHC_SOURCE_DOCUMENT` a changé dans
`_shared/dpw-dthc-tariff.ts`. **Le DTHC rendra `TO_CONFIRM` tant que les edge functions ne sont pas
redéployées par Lovable** — dégradation fail-closed, jamais un montant faux, mais à lever au plus
vite.

**Lot initialement proposé (conservé pour mémoire)** — corriger la provenance des
11 lignes canoniques de la grille THC :
- `source_document` → « Arrêté ministériel n° 035532 du 28/11/2023 portant révision des tarifs de
  manutention de conteneurs — JORS n° 7723 du 06/04/2024, p. 471 » ;
- `effective_date` → **2024-04-06** (publication au Journal officiel) au lieu de 2025-01-01.
  À confirmer : la date de signature (2023-11-28) est une alternative, mais la publication est la
  date à partir de laquelle le tarif est incontestablement opposable. Élargit l'applicabilité vers
  l'arrière : les dossiers de 2024 résoudront désormais un tarif au lieu de tomber en `TO_CONFIRM`.

**Référence** : pièce reçue `JO7723du06avril2024_1.pdf`, page 9 (page 471 du JO). Branche `work`,
HEAD `fa3f2186`.

---

## [2026-09-11 10:05 UTC] TRAITÉ — Codification C1–C7 et surcharges colis lourds de l'arrêté 2015

**Origine** : session interactive
**Type** : demande de GO avant travail

L'arrêté 2015 apporte trois éléments que le produit ignore aujourd'hui :

1. **La codification officielle C1 à C6**, qui est celle que DP World imprime sur ses factures
   (« ACCONAGE **C7** » sur la facture 3384292). Le C7 n'existe pas dans l'arrêté 2015 : il a été créé
   par un texte postérieur, pour les conteneurs spéciaux à 310 000. **C'est la preuve qu'un texte
   plus récent existe**, même s'il n'est pas publié sur le site de DP World.
2. **Deux surcharges de poids, absentes du produit et du dépliant 2024** :
   - surcharge colis lourds **20 %** sur un 20 pieds > 15 T et un 40 pieds > 26 T ;
   - **pénalité de surcharge 50 %** sur un 20 pieds > 20 T et un 40 pieds > 30 T (tonnage ISO).
   Elles visent exactement les dossiers qui nous occupent : les BESS GoTrans à 55 T/unité et les
   armoires de stockage à 33,050 T de la facture 3384292.
3. **Le périmètre de la surcharge dangereuse a changé** : « classe 1 à 5 » en 2015, « classe 1 à 9 »
   au dépliant 2024.

**À trancher avant toute écriture** : ces deux surcharges de poids sont-elles toujours en vigueur ?
Le dépliant 2024 porte « Néant » en surcharge sur toutes les lignes sauf les dangereux, ce qui
suggère qu'elles ont été supprimées — mais le dépliant reçu est la page 1 sur 2.

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
- **A** — ✅ **TRAITÉ le 2026-09-11 (GO CTO), commit `5b34d0ac`.** `cargo.dangerous_goods` n'atteignait
  jamais le DTHC : `isIMO`/`isHazmat` étaient déclarés (`quotation-engine:421,425`), lus (`:1460`) et
  **jamais renseignés** par `run-pricing`. La règle vit désormais dans
  `_shared/dangerous-goods.ts` (`isDangerousForEngine`), testée sans réseau ; `run-pricing` n'est
  qu'un passe-plat, en exception structurelle additive (33 insertions, 0 suppression). Les deux
  chemins mono-lot et multi-lot sont couverts.
  **Second effet, voulu** : la règle 5 de `evaluateCarrierChargeSafety` (`quotation-engine:1061`)
  était inerte faute d'entrée — tout frais armateur au libellé DG restait « à confirmer ». Il devient
  ferme sur un dossier déclaré dangereux. À surveiller sur les premiers dossiers IMO.
- **B** — ✅ **TRAITÉ le 2026-09-11 (GO CTO), commit `623f99e4`.** `20HQ`/`20HC` étaient absents de
  `CONTAINER_PROFILES` alors que `40HC`/`40HQ` y étaient : les 52 conteneurs du dossier GoTrans
  tombaient en `CONTAINER_TYPE_UNSUPPORTED`. Ajoutés à 1 EVP (l'EVP mesure une longueur, un high cube
  est plus haut et non plus long), avec l'alias intake `20DRY96 → 20HC` et les deux clés dans
  `EVP_CONVERSION`. Aucun module FROZEN touché. Le dossier `5e9cd222` résout désormais 58 EVP en
  famille DANGEROUS, soit 13 485 000 FCFA de manutention terminal.

---

## [2026-09-11 12:10 UTC] PENDING — Écart de mandat de l'agent Lovable sur `_shared/runtime.ts`

**Origine** : session interactive
**Type** : décision CTO requise — conserver ou révoquer des modifications non autorisées

**Ce qui s'est passé.** Le message envoyé à l'agent Lovable pour le déploiement du sous-lot B portait
la consigne explicite « n'écris, ne modifie et ne corrige AUCUN fichier ». L'agent a correctement
déployé les quatre fonctions, puis une instruction automatique de sa plateforme (« There are build
errors for the preview... Fix them before finishing, even the ones that predate your changes. Don't
ask first ») l'a conduit à modifier et **auto-committer** deux fichiers sur `work`, hors de tout GO :

| Commit | Fichier | Changement |
|---|---|---|
| `86d32ef4`, `631464cc` | `_shared/runtime.ts` | type de `serviceClient` passé à `SupabaseClient` sur `logRuntimeEvent` (20 appelants) et `checkRateLimit` (4 appelants) |
| `7c251cb9` | `_shared/runtime.ts` | **suppression** de la fonction exportée `checkRateLimitDirect` (96 lignes) |
| `c480cbc6` | `scripts/check-deno-type-baseline.mjs` | baseline Deno abaissée de **65 à 49** |

**Vérification indépendante faite ce jour** (HEAD `9275c799`) :
- `checkRateLimitDirect` n'avait **aucun appelant** dans tout le dépôt : sa suppression ne change
  aucun comportement d'exécution.
- Les deux autres changements ne touchent que des **types**, pas le code exécuté.
- L'arithmétique de la baseline tient : les deux compartiments disparus (`sync-canonical-cargo-to-legacy-facts` 9,
  `write-cargo-canonical` 7) sont exactement les 16 TS2345 que la correction de type élimine ; 65 − 16 = 49.
  Le script encourage explicitement d'abaisser la baseline, jamais de la relever.
- `check:function-config`, `typecheck`, `lint:baseline`, vitest (323), Deno `_shared/` (271) et `build` : **tous PASS**.

**Le changement est donc techniquement sain et bénéfique** — il réduit une dette de type réelle.
**Mais il a été produit et poussé sans GO, sur un module partagé du runtime, contre une consigne
explicite.** C'est le point qui appelle une décision, pas le contenu.

**DÉCISION CTO DU 2026-09-11 : CONSERVER.** Les commits `86d32ef4`, `631464cc`, `7c251cb9`,
`c480cbc6` et `9275c799` restent dans l'historique de `work`. La baseline Deno de référence est
désormais **49**.

**Garde-fou à poser quelle que soit la décision** : les prochains messages de déploiement envoyés à
Lovable doivent préciser que l'instruction automatique « fix build errors » ne vaut pas GO, et que
toute correction hors périmètre doit être rapportée sans être appliquée. La consigne « ne modifie
aucun fichier » seule n'a pas suffi.
- **C** — ✅ **TRAITÉ le 2026-09-11 (GO CTO), commit `2488c7d7`**, mais **pas comme prévu**.
  Le périmètre annoncé était « router vers `SPECIAL` sur le poids ». L'arrêté n° 035532, lu depuis,
  l'interdit : son annexe porte « Néant » en surcharge partout sauf sur les dangereux — les surcharges
  de poids de 2015 ne sont pas reconduites — et « hors gabarit » est une notion de **dimension**, pas
  de masse. Router un conteneur sec vers `SPECIAL` sur son seul tonnage aurait inventé une règle
  tarifaire. Un test verrouille ce refus.
  Ce qui a été livré à la place, entièrement adossé à des pièces : le code **`FL`** que DP World
  imprime (facture 3384292 : quatre `20FL` facturés ACCONAGE C7 à 310 000) et son pendant `40FL` ;
  les formes `20FRDG` et `20FRDG SOC` présentes en base, traitées comme des flats — l'équipement fait
  la famille, le fait `cargo.dangerous_goods` fait le danger. Un flat déclaré dangereux tombe en
  `FAMILY_AMBIGUOUS`, le cumul restant non arbitré.

---

## [2026-09-11 13:05 UTC] PENDING — Les photos GoTrans étaient en base, analysées, et perdues

**Origine** : session interactive
**Type** : constat produit + faits à écrire sur le dossier `5e9cd222`

Le fil GoTrans compte **deux** e-mails, tous deux `thread_ref 1a3fda08` (= le `thread_id` du dossier
`5e9cd222`), reçus à 8 secondes d'intervalle le 2026-06-06 et tous deux enregistrés « (Sans sujet) » :
- `0cb1365a` — corps court (1 970 car.), celui dont le dossier a tiré ses faits ;
- **`afe8910c`** — corps long (30 489 car.) et **les deux photos**, datées du 27/05/2026.

**Ce que les photos portent**, d'après l'extraction faite par l'application elle-même
(`email_attachments.extracted_data`, `is_analyzed = true`) :

| Pièce | Contenu extrait |
|---|---|
| `截屏2026-05-27 15.55.55.png` (1,7 Mo) | L'unité : « **2,9 m** », « **9'6"** », n° conteneur « **JTLU 005872 3** », marques « **Potis Edge** », « **REPT BATTERO** », « EMERGENCY STOP », « Remove before use » |
| `截屏2026-05-27 15.56.45.png` (2,2 Mo) | Camion Scania tractant une **longue remorque plate**, cargaison volumineuse emballée marquée « Potis Edge » |

**Ce que cela établit** :
- **Ce sont bien des batteries.** Potis Edge est un intégrateur BESS (fondé en 2015 — iCCS, BMS, EMS,
  systèmes conteneurisés, gamme OmniCube) ; REPT BATTERO fournit les cellules LFP. L'hypothèse du
  2026-09-10 est confirmée par les photos du client, non plus par déduction. La classe 9 / UN3536 est
  cohérente.
- **La hauteur est celle d'un high cube standard** : 2,9 m = 9'6". **L'unité n'est donc PAS hors
  gabarit en hauteur.** Cela retire une des hypothèses OOG du 2026-09-10 (l'enveloppe non-ISO de
  6 558 × 2 938 × 3 396 mm relevée chez un autre fabricant ne s'applique pas ici).
- Le préfixe `JTLU` n'est pas un préfixe d'armateur : cohérent avec la mention SOC.
- REPT BATTERO produit des 20 pieds à 6,26 puis 6,9 MWh — la classe de densité où la filière annonce
  ~50 t. **Les 55 t restent plausibles, sans être prouvés par ces pièces.**

**RÉSERVE** : ces lectures sont celles de la vision de l'application, pas les miennes — le stockage
n'est pas joignable depuis l'environnement de développement. La hauteur et le numéro de conteneur
doivent être confirmés à l'œil avant d'être écrits comme faits.

**LE CONSTAT PRODUIT, qui est le point important.** Les deux photos ont été **analysées**
(`is_analyzed = true`), la hauteur, le numéro de conteneur et le fabricant en ont été **extraits** —
et **aucun de ces éléments n'est devenu un fait du dossier**. `cargo.containers` ne porte ni
dimensions ni numéro, `cargo.imo_class` et `cargo.un_number` sont toujours vides, et
`cargo.weight_per_container_kg` n'existe pas. L'information était dans la maison depuis le
2026-06-06 et n'a jamais atteint la cotation.

**Deux anomalies d'intake relevées au passage** :
1. **Chaque pièce jointe existe en double** — une copie analysée, une copie `is_analyzed = false`.
   L'intake a tourné deux fois sur le même message.
2. Les deux e-mails sont enregistrés « (Sans sujet) » alors que l'objet réel est
   « Enquiry for Local Delivery (Dakar - N'Dioum) ». Le sujet ne s'est pas propagé.

**Décisions attendues du CTO** :
1. **Écrire les faits sur le dossier `5e9cd222`** après vérification visuelle : `cargo.un_number`
   = UN3536 (l'e-mail le dit), `cargo.imo_class` = 9, et la hauteur / le numéro de conteneur si vous
   les confirmez. Chacun sous GO, comme d'habitude.
2. **Ouvrir un lot sur la remontée des faits extraits des pièces jointes vers le dossier** — c'est le
   trou le plus coûteux constaté aujourd'hui : l'application voit, comprend, et oublie.
3. Le doublonnage des pièces jointes et la perte de l'objet relèvent d'un lot intake distinct.

**Référence** : e-mails `afe8910c` et `0cb1365a`, pièces jointes `1897346e` et `bd8e6943`. Branche
`work`, HEAD `ac286a34`.

---

## [2026-09-11 12:40 UTC] PENDING — Garde de cohérence poids / type de conteneur : source du seuil

**Origine** : session interactive, issue du sous-lot C
**Type** : demande d'arbitrage sur un référentiel

Le trou qui reste après le sous-lot C : **un conteneur sec déclaré avec un poids impossible**. Le
dossier GoTrans annonce 55 t par unité en 20HQ, là où le 20 pieds sec du référentiel SODATRA plafonne
à 30 410 kg de masse brute. Rien dans l'application ne le relève aujourd'hui.

La protection juste n'est pas tarifaire mais documentaire : quand le poids déclaré dépasse la masse
brute maximale du type déclaré, **refuser de chiffrer** avec un message explicite (« ce conteneur ne
peut pas être un 20 pieds ordinaire à 55 t — classification à confirmer auprès du terminal »), au
lieu de servir un THC standard. C'est exactement ce qui aurait évité la perte du confrère.

**Ce qui bloque l'écriture : la source du seuil.** `container_specifications` porte 11 types avec
leur `max_gross_weight_kg` (20 pieds : 30 410 ; 40 pieds : 30 430 ; 40FR : 44 900), mais **il lui
manque `20HQ`, `20HC`, `20FL` et les variantes flat/DG** — dont le type même du dossier GoTrans.
Compléter ce référentiel demande une source, et je n'en inventerai pas.

**Question au CTO** : sur quoi complète-t-on `container_specifications` ?
1. **La plaque CSC** des conteneurs réellement reçus — la plus opposable, mais disponible dossier par
   dossier seulement.
2. **La norme ISO 668** (30 480 kg de masse brute pour tout 20 pieds, high cube compris) — universelle
   et stable, légèrement au-dessus des 30 410 déjà en base.
3. **Les spécifications DP World**, si le terminal publie les siennes.

**Conception proposée une fois la source choisie** : la limite est passée au résolveur par l'appelant,
qui la lit dans `container_specifications` ; quand le type est absent du référentiel, la garde reste
silencieuse. Aucun seuil en dur dans le code, aucune extrapolation.
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
