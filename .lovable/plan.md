

# Phase 8.7b — Correction Critère "Demandes à traiter"

## Objectif

Corriger la logique du Dashboard pour que seuls les emails avec un brouillon **envoyé** (`status === 'sent'`) soient considérés comme traités.

**Règle métier :**
- Brouillon `draft` = reste visible dans "Demandes à traiter"
- Brouillon `sent` = disparaît de "Demandes à traiter"

---

## Diagnostic

| État actuel | Problème |
|-------------|----------|
| Ligne 77-82 : Query `email_drafts` sans filtre `status` | Tout brouillon = traité |
| Ligne 86 : `processedEmailIds.has(email.id)` | Ignore l'état réel du dossier |

**Conséquence directe :** L'email ShareLogistics avec brouillon non envoyé a disparu.

---

## Modification

### Fichier : `src/pages/Dashboard.tsx`

### Changement 1 : Filtrer sur `status = 'sent'` (lignes 76-82)

**Avant :**
```typescript
// Get draft count for processed emails
const { data: drafts } = await supabase
  .from('email_drafts')
  .select('original_email_id')
  .not('original_email_id', 'is', null);
```

**Après :**
```typescript
// Get SENT drafts only - un brouillon non envoyé n'est PAS traité
const { data: sentDrafts } = await supabase
  .from('email_drafts')
  .select('original_email_id')
  .eq('status', 'sent')
  .not('original_email_id', 'is', null);
```

### Changement 2 : Renommer la variable pour clarté (ligne 82)

**Avant :**
```typescript
const processedEmailIds = new Set(drafts?.map(d => d.original_email_id) || []);
```

**Après :**
```typescript
const sentEmailIds = new Set(sentDrafts?.map(d => d.original_email_id) || []);
```

### Changement 3 : Utiliser le bon set dans le filtre (ligne 86)

**Avant :**
```typescript
.filter(email => !processedEmailIds.has(email.id))
```

**Après :**
```typescript
.filter(email => !sentEmailIds.has(email.id))
```

### Changement 4 : Mettre à jour les stats (ligne 107)

**Avant :**
```typescript
processed: processedEmailIds.size,
```

**Après :**
```typescript
processed: sentEmailIds.size,
```

---

## Impact

| Aspect | Évaluation |
|--------|------------|
| Risque | Nul — modification d'une condition de filtre |
| UX | Aligné avec Phase 8.7 — cohérence workflow |
| Performance | Identique (même requête, un filtre en plus) |
| Backend | Aucun changement |

---

## Résultat Attendu

| Scénario | "Demandes à traiter" |
|----------|----------------------|
| Email ShareLogistics + draft `draft` | **Visible** |
| Email avec draft `sent` | Masqué |
| Email sans draft | **Visible** |

L'email `bijl.dik@sharelogistics.com` réapparaîtra immédiatement dans la liste.

---

## Statistiques mises à jour

| Carte Stats | Signification |
|-------------|---------------|
| "En attente" | Emails quotation sans brouillon envoyé |
| "Traitées" | Emails avec brouillon `sent` |
| "Brouillons" | Inchangé (compte les drafts en cours) |

