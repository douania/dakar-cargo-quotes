

# Étape 2 – Extraction parsing (mode sécurisé) – Plan corrigé final

## Résumé des corrections intégrées

| Correction | Impact |
|------------|--------|
| **P0** | Suppression des constantes 181-224 + import depuis `constants.ts` |
| **P1** | `normalizeSubject` → `consolidation.ts` (pas `parsing.ts`) |
| **Option A** | `getEmailSenderName` autorisée pour `parsing.ts` |

---

## 1. Fichier à créer : `src/features/quotation/utils/parsing.ts`

### Fonctions à extraire (copie identique)

| Fonction | Lignes source | Signature exacte |
|----------|---------------|------------------|
| `decodeBase64Content` | 227-242 | `(content: string \| null): string` |
| `isInternalEmail` | 245-248 | `(email: string): boolean` |
| `containsOfferKeywords` | 251-254 | `(body: string): boolean` |
| `detectOfferType` | 257-282 | `(email: ThreadEmail): 'container' \| 'breakbulk' \| 'combined' \| null` |
| `parseSubject` | 359-417 | `(subject: string \| null): Partial<ConsolidatedData>` |
| `parseEmailBody` | 420-537 | `(body: string \| null): Partial<ConsolidatedData>` |
| `getEmailSenderName` | 1344-1348 | `(email: string): string` |

### Imports requis

```typescript
import { INTERNAL_DOMAINS, OFFER_KEYWORDS, incoterms } from '../constants';
import type { ThreadEmail, ConsolidatedData } from '../types';
```

---

## 2. Fichier à créer : `src/features/quotation/utils/consolidation.ts`

### Fonctions à extraire (copie identique)

| Fonction | Lignes source | Signature exacte |
|----------|---------------|------------------|
| `extractRegulatoryInfo` | 285-356 | `(body: string): RegulatoryInfo` |
| `normalizeSubject` | 648-655 | `(subject: string \| null): string` |
| `consolidateThreadData` | 540-645 | `(emails: ThreadEmail[]): ConsolidatedData` |

### Imports requis

```typescript
import type { ThreadEmail, ConsolidatedData, RegulatoryInfo } from '../types';
import { decodeBase64Content, parseSubject, parseEmailBody } from './parsing';
```

---

## 3. Fichier à créer : `src/features/quotation/utils/detection.ts`

### Fonctions à extraire (copie identique)

| Fonction | Lignes source | Signature exacte |
|----------|---------------|------------------|
| `detectQuotationOffers` | 839-902 | `(emails: ThreadEmail[], allAttachments: Array<{...}>): QuotationOffer[]` |
| `extractAllRegulatoryInfo` | 904-930 | `(emails: ThreadEmail[]): RegulatoryInfo` |

### Imports requis

```typescript
import type { ThreadEmail, QuotationOffer, RegulatoryInfo } from '../types';
import { isInternalEmail, decodeBase64Content, containsOfferKeywords, detectOfferType, getEmailSenderName } from './parsing';
import { extractRegulatoryInfo } from './consolidation';
```

---

## 4. Modifications dans `QuotationSheet.tsx`

### A. Imports à ajouter

```typescript
// Constantes depuis le fichier centralisé
import { containerTypes, incoterms, serviceTemplates, INTERNAL_DOMAINS, OFFER_KEYWORDS } from '@/features/quotation/constants';

// Types depuis le fichier centralisé (pour usage inline si nécessaire)
import type { 
  CargoLine, 
  ServiceLine, 
  ProjectContext, 
  ExtractedData, 
  ThreadEmail, 
  ConsolidatedData, 
  Suggestion, 
  Alert, 
  QuotationOffer, 
  RegulatoryInfo 
} from '@/features/quotation/types';

// Utilitaires de parsing
import { 
  decodeBase64Content,
  isInternalEmail,
  containsOfferKeywords,
  detectOfferType,
  parseSubject,
  parseEmailBody,
  getEmailSenderName
} from '@/features/quotation/utils/parsing';

// Utilitaires de consolidation
import { 
  extractRegulatoryInfo,
  normalizeSubject,
  consolidateThreadData 
} from '@/features/quotation/utils/consolidation';

// Utilitaires de détection
import { 
  detectQuotationOffers,
  extractAllRegulatoryInfo 
} from '@/features/quotation/utils/detection';
```

### B. Suppressions requises

| Lignes | Contenu à supprimer |
|--------|---------------------|
| 61-179 | Types/Interfaces locaux (remplacés par import) |
| 181-224 | Constantes locales (remplacées par import) |
| 227-242 | `decodeBase64Content` |
| 245-248 | `isInternalEmail` |
| 251-254 | `containsOfferKeywords` |
| 257-282 | `detectOfferType` |
| 285-356 | `extractRegulatoryInfo` |
| 359-417 | `parseSubject` |
| 420-537 | `parseEmailBody` |
| 540-645 | `consolidateThreadData` |
| 648-655 | `normalizeSubject` |
| 839-902 | `detectQuotationOffers` (dans le composant) |
| 904-930 | `extractAllRegulatoryInfo` (dans le composant) |
| 1344-1348 | `getEmailSenderName` (dans le composant) |

---

## 5. Ordre d'exécution

1. Créer `src/features/quotation/utils/parsing.ts` avec les 7 fonctions listées
2. Créer `src/features/quotation/utils/consolidation.ts` avec les 3 fonctions listées
3. Créer `src/features/quotation/utils/detection.ts` avec les 2 fonctions listées
4. Modifier `QuotationSheet.tsx` :
   - Ajouter tous les imports (constantes, types, utilitaires)
   - Supprimer les définitions locales des types (61-179)
   - Supprimer les définitions locales des constantes (181-224)
   - Supprimer les définitions locales des fonctions extraites
5. Build TypeScript
6. Test manuel

---

## 6. Réduction attendue

| Avant | Après | Lignes supprimées |
|-------|-------|-------------------|
| 2312 lignes | ~1650 lignes | ~662 lignes |

**Détail :**
- Types : 119 lignes
- Constantes : 44 lignes
- Fonctions module : 409 lignes
- Fonctions composant : 90 lignes

---

## 7. Validation obligatoire

- [ ] `npm run build` sans erreur TypeScript
- [ ] Ouverture d'une cotation existante OK
- [ ] Pré-remplissage des champs IDENTIQUE
- [ ] Détection d'offres IDENTIQUE (bandeau vert "Cotation réalisée")
- [ ] Génération de réponse OK
- [ ] Navigation dans le thread OK

---

## 8. Signaux d'alerte (ROLLBACK)

- Erreur TypeScript bloquante
- Formulaire ne charge plus les données email
- Pré-remplissage des champs cassé
- Détection d'offres ne fonctionne plus
- Génération de réponse échoue

---

## 9. Fichiers modifiés (récapitulatif)

| Fichier | Action |
|---------|--------|
| `src/features/quotation/utils/parsing.ts` | CRÉER |
| `src/features/quotation/utils/consolidation.ts` | CRÉER |
| `src/features/quotation/utils/detection.ts` | CRÉER |
| `src/pages/QuotationSheet.tsx` | MODIFIER (suppressions + imports) |

---

## Message de clôture attendu

```
Étape 2 exécutée conformément au plan corrigé.
Aucun ajout, aucune modification de signature, aucune amélioration.
Build OK.
En attente du GO pour l'étape suivante.
```

