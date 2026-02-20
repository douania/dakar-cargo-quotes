

# Modification du taux d'assurance par defaut : 0.5% vers 0.15%

## Contexte

Le taux d'assurance utilise pour le calcul de la valeur CAF (Cout Assurance Fret) est actuellement fixe a 0.5% par defaut. Il doit etre abaisse a 0.15% (0.0015) pour refleter le taux reel applique.

## Modifications (3 fichiers)

### 1. `supabase/functions/_shared/quotation-rules.ts` (ligne 373)

Changer le taux par defaut dans la fonction `calculateCAF` :

```
// Avant
const insuranceRate = params.insuranceRate || 0.005; // 0.5% par défaut

// Après
const insuranceRate = params.insuranceRate || 0.0015; // 0.15% par défaut
```

### 2. `supabase/functions/quotation-engine/index.ts` (ligne 2125)

Changer le taux passe explicitement au calcul CAF :

```
// Avant
insuranceRate: 0.005

// Après
insuranceRate: 0.0015
```

### 3. `supabase/functions/arbitrage-incoterm/index.ts` (ligne 267)

Mettre a jour le texte descriptif affiche :

```
// Avant
"Valeur CAF = FOB + Fret + Assurance (0.5% si non spécifiée)"

// Après
"Valeur CAF = FOB + Fret + Assurance (0.15% si non spécifiée)"
```

## Impact

- Le calcul CAF pour les incoterms FOB/FCA/FAS/EXW utilisera desormais 0.15% au lieu de 0.5% comme taux d'assurance par defaut.
- Tout pricing run futur sera impacte. Les runs precedents ne sont pas modifies.
- Si un `insuranceRate` specifique est passe en parametre, il continuera a etre utilise (pas de regression).

