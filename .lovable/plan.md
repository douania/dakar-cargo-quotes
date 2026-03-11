

# Phase 4A — Alimentation initiale du référentiel (Data Only)

## Schéma confirmé

- `locations_reference` : 12 colonnes, `location_type` CHECK (sea/air/inland), pas d'unicité sur `canonical_name` (conformément aux instructions CTO)
- `location_aliases` : FK → `locations_reference`, UNIQUE sur `normalized_alias`
- Les deux tables sont vides (0 rows)

## Règle de normalisation (stricte, identique insertion et futur lookup)

```sql
UPPER(TRIM(REGEXP_REPLACE(alias_text, '\s+', ' ', 'g')))
```

## Dataset prévu

### locations_reference (~110 entrées)

**Afrique Ouest — sea (14)**
Dakar (SN), Banjul (GM), Abidjan (CI), San Pedro (CI), Conakry (GN), Tema (GH), Lomé (TG), Cotonou (BJ), Lagos (NG), Apapa (NG), Tin Can Island (NG), Nouakchott (MR), Douala (CM), Pointe-Noire (CG)

**Afrique Ouest — inland (9)**
Bamako (ML), Ouagadougou (BF), Niamey (NE), Kayes (ML), Sikasso (ML), Bobo-Dioulasso (BF), Tambacounda (SN), Kaolack (SN), Ziguinchor (SN)

**Afrique Nord/Est — sea (7)**
Tanger Med (MA), Casablanca (MA), Djibouti (DJ), Mombasa (KE), Dar es Salaam (TZ), Durban (ZA), Cape Town (ZA)

**Europe — sea (13)**
Le Havre (FR), Marseille Fos (FR), Anvers (BE), Rotterdam (NL), Hamburg (DE), Felixstowe (GB), Barcelona (ES), Genoa (IT), Algeciras (ES), Piraeus (GR), Valencia (ES), Bremerhaven (DE), Southampton (GB)

**Asie — sea (19)**
Shanghai (CN), Ningbo (CN), Shenzhen (CN), Qingdao (CN), Guangzhou (CN), Tianjin (CN), Hong Kong (HK), Busan (KR), Singapore (SG), Port Klang (MY), Tanjung Pelepas (MY), Laem Chabang (TH), Ho Chi Minh City (VN), Mumbai (IN), Nhava Sheva (IN), Mundra (IN), Colombo (LK), Chittagong (BD), Karachi (PK)

**Moyen-Orient — sea (11)**
Dubai (AE), Jebel Ali (AE), Khalifa (AE), Khorfakkan (AE), Fujairah (AE), Abu Dhabi (AE), Dammam (SA), Jeddah (SA), Salalah (OM), Sohar (OM), Hamad (QA)

**Turquie — sea (3)**
Istanbul Ambarli (TR), Mersin (TR), Izmir (TR)

**Amériques — sea (8)**
New York Newark (US), Savannah (US), Houston (US), Los Angeles (US), Long Beach (US), Santos (BR), Buenos Aires (AR), Manzanillo (MX)

**Aéroports — air (22)**
Blaise Diagne (SN), Charles de Gaulle (FR), Bamako Senou (ML), Banjul Yundum (GM), Abidjan Felix Houphouet (CI), Conakry (GN), Ouagadougou (BF), Niamey (NE), Dubai (AE), Istanbul (TR), JFK (US), Shanghai Pudong (CN), Singapore Changi (SG), Frankfurt (DE), Amsterdam Schiphol (NL), London Heathrow (GB), Johannesburg (ZA), Nairobi (KE), Casablanca Mohamed V (MA), Addis Ababa Bole (ET), Doha Hamad (QA), Mumbai (IN)

**Inland supplémentaires (4)**
N'Djamena (TD), Kigali (RW), Kampala (UG), Riyadh (SA)

**Total : ~110 locations**

### location_aliases (~280 entrées)

Chaque location reçoit 2-4 aliases :
- Nom canonical lui-même
- Code IATA / UNLOCODE quand pertinent
- Variantes orthographiques courantes

**Collisions potentielles identifiées et traitement :**

| Alias normalisé | Conflit | Résolution |
|---|---|---|
| DUBAI | Port sea vs Aéroport air | 2 locations distinctes, alias DUBAI attribué au port (plus fréquent en freight). Aéroport : alias DXB, DUBAI AIRPORT |
| ISTANBUL | Port sea vs Aéroport air | Alias ISTANBUL au port. Aéroport : IST, ISTANBUL AIRPORT |
| MUMBAI | Port sea vs Aéroport air | Alias MUMBAI au port. Aéroport : BOM, MUMBAI AIRPORT |
| CONAKRY | Port sea vs Aéroport air | Alias CONAKRY au port. Aéroport : CKY, CONAKRY AIRPORT |
| SINGAPORE | Port sea vs Aéroport air | Alias SINGAPORE au port. Aéroport : SIN, SINGAPORE CHANGI |
| CASABLANCA | Port sea vs Aéroport air | Alias CASABLANCA au port. Aéroport : CMN, CASABLANCA AIRPORT |
| DJIBOUTI | Port sea vs Ville (même chose) | Une seule location sea |
| BAMAKO | Inland vs Aéroport air | Alias BAMAKO à inland. Aéroport : BKO, BAMAKO SENOU |
| OUAGADOUGOU | Inland vs Aéroport air | Alias OUAGADOUGOU à inland. Aéroport : OUA |
| NIAMEY | Inland vs Aéroport air | Alias NIAMEY à inland. Aéroport : NIM |

**Règle appliquée** : quand un nom de ville est partagé entre port/aéroport/inland, l'alias du nom nu va au type le plus fréquent en contexte freight forwarding (généralement sea ou inland). Les aéroports utilisent les codes IATA et variantes "X AIRPORT".

## Implémentation

1. INSERT `locations_reference` en lot (~110 rows), `source = 'initial_seed_v1'`
2. INSERT `location_aliases` en lot (~280 rows), chaque `normalized_alias` calculé avec la formule exacte
3. La contrainte UNIQUE sur `normalized_alias` sert de garde-fou automatique — si collision non résolue, l'INSERT échoue

## Vérifications post-insertion

1. `SELECT location_type, count(*) FROM locations_reference GROUP BY location_type`
2. `SELECT country_code, count(*) FROM locations_reference GROUP BY country_code ORDER BY count DESC`
3. `SELECT count(*) FROM location_aliases WHERE location_id NOT IN (SELECT id FROM locations_reference)` → doit être 0
4. `SELECT normalized_alias, count(*) FROM location_aliases GROUP BY normalized_alias HAVING count(*) > 1` → doit être vide
5. Spot-checks : KHORFAKKAN→AE, DSS→SN, CDG→FR, PVG→CN, PORT KLANG→MY, TANGER MED→MA

## Scope strict

- 0 fichier modifié
- 0 changement runtime
- 0 migration SQL (insertion données uniquement)
- `build-case-puzzle` continue d'utiliser `PORT_COUNTRY_MAP`
- Dataset traçable : les INSERT SQL seront fournis dans le récapitulatif d'exécution

