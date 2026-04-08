

# COCKPIT-10 — Micro-correctif de clôture

## Problème

`send-external-quote-request/index.ts` ligne 134 : `ai_generated: true` est factuellement incorrect. Le corps de l'email provient soit d'un texte opérateur (`purpose_detail`), soit d'un template déterministe — jamais d'une génération IA.

## Correctif

### Fichier unique : `supabase/functions/send-external-quote-request/index.ts`

Ligne 134 : remplacer `ai_generated: true` par `ai_generated: false`.

### Redéploiement

Déployer la function `send-external-quote-request` après modification.

### Documentation

Aucune mise à jour doc nécessaire — le lot COCKPIT-10 est déjà documenté dans plan.md et DEFERRED_BACKLOG.md.

## Point 2 — Référence dossier dans purpose_detail

Conformément à la recommandation CTO (option 1) : `purpose_detail` est la vérité opérateur. Si l'opérateur n'inclut pas la référence, c'est son choix. Aucun correctif code nécessaire. Le commentaire existant (ligne 102-104) documente déjà cette convention.

## Blast radius

| Fichier | Changement |
|---------|-----------|
| `send-external-quote-request/index.ts` | 1 ligne : `true` → `false` |

Aucune migration. Aucune zone FROZEN. Aucun autre fichier impacté.

