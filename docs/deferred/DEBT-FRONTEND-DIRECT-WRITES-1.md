# DEBT-FRONTEND-DIRECT-WRITES-1

Statut : `DEFERRED / ARCHITECTURE_SECURITY_DEBT`

Priorité : `P1`

Date d'inscription : 2026-06-19

Phase d'origine : `CASEVIEW-FUNCTION-CALLS-AND-FACTS-PIPELINE-AUDIT-1`

## Contexte

Les audits statiques Claude Code + Codex ont confirmé plusieurs écritures ou mutations déclenchées directement depuis le frontend dans le périmètre CaseView/documents/classification.

Cette dette ne bloque pas le chantier cargo canonique actuel, mais elle doit être conservée comme dette production-grade à traiter plus tard, composant par composant.

## Éléments concernés confirmés

- `src/components/case/CaseDocumentsTab.tsx`
  - upload direct vers Storage Supabase bucket `case-documents` ;
  - insert direct dans `case_documents` ;
  - insert direct dans `case_timeline_events` ;
  - delete direct dans `case_documents` ;
  - remove direct Storage Supabase ;
  - appel RPC direct `reset_attachment_for_retry`.
- `src/components/case/DocumentMetadataEditor.tsx`
  - insert/update direct dans `case_document_metadata`.
- `src/components/case/DesignationSuggestionBlock.tsx`
  - insert/update direct dans `commodity_designation_matches`.

## Risque

- Validation métier dispersée côté frontend.
- Traçabilité et logs hétérogènes.
- Idempotence non uniforme.
- Atomicité fragile entre Storage et DB, notamment upload/delete documents.
- Ownership/RLS plus difficile à auditer.
- Risque de régression si plusieurs composants écrivent directement dans des tables partagées.

## Doctrine cible

Encapsuler progressivement les mutations sensibles dans des Edge Functions dédiées avec :

- validation stricte du payload ;
- contrôle d'ownership via client user-scoped ;
- `service_role` uniquement après contrôle d'accès ;
- logs runtime standardisés ;
- idempotence ;
- erreurs normalisées ;
- pas de contournement RLS/Auth ;
- rollback/cleanup documenté pour les opérations Storage + DB.

## Décision CTO actuelle

Ne pas corriger maintenant.

Ne pas lancer de refactor global.

Ne pas bloquer `CARGO-CANONICAL-OPERATOR-ADOPTION-1` sur cette dette.

Traiter ultérieurement dans une phase dédiée, par lots chirurgicaux.

## Phase future proposée

`FRONTEND-DIRECT-WRITES-HARDENING-1`

Ordre recommandé :

1. `CaseDocumentsTab` — priorité haute : upload/delete documents + timeline + Storage.
2. `DesignationSuggestionBlock` — priorité haute/moyenne : mémoire de classification.
3. `DocumentMetadataEditor` — priorité moyenne : métadonnées opérateur.

## Stop conditions futures

Arrêter et demander GO CTO si :

- migration DB nécessaire ;
- RLS/Auth ou Storage policies touchées ;
- plus de 3 fichiers frontend impactés dans un même patch ;
- changement de workflow opérateur ;
- risque de rupture upload/document parsing ;
- absence de tests ou impossibilité de vérifier l'idempotence ;
- refactor global proposé.

## Hors périmètre immédiat

- Aucun patch maintenant.
- Aucune migration maintenant.
- Aucun changement RLS/Auth maintenant.
- Aucun changement Lovable runtime maintenant.
- Aucune correction globale frontend maintenant.
