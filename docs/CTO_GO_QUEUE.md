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
