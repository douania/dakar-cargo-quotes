

# Afficher les dossiers Intake sur le Dashboard

## Probleme

Le Dashboard (`/`) ne montre que les emails avec `is_quotation_request = true`.
Les dossiers crees via Intake (upload de documents) sont des `quote_cases` sans email associe.
Resultat : l'operateur ne voit pas ses dossiers Intake dans le Dashboard.

## Solution

Ajouter une section "Dossiers en cours" au Dashboard qui liste les `quote_cases` actifs, independamment de leur origine (email ou Intake).

## Modifications

### 1. Dashboard.tsx -- Ajouter la section "Dossiers en cours"

**Nouveau query** : Recuperer les `quote_cases` avec statuts actifs (tous sauf `SENT` et `ARCHIVED`).

```text
SELECT id, thread_id, status, request_type, priority, 
       puzzle_completeness, created_at, updated_at
FROM quote_cases
WHERE status NOT IN ('SENT', 'ARCHIVED')
ORDER BY updated_at DESC
LIMIT 50
```

**Nouveau composant inline** : une liste de cartes cliquables affichant :
- Statut du dossier (badge colore)
- Type de demande (request_type)
- Completude du puzzle (barre de progression)
- Date de creation / derniere mise a jour
- Bouton "Ouvrir" qui navigue vers `/case/{id}`

**Placement** : Entre les stats cards et la liste des emails, avec un titre "Dossiers en cours" et une icone `FileText`.

### 2. Composant CaseCard (inline dans Dashboard)

Carte minimaliste pour chaque `quote_case` :
- Badge statut avec couleur semantique (ambre pour FACTS_PARTIAL/NEED_INFO, bleu pour READY_TO_PRICE, vert pour PRICED_DRAFT)
- Affichage du `request_type` si disponible
- Barre de completude `puzzle_completeness`
- Dates formatees en francais
- Click -> navigation vers `/case/{id}`

## Section technique

### Query Supabase (dans fetchData)

Ajout d'un appel parallele dans `fetchData()` :

```text
const { data: cases } = await withTimeout(
  supabase
    .from('quote_cases')
    .select('id, thread_id, status, request_type, priority, puzzle_completeness, created_at, updated_at')
    .not('status', 'in', '(SENT,ARCHIVED)')
    .order('updated_at', { ascending: false })
    .limit(50)
);
```

### State additionnel

```text
const [activeCases, setActiveCases] = useState<QuoteCaseData[]>([]);
```

### Mapping des statuts vers couleurs

```text
NEW_THREAD       -> gris
RFQ_DETECTED     -> bleu clair
FACTS_PARTIAL    -> ambre
NEED_INFO        -> orange
READY_TO_PRICE   -> bleu
PRICING_RUNNING  -> bleu anime
PRICED_DRAFT     -> vert
HUMAN_REVIEW     -> violet
QUOTED_VERSIONED -> vert fonce
```

### Stats mise a jour

Ajouter dans les stats cards un nouveau compteur "Dossiers actifs" ou integrer le count dans "En attente".

## Fichiers concernes

| Fichier | Action |
|---------|--------|
| `src/pages/Dashboard.tsx` | MODIFIER -- ajouter query quote_cases + section UI |

## Impact

- Zero migration SQL (les tables existent deja, RLS en place)
- Zero nouveau fichier (tout inline dans Dashboard)
- Pas de modification des autres pages
- Compatible avec les dossiers existants et futurs

