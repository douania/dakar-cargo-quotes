

# Plan : Traçabilité du regroupement des emails dans loadThreadData

## Objectif

Ajouter un champ `source_type` à chaque email retourné par `loadThreadData` pour distinguer :
- **`thread_ref`** : emails SOURCE (métier, contractuels) — récupérés via `thread_ref.eq.${threadId}` ou `id.eq.${threadId}`
- **`subject_match`** : emails CONTEXTE (aide IA, historique) — ajoutés via `ilike("subject", "%...%")`

**Aucun changement fonctionnel** : même nombre d'emails analysés, même comportement IA.

---

## Analyse du code actuel

### Fichier cible
`supabase/functions/learn-quotation-puzzle/index.ts` — fonction `loadThreadData` (lignes 857-1028)

### Flux actuel (2 niveaux)

```text
┌─────────────────────────────────────────────────────────────────┐
│ NIVEAU 1 : Source (thread_ref strict)                          │
│ .or(`thread_ref.eq.${threadId},id.eq.${threadId}`)             │
│ → 19 emails pour le thread a4b63fbc...                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ NIVEAU 2 : Contexte (subject match)                            │
│ .ilike("subject", `%${normalizedSubject.substring(0, 50)}%`)   │
│ → +25 emails par sujet approché                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ RÉSULTAT : allEmails = 44 emails (sans distinction d'origine)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Modifications proposées

### 1. Définir le type `SourceType`

**Lignes 857-862** — Après la signature de fonction, ajouter un type pour la clarté :

```typescript
type EmailSourceType = 'thread_ref' | 'subject_match';

interface EnrichedEmail {
  id: string;
  from_address: string;
  to_addresses: string[];
  subject: string;
  body_text: string | null;
  body_html: string | null;
  sent_at: string;
  received_at: string;
  thread_ref: string | null;
  source_type: EmailSourceType;  // ← NOUVEAU
}
```

### 2. Marquer les emails SOURCE (Niveau 1)

**Lignes 877-882** — Après la première requête, enrichir avec `source_type: 'thread_ref'` :

```typescript
// Avant (ligne 882)
let allEmails = emails || [];

// Après
let allEmails: EnrichedEmail[] = (emails || []).map(e => ({
  ...e,
  source_type: 'thread_ref' as EmailSourceType
}));
```

### 3. Marquer les emails CONTEXTE (Niveau 2)

**Lignes 905-911** — Lors de l'ajout des emails par sujet, marquer `source_type: 'subject_match'` :

```typescript
// Avant
if (relatedEmails) {
  const existingIds = new Set(allEmails.map((e: { id: string }) => e.id));
  for (const email of relatedEmails) {
    if (!existingIds.has(email.id)) {
      allEmails.push(email);  // ← Pas de source_type
    }
  }
  // ...
}

// Après
if (relatedEmails) {
  const existingIds = new Set(allEmails.map(e => e.id));
  for (const email of relatedEmails) {
    if (!existingIds.has(email.id)) {
      allEmails.push({
        ...email,
        source_type: 'subject_match' as EmailSourceType  // ← MARQUAGE
      });
    }
  }
  // ...
}
```

### 4. Conserver le type dans le retour

**Ligne 1027** — Le retour reste identique, mais les emails sont maintenant enrichis :

```typescript
return { emails: allEmails, attachments: relevantAttachments };
// allEmails contient maintenant source_type sur chaque email
```

---

## Fichiers impactés

| Fichier | Lignes | Nature |
|---------|--------|--------|
| `supabase/functions/learn-quotation-puzzle/index.ts` | 857-916 | Enrichissement `source_type` |

---

## Bénéfices immédiats

| Bénéfice | Description |
|----------|-------------|
| **Auditabilité** | On sait exactement pourquoi chaque email est dans le puzzle |
| **Debug** | Logs peuvent afficher `X source + Y contexte` |
| **Évolutivité** | Permet de limiter le périmètre IA plus tard (ex: exclure contexte) |
| **Incrémental amélioré** | Possibilité future de ne tracker que les `thread_ref` dans `emails_analyzed_ids` |

---

## Ce qui ne change PAS

- Nombre d'emails analysés : identique
- Comportement de l'IA : identique
- Structure du puzzle final : identique
- Performance : négligeable (1 attribut string par email)

---

## Tests de validation

1. **Lancer une analyse puzzle** sur un thread avec sujet générique
2. **Vérifier dans les logs** : `[Puzzle] Thread has X emails (Y source, Z context)`
3. **Optionnel** : Ajouter un log explicite pour traçabilité

```typescript
const sourceCount = allEmails.filter(e => e.source_type === 'thread_ref').length;
const contextCount = allEmails.filter(e => e.source_type === 'subject_match').length;
console.log(`[Puzzle] Thread ${threadId}: ${sourceCount} source + ${contextCount} context emails`);
```

---

## Effort estimé

**~10 minutes** — Modification ciblée, aucun refactoring

