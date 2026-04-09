

# COCKPIT-11 — Extraction de scope fournisseur multi-postes

## Problème

L'application réduisait une demande client complexe (fret + origin charges + stuffing + surcharges) à un seul purpose générique. Le scope partenaire n'était pas structuré en amont.

## Correctif

### Nouveau helper : `src/lib/partnerRequestScope.ts`

- `derivePartnerRequestScope(facts, textSignal?)` → `PartnerScopeItem[]`
- Détection déterministe de 4 blocs : `freight_rate`, `origin_charges`, `stuffing_factory`, `stuffing_port_cfs`
- Garde-fou CTO : facts structurés = source primaire, texte email = signal complémentaire uniquement

### Nouveau composant : `src/components/puzzle/PartnerScopeCard.tsx`

- Lecture seule, affiche les blocs détectés avec confiance (Élevée / Moyenne / Faible)
- Placé au-dessus de PartnerSuggestionPanel dans ExternalRequestsPanel

### Templates enrichis

- 2 nouveaux purposes : `stuffing_factory`, `stuffing_port_cfs`
- Ajoutés dans `src/lib/partnerEmailTemplate.ts` et `supabase/functions/_shared/partner-email-template.ts` (synchronisés)
- Ajoutés dans PURPOSE_OPTIONS (ExternalRequestsPanel) et PURPOSE_LABELS (PartnerSuggestionPanel)

## Blast radius

| Fichier | Changement |
|---------|-----------|
| `src/lib/partnerRequestScope.ts` | Nouveau helper métier |
| `src/components/puzzle/PartnerScopeCard.tsx` | Nouveau composant lecture seule |
| `src/lib/partnerEmailTemplate.ts` | +2 purposes (stuffing) |
| `supabase/functions/_shared/partner-email-template.ts` | Synchronisation |
| `src/components/puzzle/ExternalRequestsPanel.tsx` | Intégration PartnerScopeCard + 2 options purpose |
| `src/components/puzzle/PartnerSuggestionPanel.tsx` | +2 labels purpose |

Aucune migration. Aucune zone FROZEN. Aucune mutation.
