
# Plan A4 — Emails de cotation IA (v3 — CTO-approved)

## Périmètre

4 fichiers modifiés. Zéro migration. Zéro doc jusqu'à validation post-phase.

| Fichier | Passes |
|---------|--------|
| `supabase/functions/_shared/ai-client.ts` | A4.0 (micro-patch signal) |
| `supabase/functions/create-quotation-email-draft/index.ts` | A4.1 + A4.2 + A4.3 |
| `src/components/puzzle/SendQuotationPanel.tsx` | A4.4 |
| `src/hooks/useSendQuotation.ts` | A4.4 |

---

## A4.0 — Micro-patch ai-client.ts (signal support)

**Fichier** : `supabase/functions/_shared/ai-client.ts`

- Ajouter `signal?: AbortSignal` à l'interface `ChatOptions`
- Passer `signal` au `fetch()` interne
- Aucun autre changement (model default, URL, parsing inchangés)

---

## A4.1 — Template déterministe enrichi

**Fichier** : `supabase/functions/create-quotation-email-draft/index.ts`

Remplacer le corps statique (lignes 142-161) par un builder structuré utilisant le snapshot :
- Salutation avec `snapshot.client.company` si disponible
- Route `inputs.origin` → `inputs.destination` + incoterm si disponibles
- Rappel version + total HT formaté (`Intl.NumberFormat('fr-FR')`)
- Bloc multi-lot **préservé tel quel** (lignes 112-135 intactes)
- **Condition "ci-joint"** : lookup `quotation_documents` via **serviceClient** (pas userClient — RLS owner-only). Si PDF trouvé → "ci-joint". Sinon → "Le devis vous sera transmis séparément."
- Corriger `ai_generated: true` → `ai_generated: false` (ligne 175)

---

## A4.2 — Branche IA optionnelle

**Même fichier, après le body builder déterministe**

- Accepter `use_ai_enrichment?: boolean` dans le body (default `false`)
- Si `true` et `LOVABLE_API_KEY` disponible :
  - Construire un context pack JSON : `{ company, origin, destination, incoterm, version_number, total_ht, currency, lot_count, has_pdf }`
  - **Timeout explicite** via `AbortController` (15s) passé à `callAI` via le nouveau `signal` de A4.0
  - Appel `callAI` (model `google/gemini-2.5-flash`) avec prompt contraint :
    - "Rédige un email commercial professionnel en français pour accompagner un devis de transit. Utilise UNIQUEMENT les données fournies. Ne jamais inventer de chiffres, délais, ou promesses. Retourne un JSON `{ body_text: string }`."
  - Parser avec `extractAndParseJSON<{ body_text: string }>`
  - **Validation V1** : `typeof body_text === "string"` && `body_text.length >= 50` && non vide. Pas de check "chiffres absents du contexte".
  - Si erreur/timeout/validation fail → **fallback silencieux** vers le template déterministe, log warning
- `ai_generated` = `true` uniquement si sortie IA effectivement utilisée
- Le **sujet reste 100% déterministe** dans tous les cas

---

## A4.3 — Traçabilité

**Même fichier, après l'insert réussi du draft (et PAS sur hit idempotent)**

- Insert best-effort dans `case_timeline_events` :
  - `event_type`: `"output_generated"`
  - `actor_user_id`: `user.id`
  - `actor_type`: `"user"`
  - `event_data`: `{ kind: "quotation_email_draft_v1", draft_id, version_id, generation_mode }`
- Retourner `generation_mode` dans la réponse JSON
- Si l'insert timeline échoue : log warning, ne pas bloquer
- **Hit idempotent** : pas de timeline event, `generation_mode: undefined`, toast UI générique

---

## A4.4 — UX minimale

### `src/hooks/useSendQuotation.ts`
- Ajouter `ai_generated` au `.select()` du draft query
- L'exposer dans le return

### `src/components/puzzle/SendQuotationPanel.tsx`
- État local `useAiEnrichment` (default `false`)
- `Switch` "Enrichissement IA" au-dessus du bouton "Générer un brouillon"
- Passer `use_ai_enrichment` dans le body de l'appel
- Toast différencié : `"ai"` → "Brouillon IA créé" / `"deterministic"` → "Brouillon standard créé" / idempotent → "Brouillon existant récupéré"
- Badge `<Badge variant="outline">IA</Badge>` si `ownerDraft.ai_generated === true`

---

## Corrections CTO intégrées (6/6)

| # | Correction | Intégré |
|---|-----------|---------|
| 1 | `event_data` pas `payload` | ✅ A4.3 |
| 2 | Lookup PDF via serviceClient | ✅ A4.1 |
| 3 | Pas de check "chiffres absents" en V1 | ✅ A4.2 |
| 4 | Timeout explicite via AbortController + signal dans callAI | ✅ A4.0 + A4.2 |
| 5 | generation_mode sur hit idempotent = undefined + toast générique | ✅ A4.4 |
| 6 | _shared/ai-client.ts ajouté au périmètre (Option 1 CTO) | ✅ A4.0 |

## Ce qui ne change PAS

- `generate-quotation-version`, `export-quotation-version-pdf`, `send-quotation` : intacts
- Modules FROZEN : intacts
- `_shared/json-parser.ts` : réutilisé, non modifié
- Bloc multi-lot (lignes 112-135) : préservé
- Idempotence + index unique : préservés
- Pipeline canonique : inchangé
- `docs/DEFERRED_BACKLOG.md` : pas touché (post-phase uniquement)

## Ordre d'exécution

A4.0 → A4.1 → A4.2 → A4.3 → A4.4 → build check → smoke test
