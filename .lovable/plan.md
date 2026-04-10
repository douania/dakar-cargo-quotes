

# Fix: Impression PDF coupée à gauche

## Diagnostic

Le problème vient du layout flex `SidebarProvider > div.flex > AppSidebar + SidebarInset`. Lors de l'impression :
- La sidebar est masquée via `display: none` (`[data-sidebar]`)
- Mais le `SidebarInset` conserve ses contraintes flex et son `margin-left` implicite (via les classes `peer-data-*` et le positionnement flex)
- Le `div.min-h-screen.flex.w-full` parent maintient un contexte flex qui décale le contenu
- Le `[data-panel-group] { display: block }` actuel cible le mauvais sélecteur — `SidebarInset` n'utilise pas `data-panel-group`

Résultat : le contenu démarre avec un offset gauche invisible, et la partie gauche est coupée à l'impression.

## Correctif

**Fichier** : `src/index.css` — section `@media print`

Ajouter des règles pour neutraliser complètement le layout flex du wrapper et le positionnement du `SidebarInset` :

```css
@media print {
  /* Existing rules kept as-is */

  /* Fix: neutralize sidebar flex layout for full-width print */
  .min-h-screen.flex {
    display: block !important;
  }

  /* Fix: SidebarInset — remove all sidebar-relative positioning */
  [data-sidebar] ~ main,
  main.relative.flex.min-h-svh {
    margin-left: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    min-height: auto !important;
  }
}
```

C'est un patch CSS pur, aucun composant modifié, blast radius nul.

## Fichier impacté

| Fichier | Changement |
|---------|-----------|
| `src/index.css` | ~10 lignes ajoutées dans `@media print` |

