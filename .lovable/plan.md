

# Plan : `extractCargoValueFromText` + bloc d'injection document_regex

## Fichier modifie

`supabase/functions/build-case-puzzle/index.ts`

## Modifications

### 1. Nouvelle fonction `extractCargoValueFromText` (apres `extractHsCodesFromText`, ~ligne 405)

Fonction deterministe qui scanne du texte ligne par ligne et extrait :
- `goodsValue` via "Sous-total HT" / "Sous total HT"
- `freightValue` via "Transport Export" / "Transport International"
- `totalValue` via "Montant HT" / "Total HT"
- `currency` via EUR/USD/XOF/FCFA

Points techniques :
- **Dernier montant de la ligne** (pas le premier) pour eviter de capter quantites/references
- **Parseur robuste** : gere `965 495,26` / `965'495.26` / `945995.26` (detection automatique separateur decimal)
- **Fallback derivation** : si `goodsValue` absent mais `totalValue` et `freightValue` presents → `goodsValue = totalValue - freightValue` (si > 0)

### 2. Nouveau bloc d'injection "cargo value doc-regex" (entre ligne 1643 et 1645)

Insere entre la fin du bloc HS email-regex et le debut de M3.5 multi-quote.

Logique :
1. Scanner tous les `caseDocuments[].extracted_text` avec `extractCargoValueFromText`
2. Garder le meilleur candidat (plus grand `goodsValue`)
3. Lire les 4 facts existants independamment :
   - `cargo.value` (source_type)
   - `cargo.value_currency`
   - `cargo.freight_cost`
   - `cargo.freight_currency`
4. Pour **chaque fact individuellement** :
   - Si `source_type = 'operator'` ou `'manual_input'` → skip ce fact seulement
   - Si `source_type = 'attachment_extracted'` → skip ce fact seulement
   - Si valeur existante identique (tolerance `< 0.01` pour numbers) → skip (idempotence)
   - Sinon → `supersede_fact` avec `source_type = 'document_regex'`, `confidence = 0.88`
5. Logger la source de decision : `goods_from_sous_total` / `goods_derived_total_minus_freight` / `freight_from_transport_export`

### Regle de selection du montant (confirmee par moteur)

```text
cargo.value       = goodsValue (Sous-total HT)
                    OU totalValue - freightValue (fallback)
                    JAMAIS totalValue directement

cargo.freight_cost = freightValue (Transport Export)
```

### Guards source priority (par fact, pas global)

Chaque fact est traite independamment. Exemple :
- `cargo.value` source = `operator` → skip cargo.value
- `cargo.freight_cost` source = vide → inject freight normalement

### Impact sur Taleb

| Fact | Avant | Apres |
|------|-------|-------|
| `cargo.value` | vide | 945995.26 |
| `cargo.value_currency` | vide | EUR |
| `cargo.freight_cost` | vide | 19500.00 |
| `cargo.freight_currency` | vide | EUR |

### Securite

- Zero migration, zero RPC change
- Source priority respectee (operator > attachment_extracted > document_regex)
- Idempotent (tolerance float 0.01)
- Logging complet pour debug

