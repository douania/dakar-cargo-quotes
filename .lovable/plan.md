

# Plan : Afficher l'ID court du dossier sur les cartes du dashboard

## Problème

Les cartes du dashboard n'affichent que le nom du client. Quand on connaît uniquement l'ID du dossier (ex: `6d4d996f...`), il est impossible de le retrouver visuellement.

## Solution — 1 fichier

**`src/components/dashboard/CaseCard.tsx`**

Ajouter les 8 premiers caractères de `caseData.id` en gris discret à côté de la date (ligne 68-70).

```tsx
{/* Existing date display — add case ID prefix */}
<div className="flex items-center gap-2">
  <span className="text-[10px] font-mono text-muted-foreground/60">
    {caseData.id.substring(0, 8)}
  </span>
  <span className="text-xs text-muted-foreground whitespace-nowrap">
    {format(new Date(caseData.updated_at), 'dd MMM HH:mm', { locale: fr })}
  </span>
</div>
```

## Rendu attendu

```text
┌─────────────────────────────────────────────────┐
│ 📁 HONG KONG GOTONE INT'L...    6d4d996f 02 avr│
│     Décisions…  Maritime FCL Import             │
│     ████████████████████░░░░  100%              │
└─────────────────────────────────────────────────┘
```

## Ce qui ne change pas

- 0 module FROZEN
- 0 migration
- Aucune logique métier modifiée
- L'ID est tronqué (8 chars), discret, en `font-mono`

