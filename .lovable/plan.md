


# COCKPIT-11 — Extraction de scope fournisseur multi-postes (complet)

## Problème

L'application réduisait une demande client complexe (fret + origin charges + stuffing + surcharges) à un seul purpose générique. Le scope partenaire n'était pas structuré en amont.

## Correctif

### Phase 1 (zip 52) — Détection et affichage

- Nouveau helper `src/lib/partnerRequestScope.ts` : `derivePartnerRequestScope(facts, textSignal?)` → `PartnerScopeItem[]`
- Détection déterministe de 4 blocs : `freight_rate`, `origin_charges`, `stuffing_factory`, `stuffing_port_cfs`
- Garde-fou CTO : facts structurés = source primaire, texte email = signal complémentaire uniquement
- Nouveau composant `PartnerScopeCard.tsx` : lecture seule, affiche les blocs détectés avec confiance
- Templates enrichis : 2 nouveaux purposes (stuffing) synchronisés UI + edge

### Phase 2 (zip 53) — Branchement suggestions → scope

- `PartnerSuggestionPanel` importe et utilise `derivePartnerRequestScope`
- `derivePurpose()` prend le scope détecté comme source prioritaire via `scopePurposes: Set<string>`
- Hiérarchie de résolution : scope détecté → service_types → role/notes
- `threadId` passé en prop pour cohérence avec PartnerScopeCard
- Le brief prérempli utilise le purpose issu du scope détecté

### Phase 3 (zip 54) — COCKPIT-11B : Email partenaire scope-aware

- `buildPartnerEmailBody` accepte un paramètre optionnel `scope: PartnerScopeItem[]`
- Introduction reste centrée sur le purpose principal
- Bloc secondaire agrégé : "Merci également de préciser, si applicable :" avec items dédupliqués des autres blocs du scope
- Fallback prudent quand scope vide et purpose freight : ajoute THC, surcharges, vessel schedule
- PartnerSuggestionPanel passe le scope au préremplissage
- Synchronisation UI (`src/lib/partnerEmailTemplate.ts`) et edge (`_shared/partner-email-template.ts`)

## Blast radius

| Fichier | Changement |
|---------|-----------|
| `src/lib/partnerRequestScope.ts` | Nouveau helper métier |
| `src/components/puzzle/PartnerScopeCard.tsx` | Nouveau composant lecture seule |
| `src/lib/partnerEmailTemplate.ts` | +2 purposes (stuffing), paramètre `scope`, agrégation multi-blocs |
| `supabase/functions/_shared/partner-email-template.ts` | Synchronisation |
| `src/components/puzzle/ExternalRequestsPanel.tsx` | Intégration PartnerScopeCard + threadId prop |
| `src/components/puzzle/PartnerSuggestionPanel.tsx` | Branchement scope + derivePurpose enrichi + passage scope au template |

Aucune migration. Aucune zone FROZEN. Aucune mutation.
