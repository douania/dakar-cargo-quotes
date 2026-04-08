# COCKPIT-10 — Email partenaire professionnel : DONE ✅

## Problème corrigé
Les briefs partenaires généraient un "résumé de dossier" au lieu d'une vraie demande de cotation professionnelle prête à envoyer.

## Approche
Template déterministe partagé entre UI et edge function, avec variations par purpose.

## Fichiers créés
| Fichier | Rôle |
|---------|------|
| `src/lib/partnerEmailTemplate.ts` | Template professionnel côté UI |
| `supabase/functions/_shared/partner-email-template.ts` | Template professionnel côté edge (synchronisé) |

## Fichiers modifiés
| Fichier | Nature |
|---------|--------|
| `PartnerSuggestionPanel.tsx` | Import du template partagé, query enrichie (+final_destination, +fcl_lcl) |
| `send-external-quote-request/index.ts` | purpose_detail prioritaire si non vide, sinon fallback template déterministe |

## Règles appliquées
1. **purpose_detail prioritaire** : si non vide → source opérateur ; sinon → template déterministe
2. **Variations par purpose** : intro + bloc "merci d'inclure" adaptés (freight_rate, origin_charges, air_tariff…)
3. **Ambiguïtés prudentes** : destinations multiples signalées "à confirmer"
4. **Logique synchronisée** : structure, ordre des blocs et variations identiques entre UI et edge function

## Blast radius
- 2 fichiers créés (helpers)
- 2 fichiers modifiés (UI + edge function)
- Aucune migration
- Aucune zone FROZEN
- Aucune mutation de données
