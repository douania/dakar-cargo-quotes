

# Plan COCKPIT-2 — Garde-fous communication dans SendQuotationPanel

## Objectif

Avertir l'operateur avant marquage d'envoi si le dossier communication n'est pas "safe" : demandes partenaires non clôturées, faits partenaires non validés, clarifications client ouvertes. Avertissements visibles, pas blocage dur.

## Fichiers impactés (3 fichiers code + 2 docs)

### 1. `src/hooks/useSendQuotation.ts` — +25 lignes

Enrichir le `queryFn` avec 3 requêtes parallèles dans le step 1 existant :

```typescript
const [eqrResult, factsResult, gapsResult] = await Promise.all([
  supabase
    .from('external_quote_requests')
    .select('id, status, partner_name, purpose')
    .eq('case_id', caseId!)
    .neq('status', 'closed'),

  supabase
    .from('external_quote_response_facts')
    .select('id, fact_key, validation_status')
    .eq('case_id', caseId!)
    .eq('validation_status', 'proposed'),

  supabase
    .from('client_gap_requests')
    .select('id, gap_key, status')
    .eq('case_id', caseId!)
    .in('status', ['drafted', 'sent', 'answered']),
]);
```

Ajouter au type `SendQuotationData` et au retour du hook :
- `openPartnerRequests` — demandes EQ1 non clôturées (tout sauf `closed`)
- `pendingPartnerFacts` — faits partenaires `proposed`
- `openClientGaps` — clarifications client `drafted`, `sent` ou `answered`
- `hasCommunicationWarnings: boolean` — true si l'un des 3 est non-vide

`canSend` reste inchangé (pas de blocage dur).

### 2. `src/components/puzzle/SendQuotationPanel.tsx` — +40 lignes

Destructurer les nouveaux champs du hook. Après le bloc "Pré-vérifications" (ligne 206), ajouter un bloc conditionnel "Alertes communication" :

- Si `openPartnerRequests.length > 0` : alerte ambrée avec `AlertTriangle` — **"X demande(s) partenaire encore ouverte(s)"**
- Si `pendingPartnerFacts.length > 0` : alerte ambrée — **"X fait(s) partenaire en attente de validation"**
- Si `openClientGaps.length > 0` : alerte ambrée — **"X clarification(s) client non clôturée(s)"**

Style identique au warning PDF existant (amber background, `AlertTriangle` icon).

Dans le `AlertDialogDescription` (confirmation finale, ligne 392), ajouter un résumé des warnings si `hasCommunicationWarnings` est true, pour que l'opérateur voie le rappel au moment du clic final.

### 3. Documentation — 2 fichiers

- `docs/DEFERRED_BACKLOG.md` : ajouter entrée COCKPIT-2 en `DONE` avec date, périmètre, et filtres exacts utilisés
- `docs/MASTER_CONTEXT.md` : ajouter section COCKPIT-2 dans la zone COM, mentionnant les garde-fous et la doctrine "warning, pas blocage"

## Blast radius

| Fichier | Lignes ajoutées |
|---------|----------------|
| `useSendQuotation.ts` | ~25 |
| `SendQuotationPanel.tsx` | ~40 |
| `DEFERRED_BACKLOG.md` | ~15 |
| `MASTER_CONTEXT.md` | ~10 |

Aucune migration DB. Aucune zone FROZEN. Pipeline EQ1 intact. `canSend` inchangé.

