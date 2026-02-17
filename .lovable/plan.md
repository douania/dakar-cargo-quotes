

# Ajouter le bouton "Lancer le pricing" dans CaseView

## Constat

Le composant `PricingLaunchPanel` existe deja dans `src/components/puzzle/PricingLaunchPanel.tsx` et appelle correctement `run-pricing`. Mais il n'est jamais importe ni rendu dans `CaseView.tsx`.

Le panneau d'action actuel (ligne 714) ne s'affiche que pour les statuts `INTAKE`, `FACTS_PARTIAL`, `NEED_INFO`. Quand le dossier passe a `READY_TO_PRICE`, l'operateur ne voit aucune action possible.

## Correction

**Fichier** : `src/pages/CaseView.tsx`

### 1. Import du composant

Ajouter en haut du fichier :

```text
import { PricingLaunchPanel } from '@/components/puzzle/PricingLaunchPanel';
```

### 2. Affichage conditionnel

Apres le panneau d'action existant (ligne 736), ajouter un bloc conditionnel :

```text
{caseData.status === 'READY_TO_PRICE' && (
  <div className="mb-6">
    <PricingLaunchPanel caseId={caseId!} />
  </div>
)}
```

### 3. Rafraichissement apres pricing

Le `PricingLaunchPanel` actuel affiche un toast de succes mais ne declenche pas de refresh des donnees. Pour que le statut se mette a jour automatiquement apres le pricing, ajouter un callback `onComplete` au composant :

- Modifier `PricingLaunchPanel` pour accepter un prop optionnel `onComplete?: () => void`
- Appeler `onComplete()` apres le toast de succes
- Dans CaseView, passer `handleRefresh` comme callback

## Fichiers modifies

| Fichier | Modification |
|---------|-------------|
| `src/pages/CaseView.tsx` | Import + rendu conditionnel de PricingLaunchPanel |
| `src/components/puzzle/PricingLaunchPanel.tsx` | Ajout prop optionnel `onComplete` |

## Resultat attendu

1. Statut `READY_TO_PRICE` → le bouton "Lancer le pricing" apparait
2. Click → confirmation → appel `run-pricing`
3. Succes → refresh automatique → statut passe a `PRICED_DRAFT`
4. Le bouton disparait (statut n'est plus `READY_TO_PRICE`)

