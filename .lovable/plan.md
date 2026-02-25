

# Plan : Rendre le gap `routing.transport_mode` resolvable par l'operateur

## Diagnostic confirme

Le gap bloquant `routing.transport_mode` est legitime (document sans indice transport). Mais 3 verrous empechent sa resolution manuelle :

1. **UI** : `routing.transport_mode` absent de `EDITABLE_FACT_KEYS` et `SELECT_FACT_OPTIONS` -- pas de selecteur
2. **Backend `set-case-fact`** : `routing.transport_mode` absent de `ALLOWED_FACT_KEYS` -- sauvegarde rejetee
3. **Backend `build-case-puzzle`** : le bloc A1 (ligne 2471) re-insere le gap quand `detectedType === "UNKNOWN"` sans verifier si un fact manuel existe deja

## Corrections (3 patchs chirurgicaux)

### Patch A -- `src/pages/CaseView.tsx`

Ajouter `routing.transport_mode` dans `EDITABLE_FACT_KEYS` (ligne 66) et dans `SELECT_FACT_OPTIONS` (ligne 48) :

```typescript
// SELECT_FACT_OPTIONS
"routing.transport_mode": [
  { value: "AIR", label: "Air" },
  { value: "MARITIME", label: "Maritime" },
  { value: "ROUTE", label: "Route" },
],

// EDITABLE_FACT_KEYS
"routing.transport_mode",
```

Le systeme existant `renderGapRow` + `saveGapAnswer` + `Select` fonctionne deja sans modification supplementaire.

### Patch B -- `supabase/functions/set-case-fact/index.ts`

Ajouter `"routing.transport_mode"` dans `ALLOWED_FACT_KEYS` (ligne 18).

### Patch C -- `supabase/functions/build-case-puzzle/index.ts`

Modifier le bloc A1 (lignes 2471-2493) pour verifier si un fact manuel `routing.transport_mode` existe deja avant d'inserer/maintenir le gap :

```typescript
// A1: For UNKNOWN request type, add transport mode gap ONLY if no manual fact exists
if (detectedType === "UNKNOWN") {
  const hasManualTransportMode = existingDbKeys.includes("routing.transport_mode");
  
  if (hasManualTransportMode) {
    // Resolve existing gap if operator already answered
    const { data: openModeGap } = await serviceClient
      .from("quote_gaps")
      .select("id")
      .eq("case_id", case_id)
      .eq("gap_key", "routing.transport_mode")
      .eq("status", "open")
      .single();
    
    if (openModeGap) {
      await serviceClient.from("quote_gaps")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", openModeGap.id);
      console.log("[A1] Closed routing.transport_mode gap: manual fact exists");
    }
  } else {
    // No fact → ensure gap exists
    const { data: existingModeGap } = await serviceClient
      .from("quote_gaps")
      .select("id")
      .eq("case_id", case_id)
      .eq("gap_key", "routing.transport_mode")
      .eq("status", "open")
      .single();
    
    if (!existingModeGap) {
      const modeGapInfo = GAP_QUESTIONS["routing.transport_mode"];
      await serviceClient.from("quote_gaps").insert({
        case_id,
        gap_key: "routing.transport_mode",
        gap_category: "routing",
        question_fr: modeGapInfo.fr,
        question_en: modeGapInfo.en,
        priority: "critical",
        is_blocking: true,
      });
      gapsIdentified++;
    }
  }
}
```

Egalement, modifier la ligne 2448 pour ne pas maintenir le gap dans mandatorySet si le fact existe :

```typescript
if (detectedType === "UNKNOWN" && !existingDbKeys.includes("routing.transport_mode")) {
  mandatorySet.add("routing.transport_mode");
}
```

Note : `existingDbKeys` est charge a la ligne 2496, mais le bloc A1 est a 2471 (avant). Il faut deplacer le chargement `existingDbFacts` AVANT le bloc A1, ou dupliquer la lecture. Le plus simple est de deplacer les lignes 2496-2501 avant la ligne 2445.

## Fichiers modifies

| Fichier | Action |
|---------|--------|
| `src/pages/CaseView.tsx` | Ajouter `routing.transport_mode` dans `EDITABLE_FACT_KEYS` + `SELECT_FACT_OPTIONS` |
| `supabase/functions/set-case-fact/index.ts` | Ajouter `"routing.transport_mode"` dans `ALLOWED_FACT_KEYS` |
| `supabase/functions/build-case-puzzle/index.ts` | Deplacer lecture existingDbFacts avant A1, conditionner A1 sur absence de fact manuel, fermer le gap si fact existe |

## Semantique des valeurs

- `routing.transport_mode` = `AIR` / `MARITIME` / `ROUTE` (mode generique)
- `request_type` = `AIR_IMPORT` / `SEA_FCL_IMPORT` / etc. (type de requete specifique)
- On ne stocke PAS `SEA_FCL_IMPORT` dans `routing.transport_mode`

## Resultat attendu

1. L'operateur voit le gap "Quel mode de transport ?" avec un Select (Air / Maritime / Route)
2. Il choisit "MARITIME"
3. `set-case-fact` injecte `routing.transport_mode = MARITIME`
4. `build-case-puzzle` relance, voit le fact, ferme le gap
5. Le dossier progresse (vers READY_TO_PRICE si plus de gaps bloquants)

