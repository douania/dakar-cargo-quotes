# BACKLOG DIFFÉRÉ — DAKAR CARGO QUOTES

Source de vérité unique de tous les sujets volontairement reportés, laissés dormants, acceptés comme dette, ou déplacés à une phase ultérieure.

Dernière mise à jour : 2026-03-26

---

## Règle de mise à jour obligatoire

Tout sujet explicitement différé, laissé dormant, accepté comme dette, ou déplacé à une phase ultérieure **doit être ajouté ou mis à jour dans ce fichier immédiatement**.

Cela inclut les décisions formulées comme :
- "pas maintenant"
- "phase ultérieure"
- "dormant"
- "legacy conservé"
- "dette acceptée"
- "à revalider plus tard"

---

## Vocabulaire de statuts

| Statut | Signification |
|--------|---------------|
| `deferred` | Reporté volontairement — sera traité plus tard |
| `deferred-high` | Reporté mais priorité haute — à traiter au prochain cycle |
| `dormant` | Conservé dans le code, pas d'appelant actif, pas de suppression prévue |
| `legacy` | Code ou modèle ancien, conservé par prudence |
| `watchlist` | À surveiller — pourrait devenir un problème |
| `pending_validation` | Nécessite une vérification avant action |
| `historical_note` | Information contextuelle archivée, pas d'action requise |
| `closed` | Résolu ou explicitement abandonné |

---

## Backlog

| ID | Sujet | Catégorie | Statut | Priorité | Phase | Date | Pourquoi non traité | Déclencheur de réouverture | Surface probable | Source | Vérification | Recommandation |
|----|-------|-----------|--------|----------|-------|------|---------------------|---------------------------|-----------------|--------|--------------|----------------|
| E1 | MASTER_CONTEXT.md référence `generate-case-outputs` (§Cockpit, §Fonctions dormantes) — supprimée en M26b | doc | deferred-high | Haute | M26b | 2026-03 | Pas exécuté après bilan final | Immédiat | `docs/MASTER_CONTEXT.md` | repo + chat | Confirmé | Corriger maintenant |
| E2 | SECURITY_CONTRACT.md référence `generate-case-outputs` (ligne 36, 74) | doc | deferred-high | Haute | M26b | 2026-03 | Idem E1 | Immédiat | `docs/SECURITY_CONTRACT.md` | repo + chat | Confirmé | Corriger maintenant |
| E3 | STATUS_REGISTRY.md référence `generate-case-outputs` comme writer HUMAN_REVIEW | doc | deferred-high | Haute | M26b | 2026-03 | Non identifié avant inventaire | Immédiat | `docs/STATUS_REGISTRY.md` | repo | Confirmé | Corriger maintenant |
| E4 | PHASE_15_NOTES.md référence `generate-case-outputs` dans config verify_jwt | doc | historical_note | Moyenne | M26b | 2026-03 | Document historique | Lors de prochaine relecture | `.lovable/PHASE_15_NOTES.md` | repo | Confirmé | Annoter comme historique |
| C1 | CaseView.tsx monolithique (2700+ lignes, 20+ useState, IIFEs) | dette | deferred | Haute | M27 | 2026-03 | Risque régression mais pas de bug actif | Prochain changement UX sur CaseView | `src/pages/CaseView.tsx` | chat M27 | Confirmé | Extraction progressive |
| B1 | Isolation multi-tenant (email_drafts CRUD ouvert, case-documents sans isolation) | sécurité | deferred | Moyenne | M23c | 2026-03 | Modèle mono-équipe suffisant | Ouverture multi-société | RLS `email_drafts`, storage `case-documents` | chat M23c | Confirmé | Phase M23c-fix si besoin |
| B2 | Données historiques `route_port = 'Dakar'` non corrigées rétroactivement | dette | legacy | Basse | M23b-fix | 2026-03 | Migration données risquée | Jamais (accepté) | `quotation_history` | chat M23b-fix | Confirmé | Garder dormant |
| A1 | Fin commerciale post-SENT (pas de ACCEPTED/REJECTED) | futur produit | deferred | Moyenne | M25 | 2026-03 | Ticket produit requis | Besoin commercial suivi post-envoi | Enum DB, FSM, CaseView | repo + chat | Confirmé | Ouvrir phase quand besoin |
| A2 | Statut ARCHIVED jamais écrit par le runtime | dormant | dormant | Basse | M25 | 2026-03 | Action manuelle future prévue | Besoin d'archivage | Enum DB, CaseView | repo | Confirmé | Garder dormant |
| A3 | Re-pricing après version (QUOTED_VERSIONED → re-priceable) | futur produit | deferred | Basse | M25 | 2026-03 | Choix produit assumé (irréversibilité) | Ticket produit dédié | `generate-quotation-version`, CaseView | repo | Confirmé | Garder tel quel |
| A4 | Emails de cotation IA (corps enrichi au lieu de template statique) | futur produit | deferred | Moyenne | M26 | 2026-03 | `generate-case-outputs` supprimée, capacité non migrée | Besoin d'emails plus intelligents | `create-quotation-email-draft` | repo + chat | Confirmé | Ajouter option IA au pipeline canonique |
| A5 | Persistance du rejet des suggestions dérivées | futur produit | dormant | Basse | M27 | 2026-03 | Acceptable avec 1 suggestion | ≥3 suggestions dérivées | CaseView, potentiellement table dédiée | repo | Confirmé | Garder dormant |
| A6 | Intégration SMTP réelle | futur produit | deferred | Conditionnelle | — | 2026-03 | Décision fondamentale "Pas d'auto-send" | Décision produit SMTP | Edge functions send-*, email_drafts | repo | Confirmé | Conditionnel |
| A7 | Filtrage lot-level demandes partenaires P1 Auto-EQ | dette | dormant | Basse | P1 | 2026-03 | Extension schéma quote_gaps nécessaire | Multi-lot mixte fréquent | `build-case-puzzle` (FROZEN) | repo | Confirmé | Garder dormant |
| C2 | Idempotence divergente entre 3 chemins learned_knowledge | dette | watchlist | Basse | M23a | 2026-03 | Pas un bug urgent | Volume élevé d'apprentissage auto | `learn-from-content`, `learn-quotation-puzzle`, `analyze-attachments` | chat M23a | Confirmé | Documenter |
| C3 | quotation_history à double usage (historique + comparaison) | dette | legacy | Basse | M23b | 2026-03 | Pas de scission envisagée | Jamais (accepté) | `quotation_history` | chat M23b | Confirmé | Garder tel quel |
| C4 | Idempotence P1 Auto-EQ applicative seulement (pas de UNIQUE DB) | dette | watchlist | Basse | P1 | 2026-03 | Mitigé par orchestration séquentielle | Re-runs concurrents fréquents | `build-case-puzzle` (FROZEN) | repo | Confirmé | Garder dormant |
| C5 | Fallback legacy multi-lot (raw_lines pré-M14b) | legacy | pending_validation | Basse | M14b | 2026-03 | Non validé en runtime | Cas legacy multi-lot en base | `export-quotation-version-pdf`, `create-quotation-email-draft` | repo | À revalider | Tester si cas apparaît |
| D1 | Scroll-to-section auto sur changement de statut | UX | deferred | Basse | M27 | 2026-03 | Polish non prioritaire | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| D2 | Actions clôturées collapsibles par défaut | UX | deferred | Basse | M27 | 2026-03 | Mineur | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| D3 | Panels visibles sans contenu (ExternalRequests en INTAKE) | UX | deferred | Basse | M27 | 2026-03 | Bruit visuel mineur | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| F1 | Audit P0 métier (précision cotation, 30-50 dossiers) | audit | pending_validation | Opérationnelle | — | 2026-03 | Protocole rédigé, attente dossiers réels | Dossiers réels disponibles | `AUDIT_METIER_P0_PROTOCOL.md`, `audit/p0/` | repo | Confirmé | Lancer quand dossiers prêts |
| F2 | Smoke test post-M24b (cargo.weight_kg = 22000) | audit | pending_validation | Opérationnelle | M24b | 2026-03 | Recommandé non confirmé exécuté | Prochain test réel | `run-pricing`, `quotation-engine` | chat M24b | À revalider | Exécuter sur prochain cas |
| S1 | Label `sent` EQ1 sémantiquement ambigu (devrait être draft_ready) | dette | watchlist | Basse | EQ1 | 2026-03 | Renommage coûteux | Ajout SMTP | `external_quote_requests`, STATUS_REGISTRY | repo | Confirmé | Conditionnel (si SMTP) |
| S2 | HUMAN_REVIEW dormant dans l'enum (jamais atteint canoniquement) | dormant | dormant | Basse | M25 | 2026-03 | Supporté défensivement | Jamais (conservé par design) | Enum DB, `generate-quotation-version` | repo | Confirmé | Garder dormant |

---

## Top priorités futures

| Rang | ID | Sujet | Valeur |
|------|----|-------|--------|
| 1 | E1+E2+E3 | Mise à jour docs — supprimer références `generate-case-outputs` | Cohérence doc/runtime immédiate |
| 2 | C1 | Extraction progressive CaseView.tsx | Réduction risque de régression |
| 3 | A4 | Emails de cotation IA | Valeur produit directe |
| 4 | A1 | Fin commerciale post-SENT | Complétude workflow métier |
| 5 | B1 | M23c-fix multi-tenant | Pré-requis ouverture multi-société |
| 6 | F1 | Audit P0 métier | Validation justesse tarifaire |
| 7 | F2 | Smoke test M24b | Confirmation fix facteur 1000x |
| 8 | A6 | Intégration SMTP | Automatisation envoi (si décision produit) |
| 9 | D1 | Scroll-to-section | UX polish à fort impact perçu |
| 10 | A3 | Re-pricing après version | Flexibilité opérateur |

---

## Éléments à revalider avant action

| ID | Sujet | Ce qu'il faut vérifier | Pourquoi |
|----|-------|----------------------|----------|
| F2 | Smoke test M24b | Exécuter pricing réel avec `cargo.weight_kg = 22000`, vérifier `inputs.cargoWeight = 22` | Aucune preuve d'exécution |
| E4 | PHASE_15_NOTES config | Vérifier si le document est encore consulté ou purement archivé | Si archivé, pas besoin de corriger |
| C5 | Fallback legacy multi-lot | Vérifier s'il existe des snapshots pré-M14b en base avec `lot_index`/`lot_label` dans `raw_lines` | Si aucun cas, le code est mort |

---

## Note méthodologique

Cet inventaire couvre les sources suivantes :
- **Repo** : `MASTER_CONTEXT.md`, `STATUS_REGISTRY.md`, `SECURITY_CONTRACT.md`, `PHASE_15_NOTES.md`, `DECISIONS.md`, `AUDIT_METIER_P0_PROTOCOL.md`, `.lovable/plan.md`, code runtime
- **Chats** : phases M18d → M27b (session de stabilisation complète)

Les sujets reportés dans des conversations antérieures (pré-M18d) qui n'auraient laissé aucune trace dans le code ou la documentation ne sont **pas** listés ici. Pour les capturer, fournir les résumés/prompts des anciens chats.
