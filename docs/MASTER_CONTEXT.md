# MASTER CONTEXT — DAKAR CARGO QUOTES
Version: 1.0
Phase: C2 — Conversation Engine
Date: 2026-03

---

## État général

- Pricing engine stabilisé
- Parsing IA robuste (extractAndParseJSON)
- Blockers Policy v1 active
- Timeline CHECK constraint corrigée (29 valeurs)
- Silent failures corrigés

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

---

## Module C2

Edge function : analyze-thread-event  
Stockage : event_type = thread_intent_v1  
Parsing : extractAndParseJSON (maxLogChars=500)  
Insert via serviceClient  
SELECT via userClient  

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
5. il est justifié explicitement avant exécution sous le format :
   - Problème métier réel
   - Pourquoi le patch est structurel
   - Pourquoi il reste localisé
   - Pourquoi ce n'est pas un refactor global
   - Risques
   - Tests minimums

Quand un patch touche une zone FROZEN, il est interdit par défaut.
Il ne peut être accepté que s'il est explicitement présenté comme STRUCTURAL_PATCH_ALLOWED et validé par le CTO avant exécution.
