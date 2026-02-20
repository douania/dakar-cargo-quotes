
# Affichage des gaps bloquants dans CaseView

## Probleme constate

La page CaseView affiche "Gaps: 0" (ligne 811) en lisant `caseData.gaps_count`, un compteur denormalise qui n'est mis a jour que par `build-case-puzzle`. En base, il existe pourtant 1 gap bloquant ouvert (`routing.transport_mode`) et 1 gap non-bloquant. L'operateur n'a aucune indication visuelle du blocage.

## Solution en 2 parties

### 1. Ajouter une requete directe sur `quote_gaps`

Ajouter un `useQuery` dans CaseView pour lire les gaps reels depuis la table `quote_gaps`, filtre sur `case_id`. Cela evite d'utiliser le hook `useQuoteCaseData` (qui fonctionne par `thread_id` et ferait un double fetch du case).

```text
const { data: gaps = [] } = useQuery({
  queryKey: ["case-gaps", caseId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("quote_gaps")
      .select("id, gap_key, gap_category, question_fr, is_blocking, status")
      .eq("case_id", caseId!)
      .eq("status", "open")
      .order("is_blocking", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  enabled: !!caseId,
  staleTime: 30000,
});
```

### 2. Modifier l'affichage

**Compteur Gaps (ligne 811)** : remplacer `caseData.gaps_count ?? 0` par `gaps.length` avec fallback :

```text
const displayedGapsCount = gaps.length || (caseData.gaps_count ?? 0);
```

Ajouter un badge rouge si des gaps bloquants existent.

**Bandeau d'alerte** : inserer entre la barre Info (ligne 825) et le panneau d'action (ligne 828). Si des gaps bloquants existent (`gaps.filter(g => g.is_blocking).length > 0`), afficher une `Alert` destructive listant chaque gap bloquant avec sa `question_fr`.

```text
{blockingGaps.length > 0 && (
  <Alert variant="destructive" className="mb-6">
    <AlertCircle className="h-4 w-4" />
    <AlertDescription>
      <p className="font-semibold mb-2">
        {blockingGaps.length} gap(s) bloquant(s)
      </p>
      <ul className="list-disc pl-4 space-y-1 text-sm">
        {blockingGaps.map(g => (
          <li key={g.id}>{g.question_fr || g.gap_key}</li>
        ))}
      </ul>
    </AlertDescription>
  </Alert>
)}
```

**Refresh** : ajouter `refetchGaps` dans `handleRefresh()` pour que le bandeau disparaisse apres resolution d'un gap.

## Section technique

### Fichier modifie : `src/pages/CaseView.tsx`

1. **Nouvelle query** (apres ligne 565) : `useQuery` sur `quote_gaps` avec `case_id`, filtre `status = 'open'`
2. **Variable derivee** : `const blockingGaps = gaps.filter(g => g.is_blocking);`
3. **Ligne 811** : remplacer `caseData.gaps_count ?? 0` par `gaps.length || (caseData.gaps_count ?? 0)` + badge rouge conditionnel
4. **Apres ligne 825** : inserer le bandeau `Alert` destructive
5. **Ligne 569** : ajouter `refetchGaps()` dans `handleRefresh`

### Aucune modification backend

Les donnees existent deja. Les RLS policies sur `quote_gaps` autorisent le SELECT pour les utilisateurs authentifies (`quote_gaps_select_team`).

### Garde-fous integres

- Fallback sur `caseData.gaps_count` si la query gaps echoue
- Guard `enabled: !!caseId` pour eviter les fetch invalides
- `staleTime: 30000` pour eviter les requetes excessives
- Le bandeau ne s'affiche que si `blockingGaps.length > 0` (pas de rendu inutile)
