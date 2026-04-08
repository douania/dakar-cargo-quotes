

# Plan COCKPIT-4C — Séparation visuelle Communication / Consolidation

## Problème

Le plan d'actions actuel (12 étapes) affiche une liste plate. L'opérateur ne voit pas que le pricing final doit venir **après** la boucle communication. L'étape 8 "Lancer le pricing" apparaît comme une étape parmi d'autres, sans signaler qu'elle dépend de la résolution des étapes partenaires/client.

## Solution

Ajouter une séparation visuelle en 2 sections dans le même composant, sans changer la logique métier ni les queries :

```text
┌─────────────────────────────────┐
│ Plan d'actions        7/12      │
│                                 │
│ ── Communication ──             │
│ ✓ Analyser la demande client    │
│ ✓ Résoudre les gaps bloquants   │
│ ● Préparer demandes partenaires │
│ ○ Confirmer l'envoi             │
│ ○ Traiter réponses partenaires  │
│ ○ Envoyer clarifications client │
│ ○ Analyser réponses client      │
│                                 │
│ ── Consolidation commerciale ── │
│ ○ Lancer le pricing             │
│ ○ Créer la version              │
│ ○ Exporter le PDF               │
│ ○ Préparer l'email client       │
│ ○ Marquer l'envoi client        │
└─────────────────────────────────┘
```

## Fichier modifié

**`src/components/case/CaseActionPlan.tsx`** — seul fichier code modifié :

1. Ajouter une propriété `group: "communication" | "consolidation"` à chaque étape
2. Étapes 1-7 → group `"communication"`, étapes 8-12 → group `"consolidation"`
3. Dans le rendu, séparer les deux groupes avec un petit label de section (texte `text-[10px] uppercase tracking-wide text-muted-foreground/60`)
4. Aucun changement aux queries, à la logique de statut, ni au compteur global

## Ce qui ne change PAS

- Aucune query ajoutée ou modifiée
- Aucune logique de statut modifiée
- Le compteur `done/total` reste global
- Skip logic inchangée
- Aucune migration, aucune zone FROZEN, aucune mutation

## Documentation

- `docs/DEFERRED_BACKLOG.md` : ajouter entrée COCKPIT-4C en `planned`
- `.lovable/plan.md` : plan actif COCKPIT-4C

## Blast radius

| Fichier | Nature |
|---------|--------|
| `src/components/case/CaseActionPlan.tsx` | ~15 lignes modifiées (rendu uniquement) |
| `docs/DEFERRED_BACKLOG.md` | Entrée ajoutée |
| `.lovable/plan.md` | Plan actif |

Aucune migration. Aucune zone FROZEN. Aucune mutation métier. Pipeline EQ1 intact.

