
# Service Override Panel — Implémenté

## Résumé

Panneau de checkboxes dans CaseView permettant aux opérateurs d'ajuster les services d'un package sans changer le package lui-même. Le `service.package` reste la source de vérité principale ; `service.overrides` (JSON `{ add, remove }`) stocke les ajustements.

## Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `supabase/functions/set-case-fact/index.ts` | Ajout `"service.overrides"` dans `ALLOWED_FACT_KEYS` |
| `src/pages/CaseView.tsx` | Composant `ServiceOverridePanel` avec checkboxes, imports Checkbox/Separator/Package, bouton "Afficher plus" pour services secondaires |
| `src/pages/QuotationSheet.tsx` | Patch injection services : lecture `service.overrides`, allowlist via `serviceTemplates`, parsing robuste JSON, ordre stable + dédoublonnage |

## 3 Garde-fous CTO

1. **Allowlist** : `ALL_SERVICE_KEYS` construit depuis `serviceTemplates` — seules les clés connues sont acceptées dans add/remove
2. **JSON robuste** : `typeof raw === 'string' ? JSON.parse(raw) : raw` avec try/catch et fallback `{}`
3. **Ordre stable** : base package filtré par remove, puis add concaténé sans doublons
