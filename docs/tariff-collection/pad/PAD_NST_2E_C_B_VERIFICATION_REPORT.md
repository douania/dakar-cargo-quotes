# PAD-NST-2E-C-B — Rapport de vérification post-déploiement

## Identité

| Champ | Valeur |
|-------|--------|
| Phase | PAD-NST-2E-C-B |
| Date | 2026-05-08 |
| Fonction | `get-pad-nst-suggestions` |
| Fichier | `supabase/functions/get-pad-nst-suggestions/index.ts` |
| Type | Edge Function Deno isolée — lecture SELECT uniquement |

## Périmètre respecté

| Contrainte | Respecté |
|-----------|----------|
| Aucun `src/` modifié | ✅ |
| Aucun `run-pricing` modifié | ✅ |
| Aucun frontend modifié | ✅ |
| Aucune migration créée | ✅ |
| Aucune modification de schéma | ✅ |
| Aucune modification `config.toml` | ✅ |
| Aucune écriture DB | ✅ |
| Aucun appel IA | ✅ |
| Aucun `amount` / `estimated_amount` | ✅ |
| Aucun `OFFICIAL` | ✅ |
| Aucun `SUPABASE_SERVICE_ROLE_KEY` | ✅ |
| Aucun bypass RLS | ✅ |
| Auth via `requireUser` (helper partagé `_shared/auth.ts`) | ✅ |
| Client Supabase construit avec JWT utilisateur | ✅ |
| POST uniquement, OPTIONS preflight, autres → 405 | ✅ |

## Fichiers modifiés

### Fichier code créé

- `supabase/functions/get-pad-nst-suggestions/index.ts`

### Fichiers documentaires mis à jour

- `docs/DEFERRED_BACKLOG.md` — ajout entrée C-B, mise à jour header
- `docs/SECURITY_CONTRACT.md` — ajout `get-pad-nst-suggestions` dans classification + S1 Patch Log
- `docs/tariff-collection/pad/PAD_NST_2E_C_B_VERIFICATION_REPORT.md` — ce fichier

## Sécurité

- **Auth** : `requireUser` depuis `_shared/auth.ts` — signature `(req: Request) => Promise<AuthResult | Response>`
- **Client DB** : `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: Bearer ${token} } } })`
- **RLS** : respectée nativement via token utilisateur
- **Service role** : non utilisée, non importée, non référencée
- **config.toml** : non modifié. Le projet utilise `verify_jwt = false` par défaut → `requireUser` bloque inline. Appel sans JWT → 401 confirmé par test.

## Tests post-déploiement

| # | Test | Attendu | Résultat |
|---|------|---------|----------|
| 1 | Sans Authorization | 401 | ✅ `{"error":"Missing authorization header"}` |
| 2 | GET | 405 | ✅ `{"error":"Method not allowed"}` |
| 3 | nst_level invalide | 400 | ✅ `{"error":"nst_level must be 'group' or 'division'"}` |
| 4 | nst_code invalide (group + "999") | 400 | ✅ `{"error":"nst_code format invalid for group..."}` |
| 5 | group / 01.1 | T05 | ✅ 1 suggestion, pad_category=T05, confidence=0.85 |
| 6 | division / 02 | Ordonnées DESC | ✅ 2 suggestions : T11@0.55, T07@0.50 |
| 7 | group / 03.6 | [] | ✅ suggestions=[] (TIER-C supprimée par R2) |
| 8 | group / 02.3 | Pas de T11 | ✅ 1 suggestion T06 seulement |

## Réponse type

```json
{
  "ok": true,
  "source_type": "TO_CONFIRM",
  "requires_operator_confirmation": true,
  "suggestions": [
    {
      "rule_id": "4a89ef00-07c6-448d-9b34-9e91706859b1",
      "nst_level": "group",
      "nst_code": "01.1",
      "pad_category": "T05",
      "confidence": 0.85,
      "evidence_level": "expert_rule",
      "notes": "...",
      "source_document": "PAD_NST_RECOMMENDATION_ENGINE.md",
      "source_reference": "Label PAD T05 = 'Cereales, ciment, riz...'"
    }
  ]
}
```

## Décision CTO — Filtre confidence

**Date** : 2026-05-08  
**Décision** : C-B ne filtre **pas** par `confidence >= 0.60`.

**Justification** : `get-pad-nst-suggestions` est un endpoint de lecture isolé destiné à l'audit, au diagnostic et au pilote terrain. Il ne branche pas `run-pricing` et ne produit aucun montant. Retourner les règles à `0.45–0.59` est utile pour l'observation terrain et l'UI opérateur (C-D), à condition que la confidence soit visible dans chaque suggestion (✅ champ `confidence` présent dans la réponse).

**Garde-fou** : tout usage runtime futur — en particulier C-C (branchement `run-pricing`) — **devra** appliquer un seuil de confiance explicite. Seuil recommandé : `confidence >= 0.60`, à confirmer après pilote terrain C-E.

**Ce qui est interdit maintenant** : aucune règle retournée par C-B ne devient `OFFICIAL`, ne produit un `amount > 0`, ni ne s'écrit dans `pad_designation_aliases`, quelle que soit sa confidence.

---

## Statut

**PAD-NST-2E-C-B = ✅ DÉPLOYÉ ET VÉRIFIÉ**

- C-C = non autorisé
- `run-pricing` = intouché
- Aucun `src/` modifié
- Filtre confidence : absent de C-B (décision CTO — voir § ci-dessus). Appartient à C-C.
