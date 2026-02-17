
# Afficher les resultats de pricing dans CaseView

## Diagnostic

Le pricing du dossier 31efcc01 a reussi :
- Statut passe a `PRICED_DRAFT`
- 9 lignes calculees, total HT 150 000 XOF, TTC 177 000 XOF
- Le bouton "Lancer le pricing" a disparu (correct, le statut n'est plus `READY_TO_PRICE`)

Mais **aucun panneau de resultats n'est affiche** car `CaseView.tsx` n'importe pas `PricingResultPanel`. Ce composant existe deja et fonctionne dans `QuotationSheet.tsx`.

## Correction

**Fichier** : `src/pages/CaseView.tsx`

### 1. Import du composant

Ajouter l'import de `PricingResultPanel` (deja existant dans `src/components/puzzle/PricingResultPanel.tsx`).

### 2. Affichage conditionnel apres le PricingLaunchPanel

Apres le bloc `READY_TO_PRICE` (ligne 744), ajouter :

```text
{['PRICED_DRAFT', 'HUMAN_REVIEW', 'QUOTED_VERSIONED', 'SENT'].includes(caseData.status) && (
  <div className="mb-6">
    <PricingResultPanel 
      caseId={caseId!} 
      isLocked={caseData.status === 'SENT'} 
    />
  </div>
)}
```

Ce bloc affiche :
- Les lignes de pricing calculees (frais SODATRA, droits de douane, etc.)
- Le total HT / TTC
- Le bouton de creation de version (si non verrouille)

## Fichiers modifies

| Fichier | Modification |
|---------|-------------|
| `src/pages/CaseView.tsx` | Import + rendu conditionnel de PricingResultPanel |

## Resultat attendu

1. Statut `PRICED_DRAFT` : le panneau de resultats apparait avec les 9 lignes et les totaux
2. Statut `SENT` : le panneau est en lecture seule (verrouille)
3. Zero changement de logique metier
