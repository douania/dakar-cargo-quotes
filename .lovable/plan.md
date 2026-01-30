
# Plan de refactor – Phase 1 (sécurisée)

## Contexte et objectifs

Ce plan vise à préparer une refactorisation incrémentale du frontend de Dakar Cargo Quotes, sans casser l'existant. L'objectif est de réduire la dette technique identifiée lors de l'audit, en commençant par les zones à risque maximal.

### Fichiers critiques identifiés

| Fichier | Lignes | Risque | Problèmes |
|---------|--------|--------|-----------|
| `src/pages/QuotationSheet.tsx` | 2312 | **P0** | Monolithe avec types, parsing, logique métier, UI, appels API mélangés |
| `src/pages/admin/Emails.tsx` | 1504 | **P1** | Types locaux, logique de filtrage, gestion d'état complexe |
| `src/pages/CaseView.tsx` | 386 | **P2** | Appels Railway, affichage JSON brut |
| `src/pages/Intake.tsx` | 298 | **P2** | Appels Railway, structure simple |

---

## Clarification Railway vs Supabase

### Qui gère quoi

| Backend | Responsabilités | Fichiers concernés |
|---------|-----------------|-------------------|
| **Supabase** | Emails, threads, knowledge, tarifs, drafts, attachments | `emailService.ts`, `QuotationSheet.tsx`, `Emails.tsx` |
| **Railway** | Intake (analyse complexité), Workflow (CaseView), Truck loading | `Intake.tsx`, `CaseView.tsx`, `truckLoadingService.ts` |

### Priorité d'abstraction

1. **Railway** : Créer `src/services/railwayApi.ts` pour centraliser les appels vers `API_BASE`
2. **Supabase** : Déjà partiellement abstrait via `emailService.ts`, mais `QuotationSheet.tsx` fait des appels directs

---

## Ordre STRICT des refactors

### Etape 1 : Préparation (safe, sans impact UI)

**Objectif** : Centraliser les types et constantes sans modifier le comportement

| Action | Fichiers concernés | Risque | Critère de validation |
|--------|-------------------|--------|----------------------|
| 1.1 Créer `src/features/quotation/types.ts` | Nouveau fichier | Nul | Fichier compile sans erreur |
| 1.2 Extraire les 12 interfaces de `QuotationSheet.tsx` (lignes 61-179) | `QuotationSheet.tsx` → `types.ts` | Faible | Imports fonctionnent, pas de régression UI |
| 1.3 Créer `src/features/quotation/constants.ts` | Nouveau fichier | Nul | Export réussi |
| 1.4 Extraire `containerTypes`, `incoterms`, `serviceTemplates`, `INTERNAL_DOMAINS`, `OFFER_KEYWORDS` (lignes 181-224) | `QuotationSheet.tsx` → `constants.ts` | Faible | Constantes accessibles partout |
| 1.5 Créer `src/services/railwayApi.ts` | Nouveau fichier | Nul | Compilation OK |
| 1.6 Migrer les appels Railway de `Intake.tsx` et `CaseView.tsx` | 2 fichiers | Faible | Fonctionnalité identique |

**Signaux d'alerte (rollback)** :
- Erreur TypeScript lors de la compilation
- Perte de données dans les formulaires existants

---

### Etape 2 : Extraction logique (sans changement fonctionnel)

**Objectif** : Isoler les fonctions de parsing et de logique métier

| Action | Fichiers concernés | Risque | Critère de validation |
|--------|-------------------|--------|----------------------|
| 2.1 Créer `src/features/quotation/utils/parsing.ts` | Nouveau fichier | Nul | Compile |
| 2.2 Extraire `decodeBase64Content`, `isInternalEmail`, `containsOfferKeywords`, `detectOfferType` (lignes 227-282) | `QuotationSheet.tsx` → `parsing.ts` | Moyen | Tests unitaires passent |
| 2.3 Extraire `parseSubject`, `parseEmailBody` (lignes 358-537) | `QuotationSheet.tsx` → `parsing.ts` | Moyen | Extraction correcte sur emails réels |
| 2.4 Créer `src/features/quotation/utils/consolidation.ts` | Nouveau fichier | Nul | Compile |
| 2.5 Extraire `consolidateThreadData`, `extractRegulatoryInfo`, `normalizeSubject` (lignes 285-655) | `QuotationSheet.tsx` → `consolidation.ts` | **Elevé** | Consolidation thread identique |
| 2.6 Créer `src/features/quotation/utils/detection.ts` | Nouveau fichier | Nul | Compile |
| 2.7 Extraire `detectQuotationOffers`, `extractAllRegulatoryInfo` (lignes 839-930) | `QuotationSheet.tsx` → `detection.ts` | Moyen | Détection offres fonctionnelle |

**Signaux d'alerte (rollback)** :
- Données consolidées différentes de l'original
- Parsing incorrect sur les emails de production

---

### Etape 3 : Découpage composants

**Objectif** : Réduire `QuotationSheet.tsx` de 2312 à moins de 600 lignes

| Action | Fichiers concernés | Risque | Critère de validation |
|--------|-------------------|--------|----------------------|
| 3.1 Créer `src/features/quotation/components/ProjectContextCard.tsx` | Nouveau composant | Faible | Affichage identique |
| 3.2 Extraire la carte "Contexte projet" (lignes 1700-1850) | `QuotationSheet.tsx` | Moyen | Formulaire fonctionne |
| 3.3 Créer `src/features/quotation/components/CargoLinesEditor.tsx` | Nouveau composant | Moyen | CRUD cargo lines OK |
| 3.4 Extraire la gestion des lignes cargo (lignes 1850-1980) | `QuotationSheet.tsx` | Moyen | Ajout/suppression fonctionne |
| 3.5 Créer `src/features/quotation/components/ServiceLinesEditor.tsx` | Nouveau composant | Moyen | CRUD service lines OK |
| 3.6 Extraire la gestion des services (lignes 2025-2115) | `QuotationSheet.tsx` | Moyen | Tarifs s'affichent |
| 3.7 Créer `src/features/quotation/components/ThreadTimeline.tsx` | Nouveau composant | Faible | Timeline cliquable |
| 3.8 Extraire la timeline d'emails (lignes 1550-1700) | `QuotationSheet.tsx` | Faible | Navigation emails OK |
| 3.9 Créer `src/features/quotation/hooks/useQuotationForm.ts` | Nouveau hook | **Elevé** | Etat synchronisé |
| 3.10 Migrer les 15 useState vers le hook centralisé | `QuotationSheet.tsx` | **Elevé** | Pas de perte d'état |

**Signaux d'alerte (rollback)** :
- Formulaire ne se pré-remplit plus
- Perte de données lors de la navigation

---

## Ciblage prioritaire de QuotationSheet.tsx

### Parties à extraire EN PREMIER (safe)

1. **Types et interfaces** (lignes 61-179) - Aucun risque
2. **Constantes** (lignes 181-224) - Aucun risque
3. **Fonctions pures de parsing** (lignes 227-282) - Testables isolément

### Parties à NE SURTOUT PAS toucher au début

1. **fetchThreadData** (lignes 710-837) - Logique critique de chargement
2. **applyConsolidatedData** (lignes 932-998) - Pré-remplissage formulaire
3. **handleGenerateResponse** (lignes 1294-1328) - Appel API génération
4. **Le JSX principal** (lignes 1376-2312) - Trop risqué sans extraction préalable

### Objectif de réduction

| Phase | Lignes cibles | Contenu extrait |
|-------|---------------|-----------------|
| Après Etape 1 | ~2100 lignes | Types et constantes (-212 lignes) |
| Après Etape 2 | ~1500 lignes | Parsing et consolidation (-600 lignes) |
| Après Etape 3 | ~400 lignes | Composants et hook (-1100 lignes) |

---

## Stratégie de centralisation des types

### Types à extraire EN PREMIER

```text
src/features/quotation/types.ts
├── CargoLine
├── ServiceLine
├── ProjectContext
├── ExtractedData (email)
├── ThreadEmail
├── ConsolidatedData
├── Suggestion
├── Alert
├── QuotationOffer
└── RegulatoryInfo
```

### Emplacement cible

```text
src/
├── features/
│   ├── quotation/
│   │   ├── types.ts          (types cotation)
│   │   ├── constants.ts      (constantes métier)
│   │   ├── utils/
│   │   │   ├── parsing.ts
│   │   │   ├── consolidation.ts
│   │   │   └── detection.ts
│   │   ├── components/
│   │   │   ├── ProjectContextCard.tsx
│   │   │   ├── CargoLinesEditor.tsx
│   │   │   ├── ServiceLinesEditor.tsx
│   │   │   └── ThreadTimeline.tsx
│   │   └── hooks/
│   │       └── useQuotationForm.ts
│   └── emails/
│       └── types.ts          (types emails - à créer)
├── services/
│   ├── emailService.ts       (existant)
│   ├── railwayApi.ts         (à créer)
│   └── knowledgeService.ts   (existant)
└── types/
    └── index.ts              (types partagés - existant)
```

### Stratégie anti-régression

1. **Export/Import par alias** : `import type { CargoLine } from '@/features/quotation/types'`
2. **Re-export temporaire** dans l'ancien fichier pour la transition
3. **Supprimer les re-exports** seulement quand tous les imports sont migrés

---

## Checklist de GO / NO-GO

### Avant Etape 1 (Préparation)

| Condition | Statut requis |
|-----------|--------------|
| Build actuel fonctionne | Vert |
| Tests manuels Dashboard/QuotationSheet OK | Vert |
| Commit de référence tagué | Fait |

### Avant Etape 2 (Extraction logique)

| Condition | Statut requis |
|-----------|--------------|
| Etape 1 complète sans régression | Vert |
| Types importés correctement partout | Vert |
| Aucune erreur TypeScript | Vert |
| Test manuel : ouvrir 3 emails différents dans QuotationSheet | OK |

### Avant Etape 3 (Découpage composants)

| Condition | Statut requis |
|-----------|--------------|
| Etape 2 complète | Vert |
| Fonctions de parsing testées sur emails réels | OK |
| Consolidation thread identique à l'original | Vérifié |
| Test : créer une cotation complète de bout en bout | OK |

### Signaux d'alerte = ROLLBACK immédiat

- Formulaire QuotationSheet ne charge plus les données email
- Pré-remplissage des champs cassé
- Génération de réponse échoue
- Navigation entre emails du thread ne fonctionne plus
- Erreur TypeScript bloquante

---

## Section technique : Détail des extractions

### Etape 1.2 - Extraction des interfaces

Les interfaces suivantes seront déplacées vers `src/features/quotation/types.ts` :

- `CargoLine` (lignes 61-73)
- `ServiceLine` (lignes 75-83)
- `ProjectContext` (lignes 85-95)
- `ExtractedData` (lignes 97-111)
- `ThreadEmail` (lignes 113-124)
- `ConsolidatedData` (lignes 126-144)
- `Suggestion` (lignes 146-151)
- `Alert` (lignes 153-157)
- `QuotationOffer` (lignes 159-168)
- `RegulatoryInfo` (lignes 170-179)

### Etape 1.4 - Extraction des constantes

Les constantes suivantes seront déplacées vers `src/features/quotation/constants.ts` :

- `containerTypes` (lignes 181-189)
- `incoterms` (ligne 191)
- `serviceTemplates` (lignes 193-201)
- `INTERNAL_DOMAINS` (ligne 204)
- `OFFER_KEYWORDS` (lignes 207-224)

### Etape 1.5 - Création de railwayApi.ts

Le nouveau service centralisera les appels vers Railway :

- `fetchCaseFile(caseId)` - depuis CaseView.tsx ligne 87
- `runWorkflow(caseId)` - depuis CaseView.tsx ligne 108
- `createIntake(data)` - depuis Intake.tsx ligne 63

### Etape 2 - Fonctions à extraire

Vers `src/features/quotation/utils/parsing.ts` :
- `decodeBase64Content` (lignes 227-242)
- `isInternalEmail` (lignes 244-248)
- `containsOfferKeywords` (lignes 250-254)
- `detectOfferType` (lignes 256-282)
- `parseSubject` (lignes 358-417)
- `parseEmailBody` (lignes 419-537)

Vers `src/features/quotation/utils/consolidation.ts` :
- `extractRegulatoryInfo` (lignes 285-356)
- `consolidateThreadData` (lignes 539-645)
- `normalizeSubject` (lignes 647-655)

Vers `src/features/quotation/utils/detection.ts` :
- `detectQuotationOffers` (lignes 839-902)
- `extractAllRegulatoryInfo` (lignes 904-930)

---

## Résumé exécutif

Le refactor Phase 1 se décompose en 3 étapes séquentielles, chacune validée avant de passer à la suivante. L'objectif final est de réduire `QuotationSheet.tsx` de 2312 lignes à moins de 600 lignes, tout en maintenant une fonctionnalité identique.

**Durée estimée** : 3-4 sessions de développement
**Risque global** : Modéré si les validations sont respectées
**Bénéfice attendu** : Maintenabilité x3, testabilité des fonctions métier, évolutivité

