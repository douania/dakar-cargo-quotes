

# Phase DASHBOARD-SEARCH — Ajout de la recherche sur "Demandes a traiter"

## Diagnostic

L'email de "Bilal Usmani" (sujet: AB26065 // JEDDAH TO SENEGAL) existe bien en base, est marque `is_quotation_request = true`, et n'a pas de brouillon envoye. Il devrait donc apparaitre dans la liste du Dashboard.

Le probleme : **la page "Demandes a traiter" n'a aucun champ de recherche textuelle**. Elle affiche les 50 derniers emails de type cotation tries par date ou completude, sans possibilite de filtrer par nom, sujet ou expediteur. La recherche globale (palette de commandes) ne cherche que dans les routes/commandes de l'application, pas dans le contenu des emails.

Si l'email n'apparait pas visuellement, c'est probablement parce qu'il est au-dela de la limite de 50 resultats (`LIMIT 50` dans la requete).

## Solution proposee

Ajouter un champ de recherche textuelle dans le Dashboard qui filtre cote client parmi les emails deja charges, ET qui augmente la couverture de la requete.

### Modifications (1 seul fichier)

**Fichier** : `src/pages/Dashboard.tsx`

1. **Ajouter un etat `searchQuery`** pour stocker le texte de recherche
2. **Ajouter un champ `Input`** avec une icone de recherche a cote du selecteur de tri existant
3. **Filtrer `sortedRequests`** en appliquant un filtre textuel sur `subject`, `from_address` et `body_text` (insensible a la casse)
4. **Augmenter la limite** de 50 a 100 pour couvrir plus d'emails

### Detail technique

```text
Nouveau state :
  const [searchQuery, setSearchQuery] = useState('');

Filtre applique avant le tri :
  const filteredRequests = sortedRequests.filter(r => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.subject?.toLowerCase().includes(q) ||
      r.from_address?.toLowerCase().includes(q) ||
      r.body_text?.toLowerCase().includes(q)
    );
  });

Champ de recherche dans la zone Filter & Sort :
  <Input
    placeholder="Rechercher par nom, sujet..."
    value={searchQuery}
    onChange={e => setSearchQuery(e.target.value)}
    className="w-[250px]"
  />
  (avec icone Search de lucide-react)
```

### Impact

| Element | Valeur |
|---|---|
| Fichier modifie | `src/pages/Dashboard.tsx` uniquement |
| Lignes ajoutees | ~15 lignes |
| Migration DB | Aucune |
| Edge Functions | Aucune modification |
| Risque | Aucun — filtrage purement cote client |

