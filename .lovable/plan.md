

# P1-A micro-fix — Note CaseActionPlan cohérente avec P0-C

## Problème
Line 88 de `CaseActionPlan.tsx` affiche :
```
"Envoi réel confirmé après activation COM-1A"
```
Ce wording est devenu faux depuis P0-C : la confirmation manuelle traçable via `email_sent_at` existe déjà.

## Correctif
Remplacer la note (ligne 88) par un wording reflétant le runtime actuel :
```
"Confirmation manuelle disponible — COM-1A automatisera l'envoi"
```

## Blast radius
- 1 ligne modifiée dans `src/components/case/CaseActionPlan.tsx`
- Aucun autre fichier impacté

