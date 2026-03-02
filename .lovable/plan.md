

## Correctif P0 — Refresh gaps après soft blocker pricing

### Probleme
Quand `run-pricing` retourne un soft blocker (HTTP 200 + `pricing_blockers`), il cree le gap en base mais le panel fait `return` sans appeler `onComplete`. L'UI reste stale avec "0 gaps".

### Modification unique

**Fichier** : `src/components/puzzle/PricingLaunchPanel.tsx`, ligne 82

Dans le bloc `if (data?.pricing_blockers?.length > 0)`, ajouter `onComplete?.()` avant le `return` pour declencher le refresh des facts/gaps.

```typescript
if (data?.pricing_blockers?.length > 0) {
  const blockerMsg = data.message || 'Données manquantes pour le pricing';
  setError(blockerMsg);
  toast.error(blockerMsg);
  setConfirmOpen(false);
  onComplete?.();  // ← refresh facts/gaps after run-pricing created blockers
  return;
}
```

### Impact
- 1 ligne ajoutee
- Zero changement DB / RLS / moteur
- Le gap `cargo.hs_code` (ou autre) cree par `run-pricing` apparait immediatement dans le `BlockingGapsPanel`

