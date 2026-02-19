

# Audit trail des faits dans CaseView

## Contexte

La vue dossier affiche uniquement les faits courants (`is_current = true`). Les versions precedentes sont en base (`is_current = false`) mais invisibles. L'operateur ne peut pas voir qui a change quoi, quand, ni l'ancienne valeur.

## Verification RLS

La policy `quote_facts_select_team` autorise `SELECT` pour tout utilisateur authentifie sans filtre sur `is_current`. Pas de blocage.

## Plan d'implementation

### Fichier unique : `src/pages/CaseView.tsx`

**1. Nouveaux imports**
- `Popover`, `PopoverTrigger`, `PopoverContent` depuis `@/components/ui/popover`
- `formatDistanceToNow` depuis `date-fns`
- `fr` depuis `date-fns/locale`
- `Clock` depuis `lucide-react`

**2. Helper `mapSourceType`**
```text
function mapSourceType(type: string): string {
  if (["manual_input","operator"].includes(type)) return "Operateur";
  if (type.startsWith("ai_")) return "IA";
  if (["document_regex","attachment_extracted"].includes(type)) return "Document";
  if (type === "hs_resolution") return "HS";
  if (type === "known_contact_match") return "Contact";
  if (type === "quotation_engine") return "Moteur";
  if (type.startsWith("email_")) return "Email";
  return type;
}
```

**3. Composant `FactHistoryPopover`**
- Props : `caseId`, `factKey`
- State interne : `history[]`, `isLoading`, `isOpen`
- Au clic (onOpenChange) : query lazy avec cache local (`useState<Record<string, any[]>>`)
- Query :
```text
SELECT id, value_text, value_number, value_json,
       source_type, confidence, created_at
FROM quote_facts
WHERE case_id = ? AND fact_key = ? AND is_current = false
ORDER BY created_at DESC
LIMIT 10
```
- Affichage dans Popover :
  - Titre "Historique"
  - Si vide : "Aucune version precedente"
  - Sinon : liste avec pour chaque entree :
    - Valeur : `value_text ?? (value_number != null ? String(value_number) : JSON.stringify(value_json))`
    - Badge source : `mapSourceType(source_type)`
    - Confiance : `confidence != null ? Math.round(confidence * 100) + "%" : "--"`
    - Date relative : `formatDistanceToNow(new Date(created_at), { addSuffix: true, locale: fr })`

**4. Integration dans la colonne Actions du tableau des faits**
- A cote du bouton Edit existant (ligne 965-974), ajouter le `FactHistoryPopover`
- Visible uniquement quand le fait n'est PAS en edition
- Pas de pre-query count : on charge au clic et on affiche "Aucune version" si vide (plus simple, moins de queries)

## Points de securite appliques

| Recommandation CTO | Implementation |
|---------------------|----------------|
| Query precise (pas SELECT *) | Oui, 7 colonnes nommees |
| Valeur falsy-safe | `??` au lieu de `\|\|` |
| Confiance null | Affiche "--" |
| Badge source robuste | Mapper couvrant tous les source_type connus |
| Date coherente | `formatDistanceToNow` avec locale fr |
| Cache local | `useState<Record<string, any[]>>` pour eviter re-fetch |
| RLS verifie | `quote_facts_select_team` ne filtre pas `is_current` |

## Ce qui ne change pas

- Aucune migration DB
- Aucune edge function
- Aucun impact sur le pricing, build-case-puzzle, ou run-pricing
- Le chargement principal des faits reste `is_current = true`

## Risque : zero

Ajout purement UI, lecture seule, lazy loading.

