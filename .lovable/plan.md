

# Phase DASHBOARD-SEARCH-V2 — Recherche serveur pour les demandes

## Diagnostic approfondi

L'email "usmani" existe en base, est marque `is_quotation_request = true`, contient "usmani" dans `body_text` ET `body_html`, et se situe dans le top 100 par date. La requete Supabase retourne bien un statut 200.

Le probleme reel : **la reponse de la requete est trop volumineuse**. Avec 100 emails contenant chacun `body_text` (~70 Ko) et `body_html` (~100 Ko), la reponse atteint environ **17 Mo**. Cela cause probablement :
- Un timeout du `withTimeout()` avant que toutes les donnees soient recues
- Ou une troncature silencieuse des champs texte volumineux

## Solution : double approche

### 1. Ne plus charger body_text/body_html dans la requete de liste

La liste du Dashboard n'affiche jamais le contenu du body. Ces champs sont charges inutilement et alourdissent la reponse.

**Fichier** : `src/pages/Dashboard.tsx`

Retirer `body_text` et `body_html` du `.select()` initial :

```text
Avant :  .select('id, subject, from_address, received_at, body_text, body_html, extracted_data, thread_id')
Apres :  .select('id, subject, from_address, received_at, extracted_data, thread_id')
```

### 2. Recherche serveur-side via ilike quand un terme est saisi

Quand `searchQuery` n'est pas vide, effectuer une **seconde requete** filtree cote serveur avec `.or()` sur `subject`, `from_address`, `body_text` et `body_html` :

```text
supabase
  .from('emails')
  .select('id, subject, from_address, received_at, extracted_data, thread_id')
  .eq('is_quotation_request', true)
  .or(`subject.ilike.%${q}%,from_address.ilike.%${q}%,body_text.ilike.%${q}%,body_html.ilike.%${q}%`)
  .order('received_at', { ascending: false })
  .limit(50)
```

### 3. Debounce de la recherche

Ajouter un debounce de 400ms pour eviter de lancer une requete a chaque frappe.

### Detail des modifications

**Fichier unique** : `src/pages/Dashboard.tsx`

1. Retirer `body_text` et `body_html` du select principal (alleger la reponse de ~17 Mo a ~500 Ko)
2. Retirer `body_text` et `body_html` de l'interface `QuotationRequest` (plus necessaires)
3. Ajouter un etat `searchResults` et `isSearching` pour la recherche serveur
4. Ajouter un `useEffect` avec debounce qui lance une requete serveur quand `searchQuery` change
5. Afficher `searchResults` au lieu de `filteredRequests` quand une recherche est active
6. Garder le filtre client-side sur `subject` et `from_address` pour le filtrage instantane sur ces champs visibles

### Comportement attendu

| Action | Comportement |
|---|---|
| Page chargee sans recherche | Affiche les 100 derniers emails (leger, sans body) |
| Saisie dans le champ recherche | Apres 400ms, requete serveur avec ilike sur 4 champs |
| Resultats trouves | Affiche les emails correspondants |
| Effacement du champ | Retour a la liste complete |

### Impact

| Element | Valeur |
|---|---|
| Fichier modifie | `src/pages/Dashboard.tsx` uniquement |
| Taille reponse initiale | ~17 Mo vers ~500 Ko |
| Migration DB | Aucune |
| Edge Functions | Aucune |
| Risque | Tres faible — les requetes ilike sont nativement supportees par PostgREST |
