

# Plan — QQM Lot 1 + Lot 2 — Canonical Quote Qualification Model

## Statut : done (2026-04-16)

## Lot 1 — Documentation canonique (zero runtime)

Fichiers modifiés :
- `docs/MASTER_CONTEXT.md` — section « Quote qualification model (commercial) »
- `docs/STATUS_REGISTRY.md` — note de clarification qualification ≠ statut FSM
- `docs/DEFERRED_BACKLOG.md` — entrée QUOTE-QUALIFICATION-MODEL

## Lot 2 — Version snapshot

Fichier modifié :
- `supabase/functions/generate-quotation-version/index.ts`

Ajout additif dans `VersionSnapshot.meta` :
```typescript
quoteQualification: {
  level: "firm" | "provisional" | "partial";
  reasons: Array<{ code: string; message: string; field?: string }>;
  firmTotalPolicy: "all_included" | "excludes_reserved_items";
}
```

Fallback par défaut : `level: "firm"`, `reasons: []`, `firmTotalPolicy: "all_included"`.

## Confirmations

- Aucun comportement runtime modifié
- Aucune migration DB
- Aucun FROZEN touché
- Aucune logique produit altérée
- TypeScript typecheck vert (tsc --noEmit EXIT 0)
- Backward-compatible : anciennes versions sans ce champ restent implicitement firm
