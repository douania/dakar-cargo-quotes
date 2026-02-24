

# Phase C3.1 — Hotfix build-case-puzzle (AIR_IMPORT + HS email)

## Fichier unique modifie
`supabase/functions/build-case-puzzle/index.ts`

Aucune migration DB. Aucun changement UI/Dashboard/C3.

---

## Patch A — Flow override AIR_IMPORT (lignes 562-565)

**Avant** :
```typescript
if (flowType === 'UNKNOWN' && requestType === 'AIR_IMPORT') {
  flowType = 'AIR_IMPORT';
}
```

**Apres** :
```typescript
if (requestType === 'AIR_IMPORT' && flowType !== 'AIR_IMPORT') {
  console.log(`[M3.5.1] Flow override: ${flowType} -> AIR_IMPORT (requestType is AIR_IMPORT)`);
  flowType = 'AIR_IMPORT';
}
```

Garantit que `detectRequestType = AIR_IMPORT` n'est jamais ecrase par `IMPORT_PROJECT_DAP`.

---

## Patch B — Ajout `cargo.hs_code` au prompt IA (ligne 2021)

Ajouter apres `cargo.pieces_count` dans la liste des fact keys :
```
- cargo.hs_code (Harmonized System code, extract exact digits as stated e.g. 3002.12.00.10)
```

Le code HS mentionne dans l'email sera extrait par l'IA et passe au pipeline de validation existant.

---

## Patch C — HS regex sur les emails (apres ligne 1303)

Nouveau bloc `M3.4c` insere juste apres le bloc M3.4b (doc-regex) et avant le bloc "Regime evidence-based detection" (ligne 1305).

Logique :
1. Recharger le fact `cargo.hs_code` courant (peut avoir ete mis a jour par M3.4b)
2. Si deja un code 10 digits valide -> skip
3. Scanner chaque email du thread : `subject + extractPlainTextFromMime(body_text)`
4. `extractHsCodesFromText()` sur le texte concatene
5. `resolveSenegalHsCode()` pour chaque candidat, garder les `status === "unique"`
6. Deduplication par `code10`
7. Si exactement 1 code unique -> `supersede_fact` avec `source_type = "email_body"` (deja autorise par la contrainte DB)
8. Si multiple -> warning log, pas d'injection
9. Si zero -> info log

`source_type = "email_body"` est deja dans la contrainte `quote_facts_source_type_check` (migration existante). Pas de migration necessaire.

---

## Patch D — Garde HS vide avant validation post-attach (lignes 1560-1566)

**Avant** :
```typescript
if (hsFactRow) {
  const rawHsValue = hsFactRow.value_text || "";
  const digitsOnly = rawHsValue.replace(/\D/g, "");
  if (digitsOnly.length !== 10 || !(await isExactHsMatch(...))) {
    const hsResult = await resolveSenegalHsCode(serviceClient, rawHsValue);
    ...
```

**Apres** :
```typescript
if (hsFactRow) {
  const rawHsValue = (hsFactRow.value_text || "").trim();
  if (!rawHsValue) {
    console.warn("[HS Post-Attach] Empty cargo.hs_code — skipping validation, deactivating fact");
    await serviceClient.from("quote_facts")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("id", hsFactRow.id);
    factsUpdated++;
  } else {
    const digitsOnly = rawHsValue.replace(/\D/g, "");
    // ... reste de la logique existante inchangee
  }
}
```

Empeche le gap trompeur `Le code HS "" n'a pas pu etre valide`.

---

## Ordre d'implementation

1. Patch A (flow override) — 3 lignes
2. Patch B (HS dans prompt) — 1 ligne
3. Patch D (garde HS vide) — ~8 lignes
4. Patch C (HS regex emails) — ~45 lignes

## Ce qui ne change PAS

- Dashboard / C2.1 / C3
- Pipeline C1 emails
- UI CaseView / QuotationSheet
- Autres edge functions
- Schema DB / migrations / RLS

