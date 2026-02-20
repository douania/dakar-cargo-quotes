

# Page d'administration des taux de change

## Probleme

La saisie des taux via le formulaire brut de la base de donnees est penible : il faut renseigner manuellement l'ID, les dates, et calculer soi-meme la date d'expiration. L'utilisateur veut une interface simple et rapide.

## Solution

Creer une page `/admin/exchange-rates` dediee avec un formulaire intelligent qui calcule automatiquement les dates de validite.

---

## 1. Nouvelle page `src/pages/admin/ExchangeRates.tsx`

Page admin suivant le pattern existant (comme TaxRates.tsx) avec :

### Tableau des taux existants
- Colonnes : Devise, Taux/XOF, Source, Valide du, Valide jusqu'au, Statut (actif/expire), Saisi par
- Badge vert/rouge pour indiquer si le taux est actuellement valide
- Tri par date de creation decroissante

### Formulaire d'ajout rapide (Dialog)

L'utilisateur saisit uniquement 3 champs :
- **Devise** : select parmi les devises courantes (USD, EUR, GBP, CNY, JPY) + saisie libre
- **Taux** : champ numerique (1 devise = ? XOF)
- **Periode de validite** : choix parmi 4 options
  - Quotidienne (expire ce soir 23:59 UTC)
  - Hebdomadaire (expire le jour choisi a 23:59 UTC) — avec un selecteur de jour de la semaine (Lundi a Dimanche, defaut : Mercredi)
  - Mensuelle (expire le dernier jour du mois en cours)
  - Annuelle (expire le 31 decembre de l'annee en cours)
  - Permanente (pour les taux fixes type EUR/BCEAO, expire en 2100)

Les champs auto-calcules (invisibles pour l'utilisateur) :
- `id` : genere par la base
- `valid_from` : now()
- `valid_until` : calcule selon la periode choisie
- `source` : pre-rempli "GAINDE" (modifiable)
- `updated_by` : user connecte
- `created_at` / `updated_at` : auto

## 2. Modification de `upsert-exchange-rate` (edge function)

Ajouter le support d'un parametre optionnel `valid_until` dans le body :
- Si `valid_until` est fourni : l'utiliser directement (au lieu de calculer le prochain mardi)
- Si absent : comportement actuel (prochain mardi 23:59 UTC, retrocompatible)

Cela permet a la page admin d'envoyer la date calculee cote frontend selon le choix de periode.

## 3. Ajout dans la navigation

- Ajouter l'entree "Taux de change" dans `AppSidebar.tsx` (section Administration)
- Ajouter la route `/admin/exchange-rates` dans `App.tsx`

## 4. Mise a jour de la modale PricingLaunchPanel

Adapter le body envoye a `upsert-exchange-rate` depuis la modale existante pour qu'il inclue aussi un choix de periode (par defaut : hebdomadaire/mercredi, qui correspond au cycle GAINDE actuel).

---

## Details techniques

### Calcul `valid_until` cote frontend

```text
function computeValidUntil(period, dayOfWeek?):
  - "daily"    → aujourd'hui 23:59:59 UTC
  - "weekly"   → prochain [dayOfWeek] 23:59:59 UTC
  - "monthly"  → dernier jour du mois courant 23:59:59 UTC
  - "yearly"   → 31 dec annee courante 23:59:59 UTC
  - "permanent"→ 2100-01-01T00:00:00Z
```

### Fichiers impactes

| Fichier | Action |
|---------|--------|
| `src/pages/admin/ExchangeRates.tsx` | Nouveau — page admin complete |
| `src/App.tsx` | Ajouter route `/admin/exchange-rates` |
| `src/components/AppSidebar.tsx` | Ajouter lien navigation |
| `supabase/functions/upsert-exchange-rate/index.ts` | Support `valid_until` optionnel |
| `src/components/puzzle/PricingLaunchPanel.tsx` | Ajout selecteur periode dans la modale |

### Ce qui ne change pas

- La table `exchange_rates` (pas de migration SQL)
- La fonction `get-active-exchange-rate`
- Le moteur `quotation-engine` et `resolveExchangeRate`
- La logique de cache `_rateCache`

