

# Phase V4.2.3 — Correction detection maritime faux-positif + filtrage questions non-bloquantes

## 1. Cause racine confirmee (preuve dans les logs)

Le log du dernier run montre clairement :

```
[A1] detectRequestType: SEA_FCL_IMPORT (strong maritime pattern)
```

Or l'email est un fret aerien ("DAP cost from DSS airport"). Le probleme : le mot **"POLAND"** dans la signature du client ("GERMANY | DENMARK | NETHERLANDS | **POLAND** | SWITZERLAND...") contient la sous-chaine `"pol"` qui matche le pattern maritime :

```typescript
const maritimePatterns = [
  "container", "fcl",
  // ...
  "pol", "pod", "cy/cfs", "cfs",   // <-- "pol" matche "POLAND"
];
```

Le test `lowerContext.includes("pol")` retourne `true` a cause de "poland", et le Step 2 (maritime) s'execute AVANT les Steps 5-6 (IATA/airport), donc le systeme ne voit jamais les indicateurs aeriens.

**Consequence en cascade** :
- `detectedType = SEA_FCL_IMPORT`
- `MANDATORY_FACTS` inclut `cargo.containers`
- Le gap `cargo.containers` est cree (bloquant)
- Le V4.2.1 (orphan cleanup) ne le ferme pas car `cargo.containers` EST dans la liste mandatory pour SEA_FCL
- Le dossier reste en `NEED_INFO`

## 2. Deuxieme probleme : questions non-bloquantes dans l'email de clarification

Le `qualify-quotation-minimal` genere des questions (type de packaging, exigences speciales, date d'arrivee) qui ne sont pas necessaires pour produire une cotation. L'email de clarification les affiche, donnant l'impression que le systeme bloque sur ces elements.

## 3. Corrections chirurgicales

### Phase V4.2.3a — Securiser les patterns maritimes (word-boundary)

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`
**Emplacement** : Fonction `detectRequestType()` (lignes 1594-1606)

**Probleme** : Les patterns `"pol"` et `"pod"` sont trop courts et matchent des mots courants ("poland", "podium", "pologne", etc.)

**Correction** : Remplacer la verification `includes()` par des regex avec word boundaries pour les patterns ambigus, et deplacer la verification des faits aeriens (Step 6: `routing.origin_airport`) AVANT la detection maritime.

```text
Ordre actuel :
  Step 1: Air patterns explicites ("by air", "awb"...)
  Step 2: Maritime patterns ("container", "pol", "pod"...) <-- BLOQUE ICI
  Step 3: Breakbulk
  Step 4: Container fact
  Step 5: IATA regex
  Step 6: Airport fact                                     <-- JAMAIS ATTEINT

Nouvel ordre :
  Step 1: Air patterns explicites ("by air", "awb"...)
  Step 1b: Airport fact (routing.origin_airport)           <-- NOUVEAU: priorite air
  Step 2: Maritime patterns (avec word boundaries)
  Step 3: Breakbulk
  Step 4: Container fact
  Step 5: IATA regex
  Step 6: Default UNKNOWN
```

Modification concrete de `maritimePatterns` :
- `"pol"` remplace par regex `/\bpol\b/` (match "POL" mais pas "POLAND")
- `"pod"` remplace par regex `/\bpod\b/` (match "POD" mais pas "PODIUM")
- `"bl "` remplace par regex `/\bbl\b/` (match "BL" mais pas "BLUE")
- `"cfs"` reste tel quel (suffisamment specifique)

### Phase V4.2.3b — Filtrer les questions non-bloquantes dans le draft de clarification

**Fichier** : `supabase/functions/qualify-quotation-minimal/index.ts`

**Probleme** : L'IA genere des questions de priorite "medium" (packaging, date, exigences speciales) meme quand tous les faits critiques sont presents. Ces questions apparaissent dans l'email de clarification, donnant l'impression que le systeme bloque.

**Correction** : Apres la reponse IA, filtrer pour ne garder que les questions de priorite `critical` ou `high` dans le draft email. Les questions `medium` sont conservees dans `detected_ambiguities` (pour info) mais exclues du `clarification_draft`.

## 4. Resume des modifications

| Fichier | Modification | Lignes |
|---|---|---|
| `supabase/functions/build-case-puzzle/index.ts` | Word boundaries sur "pol"/"pod"/"bl" + deplacer airport fact avant maritime | ~15 lignes dans detectRequestType() |
| `supabase/functions/qualify-quotation-minimal/index.ts` | Filtrer questions medium du draft email | ~5 lignes |

## 5. Impact et risques

| Element | Evaluation |
|---|---|
| Risque regression | Minimal — les patterns maritimes reels ("POL: Singapore", "POD: Dakar") matchent toujours avec word boundary |
| Impact positif | Elimination des faux positifs sur les pays (POLAND, PORTUGAL...) |
| Cases existants | Le case 843a1f1c sera correctement detecte comme AIR_IMPORT apres re-analyse |
| Compatibilite | Aucun changement DB, aucun changement frontend |

## 6. Resultat attendu

Apres deploiement et re-analyse du case 843a1f1c :
1. `detectRequestType` retourne `AIR_IMPORT` (via airport fact, Step 1b)
2. `MANDATORY_FACTS.AIR_IMPORT` = destination + weight + pieces + client_email
3. Tous presents dans quote_facts
4. `cargo.containers` ferme comme orphelin (V4.2.1)
5. Statut final : `READY_TO_PRICE`
6. Email de clarification : uniquement les questions critiques/hautes (si existantes)

