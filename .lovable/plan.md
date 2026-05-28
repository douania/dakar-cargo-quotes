
# HAPAG-OP-TYPE-IMPORT-PROMOTION-1 — Plan SELECT-only

Mode Plan / SELECT-only. Aucune écriture, migration, patch, smoke. Portée stricte : `carrier_billing_templates` / `carrier='HAPAG_LLOYD'`.

---

## 1. État live HAPAG_LLOYD (12 lignes)

| charge_code | op_type | method | amount | currency | evidence | active | base_ref | id |
|---|---|---|---|---|---|---|---|---|
| **COLL** | ALL | PERCENTAGE | 3.5 | XOF | validated_internal | ✅ | `seafreight_collection` | `f53be9c6…` |
| **DOC** (Destination Documentation Fee) | ALL | PER_BL | 18 000 | XOF | validated_internal | ✅ | null | `4fa72e59…` |
| **MNF** (Manifest Fee) | ALL | PER_BL | 145 000 | XOF | validated_internal | ✅ | null | `15b24168…` |
| TBL | ALL | PER_BL | 2 000 | XOF | to_confirm | ❌ | null | `6fbec233…` |
| THO | ALL | PER_TONNE | null | XOF | historical_only | ❌ | T01-T14/P01-P05 | `c7b7ca06…` |
| PSX_20 | EXPORT | PER_CNT | 4 500 | XOF | validated_internal | ✅ | null | `9b3e74e0…` |
| PSX_40 | EXPORT | PER_CNT | 9 000 | XOF | validated_internal | ✅ | null | `ac8435b4…` |
| EDO | IMPORT | PER_TEU | 15 000 | XOF | validated_internal | ✅ | null | `816d5e9f…` |
| ETD_20 | IMPORT | PER_CNT | 90 000 | XOF | validated_internal | ✅ | null | `5b1610a9…` |
| ETD_40 | IMPORT | PER_CNT | 150 000 | XOF | validated_internal | ✅ | null | `49b66178…` |
| TXI | IMPORT | PER_BL | 25 000 | XOF | validated_internal | ✅ | null | `d78a7756…` |
| XAO | IMPORT | PER_TEU | 4 500 | XOF | validated_internal | ✅ | null | `0b97e149…` |

Remarque codes : le DB utilise **`DOC`**, **`MNF`**, **`COLL`** (pas les alias PDF `DDF` / `MFD` / `CFF`). Mapping confirmé via `charge_name` + `default_amount`.

---

## 2. Comparaison PDF officiel vs DB (lignes op=ALL ciblées)

| Code DB | charge_name | Référence PDF Hapag-Lloyd SN Mar2026 | Montant PDF | Montant DB | Match |
|---|---|---|---|---|---|
| DOC | Destination Documentation Fee | **DDF** Destination Documentation Fee, import @ DKR | 18 000 XOF / BL | 18 000 / BL | ✅ exact |
| MNF | Manifest Fee | **MFD** Manifest Fee, import @ DKR | 145 000 XOF / BL | 145 000 / BL | ✅ exact |
| COLL | Collection Fee | **CFF** Collection Fee on Seafreight | 3.5 % seafreight | 3.5 % | ✅ exact mais formule |

DOC et MNF sont sans ambiguïté des frais **destination/import** au PDF (perçus à Dakar sur l'arrivée). Aucune ligne export équivalente n'existerait avec ces noms → pas de risque de double comptage en cas de promotion IMPORT.

---

## 3. Classification par ligne

| Code | Décision | Justification |
|---|---|---|
| **DOC** | **PROMOTE_TO_IMPORT** | PDF = destination/import, montant exact, méthode PER_BL supportée par engine, déjà `validated_internal`, base évidente (1 BL). Promotion sûre. |
| **MNF** | **PROMOTE_TO_IMPORT** | PDF = manifest import à destination, montant exact, PER_BL supportée. Scope import confirmé (manifest perçu à Dakar). Promotion sûre. |
| **COLL** | **FORMULA_DEFERRED** (NO TOUCH) | `calculation_method=PERCENTAGE`. `quotation-engine` (switch L1580-1603) ne gère pas `PERCENTAGE` → default-case renverrait **3.5 XOF flat**. Même vulnérabilité structurelle que `ONE.COLL` traitée par ONE-COLL-SAFETY-1. Garder `op=ALL` est en réalité une protection runtime par exclusion. Promotion = NO-GO tant que `HAPAG-COLL-FORMULA-1` n'est pas livré (ajout case PERCENTAGE moteur + base de calcul). Conforme à l'interdiction CTO. |
| TBL | KEEP_DORMANT / INACTIVE_OK | `is_active=false`, `to_confirm`, source insuffisante. Hors scope ticket. |
| THO | INACTIVE_OK | `historical_only`, désactivé pour double-comptage `port_tariffs.THD`. Hors scope ticket. |
| PSX_20/40 | (hors scope) | EXPORT only. Interdiction CTO de toucher. |
| EDO, ETD_20/40, TXI, XAO | (déjà IMPORT runtime) | Déjà consommés. Aucune action. |

**Aucun port-dues / port-tax / THD / THO / XPV / PSX n'est reclassé.**

---

## 4. SQL data-only proposé (NON exécuté)

2 UPDATE ciblés par id, transactionnels, ROW_COUNT=1 garanti par ligne.

```sql
BEGIN;

-- ─── HAPAG.DOC : ALL → IMPORT ──────────────────────────────────
DO $$
DECLARE rc int;
BEGIN
  UPDATE public.carrier_billing_templates
     SET operation_type = 'IMPORT',
         notes = COALESCE(notes, '')
              || ' [HAPAG-OP-TYPE-IMPORT-PROMOTION-1] Promotion ALL→IMPORT : '
              || 'DDF Destination Documentation Fee, perçu à destination Dakar, '
              || '18 000 XOF/BL confirmé PDF Hapag-Lloyd SN Mar2026.',
         updated_at = now()
   WHERE id = '4fa72e59-0d09-46ce-96bf-9dc8cabe0ecb'
     AND carrier = 'HAPAG_LLOYD'
     AND charge_code = 'DOC'
     AND operation_type = 'ALL'
     AND calculation_method = 'PER_BL'
     AND default_amount = 18000
     AND evidence_level = 'validated_internal'
     AND is_active = true;
  GET DIAGNOSTICS rc = ROW_COUNT;
  IF rc <> 1 THEN RAISE EXCEPTION 'HAPAG.DOC: expected 1, got %', rc; END IF;
END $$;

-- ─── HAPAG.MNF : ALL → IMPORT ──────────────────────────────────
DO $$
DECLARE rc int;
BEGIN
  UPDATE public.carrier_billing_templates
     SET operation_type = 'IMPORT',
         notes = COALESCE(notes, '')
              || ' [HAPAG-OP-TYPE-IMPORT-PROMOTION-1] Promotion ALL→IMPORT : '
              || 'MFD Manifest Fee, perçu à destination Dakar, '
              || '145 000 XOF/BL confirmé PDF Hapag-Lloyd SN Mar2026.',
         updated_at = now()
   WHERE id = '15b24168-30c6-4e4b-bbc7-2f489a33e7bc'
     AND carrier = 'HAPAG_LLOYD'
     AND charge_code = 'MNF'
     AND operation_type = 'ALL'
     AND calculation_method = 'PER_BL'
     AND default_amount = 145000
     AND evidence_level = 'validated_internal'
     AND is_active = true;
  GET DIAGNOSTICS rc = ROW_COUNT;
  IF rc <> 1 THEN RAISE EXCEPTION 'HAPAG.MNF: expected 1, got %', rc; END IF;
END $$;

COMMIT;
```

### Préchecks bloquants (à exécuter avant le bloc)
```sql
SELECT id, charge_code, operation_type, calculation_method,
       default_amount, evidence_level, is_active
  FROM public.carrier_billing_templates
 WHERE id IN ('4fa72e59-0d09-46ce-96bf-9dc8cabe0ecb',
              '15b24168-30c6-4e4b-bbc7-2f489a33e7bc');
-- attendu : DOC = ALL/PER_BL/18000/validated_internal/true
--          MNF = ALL/PER_BL/145000/validated_internal/true

SELECT COUNT(*) AS hapag_total FROM public.carrier_billing_templates
 WHERE carrier='HAPAG_LLOYD';
-- attendu : 12

SELECT COUNT(*) AS hapag_import_runtime
  FROM public.carrier_billing_templates
 WHERE carrier='HAPAG_LLOYD' AND is_active=true
   AND operation_type='IMPORT'
   AND evidence_level IN ('official','validated_internal');
-- attendu avant : 5  (EDO, ETD_20, ETD_40, TXI, XAO)
```

### Postchecks
```sql
SELECT id, charge_code, operation_type, calculation_method, default_amount, evidence_level, is_active
  FROM public.carrier_billing_templates
 WHERE id IN ('4fa72e59-0d09-46ce-96bf-9dc8cabe0ecb',
              '15b24168-30c6-4e4b-bbc7-2f489a33e7bc');
-- attendu : DOC = IMPORT/PER_BL/18000/validated_internal/true
--          MNF = IMPORT/PER_BL/145000/validated_internal/true

SELECT COUNT(*) FROM public.carrier_billing_templates WHERE carrier='HAPAG_LLOYD';
-- attendu : 12 (inchangé)

SELECT COUNT(*) FROM public.carrier_billing_templates
 WHERE carrier='HAPAG_LLOYD' AND is_active=true
   AND operation_type='IMPORT'
   AND evidence_level IN ('official','validated_internal');
-- attendu après : 7  (5 + DOC + MNF)

-- COLL ne doit PAS être passée IMPORT
SELECT operation_type FROM public.carrier_billing_templates
 WHERE id='f53be9c6-0a83-46fb-81ea-f8a3b75ed753';
-- attendu : ALL  (inchangé, protégé)
```

### Rollback (à conserver, ne pas exécuter sauf régression)
```sql
BEGIN;
UPDATE public.carrier_billing_templates
   SET operation_type = 'ALL',
       notes = 'Frais de documentation par BL',
       updated_at = now()
 WHERE id = '4fa72e59-0d09-46ce-96bf-9dc8cabe0ecb';

UPDATE public.carrier_billing_templates
   SET operation_type = 'ALL',
       notes = 'Frais de manifeste par BL',
       updated_at = now()
 WHERE id = '15b24168-30c6-4e4b-bbc7-2f489a33e7bc';
COMMIT;
```

---

## 5. Projection runtime après promotion (1 BL, IMPORT)

Lignes HAPAG IMPORT runtime-consommables passeraient de **5 → 7** :
- EDO 15 000 / TEU
- ETD_20 90 000 / 20'
- ETD_40 150 000 / 40'
- TXI 25 000 / BL
- XAO 4 500 / TEU
- **DOC +18 000 / BL** (nouveau)
- **MNF +145 000 / BL** (nouveau)

Impact par devis : +163 000 XOF HT / BL (TVA 18% applicable hors moteur). Conforme PDF officiel, aucun double comptage avec PAD ni `port_tariffs`.

---

## 6. Verdict

| Item | Statut |
|---|---|
| DOC promotion ALL→IMPORT | **GO** (data-only, 1 UPDATE) |
| MNF promotion ALL→IMPORT | **GO** (data-only, 1 UPDATE) |
| COLL promotion | **NO-GO** — FORMULA_DEFERRED, ouvrir `HAPAG-COLL-FORMULA-1` (P1) |
| Lignes TBL / THO / PSX / TXI / EDO / ETD / XAO | NO-TOUCH |
| Patch code | NO-GO |
| Migration | NO-GO |
| Docs | NO-GO (per règle CTO précédente) |

**Décision globale : GO partiel — 2 UPDATE data-only sur DOC et MNF, COLL strictement préservée.**

En attente validation CTO avant exécution.
