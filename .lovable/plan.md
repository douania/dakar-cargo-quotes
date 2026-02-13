

# Correctif LCL - 2 bugs restants apres deploiement

## Etat actuel (confirme par test curl)

L'appel direct a `build-case-puzzle` retourne maintenant `request_type: SEA_LCL_IMPORT` -- la detection fonctionne. Mais 2 problemes persistent :

| Probleme | Cause racine | Preuve |
|---|---|---|
| `service.package` reste `DAP_PROJECT_IMPORT` | `applyAssumptionRules` utilise `flowType` de `detectFlowType()` qui retourne `IMPORT_PROJECT_DAP` (car Dakar = SN), pas le `requestType` `SEA_LCL_IMPORT`. Le mapping vers `SEA_LCL_IMPORT` dans `ASSUMPTION_RULES` n'est jamais utilise. | Reponse curl : `flowType: IMPORT_PROJECT_DAP`, `skipped: 2` |
| Aucun fact injecte depuis les PJ | `injectAttachmentFacts` retourne `added: 0, skipped: 0, updated: 0` malgre 2 attachments avec `codes_hs`, `valeur_caf`, etc. Cause probable : un probleme dans le parcours des cles ou un filtrage silencieux. | Reponse curl : `attachment_facts: {added: 0}` |

---

## Action 1 — Forcer flowType = SEA_LCL_IMPORT quand requestType est LCL

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`, fonction `applyAssumptionRules`

Ligne ~459, ajouter apres le bloc AIR_IMPORT :

```text
// A1 bis: If flowType is IMPORT_PROJECT_DAP but requestType is SEA_LCL_IMPORT, force LCL
if (flowType === 'IMPORT_PROJECT_DAP' && requestType === 'SEA_LCL_IMPORT') {
  flowType = 'SEA_LCL_IMPORT';
}
```

Cela garantit que le `SEA_LCL_IMPORT` dans `ASSUMPTION_RULES` est utilise, et que `service.package = LCL_IMPORT_DAP` est injecte (en remplacement de `DAP_PROJECT_IMPORT`).

Le meme pattern existe deja pour `AIR_IMPORT` (ligne 457), c'est donc coherent avec l'architecture.

---

## Action 2 — Ajouter du logging diagnostic dans injectAttachmentFacts

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`, fonction `injectAttachmentFacts`

Ajouter des logs pour tracer :
- Nombre d'attachments charges
- Pour chaque attachment : les cles parcourues
- Pour chaque cle : si mapping trouve ou non
- Si skip, la raison (source protegee, deja injectee)

Cela permettra de diagnostiquer pourquoi `added: 0` malgre des donnees PJ valides.

De plus, ajouter un log special avant la boucle pour montrer la structure exacte de `extractedInfo` :

```text
console.log(`[M3.4] Processing attachment ${attachment.filename}: keys=${Object.keys(extractedInfo).join(',')}`);
```

---

## Action 3 — Gerer le cas ou `extractedInfo` contient des cles imbriquees

Certaines cles comme `quantites` ou `descriptions` sont des arrays d'objets complexes. Le code actuel fait `if (rawValue == null || rawValue === '') continue;` mais un array non-vide ne sera pas filtre. Par contre, si `normalizeExtractedKey` ne trouve pas de mapping pour ces cles, elles seront simplement ignorees — ce qui est correct.

Le vrai risque est que `Object.entries(extractedInfo)` sur un objet Supabase JSONB retourne des entries inattendues. Ajoutons un guard :

```text
if (typeof extractedInfo !== 'object' || extractedInfo === null) continue;
```

(Ce guard existe deja ligne 616 mais verifions qu'il n'y a pas de probleme de type.)

---

## Resume

| Action | Impact | Fichier |
|---|---|---|
| 1. Mapper flowType LCL | `service.package = LCL_IMPORT_DAP` | build-case-puzzle |
| 2. Logging diagnostic PJ | Comprendre le zero injection | build-case-puzzle |
| 3. Guard structure | Robustesse | build-case-puzzle |

Apres deploiement, relancer l'analyse sur le dossier Lantia et verifier :
1. `service.package` = `LCL_IMPORT_DAP`
2. Facts PJ injectes (HS codes, valeur CIF)
3. Logs visibles dans les edge function logs

