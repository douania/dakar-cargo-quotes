
# Corrections CTO Phase 8.8 — Merge Final

## Contexte

Le CTO a validé Phase 8.8 sur le fond mais exige 4 corrections techniques et de gouvernance avant le merge définitif. Ces corrections sécurisent l'implémentation sans en modifier l'architecture.

---

## Correction #1 — `verify_jwt = true` (CRITIQUE)

### Problème Identifié
Dans `supabase/config.toml` ligne 124 :
```toml
[functions.qualify-quotation-minimal]
verify_jwt = false
```

### Risque
- N'importe qui peut appeler l'IA avec un `thread_id` arbitraire
- Faille de confidentialité grave (accès aux emails clients)

### Correction
Modifier `supabase/config.toml` ligne 124 :
```toml
[functions.qualify-quotation-minimal]
verify_jwt = true
```

### Fichier
`supabase/config.toml` — ligne 124

---

## Correction #2 — Garde-fou "NO SIDE EFFECT" explicite

### Problème Identifié
Le commentaire en tête de fichier mentionne la règle mais il n'y a pas de garde-fou contractuel explicite dans le code.

### Correction
Ajouter un commentaire CTO explicite après la création du client Supabase (ligne 129) :

```typescript
// ⚠️ CTO RULE: NO supabase.from(...).insert/update/delete ALLOWED HERE
// This function is READ-ONLY: emails + quote_cases + quote_gaps SELECT only
```

### Fichier
`supabase/functions/qualify-quotation-minimal/index.ts` — après ligne 129

---

## Correction #3 — `can_proceed` forcé à `false`

### Problème Identifié
L'interface `QualifyMinimalResult` (ligne 45) contient :
```typescript
can_proceed: boolean;
```

Dans le fallback (ligne 267), il est calculé dynamiquement :
```typescript
can_proceed: existingGaps.length === 0,
```

### Risque
Un développeur Phase 9 pourrait utiliser ce champ pour débloquer automatiquement une cotation.

### Correction
1. Modifier l'interface pour documenter la contrainte (ligne 45) :
```typescript
can_proceed: false; // CTO: Pricing is NEVER allowed in Phase 8.8
```

2. Forcer à `false` dans le fallback (ligne 267) :
```typescript
can_proceed: false, // CTO: ALWAYS false in Phase 8.8 regardless of completeness
```

3. Ajouter une validation avant le return final pour écraser toute valeur IA :
```typescript
// CTO RULE: Force can_proceed to false - Phase 8.8 is qualification only, NOT pricing
result.can_proceed = false;
```

### Fichier
`supabase/functions/qualify-quotation-minimal/index.ts` — lignes 45, 267, et avant ligne 272

---

## Correction #4 — ClarificationPanel 100% lecture seule

### Analyse du Composant Actuel

**Actions présentes :**
| Action | Type | Backend Mutation |
|--------|------|------------------|
| `handleCopy` | Clipboard API | ❌ Non |
| `onClose` | Callback UI | ❌ Non |
| `setLanguage` | État local | ❌ Non |
| `setShowAmbiguities` | État local | ❌ Non |

**Verdict : Le composant est DÉJÀ 100% lecture seule.** Aucun appel Supabase, aucune mutation.

### Correction
Ajouter un commentaire CTO explicite en tête de fichier pour verrouiller contractuellement :

```typescript
/**
 * Phase 8.8 — Panneau de clarification léger
 * 
 * CTO RULE: This panel NEVER triggers any backend mutation
 * ❌ No supabase calls
 * ❌ No status changes
 * ❌ No email sending
 * ✅ Copy to clipboard only (manual operator action)
 * 
 * ...
 */
```

### Fichier
`src/components/puzzle/ClarificationPanel.tsx` — lignes 1-9

---

## Résumé des Modifications

| Fichier | Modification | Lignes |
|---------|--------------|--------|
| `supabase/config.toml` | `verify_jwt = true` | 124 |
| `qualify-quotation-minimal/index.ts` | Commentaire NO WRITE | après 129 |
| `qualify-quotation-minimal/index.ts` | `can_proceed` forcé false | 45, 267, avant 272 |
| `ClarificationPanel.tsx` | Commentaire CTO read-only | 1-9 |

---

## Impact

- **Sécurité** : JWT vérifié, accès emails protégé
- **Intégrité** : Aucune écriture DB possible
- **Gouvernance** : Pas de déblocage automatique pricing
- **Traçabilité** : Commentaires CTO pour audits futurs

---

## Résultat Attendu

Après ces 4 corrections, Phase 8.8 sera :
- ✅ Sécurisée (JWT obligatoire)
- ✅ Stateless (aucune écriture)
- ✅ Non-décisionnelle (`can_proceed` toujours false)
- ✅ UI passive (copie manuelle uniquement)

Phase 8.8 pourra alors être considérée comme **clôturée et stable**.
