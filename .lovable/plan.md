

# Plan : 2 fixes critiques + 2 hardenings M3.4c

Deux bugs runtime confirmes dans le bloc M3.4c actuel, plus deux hardenings optionnels. Aucun changement de logique metier.

---

## Fix critique #1 — Params RPC manquants (L1664-1675)

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`

La signature SQL de `supersede_fact` attend `p_source_email_id` et `p_source_attachment_id`. L'appel actuel ne les passe pas, ce qui peut provoquer une erreur RPC runtime.

Ajouter dans l'appel `serviceClient.rpc("supersede_fact", {...})` :

```typescript
p_source_email_id: null,
p_source_attachment_id: null,
```

## Fix critique #2 — event_type invalide (L1683)

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`

Le CHECK constraint `case_timeline_events_event_type_check` autorise ces valeurs :

```
case_created, status_changed, fact_added, fact_updated, fact_superseded,
gap_identified, gap_resolved, gap_waived, pricing_started, pricing_completed,
pricing_failed, output_generated, human_approved, human_rejected, sent, archived,
email_received, email_sent, attachment_analyzed, clarification_sent,
manual_action, status_rollback, fact_insert_failed, document_uploaded,
fact_injected_manual
```

`fact_injected_from_document` n'est PAS dans cette liste → insert silencieusement rejecte.

Remplacer L1683 :
```typescript
event_type: "fact_updated",
```

## Hardening A — Deduplication articles (L1663)

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`

Si plusieurs `case_documents` contiennent les memes lignes facture, les articles sont doubles. Ajouter un `Set` de cle composite avant le push dans la boucle d'extraction (vers L1640-1660) :

```typescript
const seen = new Set<string>();
// dans la boucle, avant extracted.push(...):
const dedupKey = `${hsAligned}|${value}|${description || ""}`;
if (seen.has(dedupKey)) continue;
seen.add(dedupKey);
```

## Hardening B — Cap 50 articles (L1663)

Coherent avec la validation serveur P2-D (set-case-fact max 50).

Avant l'appel supersede_fact :
```typescript
if (extracted.length > 50) extracted.length = 50;
```

---

## Resume des modifications

| Fichier | Ligne(s) | Type | Description |
|---------|----------|------|-------------|
| `build-case-puzzle/index.ts` | 1664-1675 | **Fix critique** | Ajouter `p_source_email_id: null, p_source_attachment_id: null` |
| `build-case-puzzle/index.ts` | 1683 | **Fix critique** | Remplacer event_type par `fact_updated` |
| `build-case-puzzle/index.ts` | ~1640-1660 | Hardening | Deduplication via Set composite |
| `build-case-puzzle/index.ts` | ~1663 | Hardening | Cap 50 articles |

Un seul fichier modifie. Zero impact sur la logique metier, le moteur, ou les composants UI.

