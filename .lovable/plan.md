

# Audit Technique -- Pipeline Extraction et Cause Racine du Blocage AIR_IMPORT

## 1. Diagnostic factuel

### Faits extraits pour le case 843a1f1c (tous corrects)

| fact_key | value | source | OK? |
|---|---|---|---|
| routing.incoterm | DAP | ai_extraction | Oui |
| routing.destination_city | Dakar | ai_extraction | Oui |
| routing.origin_airport | DSS | ai_extraction | Oui |
| cargo.description | Medical equipment | ai_extraction | Oui |
| cargo.weight_kg | 25 | ai_extraction | Oui |
| cargo.volume_cbm | 0.44347 | ai_extraction | Oui |
| cargo.pieces_count | 3 | ai_extraction | Oui |
| contacts.client_email | ivan.tomov@... | ai_extraction | Oui |

**L'extraction IA fonctionne parfaitement.** Tous les faits critiques sont presents.

### Gaps ouverts (cause du blocage)

| gap_key | is_blocking | status |
|---|---|---|
| cargo.containers | **true** | open |
| routing.origin_port | false | open |

### Type de requete detecte

`detectRequestType` retourne `AIR_IMPORT` (step 6: airport fact `routing.origin_airport = DSS`).

### Faits obligatoires pour AIR_IMPORT

```
AIR_IMPORT: [
  "routing.destination_city",   // PRESENT
  "cargo.weight_kg",            // PRESENT
  "cargo.pieces_count",         // PRESENT
  "contacts.client_email",      // PRESENT
]
```

**Tous les faits obligatoires AIR_IMPORT sont presents.** Le dossier devrait etre READY_TO_PRICE.

## 2. Cause racine identifiee

### Le bug : les gaps orphelins ne sont jamais nettoyes lors d'un changement de type

Le flux actuel dans `build-case-puzzle` (lignes 1027-1156) :

1. Determine `detectedType = AIR_IMPORT`
2. Charge `mandatoryFacts = MANDATORY_FACTS["AIR_IMPORT"]` (4 cles)
3. Boucle sur `mandatoryFacts` pour creer/resoudre les gaps
4. `cargo.containers` n'est PAS dans la liste AIR_IMPORT, donc la boucle ne le touche jamais
5. Mais `cargo.containers` a ete cree lors d'une analyse precedente (ou dans le meme run avec un fallback SEA_FCL_IMPORT)
6. Le gap reste `status=open, is_blocking=true`
7. A la ligne 1151-1156, `blockingGapsCount` compte TOUS les gaps ouverts bloquants, y compris le gap orphelin
8. `blockingGapsCount > 0` donc le statut passe a `NEED_INFO` au lieu de `READY_TO_PRICE`

### Preuve dans la timeline

```
10:53:03 - gap_identified: cargo.containers (priority: critical)
10:53:03 - gap_identified: routing.origin_port (priority: critical)
10:53:03 - status_changed -> NEED_INFO
```

Le gap `cargo.containers` a ete cree DANS LE MEME RUN. Explication : la detection du type se fait a la ligne 776, APRES l'extraction des faits. Mais l'ancien code de gap detection (ligne 1028) utilise un fallback :

```typescript
const mandatoryFacts = MANDATORY_FACTS[detectedType] || MANDATORY_FACTS.SEA_FCL_IMPORT;
```

Comme `detectedType = AIR_IMPORT` et `MANDATORY_FACTS["AIR_IMPORT"]` existe, le fallback n'est pas utilise. MAIS le probleme est different : regardons la boucle (ligne 1058-1136) :

```typescript
for (const requiredKey of mandatoryFacts) {
  const hasFact = extractedKeys.includes(requiredKey);
```

`extractedKeys` est construit a partir de `extractedFacts` (les faits retournes par l'IA). Si l'IA a retourne le type `AIR_IMPORT`, alors `cargo.containers` n'est PAS dans `mandatoryFacts`, donc aucun gap n'est cree pour lui dans cette boucle.

**MAIS** : il y a un autre chemin. Regardons le `detectRequestType` plus attentivement. L'email contient "DSS airport" qui matche `routing.origin_airport`. Mais la detection se fait sur le `threadContext`, pas sur les faits. Si le `threadContext` contient aussi "DAP cost from DSS airport to Dakar", le step 5 (`iataFromToRegex`) pourrait ne PAS matcher car "DSS" et "Dakar" ne sont pas deux codes IATA a 3 lettres lies par "to".

En fait, le step 6 (`routing.origin_airport` fact) devrait capturer cela. Donc `detectedType = AIR_IMPORT`.

Le probleme est probablement que **la premiere execution** a detecte `SEA_FCL_IMPORT` (avant que le fait `routing.origin_airport` ne soit extrait, dans le cas de `extractFactsBasic`), a cree le gap `cargo.containers`, puis une seconde execution a detecte `AIR_IMPORT` mais n'a pas nettoye le gap orphelin.

**OU** : dans un seul run, si `extractFactsWithAI` retourne les faits mais `detectRequestType` est appele sur le `threadContext` qui ne contient pas de patterns air explicites (pas de "by air", "air cargo", etc.), il tombe en `UNKNOWN`. Puis `MANDATORY_FACTS["UNKNOWN"]` n'existe pas, donc le fallback `MANDATORY_FACTS.SEA_FCL_IMPORT` est utilise, ce qui inclut `cargo.containers`.

### Scenario le plus probable (single run)

1. L'email dit "DAP cost from DSS airport to Dakar" -- pas de pattern air explicite ("by air", "air cargo")
2. `detectRequestType` : aucun air pattern, aucun maritime pattern, aucun breakbulk, aucun container fact, IATA regex ne matche pas ("DSS" to "Dakar" -- "Dakar" n'est pas un code IATA 3 lettres standard)
3. Step 6 : `facts.some(f => f.key === "routing.origin_airport")` -- OUI, le fait est extrait par l'IA
4. Retourne `AIR_IMPORT`
5. Mais MANDATORY_FACTS["AIR_IMPORT"] n'inclut pas `cargo.containers`

Alors **d'ou vient le gap `cargo.containers`?**

Reponse : il a ete cree dans un run precedent, OU il y a une premiere passe qui utilise le fallback SEA_FCL.

Pour en etre certain, regardons le timeline : un seul `status_changed` avant les gaps = c'est le premier run. Les deux gaps ont ete crees dans le meme run.

Cela signifie que `detectedType` a ete `SEA_FCL_IMPORT` lors de ce run (pas AIR_IMPORT), probablement parce que le step 6 ne matchait pas.

Verification : dans `detectRequestType`, le step 6 utilise `facts` qui est le parametre `extractedFacts` -- ce sont les faits retournes par l'IA. Si l'IA a bien retourne `routing.origin_airport`, alors le step 6 devrait matcher. SAUF si le step 2 (maritime patterns) matche d'abord.

Le mot "container" pourrait-il etre present dans l'email (meme dans un contexte non-maritime) ? Non, c'est du medical equipment en 3 colis.

La cause la plus probable : **`detectRequestType` retourne `UNKNOWN`**, puis `MANDATORY_FACTS["UNKNOWN"]` est undefined, et le fallback est `MANDATORY_FACTS.SEA_FCL_IMPORT` qui inclut `cargo.containers`.

Verifions : le step 6 cherche `routing.origin_airport` dans les `facts`. Si l'IA a extrait ce fait, il devrait etre present. MAIS le step 5 (IATA codes) pourrait matcher d'abord et retourner `AIR_IMPORT`. Ou pas.

En fait, le probleme est clair et la solution est unique quel que soit le scenario :

## 3. Plan de correction (micro-phases)

### Phase V4.2.1 -- Nettoyage des gaps orphelins par type de requete

**Fichier unique** : `supabase/functions/build-case-puzzle/index.ts`

**Principe** : Apres avoir determine le `detectedType`, fermer automatiquement tout gap ouvert dont le `gap_key` n'appartient PAS aux `mandatoryFacts` du type actuel.

**Emplacement** : Entre la ligne 1028 et 1058 (apres le calcul de `mandatoryFacts`, avant la boucle de gap detection).

**Code a ajouter** (~15 lignes) :

```typescript
// V4.2.1: Close orphan gaps from previous/wrong request type
const { data: allOpenGaps } = await serviceClient
  .from("quote_gaps")
  .select("id, gap_key")
  .eq("case_id", case_id)
  .eq("status", "open");

if (allOpenGaps) {
  const mandatorySet = new Set(mandatoryFacts);
  const orphanGaps = allOpenGaps.filter(g => !mandatorySet.has(g.gap_key));

  for (const orphan of orphanGaps) {
    await serviceClient
      .from("quote_gaps")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", orphan.id);

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "gap_resolved",
      event_data: {
        gap_key: orphan.gap_key,
        reason: `Not required for ${detectedType}`,
      },
      actor_type: "system",
    });
  }

  if (orphanGaps.length > 0) {
    console.log(`[V4.2.1] Closed ${orphanGaps.length} orphan gaps: ${orphanGaps.map(g => g.gap_key).join(', ')}`);
  }
}
```

### Phase V4.2.2 -- Ajouter le fallback UNKNOWN dans MANDATORY_FACTS

**Meme fichier** : `supabase/functions/build-case-puzzle/index.ts`

**Probleme** : Quand `detectedType = "UNKNOWN"`, `MANDATORY_FACTS["UNKNOWN"]` est `undefined`, et le fallback `MANDATORY_FACTS.SEA_FCL_IMPORT` impose des gaps maritimes (comme `cargo.containers`) a un dossier potentiellement aerien.

**Correction** (~3 lignes) : Ajouter une entree UNKNOWN avec des faits minimaux universels.

```typescript
UNKNOWN: [
  "routing.destination_city",
  "cargo.description",
  "contacts.client_email",
],
```

Cela evite que le fallback SEA_FCL impose `cargo.containers` ou `routing.origin_port` a un dossier dont le mode de transport n'est pas encore determine.

## 4. Resume des fichiers a modifier

| Fichier | Modification | Lignes |
|---|---|---|
| `supabase/functions/build-case-puzzle/index.ts` | Ajout nettoyage gaps orphelins (V4.2.1) | ~15 lignes, entre L1028 et L1058 |
| `supabase/functions/build-case-puzzle/index.ts` | Ajout MANDATORY_FACTS["UNKNOWN"] (V4.2.2) | ~4 lignes, dans le bloc MANDATORY_FACTS L109-123 |

Aucune migration SQL. Aucun changement frontend. Aucun composant FROZEN touche.

## 5. Impact et risques

| Element | Evaluation |
|---|---|
| Risque de regression | Minimal -- le nettoyage ne ferme que les gaps hors scope du type actuel |
| Impact sur les cases existants | Positif -- les cases bloques par des gaps orphelins seront debloquees a la prochaine analyse |
| Compatibilite architecture | Totale -- utilise les memes patterns (supersede, timeline events) |
| Cas limite | Si le type change entre deux runs (ex: SEA_FCL -> AIR), les gaps maritimes seront fermes et les gaps aeriens crees -- comportement correct |

## 6. Resultat attendu apres correction

Pour l'email "DAP cost from DSS airport to Dakar, medical equipment, 3 pieces, 25 kg" :

1. `detectedType = AIR_IMPORT` (ou UNKNOWN avec fallback minimal)
2. `MANDATORY_FACTS` = destination_city + weight_kg + pieces_count + client_email (ou destination_city + description + client_email pour UNKNOWN)
3. Tous les faits obligatoires sont presents
4. Le gap `cargo.containers` est soit jamais cree (V4.2.2), soit ferme comme orphelin (V4.2.1)
5. `blockingGapsCount = 0`
6. Statut final : `READY_TO_PRICE`

