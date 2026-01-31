

# PHASE 4B.1 — Quick Win Safe : Suppression du state inutilisé

## Analyse

| Élément | Statut |
|---------|--------|
| `offersExpanded` | Déclaré ligne 131, **jamais lu** |
| `setOffersExpanded` | Déclaré ligne 131, **jamais appelé** |
| Références dans le JSX | **Aucune** |
| Impact logique métier | **Zéro** |

## Modification prévue

**Fichier** : `src/pages/QuotationSheet.tsx`

**Action** : Supprimer la ligne 131 uniquement

```
Avant (ligne 131) :
  const [offersExpanded, setOffersExpanded] = useState(true);

Après :
  (ligne supprimée)
```

## Fichiers impactés

| Fichier | Action |
|---------|--------|
| `src/pages/QuotationSheet.tsx` | Supprimer ligne 131 |

## Validation

- [ ] Build TypeScript OK
- [ ] Tests Vitest : ThreadTimelineCard 5/5
- [ ] Aucun runtime error
- [ ] Diff minimal (1 ligne supprimée)

## Message de clôture attendu

```
Phase 4B.1 exécutée.
State inutilisé supprimé : offersExpanded
Diff : -1 ligne
Build OK. Tests 5/5.
```

