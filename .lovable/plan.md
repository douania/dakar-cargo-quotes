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

---

## Phase CL1 — Conversation Layer minimal ✅

### Objectif

Tracer le cycle de vie des clarifications client par gap :
`drafted → sent → answered → validated`

### Table créée

| Table | Description |
|-------|-------------|
| `client_gap_requests` | Suivi conversationnel par gap_key (status, sent_at, response_email_id, validated_fact_id) |

### Index

- `uq_client_gap_requests_active` : UNIQUE partiel sur `(case_id, gap_key)` WHERE status IN ('drafted','sent','answered')
- `idx_client_gap_requests_case_id`, `idx_client_gap_requests_status`, `idx_client_gap_requests_case_gap`

### Edge Functions modifiées

| Fonction | Modification |
|----------|-------------|
| `generate-reply-draft` | Insert-if-not-exists `client_gap_requests` en `drafted` après génération du brouillon. `source_timeline_event_id` pointe vers l'event `output_generated` |
| `analyze-reply-event` | Match proposed_facts → active requests (priorité `sent`, fallback `drafted`), passe en `answered` |
| `set-case-fact` | Promotion `answered → validated` après `supersede_fact` réussi |

### Edge Function créée

| Fonction | Description |
|----------|-------------|
| `mark-client-gap-request-sent` | Marquage manuel `drafted → sent` par l'opérateur |

### Frontend

| Fichier | Modification |
|---------|-------------|
| `src/pages/CaseView.tsx` | Query `client_gap_requests`, section "Clarifications client", bouton "Envoyé" dans draft display |
| `src/components/puzzle/ClarificationPanel.tsx` | Ajout props `onMarkSent`, `markSentDisabled`, `isMarkingSent`, bouton "Marquer comme envoyé" |

### Zones FROZEN respectées

- `build-case-puzzle`, `run-pricing`, `quotation-engine` : aucune modification
- `quote_gaps` : structure inchangée
- `quote_cases.status` FSM : inchangé

---

## Phase ATT1 — Correction pipeline pièces jointes dans sync-emails ✅

### Cause racine

`sync-emails/index.ts` importait les emails mais pas leurs pièces jointes. Les méthodes IMAP (`fetchBodyStructure`, `fetchAttachmentPart`) existaient mais n'étaient pas branchées dans le pipeline principal.

### Correction apportée

#### Patch 1 — `supabase/functions/sync-emails/index.ts`

- **Helpers MIME ajoutés** (copie fidèle depuis `import-thread`) : `AttachmentInfo`, `tokenizeBodyStructure`, `extractFilenameFromParams`, `parseMimePart`, `extractBodyStructure`, `parseBodyStructure`, `findPartNumberByPosition`, `decodeBase64Chunked`, `decodeQuotedPrintableAttachment`
- **`fetchBodyStructure(uid)`** : retourne désormais `AttachmentInfo[]` au lieu de `string`
- **`fetchAttachment(uid, partNumber, encoding)`** : nouvelle méthode robuste remplaçant `fetchAttachmentPart`, gère 3 patterns d'extraction + base64 chunked + quoted-printable
- **`processEmailAttachments(client, uid, emailId, supabase)`** : sous-flux non-bloquant appelé après chaque insertion email réussie
  - Garde d'idempotence : check `email_id + filename` avant insert
  - PJ > 5MB : enregistrée avec `storage_path = null` et texte indicatif
  - Pas de limite au nombre de PJ
  - Erreurs individuelles loguées, ne bloquent jamais le pipeline email

#### Patch 2 — `supabase/functions/email-admin/index.ts`

- **Action `reimport_attachments` étendue** avec mode ciblé `thread_id` :
  - Récupère tous les emails du thread via `thread_ref`
  - Pour chaque email sans PJ existantes : connexion IMAP, BODYSTRUCTURE, download, upload
  - Garde d'idempotence identique (`email_id + filename`)
  - Classe `ReimportIMAPClient` minimale ajoutée localement
  - Mode heuristique existant (sans `thread_id`) : inchangé

### Contraintes respectées

- Limite taille : **5 MB** (alignée sur `import-thread`)
- Pas de limite nombre de PJ
- Non-bloquant : erreurs loguées, pipeline email intact
- Lecture explicite `{ data, error }` (P0-A)
- Zéro migration SQL
- Aucun module FROZEN touché

---

## Phase CL2 — Attachment Analysis Layer v2 ✅

### Objectif

Renforcer le pipeline `analyze-attachments` avec extraction texte brute PDF, normalisation, idempotence et anti-doublon — sans casser l'analyse AI existante.

### Modèle 3 voies

- **extracted_text** = texte brut (trace, audit, recherche plein texte)
- **extracted_data** = analyse AI structurée du document natif (interprétation métier)
- Les deux coexistent sans substitution

### Patches appliqués (v1)

| Patch | Description |
|-------|-------------|
| A | Extraction PDF texte brut via `pdfjs-dist@4.0.379` — même lib que `parse-document`. Fonction `extractPdfText()` ajoutée. Appliquée aux blocs PDF background et sync, avant l'appel AI natif. |
| B | `normalizeText()` — supprime null chars, normalise newlines, collapse whitespace. Appliquée avant chaque écriture `extracted_text`. |
| C | Garde `.eq('is_analyzed', false)` sur tous les `.update({ is_analyzed: true })` — ~14 occurrences (background + sync + skip). |
| D | Lecture explicite `{ error }` avec `console.warn` sur tous les UPDATE/INSERT du background mode. |
| E | ~~Garde anti-doublon `quotation_history`~~ — **remplacé par CL2-final A+** |

---

## Phase CL2-final A+ — Claim Ownership + DB Constraints 🔄 IN PROGRESS

### Objectif

Renforcer l'idempotence et la concurrence du pipeline `analyze-attachments` via un mécanisme de claim atomique et des contraintes DB pour les side effects.

### Migration SQL

| Opération | Description |
|-----------|-------------|
| `analysis_claimed_at TIMESTAMPTZ` | Colonne de claim sur `email_attachments` |
| `source_attachment_id UUID` | Colonne ajoutée sur `local_transport_rates` |
| `uq_quotation_history_attachment_cargo` | UNIQUE partiel `(source_attachment_id, cargo_type)` |
| `uq_learned_knowledge_source` | UNIQUE partiel `(source_type, source_id, category)` WHERE attachment |
| `uq_local_transport_rates_attachment` | UNIQUE partiel `(source_attachment_id, destination, container_type, cargo_category)` |

**Invariant documenté** : un même attachment produit au plus un rate par `(destination, container_type, cargo_category)`.

### Mécanisme de claim

| Propriété | Mécanisme |
|-----------|-----------|
| Exclusivité | Claim atomique `analysis_claimed_at = claimTs` via `.or(null, expired>15min)` |
| Ownership | Final update + early exits + catch conditionnés par `.eq('analysis_claimed_at', claimTs)` |
| Pas de doublons | UNIQUE DB sur 3 tables secondaires, gestion `23505` comme skip |
| Auto-recovery | Claims expirés (>15 min) ré-éligibles dans la sélection initiale et le claim |
| Observabilité | `.select('id').maybeSingle()` sur finalisation détecte claim perdu |

### Corrections spécifiques

- BG `unsupported` : reste **pré-claim**, inchangé
- Sync `return new Response(402/429)` : 4 occurrences précédées d'un release ownership-aware
- Patch E : supprimé, remplacé par contraintes DB + gestion `23505`

### Fichier modifié

| Fichier | Changement |
|---------|------------|
| `supabase/functions/analyze-attachments/index.ts` | Claim ownership BG+Sync, final vérifié, early exits ownership-aware, `source_attachment_id` sur transport rates |

### Ce qui n'est PAS touché

- Patches A (PDF extraction), B (normalisation), D (error reads) — conservés
- `sync-emails`, `email-admin`, modules FROZEN
- Prompts AI, routing, extraction
- Aucun fichier front
