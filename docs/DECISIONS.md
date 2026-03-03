# DECISIONS — Dakar Cargo Quotes

## D1 — Direction produit
Construire un moteur conversationnel structuré avant toute autonomie.

## D2 — Intent stockage
Stockage via event_type `thread_intent_v1` dans case_timeline_events.

## D3 — Idempotence intent
Déduplication = case_id + event_type + related_email_id.

## D4 — Sécurité Edge Functions
verify_jwt=false + requireUser (pattern Lovable Cloud).

## D5 — Correction timeline
Ajout des event_type manquants à la CHECK constraint :
assumption_applied,
detection_corrected,
fact_injected_from_attachment,
thread_intent_v1.

## D6 — Contrat JSON officiel
thread_intent_v1 avec :
intent_type,
risk_level,
confidence,
case_updates,
open_questions,
reply_recommended.

## D7 — Périmètre C2
Aucune modification du pricing engine.
