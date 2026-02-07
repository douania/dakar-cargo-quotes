

# Correction de la recherche "usmani" -- Cause racine identifiee

## Le vrai probleme

Apres investigation approfondie des requetes reseau, le probleme est maintenant clair :

L'utilisateur tape "usmani" dans la **barre de recherche globale de la sidebar** (le composant `KnowledgeSearch`, accessible via Cmd+K). Ce composant cherche dans la table `learned_knowledge` via l'edge function `data-admin` -- il ne cherche **pas** dans les emails. Le resultat `[]` est donc normal.

Le champ de recherche qu'on a ajoute au Dashboard (celui avec l'icone loupe dans la zone des filtres) fait bien la bonne requete `.ilike()` sur les emails, mais ce n'est pas celui que l'utilisateur utilise.

**Preuve** : les logs reseau montrent un appel `POST data-admin` avec `{"action":"search","data":{"query":"usmani"}}` qui retourne `{"success":true,"results":[]}`. Aucune requete directe vers la table `emails` avec `or=` n'a ete faite.

## Solution

Modifier le composant `KnowledgeSearch` pour qu'il cherche aussi dans les **emails** (en plus des connaissances), afin que la recherche globale renvoie des resultats pertinents quel que soit le champ utilise.

### Modifications

**Fichier 1** : `src/components/KnowledgeSearch.tsx`

- Ajouter une requete parallele sur la table `emails` avec `.or().ilike()` sur `subject`, `from_address`, `body_text`, `body_html`
- Afficher les resultats emails dans un groupe separe ("Emails") avec une icone Mail
- Au clic sur un resultat email, naviguer vers `/quotation/{emailId}`

**Fichier 2** : `supabase/functions/data-admin/index.ts`

- Ajouter un nouveau case `search_emails` dans le switch, ou bien etendre le case `search` existant pour inclure aussi une recherche dans la table `emails`
- La recherche cote edge function (avec service role) contourne les RLS et garantit l'acces aux donnees

### Detail technique

#### Option retenue : etendre le case `search` de data-admin

Dans `data-admin/index.ts`, le case `search` (ligne 203) sera modifie pour chercher aussi dans `emails` :

```
case 'search': {
  // ... recherche existante dans learned_knowledge ...

  // NOUVEAU : recherche parallele dans emails
  const { data: emailResults } = await supabase
    .from('emails')
    .select('id, subject, from_address, received_at, is_quotation_request')
    .eq('is_quotation_request', true)
    .or(`subject.ilike.${searchQuery},from_address.ilike.${searchQuery},body_text.ilike.${searchQuery},body_html.ilike.${searchQuery}`)
    .order('received_at', { ascending: false })
    .limit(10);

  return { results, emails: emailResults || [] };
}
```

#### Dans KnowledgeSearch.tsx

- Ajouter un type `EmailSearchResult` pour les resultats email
- Recuperer `data?.emails` en plus de `data?.results`
- Ajouter un `CommandGroup` "Emails" qui affiche les resultats email
- Au clic, naviguer vers `/quotation/{email.id}`

### Comportement attendu

| Composant | Avant | Apres |
|---|---|---|
| Sidebar (Cmd+K) | Cherche uniquement dans learned_knowledge | Cherche dans learned_knowledge ET emails |
| Dashboard search | Cherche dans emails via ilike (fonctionne deja) | Inchange |
| Resultat "usmani" | 0 resultats | 1 email trouve (AB26065 // JEDDAH TO SENEGAL) |

### Impact

| Element | Valeur |
|---|---|
| Fichiers modifies | 2 (`KnowledgeSearch.tsx` + `data-admin/index.ts`) |
| Migration DB | Aucune |
| Risque | Faible -- ajout d'une requete parallele sans modifier l'existant |
| Performance | La requete ilike sur emails est legere (select sans body, limit 10) |

