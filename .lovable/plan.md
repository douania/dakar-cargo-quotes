
# Correctif "LCL Detection + Pricing LCL"

## Diagnostic confirme (donnees DB)

Le dossier Lantia (`acddafa7`) presente ces valeurs en base :

| Champ | Valeur actuelle | Valeur attendue |
|---|---|---|
| `request_type` | `SEA_FCL_IMPORT` | `SEA_LCL_IMPORT` |
| `service.package` | `DAP_PROJECT_IMPORT` | `LCL_IMPORT_DAP` |
| Gap bloquant | `cargo.containers` | Aucun (LCL n'a pas de conteneurs) |
| HS codes depuis PJ | Non injectes | `8525.50, 8507.20` |

### Causes racines

1. **Timing** : L'analyse a ete executee a 16:29, AVANT le deploiement des corrections LCL. Le code `detectRequestType` n'avait pas encore le Step 2b (LCL patterns). Le code est maintenant correct dans le fichier mais le dossier doit etre re-analyse.

2. **Package manquant cote frontend** : `SERVICE_PACKAGES` dans `src/features/quotation/constants.ts` ne contient pas `LCL_IMPORT_DAP`. Meme apres re-analyse, le frontend ne saura pas quels services injecter pour du LCL.

3. **Unites de pricing inadaptees** : Les services actuels (DTHC, EMPTY_RETURN) utilisent des unites EVP/conteneur. Pour du LCL, les unites doivent etre `tonne`, `cbm`, ou `forfait`.

---

## Plan de correction — 2 actions

### Action 1 — Ajouter `LCL_IMPORT_DAP` dans le frontend

**Fichier** : `src/features/quotation/constants.ts`

Ajouter le package LCL avec des services adaptes :

```text
LCL_IMPORT_DAP: [
  'PORT_DAKAR_HANDLING',   // Frais portuaires (base tonne ou cbm)
  'CUSTOMS_DAKAR',         // Dedouanement
  'TRUCKING',              // Transport (forfait, pas EVP)
  'AGENCY',                // Frais d'agence
],
```

Pas de `DTHC` (specifique aux conteneurs plein), pas de `EMPTY_RETURN` (pas de conteneur a rendre en LCL).

### Action 2 — Re-analyser le dossier

Apres le deploiement d'Action 1, relancer "Analyser la demande" sur le dossier Lantia. Le code `build-case-puzzle` deja deploye va :

- Detecter `SEA_LCL_IMPORT` (le sujet contient "LCL")
- Injecter `service.package = LCL_IMPORT_DAP`
- Ne PAS generer de gap `cargo.containers`
- Injecter les HS codes et la valeur depuis les pieces jointes

---

## Details techniques

### Pourquoi les corrections precedentes n'ont pas fonctionne

Le deploiement de `build-case-puzzle` a eu lieu APRES que l'utilisateur a clique sur "Analyser la demande". Les facts et gaps en DB datent de l'execution avec l'ancien code. La solution est simplement de re-executer l'analyse.

### Services LCL vs FCL : differences cles

| Service | FCL | LCL |
|---|---|---|
| DTHC (Terminal Handling) | Oui (EVP) | Non (inclus dans le fret LCL) |
| EMPTY_RETURN | Oui (retour conteneur) | Non (pas de conteneur) |
| PORT_DAKAR_HANDLING | Par EVP | Par tonne ou CBM |
| TRUCKING | Par EVP | Forfait |

### Ce qui ne change PAS

- Aucune modification de `build-case-puzzle` (code deja correct)
- Aucune modification de tables DB
- Aucune modification du moteur de pricing (`run-pricing`)
- Modification triviale d'un seul fichier frontend

### Validation

Apres re-analyse du dossier Lantia :
1. `request_type` = `SEA_LCL_IMPORT`
2. `service.package` = `LCL_IMPORT_DAP`
3. Services affiches : Frais port Dakar, Dedouanement, Transport, Agence (sans DTHC ni retour vide)
4. Unites : tonne/cbm/forfait (pas d'EVP)
5. HS codes injectes depuis les PJ
6. Aucun gap "conteneurs"
