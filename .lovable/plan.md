

# Phase M3.3 — Correction des faux positifs de gaps bloquants

## Diagnostic confirme

L'analyse du code et de la base de donnees revele deux problemes distincts dans `build-case-puzzle/index.ts` :

### Probleme 1 : Detection du type de demande defaillante

La fonction `detectRequestType()` (ligne 722) ne reconnait pas "40FT" comme indicateur maritime. Elle cherche uniquement `container`, `fcl`, `40hc`, `20dv`. Le sujet "JEDDAH TO SENEGAL - 40FT CONTAINER" devrait etre detecte comme `SEA_FCL_IMPORT`, mais si l'IA n'extrait pas un fait `cargo.containers`, le fallback est `SEA_FCL_IMPORT` (correct), SAUF si un autre indicateur force `AIR_IMPORT` en premier.

La base montre que le `quote_case` cree a bien `request_type = AIR_IMPORT` avec statut `NEED_INFO`, ce qui provoque les 5 gaps incorrects issus de la liste `AIR_IMPORT` (airport, weight, pieces, value, incoterm).

### Probleme 2 : Regles metier trop rigides meme pour SEA_FCL_IMPORT

Meme avec le bon type, certaines exigences sont inappropriees selon le contexte :

| Gap | Probleme | Regle metier correcte |
|---|---|---|
| `routing.origin_airport` | Demande sur une importation maritime | Ne doit JAMAIS apparaitre pour SEA_* |
| `routing.incoterm` | Le port d'origine est deja donne (Jeddah) | Utile mais pas bloquant — l'operateur peut coter sans, en faisant une hypothese DAP |
| `cargo.weight_kg` | Vehicules en conteneurs 40FT | Pour du FCL, le poids n'impacte pas le cout du fret (c'est le conteneur qui est facture). Utile pour douane/transit uniquement |
| `cargo.pieces_count` | Ce sont des vehicules | Non pertinent pour des vehicules — le nombre de conteneurs suffit |
| `cargo.value` | Necessaire uniquement si dedouanement demande | Ne devrait etre bloquant que si le service douane est explicitement demande |

## Solution proposee

### Fichier : `supabase/functions/build-case-puzzle/index.ts`

**Changement A** — Enrichir `detectRequestType()` avec plus d'indicateurs maritimes :
- Ajouter `40ft`, `20ft`, `40'`, `20'`, `40 ft`, `20 ft`, `40hc`, `40fr`, `40ot` aux patterns maritime
- Ajouter `jeddah`, `port`, `vessel`, `shipping`, `sea freight` aux indicateurs
- S'assurer que les indicateurs maritimes sont testes AVANT les indicateurs aeriens

**Changement B** — Revoir `MANDATORY_FACTS` pour `SEA_FCL_IMPORT` :
- Retirer `routing.incoterm` de la liste obligatoire SEA_FCL_IMPORT (le systeme peut coter avec hypothese DAP)
- Ne PAS ajouter `cargo.weight_kg`, `cargo.pieces_count`, `cargo.value` (ils ne sont pas dans la liste actuelle SEA_FCL)

**Changement C** — Revoir les priorites dans `GAP_QUESTIONS` :
- `routing.incoterm` : passer de `critical` a `medium` (utile mais pas bloquant)
- `cargo.weight_kg` : garder `high` pour air, mais marquer comme non-bloquant pour SEA_FCL
- `cargo.value` : passer de `high` a `medium` (bloquant uniquement si dedouanement demande)
- `cargo.pieces_count` : passer de `high` a `medium`

**Changement D** — Rendre le calcul de `is_blocking` contextuel :
- Actuellement : `is_blocking = priority === "critical" || priority === "high"` (ligne 436)
- Apres : `is_blocking` depend du `request_type` detecte
- Pour `SEA_FCL_IMPORT` : seuls `routing.destination_city`, `cargo.description`, `cargo.containers`, `contacts.client_email` sont bloquants
- Pour `AIR_IMPORT` : garder la logique actuelle

### Aucune modification UI

Le `BlockingGapsPanel` et le `QuotationHeader` continueront de fonctionner identiquement — ils affichent simplement les gaps marques `is_blocking = true`. La correction est entierement dans la logique backend de classification.

### Nettoyage des gaps existants

Apres deploiement, il faudra relancer `build-case-puzzle` sur les cases existants (via "Demarrer l'analyse") pour regenerer les gaps avec les nouvelles regles.

## Impact

| Element | Valeur |
|---|---|
| Fichier modifie | `supabase/functions/build-case-puzzle/index.ts` uniquement |
| Migration DB | Aucune |
| Modification UI | Aucune |
| Risque | Faible — les regles deviennent plus permissives, pas plus restrictives |

