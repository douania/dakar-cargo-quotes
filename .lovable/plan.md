

# Phase V4.1.7c — Afficher l'explication tarifaire de maniere visible (pas seulement au survol)

## Diagnostic

Le backend genere correctement les explications lisibles (Phase V4.1.7 + V4.1.7b). Le frontend les recoit et les stocke dans `line.explanation`. **Mais** l'affichage actuel repose uniquement sur un **tooltip au survol** d'un badge de 10px de haut :

```
<Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 cursor-help">
  <Info className="h-2.5 w-2.5" />
  {sourceLabel}
</Badge>
```

Le tooltip ne s'affiche que si l'utilisateur survole exactement ce minuscule badge. C'est pourquoi l'utilisateur dit "il n'y a pas de lien" — l'explication est techniquement la mais **invisible en pratique**.

## Solution

Afficher l'explication directement sous le badge, en texte visible, sans besoin de survol.

### Fichier unique : `src/features/quotation/components/ServiceLinesForm.tsx`

### Modification (lignes 159-176)

Remplacer le bloc actuel qui n'affiche que le badge + tooltip par un affichage ou :
- Le badge source reste visible (identique)
- L'explication s'affiche en texte a cote du badge, toujours visible
- Le tooltip est conserve pour compatibilite mais n'est plus le seul moyen de voir l'info

Avant :
```
{sourceLabel && (
  <div className="flex items-center gap-1.5 pl-3">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge ...>{sourceLabel}</Badge>
        </TooltipTrigger>
        {line.explanation && (
          <TooltipContent ...>{line.explanation}</TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  </div>
)}
```

Apres :
```
{sourceLabel && (
  <div className="flex items-center gap-1.5 pl-3 flex-wrap">
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1">
      <Info className="h-2.5 w-2.5" />
      {sourceLabel}
    </Badge>
    {line.explanation && (
      <span className="text-[11px] text-muted-foreground">
        — {line.explanation}
      </span>
    )}
  </div>
)}
```

## Resultat attendu

Chaque ligne de service affiche :

```
Frais port Dakar
  [Catalogue SODATRA] — Catalogue SODATRA : 15 000 x 38 t = 570 000 FCFA
```

```
Transport routier
  [Transport local] — Transport local (Dakar) : 123 900 FCFA/voyage
```

```
Retour conteneur vide
  [Regle metier] — EMPTY_RETURN: Obligation contractuelle, retour a vide = 0 FCFA
```

## Impact

| Element | Detail |
|---|---|
| Fichier modifie | `src/features/quotation/components/ServiceLinesForm.tsx` |
| Lignes changees | ~8 lignes (bloc 159-176) |
| Migration SQL | Aucune |
| Edge function | Aucune modification |
| Risque regression | Nul (affichage uniquement) |

