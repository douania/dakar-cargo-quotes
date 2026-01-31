
# Correction P0 – Écart consolidation.ts

## Écart identifié

**Fichier** : `src/features/quotation/utils/consolidation.ts`
**Lignes** : 121-123

**Problème** : Logique de formatage du nom expéditeur dupliquée inline au lieu d'utiliser `getEmailSenderName` depuis `parsing.ts`.

```typescript
// ❌ Code actuel (lignes 121-123)
const senderName = senderEmail.split('@')[0]
  .replace(/[._-]/g, ' ')
  .replace(/\b\w/g, l => l.toUpperCase());
```

---

## Corrections à appliquer

### 1. Ajouter l'import (ligne 7)

**Avant :**
```typescript
import { decodeBase64Content, parseSubject, parseEmailBody } from './parsing';
```

**Après :**
```typescript
import { decodeBase64Content, parseSubject, parseEmailBody, getEmailSenderName } from './parsing';
```

---

### 2. Remplacer la logique inline (lignes 119-123)

**Avant :**
```typescript
const senderEmail = firstEmail.from_address.toLowerCase();
const senderDomain = senderEmail.split('@')[1]?.split('.')[0]?.toUpperCase() || '';
const senderName = senderEmail.split('@')[0]
  .replace(/[._-]/g, ' ')
  .replace(/\b\w/g, l => l.toUpperCase());
```

**Après :**
```typescript
const senderEmail = firstEmail.from_address.toLowerCase();
const senderDomain = senderEmail.split('@')[1]?.split('.')[0]?.toUpperCase() || '';
const senderName = getEmailSenderName(firstEmail.from_address);
```

---

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `src/features/quotation/utils/consolidation.ts` | Import + remplacement logique inline |

---

## Validation post-correction

- [ ] Build TypeScript OK
- [ ] Ouverture cotation existante OK
- [ ] Pré-remplissage IDENTIQUE
- [ ] `originalRequestor.name` correctement formaté

---

## Message de clôture attendu

```
Correction P0 appliquée.
Import getEmailSenderName ajouté.
Logique inline supprimée.
Build OK.
Étape 2 conforme au plan validé.
En attente du GO pour l'étape suivante.
```
