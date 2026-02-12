

# Phase V4.1.6b — Corriger la contrainte CHECK sur quote_service_pricing.source

## Diagnostic

La table `quote_service_pricing` a une contrainte CHECK qui n'autorise que 4 valeurs :
- `internal`, `official`, `historical`, `fallback`

Or le pricing engine ecrit des valeurs comme :
- `business_rule` (nouvelle regle EMPTY_RETURN)
- `catalogue_sodatra`
- `local_transport_rate`
- `customs_tier`
- `customs_weight_tier`
- `client_override`
- `no_match`
- `missing_quantity`
- `port_tariffs:DPW:...`

Toutes ces ecritures echouent silencieusement (le code catch l'erreur et log un warning `audit_write_failed`). Ce n'est pas bloquant pour le pricing lui-meme (les tarifs sont retournes au frontend), mais l'audit trail est perdu.

## Solution

### Etape 1 : Migration SQL — Elargir la contrainte CHECK

Supprimer l'ancienne contrainte et la remplacer par une version elargie qui couvre toutes les sources utilisees par le pricing engine :

```sql
ALTER TABLE quote_service_pricing
  DROP CONSTRAINT quote_service_pricing_source_check;

ALTER TABLE quote_service_pricing
  ADD CONSTRAINT quote_service_pricing_source_check
  CHECK (source IN (
    'internal',
    'official',
    'historical',
    'fallback',
    'business_rule',
    'catalogue_sodatra',
    'local_transport_rate',
    'customs_tier',
    'customs_weight_tier',
    'client_override',
    'no_match',
    'missing_quantity',
    'port_tariffs'
  ));
```

Note : pour les sources prefixees comme `port_tariffs:DPW:THC`, on peut soit :
- Stocker uniquement `port_tariffs` dans la colonne source et le detail dans une colonne metadata/explanation
- Ou remplacer la contrainte CHECK par un pattern regex (moins propre)

Recommandation : **Stocker la valeur canonique** (`port_tariffs`) et garder le detail dans `explanation`.

### Etape 2 : Adapter l'edge function pour les sources prefixees

Fichier : `supabase/functions/price-service-lines/index.ts`

Dans la section d'ecriture audit (la ou `quote_service_pricing` est insere), normaliser la source avant insertion :

```typescript
// Normaliser la source pour la contrainte CHECK
function normalizeSourceForAudit(source: string): string {
  if (source.startsWith('port_tariffs')) return 'port_tariffs';
  if (source.startsWith('rate_card')) return 'internal';
  return source;
}
```

### Etape 3 : Deployer l'edge function mise a jour

Redeployer `price-service-lines` pour que la regle `EMPTY_RETURN` et la normalisation source soient actives.

## Fichiers impactes

| Fichier | Modification |
|---|---|
| Migration SQL | DROP + ADD CONSTRAINT (2 lignes) |
| `supabase/functions/price-service-lines/index.ts` | Normalisation source avant audit write (~5 lignes) |

## Resultat attendu

1. L'audit trail s'ecrit correctement pour toutes les sources
2. Le warning `audit_write_failed` disparait des logs
3. La regle EMPTY_RETURN = 0 fonctionne et est tracee en base
4. Relancer le pricing donne les bons resultats

## Validation

1. Relancer le pricing sur le dossier c627ed62
2. Verifier dans les logs edge function : pas de warning `audit_write_failed`
3. Verifier dans la table `quote_service_pricing` que les lignes sont inserees avec les bonnes sources
4. Verifier dans l'UI que "Retour conteneur vide" = 0 FCFA
