

# P0-B — Micro-correctif : condition de visibilité `apply_facts`

## Problème

`hasProposedFacts` est `true` dès que `proposed_facts.length > 0`, même si tous les faits sont déjà appliqués. Faux positif.

## Solution retenue : Option A adaptée

ReadyActionsPanel fetche déjà 6 queries en parallèle. On ajoute une 7e pour charger les `quote_facts` courants du dossier, puis on filtre les `proposedFacts` avec la même logique que `isFactAlreadyApplied()` de CaseView.

### Modifications

**Fichier unique : `src/components/case/ReadyActionsPanel.tsx`**

1. **Import** : ajouter `import { toFactPayload } from "@/pages/case-view/helpers";`

2. **Query** (L171-204) : ajouter dans le `Promise.all` existant une 7e requête :
   ```typescript
   supabase
     .from("quote_facts")
     .select("fact_key, value_text, value_number")
     .eq("case_id", caseId)
     .eq("is_current", true)
   ```

3. **Logique de filtrage** (L226-236) : remplacer le calcul `hasProposedFacts` par :
   ```typescript
   const currentFacts = factsForApplied.data ?? [];
   const unappliedFacts = proposedFacts.filter((f: any) => {
     const payload = toFactPayload(f);
     if (!payload) return false;
     return !currentFacts.some((existing: any) => {
       if (existing.fact_key !== payload.fact_key) return false;
       if (payload.value_number !== null)
         return Number(existing.value_number) === Number(payload.value_number);
       if (payload.value_text !== null)
         return String(existing.value_text ?? "").trim() === payload.value_text;
       return false;
     });
   });
   const hasProposedFacts = unappliedFacts.length > 0;
   ```

### Blast radius

- 1 fichier modifié, ~15 lignes ajoutées/modifiées
- 1 requête DB supplémentaire (légère : `quote_facts` avec filtre `is_current`, quelques dizaines de rows max)
- Logique de comparaison identique à `isFactAlreadyApplied()` de CaseView — pas de divergence
- `toFactPayload` est déjà exporté depuis `helpers.ts` — réutilisation directe
- Le CTA disparaît automatiquement quand tous les faits sont appliqués
- Aucune modification de CaseView, aucune nouvelle prop

### Ce qui ne change pas

- Aucune lecture `manual_action`
- Aucun nouveau composant
- Aucune modification de CaseView ni de `.lovable/plan.md` (à part mention du fix)
- Backward compatible : si aucun `reply_analysis_v1` n'existe, comportement inchangé

