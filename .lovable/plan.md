

# Plan correctif COM-2A — Fermeture propre

## 3 corrections ciblées, 3 fichiers

### 1. Sécuriser confirm — `supabase/functions/auto-match-partner-responses/index.ts`

**Problème** : La suggestion passe à `accepted` (L250-257) et la timeline est écrite (L262-277) AVANT l'appel à `analyze-partner-response` (L280-303). Si l'analyse échoue, la suggestion reste `accepted` sans vraie réponse EQ1.

**Correction** : Inverser l'ordre.

1. Appeler `analyze-partner-response` d'abord
2. Si succès (`analyzeResp.ok`) → passer la suggestion à `accepted`, écrire la timeline, retourner `ok: true`
3. Si échec → ne pas toucher la suggestion (reste `pending`), retourner `ok: false` avec message d'erreur et status 502

Concrètement : déplacer le bloc fetch (L280-303) avant le bloc update (L250-277), puis conditionner update+timeline sur `analyzeResp.ok`.

### 2. Afficher les suggestions rejetées — `src/components/puzzle/ExternalRequestsPanel.tsx`

**Problème** : La variable `rejected` (L385) est calculée mais jamais rendue dans le JSX. Seuls `pending` et `accepted` sont affichés.

**Correction** : Après le bloc `accepted.length > 0` (L443-447), ajouter un bloc discret pour `rejected` :
```
{rejected.length > 0 && (
  <div className="text-[10px] text-muted-foreground/60 px-1">
    {rejected.length} suggestion(s) rejetée(s)
  </div>
)}
```

### 3. Retirer les casts inutiles — `src/hooks/usePartnerSuggestions.ts`

**Problème** : `as any` (L31) et `as unknown as PartnerSuggestion[]` (L36) sont inutiles puisque `types.ts` contient déjà la table.

**Correction** :
- L31 : `.from("partner_response_suggestions" as any)` → `.from("partner_response_suggestions")`
- L36 : `(data || []) as unknown as PartnerSuggestion[]` → `(data || []) as PartnerSuggestion[]`

## Blast radius

| Fichier | Nature |
|---------|--------|
| `auto-match-partner-responses/index.ts` | Réordonnancement interne du confirm |
| `ExternalRequestsPanel.tsx` | +4 lignes JSX |
| `usePartnerSuggestions.ts` | Nettoyage de 2 casts |

Aucun autre fichier touché. Aucune zone FROZEN impactée. Aucune migration DB.

