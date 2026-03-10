

# Ajout de la section STRUCTURAL_PATCH_ALLOWED dans MASTER_CONTEXT.md

Ajouter à la fin du fichier `docs/MASTER_CONTEXT.md` (après ligne 54) la section complète de l'exception contrôlée, incluant la règle sur les zones FROZEN.

### Contenu à ajouter

```markdown
---

## Exception contrôlée — STRUCTURAL_PATCH_ALLOWED

Par défaut :
- patchs chirurgicaux uniquement
- pas de refactor global
- respect strict des zones FROZEN
- préserver idempotence, traçabilité, intégrité des données

Exception autorisée :
Un patch structurel ciblé peut être accepté, y compris sur une zone sensible/FROZEN, uniquement si toutes les conditions suivantes sont réunies :

1. il corrige ou améliore un manque réel du modèle métier
2. il reste localisé à un périmètre réduit
3. il ne constitue pas un refactor global
4. il préserve le pipeline existant, l'idempotence, la traçabilité et l'intégrité des données
5. il est justifié explicitement avant exécution sous le format :
   - Problème métier réel
   - Pourquoi le patch est structurel
   - Pourquoi il reste localisé
   - Pourquoi ce n'est pas un refactor global
   - Risques
   - Tests minimums

Quand un patch touche une zone FROZEN, il est interdit par défaut.
Il ne peut être accepté que s'il est explicitement présenté comme STRUCTURAL_PATCH_ALLOWED et validé par le CTO avant exécution.
```

### Fichier modifié

| Fichier | Changement |
|---------|-----------|
| `docs/MASTER_CONTEXT.md` | Append section après ligne 54 |

