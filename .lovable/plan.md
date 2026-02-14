

# Correctif P0 : Conversion devise + Base TVA dans quotation-engine

## Contexte

La valeur marchandise (4 655 EUR) est transmise sans conversion au moteur de cotation, qui la traite comme 4 655 FCFA. Erreur de facteur x656 sur tous les droits et taxes. De plus, la base TVA est incomplete (manque surtaxe, TIN, TCI).

## Correctifs (3 fichiers, ordre d'execution)

### Correctif 1 — run-pricing/index.ts : transmettre la devise

**Ligne 252** : Ajouter `cargoCurrency` dans `engineParams`.

```text
// Avant
cargoValue: inputs.cargoValue,

// Apres
cargoValue: inputs.cargoValue,
cargoCurrency: inputs.cargoValueCurrency,
```

L'interface du moteur a deja le champ `cargoCurrency?: string` (ligne 425). Aucun changement de type necessaire.

---

### Correctif 2 — quotation-engine/index.ts : conversion devise securisee (EUR uniquement)

Avant l'appel a `calculateCAF` (ligne 2002), convertir `request.cargoValue` en FCFA.

Logique conforme a la validation CTO :

```text
// Conversion devise securisee
const rawCurrency = (request.cargoCurrency || 'XOF').toUpperCase();
let cargoValueFCFA: number;

if (rawCurrency === 'XOF' || rawCurrency === 'FCFA' || rawCurrency === 'CFA') {
  cargoValueFCFA = request.cargoValue;
} else if (rawCurrency === 'EUR') {
  cargoValueFCFA = request.cargoValue * 655.957; // parite fixe BCEAO
} else {
  // Devise non supportee — flag TO_CONFIRM, pas de hardcode
  lines.push({
    id: 'currency_warning',
    bloc: 'debours',
    category: 'Avertissement',
    description: `Devise ${rawCurrency} non supportee pour le calcul des droits`,
    amount: null,
    currency: 'FCFA',
    source: { type: 'TO_CONFIRM', reference: 'Conversion manuelle requise', confidence: 0 },
    isEditable: false
  });
  cargoValueFCFA = request.cargoValue; // fallback brut, signale
}
```

Puis remplacer `request.cargoValue` par `cargoValueFCFA` dans l'appel `calculateCAF` :

```text
const caf = calculateCAF({
  incoterm: request.incoterm || 'CIF',
  invoiceValue: cargoValueFCFA,   // <-- converti
  freightAmount: undefined,
  insuranceRate: 0.005
});
```

---

### Correctif 3 — quotation-engine/index.ts : base TVA complete

**Lignes 2023-2031** : Ajouter surtaxe, TIN, TCI dans le calcul.

```text
// Avant
const ddAmount = caf.cafValue * (hs.dd / 100);
const rsAmount = caf.cafValue * (hs.rs / 100);
const pcsAmount = caf.cafValue * (hs.pcs / 100);
const pccAmount = caf.cafValue * (hs.pcc / 100);
const cosecAmount = caf.cafValue * (hs.cosec / 100);
const baseVAT = caf.cafValue + ddAmount + rsAmount;
const tvaAmount = baseVAT * (hs.tva / 100);
const totalDuties = ddAmount + rsAmount + pcsAmount + pccAmount + cosecAmount + tvaAmount;

// Apres (formule officielle senegalaise)
const ddAmount = caf.cafValue * ((hs.dd || 0) / 100);
const rsAmount = caf.cafValue * ((hs.rs || 0) / 100);
const surtaxeAmount = caf.cafValue * ((hs.surtaxe || 0) / 100);
const tinAmount = caf.cafValue * ((hs.tin || 0) / 100);
const tciAmount = caf.cafValue * ((hs.t_conj || 0) / 100);
const pcsAmount = caf.cafValue * ((hs.pcs || 0) / 100);
const pccAmount = caf.cafValue * ((hs.pcc || 0) / 100);
const cosecAmount = caf.cafValue * ((hs.cosec || 0) / 100);
const baseVAT = caf.cafValue + ddAmount + surtaxeAmount + rsAmount + tinAmount + tciAmount;
const tvaAmount = baseVAT * ((hs.tva || 0) / 100);
const totalDuties = ddAmount + rsAmount + surtaxeAmount + tinAmount + tciAmount + pcsAmount + pccAmount + cosecAmount + tvaAmount;
```

La reference du `source` est aussi mise a jour pour reflechir tous les taux appliques :

```text
reference: `TEC UEMOA - DD ${hs.dd || 0}% + RS ${hs.rs || 0}% + TVA ${hs.tva || 0}% + Surtaxe ${hs.surtaxe || 0}% + TIN ${hs.tin || 0}%`
```

---

## Resume

| Correctif | Fichier | Lignes | Nature |
|---|---|---|---|
| Transmission devise | run-pricing/index.ts | 252 | +1 ligne |
| Conversion EUR securisee | quotation-engine/index.ts | ~2000-2007 | ~15 lignes |
| Base TVA complete | quotation-engine/index.ts | 2023-2031 | ~10 lignes |

## Conformite CTO

- EUR : parite fixe officielle BCEAO (655.957)
- USD/GBP : **non hardcodes** — erreur explicite TO_CONFIRM
- XOF/FCFA/CFA : passthrough
- Formule TVA alignee avec calculate-duties et reglementation senegalaise

## Impact attendu

Pour la cotation en cours (4 655 EUR, HS 8525.50.00.00 DD 5%) :
- Avant : CAF = 4 655, droits ~ 1 256 FCFA
- Apres : CAF = ~3 053 480 FCFA, droits ~ 823 000+ FCFA

## Risque

Minimal. Les HS codes sans surtaxe/TIN/TCI ont ces champs a null ou 0 — le fallback `|| 0` les neutralise. La conversion n'affecte que les cas ou la devise est explicitement EUR.

