

## Diagnostic confirmé

`mode: "start"` retourne immédiatement `{ job_id, status: "started" }` (ligne 1500). Le puzzle tourne en background via `EdgeRuntime.waitUntil`. Donc `await invoke(...)` n'attend **pas** la fin du puzzle — exactement comme tu l'as pressenti.

**Bonne nouvelle** : `runBuildCasePuzzleAsync` existe déjà (lignes 692-730). C'est un helper qui :
1. Lance `mode: "start"`
2. Poll `mode: "poll"` toutes les 3s avec backoff
3. Gère `tick` si stale
4. Retourne quand `status === "completed"`

Ce helper est déjà utilisé par `handleLaunchAnalysis` (ligne 736) et le refresh articles (ligne 870). Il suffit de l'utiliser dans `saveGapAnswer`.

## Fix — Option A (la plus propre, 3 lignes changées)

**Fichier** : `src/pages/CaseView.tsx`

**Lignes 1494-1500** — Remplacer le fire-and-forget par `await runBuildCasePuzzleAsync` :

```text
AVANT (lignes 1494-1500):
  // Relancer build-case-puzzle async (fire-and-forget)
  if (caseId) {
    supabase.functions.invoke("build-case-puzzle", {
      body: { case_id: caseId, mode: "start" },
    }).catch(e => console.warn("[saveGapAnswer] build-case-puzzle start:", e));
  }
  await handleRefresh();

APRÈS:
  // Relancer build-case-puzzle et attendre la fin avant refresh
  if (caseId) {
    try {
      await runBuildCasePuzzleAsync(caseId);
    } catch (e) {
      console.warn("[saveGapAnswer] build-case-puzzle:", e);
    }
  }
  await handleRefresh();
```

### Pourquoi c'est safe

| Point | Analyse |
|-------|---------|
| `runBuildCasePuzzleAsync` déjà testé | Utilisé par 2 autres flows (analyse, force-refresh) |
| Timeout 5 min intégré | Pas de blocage infini |
| UX | Le bouton reste en loading (`setSavingGapKey`) — feedback correct |
| Auto-pricing en aval | L'auto-pricing (lignes 1502-1535) query `quote_gaps` **après** le puzzle → verra les gaps résolus |
| `handleRefresh` | Appelé après completion → gaps à jour |

### Pas besoin de toucher `handleRefresh`

`handleRefresh` appelle `refetchGaps()` qui est un `useQuery` refetch. Comme le puzzle sera terminé quand on arrive là, les données seront correctes. Le `staleTime: 30000` n'empêche pas un `refetch()` explicite — il empêche seulement les re-fetch automatiques sur mount/focus.

### Résumé

- **1 fichier** : `CaseView.tsx`
- **3 lignes** changées (fire-and-forget → await helper existant)
- **0 migration, 0 RLS, 0 nouveau code**

