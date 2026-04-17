

## Micro-correctif Lot 4 — Retrait du support multi-lot provisoire

### Diagnostic

**Ligne 772-775** dans `run-pricing/index.ts` :
```typescript
if (allow_provisional && lc.blockers.every(b => b === "CARGO_VALUE_REQUIRED")) return false;
```

Cette ligne laisse passer des lots DDP sans `cargo.value` en multi-lot, mais la boucle d'exécution multi-lot n'implémente aucun PROVISIONAL-DDP-GUARD par lot. Le code promet un assouplissement qu'il ne livre pas.

### Correction

**1 fichier touché** : `supabase/functions/run-pricing/index.ts`

**~2 lignes supprimées** : retirer la ligne 774 (le `if allow_provisional...`) du filtre `blockedLots`. Le filtre redevient :

```typescript
const blockedLots = lotChecks.filter(lc => {
  if (lc.blockers.length === 0) return false;
  return true;
});
```

Autrement dit : en multi-lot, `allow_provisional` n'a aucun effet. Les lots avec des blockers restent bloquants, exactement comme avant Lot 4.

Le pilote provisoire DDP reste actif **uniquement en mono-lot**, où le PROVISIONAL-DDP-GUARD est réellement implémenté (L1477-1527).

### Ce qui ne change pas

- Mono-lot provisoire DDP : inchangé et fonctionnel
- CaseView.tsx : inchangé
- PricingLaunchPanel.tsx : inchangé
- generate-quotation-version/index.ts : inchangé
- FSM, migrations, build-case-puzzle : non touchés

### Vérification post-patch

- Mono-lot DDP sans cargo.value + opt-in → provisoire (inchangé)
- Multi-lot avec un lot DDP sans cargo.value → bloqué (comme avant Lot 4)
- Multi-lot sans blockers → inchangé
- `tsc --noEmit` doit passer

### Justification

Option A du verdict CTO : le plus petit changement sûr. Le support multi-lot provisoire pourra être ajouté dans un lot ultérieur avec un vrai PROVISIONAL-DDP-GUARD par lot.

