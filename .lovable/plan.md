
# Phase C3.2-A — Backend-first multi-devis extraction ✅ DONE

## Statut: IMPLEMENTÉ

## Fichiers modifiés
1. **Migration SQL** — table `quote_request_lines` + RPC `replace_quote_request_lines` + RLS/grants
2. **`supabase/functions/build-case-puzzle/index.ts`** — helpers + integration multi-quote

## Résumé des changements

### Migration DB
- Table `quote_request_lines` (case_id FK, line_index CHECK >= 1, UNIQUE(case_id, line_index))
- RPC `replace_quote_request_lines(UUID, JSONB)` — SECURITY DEFINER, advisory lock, atomic delete+insert
- RLS: SELECT authenticated only
- Grants: service_role EXECUTE only on RPC, authenticated SELECT only on table
- source_email_id ON DELETE SET NULL (robustesse future)
- Guards: extracted_facts_json type array, meta_json type object

### Edge Function (build-case-puzzle)
- `detectMultiQuoteMarkers(text)`: regex gate sur ≥2 marqueurs distincts (threadContext only)
- `pickSourceEmailId(emails)`: dernier email is_quotation_request, sinon dernier email
- `extractQuoteLinesWithAI(...)`: appel IA SÉPARÉ (gemini-2.5-flash), prompt dédié, context tronqué 8k
- Validation stricte: max 8 lignes, min 2 facts, clés whitelistées, line_index 1-based
- Mapping B3: extracted_facts → extracted_facts_json
- Appel RPC: p_lines direct (pas de JSON.stringify) — fix B2
- Bloc entièrement non-bloquant (try/catch)
- Réponse: quote_request_lines_detected/stored/mode

## Ce qui n'a PAS changé
- extractFactsWithAI: aucune modification
- quote_facts / quote_gaps: aucune injection
- run-pricing: zero impact
- UI / Dashboard / CaseView: aucun changement
