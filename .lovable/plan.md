## Phase EQ1 — External Quote Requests ✅

### Objectif

Permettre aux opérateurs de créer des demandes externes aux partenaires (agent France, compagnie maritime, etc.), de recevoir et analyser leurs réponses, et de valider les faits extraits avant injection dans le pipeline de cotation.

### Tables créées

| Table | Description |
|-------|-------------|
| `external_quote_requests` | Demandes sortantes vers partenaires (purpose, status, partner_name) |
| `external_quote_responses` | Réponses reçues (UNIQUE request_id+source_email_id) |
| `external_quote_response_facts` | Faits proposés extraits des réponses (validation_status: proposed/validated/rejected) |

### CHECK constraints mis à jour

- `quote_facts_source_type_check` : +`partner_response`
- `case_timeline_events_event_type_check` : +`external_request_created`, +`external_response_analyzed`

### Edge Functions créées

| Fonction | Description |
|----------|-------------|
| `analyze-partner-response` | Analyse AI (Gemini Flash) d'un email partenaire, extraction de faits avec prompt purpose-aware |
| `validate-partner-fact` | Validation/rejet d'un fait proposé → injection via `supersede_fact` RPC |

### Frontend

| Fichier | Description |
|---------|-------------|
| `src/hooks/useExternalRequests.ts` | Hook React Query pour les 3 tables + mutations |
| `src/components/puzzle/ExternalRequestsPanel.tsx` | Panel complet : liste demandes, formulaire création, validation faits |
| `src/pages/CaseView.tsx` | Intégration du panel après DecisionSupportPanel |

### Statuts de requête

```
draft → sent → response_received → response_analyzed → partially_validated → facts_validated
                                                      → closed (rejet total ou manuel)
```

### Zones FROZEN respectées

- `build-case-puzzle`, `quotation-engine`, `run-pricing` : aucune modification
- Les faits entrent via `supersede_fact` RPC après validation opérateur
