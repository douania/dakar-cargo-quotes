

# PHASE M1 — Base reglementaire normative : Rapport d'audit complet

---

## M1.1 — Inventaire des sources reglementaires

### A. Fichiers de reference (public/data/)

| Source | Type | Emplacement | Utilisee par | Statut |
|--------|------|-------------|--------------|--------|
| TEC_UEMOA_HS_Codes.csv | Nomenclature douaniere | `public/data/` | `import-hs-codes` | OK - 6132 codes importes |
| TEC_UEMOA_HS_Taxes.csv | Taux de taxes par code HS | `public/data/` | `import-hs-codes` | OK |
| nomenclature_douaniere.csv | Nomenclature | `public/data/` | `import-hs-codes` | OK |
| TEC_UEMOA.pdf | Reference TEC officielle | `public/data/` | Documentation seulement | OK |
| code_des_douanes_senegal_2014.pdf | Code des douanes | `public/data/` | Non parse automatiquement | Inactif |
| CTU_Code_French_01.pdf | Code CTU (empotage) | `public/data/` | Reference `_shared/ctu-code-reference.ts` | OK |
| DPW_TARIFS_2025_0001.pdf | Tarifs DPW 2025 | `public/data/tarifs/` | Upload tariff_documents | OK |
| dpw_dakar_landside_tariff_2015.pdf | Tarifs DPW anciens | `public/data/tarifs/` | Archive | Obsolete |
| hapag_lloyd_local_charges.pdf | Charges locales Hapag | `public/data/tarifs/` | Upload tariff_documents | OK |
| one_line_local_charges.pdf | Charges locales ONE | `public/data/tarifs/` | Upload tariff_documents | OK |

### B. Tables de donnees reglementaires (base de donnees)

| Table | Type | Nb enregistrements actifs | Utilisee par | Statut |
|-------|------|--------------------------|--------------|--------|
| `hs_codes` | Nomenclature + taux douaniers | 6 132 | `calculate-duties`, `hs-lookup`, `quotation-engine` | OK |
| `tax_rates` | Taux de taxes centralises | 7 | `calculate-duties` | OK |
| `customs_regimes` | 56 regimes douaniers SN | 319 (dont actifs) | `calculate-duties`, `suggest-regime` | OK |
| `port_tariffs` | Tarifs portuaires officiels (DPW, PAD) | 79 | `quotation-engine` | OK |
| `carrier_billing_templates` | Charges armateurs (MSC, Hapag, etc.) | 57 | `quotation-engine` | OK |
| `border_clearing_rates` | Frais frontiere Mali | 6 | `quotation-engine` | OK |
| `destination_terminal_rates` | Frais terminaux Mali (Kati, CMC) | 10 | `quotation-engine` | OK |
| `local_transport_rates` | Tarifs transport local SN | 81 | `quotation-engine` | OK |
| `transport_rate_formula` | Formules km Mali | 9 | `quotation-engine` | OK |
| `mali_transport_zones` | Zones securite/distance Mali | 17 | `quotation-engine` | OK |
| `demurrage_rates` | Surestaries armateurs | 29 | Non utilise par engine | Inactif |
| `warehouse_franchise` | Franchise magasinage PAD | 16 | Non utilise par engine | Inactif |
| `incoterms_reference` | Matrice Incoterms DB | 11 | Non utilise par engine | Doublon |
| `container_specifications` | Specs conteneurs ISO | existe | Non utilise par engine | Inactif |
| `imo_classes` | Classes IMO dangereuses | existe | `analyze-risks` | OK |
| `holidays_pad` | Jours feries PAD | existe | Non utilise par engine | Inactif |
| `tariff_documents` | Metadonnees docs tarifaires | existe | `admin/PortTariffs` | OK |
| `learned_knowledge` | Tarifs historiques appris | 849 valides | `quotation-engine` (fallback) | OK |
| `fuel_price_tracking` | Prix carburant Mali | existe | `quotation-engine` | OK |
| `security_alerts` | Alertes securite Mali | existe | `quotation-engine` | OK |
| `operational_costs_senegal` | Couts operationnels | existe | Non utilise | Inactif |

### C. Regles codifiees dans le code source

| Fichier | Type | Contenu |
|---------|------|---------|
| `_shared/quotation-rules.ts` | Regles metier pures | Matrice Incoterms ICC 2020, EVP conversion, Zones Senegal, Transport exceptionnel, CAF, Sodatra fees, Matching historique |
| `_shared/prompts.ts` | Regles dans prompt IA | Grilles THC DPW (hardcoded dans texte), Franchises PAD, Honoraires SODATRA |
| `_shared/customs-code-reference.ts` | Reference douanes | Regles douanieres codifiees |
| `_shared/ctu-code-reference.ts` | Reference CTU | Regles empotage |
| `quotation-engine/index.ts` | Moteur principal | Detection transit, THD categories, generation lignes |
| `calculate-duties/index.ts` | Calcul droits | Pipeline complet DD -> TVA -> BIC |
| `suggest-regime/index.ts` | Suggestion regime | Scoring par mots-cles et contexte |

---

## M1.2 — Modelisation des regles metier : Rapport de couverture

### Regles BIEN modelisees (en tables, utilisees par le moteur)

| Regle metier | Source officielle | Table | Fonction | Statut |
|--------------|-------------------|-------|----------|--------|
| Droits de douane par code HS | TEC UEMOA | `hs_codes` | `calculate-duties` | OK |
| 56 regimes douaniers + flags taxes | Code douanes SN | `customs_regimes` | `calculate-duties`, `suggest-regime` | OK |
| Taux taxes centraux (RS, PCS, TVA...) | Douane SN | `tax_rates` | `calculate-duties` | OK |
| THC DPW par type operation/conteneur | Arrete ministeriel DPW | `port_tariffs` | `quotation-engine` | OK |
| Charges armateurs (Hapag, MSC, ONE) | Billing templates officiels | `carrier_billing_templates` | `quotation-engine` | OK |
| Frais frontiere Mali (Kidira/Diboli) | Grille frontiere | `border_clearing_rates` | `quotation-engine` | OK |
| Frais terminaux Mali (Kati, CMC) | Grille destination | `destination_terminal_rates` | `quotation-engine` | OK |
| Tarifs transport local SN | Grille transporteurs | `local_transport_rates` | `quotation-engine` | OK |
| Formules transport Mali (km) | Formules negociees | `transport_rate_formula` | `quotation-engine` | OK |
| Zones Mali (distance, securite) | Cartographie | `mali_transport_zones` | `quotation-engine` | OK |
| Classes IMO et surcharges | Code IMDG | `imo_classes` | `analyze-risks` | OK |

### Regles HARDCODED dans le code (risque moyen a eleve)

| Regle metier | Valeur hardcodee | Emplacement | Source officielle | Risque | Action |
|--------------|------------------|-------------|-------------------|--------|--------|
| THC fallback 20' | 110 000 FCFA | `quotation-engine` L879 | Arrete DPW | **Moyen** | A modeliser en table |
| THC fallback 40' | 220 000 FCFA | `quotation-engine` L879 | Arrete DPW | **Moyen** | A modeliser en table |
| Transport Mali fallback | 2 600 000 FCFA | `quotation-engine` L1145 | Estimation non officielle | **Eleve** | A supprimer ou flaguer |
| Transport local fallback | 350 000 x multiplicateur zone | `quotation-engine` L1228 | Estimation non officielle | **Eleve** | A supprimer ou flaguer |
| Estimation droits sans HS | CAF x 0.45 (45%) | `quotation-engine` L1496 | Aucune | **Eleve** | A supprimer |
| Fret estime (FOB sans fret fourni) | Valeur x 0.08 (8%) | `quotation-rules.ts` L388 | Convention douaniere | Moyen | Documenter ou table |
| Assurance par defaut | 0.5% | `quotation-rules.ts` L371 | Convention douaniere | Faible | OK mais documenter |
| Prix carburant defaut Mali | 820 FCFA/L | `quotation-engine` L279 | Aucune | Moyen | Table fuel_price existe deja |
| Prix carburant defaut SN | 760 FCFA/L | `quotation-engine` L279 | Aucune | Moyen | Table fuel_price existe deja |
| Honoraires dedouanement min | 75 000 FCFA | `quotation-rules.ts` L469 | Grille SODATRA interne | Moyen | A modeliser |
| Honoraires suivi min | 35 000 FCFA | `quotation-rules.ts` L470 | Grille SODATRA interne | Moyen | A modeliser |
| Ouverture dossier maritime | 25 000 FCFA | `quotation-rules.ts` L457 | Grille SODATRA interne | Moyen | A modeliser |
| Ouverture dossier aerien | 20 000 FCFA | `quotation-rules.ts` L458 | Grille SODATRA interne | Moyen | A modeliser |
| Ouverture dossier routier | 15 000 FCFA | `quotation-rules.ts` L458 | Grille SODATRA interne | Moyen | A modeliser |
| Documentation fixe | 15 000 FCFA | `quotation-rules.ts` L461 | Grille SODATRA interne | Moyen | A modeliser |
| Commission min | 25 000 FCFA | `quotation-rules.ts` L473 | Grille SODATRA interne | Moyen | A modeliser |
| Suivi par conteneur | 35 000 FCFA/cnt | `quotation-rules.ts` L452 | Grille SODATRA interne | Moyen | A modeliser |
| Suivi par tonne | 3 000 FCFA/t | `quotation-rules.ts` L453 | Grille SODATRA interne | Moyen | A modeliser |
| Facteur complexite IMO | +30% | `quotation-rules.ts` L433 | Decision interne | Faible | Documenter |
| Facteur complexite OOG | +25% | `quotation-rules.ts` L434 | Decision interne | Faible | Documenter |
| Commission sur debours | 5% | `quotation-engine` L1527 | Grille SODATRA | Moyen | A modeliser |
| Segregation IMO | 150 000 FCFA | `analyze-risks` L168 | Estimation | Moyen | A modeliser |
| Escorte hors-gabarit | 250 000 FCFA | `analyze-risks` L180 | Estimation | Moyen | A modeliser |

### Regles dans le prompt IA (duplication risquee)

| Regle | Valeur dans prompt | Valeur en table/code | Coherence |
|-------|-------------------|---------------------|-----------|
| THC Export C1 (Coton) | 70 000 FCFA | port_tariffs | A verifier |
| THC Export C2 (Frigo) | 80 000 FCFA | port_tariffs | A verifier |
| THC Export C3 (Standard) | 110 000 FCFA | port_tariffs | A verifier |
| THC Import C4 (Base) | 87 000 FCFA | port_tariffs | A verifier |
| THC Import C5 (Standard) | 133 500 FCFA | port_tariffs | A verifier |
| THC Transit C6 | 110 000 FCFA | port_tariffs | A verifier |
| Franchise Import SN | 7 jours | warehouse_franchise (non utilise) | **Desynchro** |
| Franchise Transit | 20 jours | warehouse_franchise (non utilise) | **Desynchro** |
| Honoraires conteneur | ~150 000 FCFA | quotation-rules (75 000 min) | **Incoherent** |
| Honoraires vehicule | ~120 000 FCFA | Nulle part | **Non modelise** |
| Honoraires aerien | ~100 000 FCFA | Nulle part | **Non modelise** |

### Tables existantes NON UTILISEES par le moteur

| Table | Nb enregistrements | Usage prevu | Statut |
|-------|-------------------|-------------|--------|
| `demurrage_rates` | 29 | Surestaries armateurs | **Jamais interrogee par quotation-engine** |
| `warehouse_franchise` | 16 | Franchise magasinage PAD | **Jamais interrogee par quotation-engine** |
| `incoterms_reference` | 11 | Matrice Incoterms en DB | **Doublon avec INCOTERMS_MATRIX hardcodee** |
| `holidays_pad` | existe | Jours feries pour calcul franchise | **Non connectee** |
| `container_specifications` | existe | Specs ISO conteneurs | **Non connectee au moteur** |
| `operational_costs_senegal` | existe | Couts operationnels | **Jamais utilisee** |

---

## M1.3 — Audit du moteur de cotation normative

### Architecture du moteur

```text
+------------------+     +---------------------+     +--------------------+
| run-pricing      | --> | quotation-engine     | --> | QuotationResult    |
| (orchestrateur)  |     | (calcul des lignes)  |     | {lines, totals,    |
|                  |     |                      |     |  metadata, warnings}|
| - Charge facts   |     | Utilise:             |     +--------------------+
| - Build inputs   |     | - port_tariffs (DB)  |
| - Appelle engine |     | - carrier_billing    |
| - Stocke result  |     | - border_clearing    |
+------------------+     | - transport_formula  |
                          | - mali_zones (DB)    |
                          | - local_transport    |
                          | - learned_knowledge  |
                          | - quotation-rules.ts |
                          |   (hardcoded rules)  |
                          +---------------------+
                                    |
                          +---------------------+
                          | calculate-duties     |
                          | (appele separement)  |
                          | Utilise:             |
                          | - hs_codes (DB)      |
                          | - customs_regimes    |
                          | - tax_rates (DB)     |
                          +---------------------+
```

### Audit ligne par ligne

| Composant | Source du calcul | Type | Risque |
|-----------|-----------------|------|--------|
| THC Import/Transit/Export | Table `port_tariffs` (DPW) | **Normatif** | OK |
| THC fallback | Hardcode 110k/220k | **Hardcoded** | Moyen |
| Redevance Variable PAD | Table `port_tariffs` (PAD) | **Normatif** | OK |
| Port Tax PAD | Table `port_tariffs` (PAD) | **Normatif** | OK |
| Relevage Transit | Table `port_tariffs` (DPW) | **Normatif** | OK |
| Charges armateur transit | Table `carrier_billing_templates` | **Normatif** | OK |
| THD/THO par categorie | Table `port_tariffs` + `determineTariffCategory()` | **Mixte** | Moyen - categories hardcodees |
| Transport Mali (formule) | Table `transport_rate_formula` + `mali_transport_zones` | **Normatif** | OK |
| Transport Mali (fallback) | Hardcode 2 600 000 | **Hardcoded** | **Eleve** |
| Transport local SN | Table `local_transport_rates` | **Normatif** | OK |
| Transport local (fallback) | Hardcode 350 000 x multiplicateur | **Hardcoded** | **Eleve** |
| Surcharge carburant | Table `fuel_price_tracking` + defaut 820/760 | **Mixte** | Moyen |
| Surcharge securite Mali | Table `mali_transport_zones.security_surcharge_percent` | **Normatif** | OK |
| Frais frontiere Mali | Table `border_clearing_rates` | **Normatif** | OK |
| Frais terminaux Mali | Table `destination_terminal_rates` | **Normatif** | OK |
| Honoraires SODATRA (tous) | Hardcode dans `quotation-rules.ts` | **Hardcoded** | Moyen |
| Commission sur debours | Hardcode 5% | **Hardcoded** | Moyen |
| Droits douaniers (avec HS) | Table `hs_codes` + `tax_rates` + `customs_regimes` | **Normatif** | OK |
| Droits douaniers (sans HS) | Hardcode CAF x 0.45 | **Hardcoded** | **Eleve** |
| Calcul CAF | `quotation-rules.ts` (logique pure) | **Regle metier** | OK |
| Matrice Incoterms | Hardcode `INCOTERMS_MATRIX` (malgre table `incoterms_reference` existante) | **Doublon** | Moyen |
| Zones livraison SN | Hardcode `DELIVERY_ZONES` | **Hardcoded** | Moyen - devrait etre en table |
| Detection transit | Hardcode `TRANSIT_COUNTRIES` + `MALI_CITIES` | **Hardcoded** | Faible - rarement change |
| Seuils transport exceptionnel | Hardcode `TRANSPORT_THRESHOLDS` | **Regle metier** | Faible |
| Surestaries armateurs | Table `demurrage_rates` existe mais **non utilisee** | **Non connecte** | **Eleve** |
| Franchise magasinage | Table `warehouse_franchise` existe mais **non utilisee** | **Non connecte** | **Eleve** |
| Jours feries PAD | Table `holidays_pad` existe mais **non connectee** | **Non connecte** | Moyen |

---

## Synthese : Trous a combler (priorisee)

### Priorite HAUTE (risque eleve - impact direct sur cotation)

1. **Fallbacks d'estimation non normatifs** : THC (110k/220k), Transport Mali (2.6M), Transport local (350k x mult), Droits sans HS (45%) -- ces valeurs inventees ne devraient JAMAIS apparaitre sans etre clairement marquees. Action : les marquer systematiquement TO_CONFIRM (deja fait) et auditer que le front les affiche en rouge.

2. **Tables existantes non connectees au moteur** : `demurrage_rates` (29 records), `warehouse_franchise` (16 records), `holidays_pad` -- ces donnees officielles existent mais le moteur ne les utilise pas du tout.

3. **Duplication prompt vs code vs DB** : La matrice Incoterms existe 3 fois (prompt, `INCOTERMS_MATRIX` hardcoded, table `incoterms_reference`). Les THC sont dans le prompt ET en table. Risque de desynchronisation.

### Priorite MOYENNE (risque moyen - maintenabilite)

4. **Honoraires SODATRA entierement hardcodes** : 8+ valeurs fixes dans `quotation-rules.ts`. Action : creer une table `sodatra_fee_rules` parametrable.

5. **Zones de livraison SN hardcodees** : `DELIVERY_ZONES` avec multiplicateurs. Action : migrer vers une table `delivery_zones` (similaire a `mali_transport_zones`).

6. **`incoterms_reference` inutilisee** : La table DB existe (11 records) mais le moteur utilise le hardcode. Action : migrer le moteur vers la table.

7. **`determineTariffCategory()` hardcoded** : Le mapping cargo description -> categorie T01-T14 est fait par regex. Action : modeliser en table de correspondance.

### Priorite BASSE (documentation)

8. **Conventions douanieres implicites** : Fret 8%, assurance 0.5% sont des conventions SN connues mais non documentees dans le systeme.

9. **Facteurs de complexite SODATRA** : +30% IMO, +25% OOG, etc. -- decisions internes, a documenter.

---

## Critere de fin Phase M1

| Critere | Statut |
|---------|--------|
| Liste complete des sources reglementaires | **FAIT** (10 fichiers, 21 tables, 7 fichiers de regles) |
| Cartographie des regles metier | **FAIT** (11 normatives, 18+ hardcodees, 3 non connectees) |
| Audit du moteur de pricing | **FAIT** (27 composants audites, sources classifiees) |
| Liste claire des trous a combler | **FAIT** (3 haute priorite, 4 moyenne, 2 basse) |

