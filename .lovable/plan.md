
## Plan d'exécution — Phase C2/P0.2 — Exploiter `thread_intent_v1` dans le dossier

### STATUS: ✅ DONE

### Fichiers créés/modifiés

| Fichier | Action |
|---------|--------|
| `supabase/functions/apply-thread-intent-v1/index.ts` | Création — edge function idempotente |
| `supabase/config.toml` | +1 entrée `verify_jwt = false` |
| `src/pages/CaseView.tsx` | Intent display + bouton "Appliquer intent" |

### Fonctionnalités

1. **Affichage intent** : Badge intent_type + confiance + risque dans CaseView (dérivé des events existants)
2. **Bouton "Appliquer intent"** : crée des `manual_action` dans la timeline via edge function
3. **Idempotence** : dedupe_key `apply_intent_v1:{eventId}:{action_code}` — relancer = 0 doublons
4. **Mapping P0** : `provide_missing_info` → 2 actions, `new_quote_request` → 1 action, default → 1 action
5. **Sécurité** : userClient (JWT/RLS) pour lectures, serviceClient pour inserts, intent_event_id vérifié contre case_id
