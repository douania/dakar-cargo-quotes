# MASTER CONTEXT — DAKAR CARGO QUOTES
Version: 1.1
Phase: EQ1.2 + CL1 — Conversation Layer minimal
Latest patch: CL1 — Conversation Layer minimal
Date: 2026-03

---

## État général

- Pricing engine stabilisé
- Parsing IA robuste (extractAndParseJSON)
- Blockers Policy v1 active
- Timeline CHECK constraint corrigée (29 valeurs)
- Silent failures corrigés
- Module EQ1 (External Quote Requests) stabilisé et hardened
- Module CL1 (Conversation Layer) opérationnel

---

## Décisions fondamentales

- Pas d'auto-send
- Pas d'auto-update facts
- Pas d'agent autonome
- Assistant structurant uniquement
- Idempotence = case_id + event_type + related_email_id
- event_data (JSONB) pour timeline
- verify_jwt=false + requireUser (pattern Lovable Cloud)
- Security contract opérationnel: docs/SECURITY_CONTRACT.md (subordonné à ce document)
- Status registry opérationnel: docs/STATUS_REGISTRY.md (subordonné à ce document)
- Phase S3: DECISIONS_PENDING restauré comme état canonique
- Phase P4: build-case-puzzle introduit une détection d'ambiguïté
- Phase EQ1: Module External Quote Requests — workflow latéral pour demandes partenaires. Injection dans quote_facts via supersede_fact RPC uniquement. Validation humaine obligatoire.
- Phase EQ1.2: Hardening P0 — email thread/sender guard (normalizeEmail strict equality), fail-fast on facts insert, exact-match replay guard, critical error hierarchy.
- Phase CL1: Conversation Layer minimal — suivi drafted→sent→answered→validated par gap_key. Insert-if-not-exists (pas d'upsert). Matching sent-first avec fallback drafted. Promotion answered→validated dans set-case-fact (exception STRUCTURAL_PATCH_ALLOWED).

---

## Module C2

Edge function : analyze-thread-event  
Stockage : event_type = thread_intent_v1  
Parsing : extractAndParseJSON (maxLogChars=500)  
Insert via serviceClient  
SELECT via userClient  

---

## Module EQ1

Edge functions : analyze-partner-response, validate-partner-fact  
Tables : external_quote_requests, external_quote_responses, external_quote_response_facts  
Hook : useExternalRequests  
UI : ExternalRequestsPanel  
Injection : via supersede_fact RPC (pas de write direct dans quote_facts)  
Validation : humaine obligatoire, pas d'auto-merge  
Idempotence : UNIQUE (request_id, source_email_id) + facts-existence guard + exact-match replay guard  

---

## Module CL1

Edge functions : generate-reply-draft (enrichi), analyze-reply-event (enrichi), set-case-fact (enrichi), mark-client-gap-request-sent (nouveau)  
Table : client_gap_requests  
Cycle : drafted → sent → answered → validated (+ cancelled)  
Unicité : UNIQUE partiel (case_id, gap_key) WHERE status IN ('drafted','sent','answered')  
Matching : sent-first, fallback drafted  
Injection : via set-case-fact uniquement (promotion answered → validated)  
UI : ClarificationPanel (bouton "Marquer comme envoyé"), CaseView (section statuts)  
Contrainte : non-bloquant — erreurs CL1 loguées, jamais fatales  

---

## Modules FROZEN

Ne pas modifier :

- quotation-engine
- build-case-puzzle
- set-case-fact
- pricing logic

---

## Philosophie

L'application est un assistant traçable,
pas un décideur automatique.

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
5. il est justifié explicitement avant exécution
