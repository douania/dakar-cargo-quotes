

# Micro-patch post-review CTO : 2 corrections dans CaseView.tsx

## Constat apres inspection du code deploye

### P1.1 (MultiRequestLinesPanel) : OK, aucune correction necessaire
Le JSX compile proprement. La condition `confidence >= 0.8` est correcte (ligne 86). Le `as any` est acceptable pour ce patch (la table n'est pas dans les types generes).

### P0.2 (Auto-pricing) : 2 micro-corrections a faire

**Correction 1 — Ligne 941 : `handleRefresh()` sans `await`**

Le dernier `handleRefresh()` apres le run-pricing n'a pas de `await`. Meme si handleRefresh n'est pas veritablement async, il faut etre coherent avec la ligne 911 qui utilise `await handleRefresh()`.

```
Avant : handleRefresh();
Apres : await handleRefresh();
```

**Correction 2 — Ligne 914 : Ajouter garde anti-double PRICING_RUNNING**

Le guard `!isLocked` depend du state React (potentiellement stale). Ajouter une verification directe sur `caseData?.status` pour couvrir le cas de latence reseau ou l'utilisateur resout 2 gaps rapidement.

```
Avant : if (caseId && !isLocked && caseData?.status !== "SENT" && caseData?.status !== "ARCHIVED")
Apres : if (caseId && !isLocked && caseData?.status !== "SENT" && caseData?.status !== "ARCHIVED" && caseData?.status !== "PRICING_RUNNING")
```

## Fichiers modifies

| Fichier | Lignes | Action |
|---------|--------|--------|
| `src/pages/CaseView.tsx` | 914, 941 | 2 corrections chirurgicales |

## Ce qui ne change pas
- MultiRequestLinesPanel : inchange
- Backend / edge functions : inchange
- Logique metier : inchangee

