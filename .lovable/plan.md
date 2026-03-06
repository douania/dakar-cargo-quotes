
## Plan — 2 correctifs P0 Phase 16

Deux patchs chirurgicaux dans `src/pages/CaseView.tsx`. Aucun autre fichier modifié.

---

### Patch A — Bloquer selon `pricing_gate` au lieu d'une liste hardcodée

**Fichier** : `src/pages/CaseView.tsx` (L1764-1770)

Remplacer la logique actuelle qui teste une `Set` de 3 intents par une lecture directe de `pricing_gate` depuis `event_data.intent.pricing_gate`. C'est l'Option B du CTO — plus robuste car tout changement futur du prompt AI se propage automatiquement sans toucher le front.

On prend aussi le **dernier** event (pas le premier) en triant par `created_at` desc, pour refléter le dernier email classifié.

```typescript
blockedByIntent={(() => {
  const intentEvents = events
    .filter((e: any) => e.event_type === "thread_intent_v1")
    .sort((a: any, b: any) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  const ie = intentEvents[0];
  if (!ie) return undefined;
  const iObj = (ie?.event_data as any)?.intent ?? null;
  const pricingGate = iObj?.pricing_gate ?? (ie?.event_data as any)?.pricing_gate;
  if (pricingGate === false) {
    return iObj?.intent_type ?? (ie?.event_data as any)?.intent_type ?? "blocked";
  }
  return undefined;
})()}
```

Résultat : si `pricing_gate === false` → le bouton est désactivé avec le type d'intent affiché. Si `pricing_gate === true` ou absent → comportement normal.

---

### Patch B — Anti-doublon par `latestEmail.id`

**Fichier** : `src/pages/CaseView.tsx` (L746-770)

Remplacer le test `intentAlreadyPresent` global par un test ciblé sur le dernier email du thread.

```typescript
// Phase 16: Trigger intent analysis after puzzle (non-blocking, per-email anti-doublon)
try {
  if (caseData?.thread_id) {
    // Find the latest email in the thread
    const { data: latestEmail } = await supabase
      .from("emails")
      .select("id")
      .eq("thread_ref", caseData.thread_id)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestEmail) {
      // Check if this specific email already has an intent classification
      const intentAlreadyPresent = (events ?? []).some(
        (e: any) =>
          e.event_type === "thread_intent_v1" &&
          e.related_email_id === latestEmail.id
      );

      if (!intentAlreadyPresent) {
        await supabase.functions.invoke("analyze-thread-event", {
          body: { email_id: latestEmail.id },
        });
      }
    }
  }
} catch (intentErr) {
  console.warn("[Phase16] Intent analysis (non-blocking):", intentErr);
}
```

Logique : on récupère d'abord le `latestEmail.id`, puis on vérifie si un `thread_intent_v1` avec `related_email_id === latestEmail.id` existe déjà. Si non → on lance la classification. Chaque nouvel email sera donc classifié.

---

### Récapitulatif

| Patch | Ligne | Changement | Risque |
|-------|-------|-----------|--------|
| A | 1764-1770 | `pricing_gate === false` au lieu de Set hardcodée | nul |
| B | 746-770 | Anti-doublon par `related_email_id` du dernier email | nul |

0 migration. 0 RLS. 0 nouveau fichier. 2 patchs dans 1 fichier.
