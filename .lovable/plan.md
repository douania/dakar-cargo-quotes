
## Plan d'exécution — Phase C2/P0.4 — Réponse brouillon (safe, non envoyée)

### STATUS: ✅ DONE

### Fichiers créés/modifiés

| Fichier | Action |
|---------|--------|
| `supabase/functions/generate-reply-draft/index.ts` | Création — edge function AI draft |
| `supabase/config.toml` | +1 entrée `verify_jwt = false` |
| `src/pages/CaseView.tsx` | +bouton "Générer brouillon", +affichage draft, +copier clipboard |

### Fonctionnalités

1. **Edge function `generate-reply-draft`** : AI draft via gemini-2.5-flash, append-only, idempotente
2. **Guard action_code** : refuse si action ≠ PREPARE_CLIENT_REPLY_DRAFT (micro-ajustement #1)
3. **Idempotence stricte** : match dedupe_key + kind (micro-ajustement #2)
4. **Validation stricte** : subject ≥ 3 chars, body ≥ 20 chars (micro-ajustement #3)
5. **Clipboard fallback** : try/catch + toast erreur (micro-ajustement #4)
6. **UI** : bouton "Générer brouillon" + affichage inline (subject + body) + bouton "Copier"
7. **0 envoi email** : copier/coller uniquement

### Done Criteria

- [x] Bouton "Générer brouillon" visible sur action PREPARE_CLIENT_REPLY_DRAFT
- [x] Click → draft généré, stocké en DB, affiché dans CaseView
- [x] Re-click → idempotent true (pas de doublon)
- [x] Copier → clipboard OK (ou toast erreur si permissions)
- [x] Aucun envoi email automatique
