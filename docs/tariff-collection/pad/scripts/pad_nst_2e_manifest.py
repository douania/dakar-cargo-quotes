#!/usr/bin/env python3
"""
PAD-NST-2E-A — Rule Candidate Manifest Generator

Phase: PAD-NST-2E-A (documentation only, NO database import)
Purpose: Generate auditable CSV + Markdown manifest of all NST->PAD
         candidate rules for CTO review before any DB insertion.

Every rule is defined EXPLICITLY below. No automatic generation,
no heuristic loops, no opaque logic.

Constraints enforced:
- validation_status = 'candidate' (never 'validated')
- requires_operator_validation = true (always)
- evidence_level in ('expert_rule', 'nstr_bridge_inferred') only
- NO 'pad_official_extract'
- division-level confidence max 0.50
- group-level confidence max 0.65
- NO rules for divisions 18, 19, 20
- pad_category must match ^(T(0[1-9]|1[0-4])|P0[1-5])$
"""

import csv
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date

PAD_CATEGORIES = {
    "T01": "Biens de valeur, électronique, informatique et mobilier",
    "T02": "Marchandises générales",
    "T03": "Acides, sucres et matières premières",
    "T04": "Bois et produits divers",
    "T05": "Céréales, ciment, riz et produits assimilés",
    "T06": "Gasoil, fuel oil, diesel, butane en vrac, phosphates",
    "T07": "Clinker, farine, charbon, sable et vracs pondéreux",
    "T08": "Attapulgite, phosphates, ferrailles, tourteaux, cellulose",
    "T09": "Tracteurs, véhicules industriels et matériel de transport",
    "T10": "Sel de production locale",
    "T11": "Pétrole brut, essences, bitumes, hydrocarbures raffinés",
    "T12": "Matériaux et produits manufacturés",
    "T13": "Marchandises diverses en groupage",
    "T14": "Fil machine et feuillard",
    "P01": "Crustacés non dénommés ailleurs",
    "P02": "Thonidés",
    "P03": "Crabes, crevettes, mollusques et poissons plats",
    "P04": "Sardinelles, chinchard, maquereau",
    "P05": "Produits de pêche non dénommés ailleurs",
}

NST_DIVISIONS = {
    "01": "Products of agriculture, hunting, and forestry; fish and other fishing products",
    "02": "Coal and lignite; crude petroleum and natural gas",
    "03": "Metal ores and other mining and quarrying products; peat; uranium and thorium ores",
    "04": "Food products, beverages and tobacco",
    "05": "Textiles and textile products; leather and leather products",
    "06": "Wood and products of wood and cork; pulp, paper and paper products; printed matter and recorded media",
    "07": "Coke and refined petroleum products",
    "08": "Chemicals, chemical products, and man-made fibres; rubber and plastic products; nuclear fuel",
    "09": "Other non-metallic mineral products",
    "10": "Basic metals; fabricated metal products, except machinery and equipment",
    "11": "Machinery and equipment n.e.c.; office machinery and computers; electrical machinery and apparatus n.e.c.; radio, television and communication equipment and apparatus; medical, precision and optical instruments; watches and clocks",
    "12": "Transport equipment",
    "13": "Furniture; other manufactured goods n.e.c.",
    "14": "Secondary raw materials; municipal wastes and other wastes",
    "15": "Mail, parcels",
    "16": "Equipment and material utilised in the transport of goods",
    "17": "Goods moved in the course of household and office removals; baggage and articles accompanying travellers; motor vehicles being moved for repair; other non-market goods n.e.c.",
    "18": "Grouped goods: a mixture of types of goods which are transported together",
    "19": "Unidentifiable goods",
    "20": "Other goods n.e.c.",
}

NST_GROUPS = {
    "01.1": "Cereals",
    "01.2": "Potatoes",
    "01.3": "Sugar beet",
    "01.4": "Other fresh fruit and vegetables",
    "01.5": "Products of forestry and logging",
    "01.6": "Live plants and flowers",
    "01.7": "Other substances of vegetable origin",
    "01.8": "Live animals",
    "01.9": "Raw milk from bovine cattle, sheep and goats",
    "01.A": "Other raw materials of animal origin",
    "01.B": "Fish and other fishing products",
    "02.1": "Coal and lignite",
    "02.2": "Crude petroleum",
    "02.3": "Natural gas",
    "03.1": "Iron ores",
    "03.2": "Non ferrous metal ores (except uranium and thorium ores)",
    "03.3": "Chemical and (natural) fertilizer minerals",
    "03.4": "Salt",
    "03.5": "Stone, sand, gravel, clay, peat and other mining and quarrying products n.e.c.",
    "03.6": "Uranium and thorium ores",
    "04.1": "Meat, raw hides and skins and meat products",
    "04.2": "Fish and fish products, processed and preserved",
    "04.3": "Fruit and vegetables, processed and preserved",
    "04.4": "Animal and vegetable oils and fats",
    "04.5": "Dairy products and ice cream",
    "04.6": "Grain mill products, starches, starch products and prepared animal feeds",
    "04.7": "Beverages",
    "04.8": "Other food products n.e.c. and tobacco products (except in parcel service or grouped)",
    "05.1": "Textiles",
    "05.2": "Wearing apparel and articles of fur",
    "05.3": "Leather and leather products",
    "06.1": "Products of wood and cork (except furniture)",
    "06.2": "Pulp, paper and paper products",
    "06.3": "Printed matter and recorded media",
    "07.1": "Coke oven products; briquettes, ovoids and similar solid fuels",
    "07.2": "Liquid refined petroleum products",
    "07.3": "Gaseous, liquefied or compressed petroleum products",
    "07.4": "Solid or waxy refined petroleum products",
    "08.1": "Basic mineral chemical products",
    "08.2": "Basic organic chemical products",
    "08.3": "Nitrogen compounds and fertilizers (except natural fertilizers)",
    "08.4": "Basic plastics and synthetic rubber in primary forms",
    "08.5": "Pharmaceuticals and parachemicals including pesticides and other agro-chemical products",
    "08.6": "Rubber or plastic products",
    "08.7": "Nuclear fuel",
    "09.1": "Glass and glass products, ceramic and porcelain products",
    "09.2": "Cement, lime and plaster",
    "09.3": "Other construction materials, manufactures",
    "10.1": "Basic iron and steel and ferro-alloys and products of the first processing of iron and steel (except tubes)",
    "10.2": "Non ferrous metals and products thereof",
    "10.3": "Tubes, pipes, hollow profiles and related fittings",
    "10.4": "Structural metal products",
    "10.5": "Boilers, hardware, weapons and other fabricated metal products",
    "11.1": "Agricultural and forestry machinery",
    "11.2": "Domestic appliances n.e.c. (White goods)",
    "11.3": "Office machinery and computers",
    "11.4": "Electric machinery and apparatus n.e.c.",
    "11.5": "Electronic components and emission and transmission appliances",
    "11.6": "Television and radio receivers; sound or video recording or reproducing apparatus and associated goods (Brown goods)",
    "11.7": "Medical, precision and optical instruments, watches and clocks",
    "11.8": "Other machines, machine tools and parts",
    "12.1": "Automobile industry products",
    "12.2": "Other transport equipment",
    "13.1": "Furniture",
    "13.2": "Other manufactured goods",
    "14.1": "Household and municipal waste",
    "14.2": "Other waste and secondary raw materials",
    "16.1": "Containers and swap bodies in service, empty",
    "17.1": "Household removal",
    "17.5": "Other non market goods n.e.c.",
    "18.0": "Grouped goods",
    "19.1": "Unidentifiable goods in containers or swap bodies",
    "19.2": "Other unidentifiable goods",
}

DOC_DOCTRINE = "PAD_NST_RECOMMENDATION_ENGINE.md"
DOC_DOCTRINE_REF = "Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)"
DOC_NSTR_BRIDGE = "nstr_nst2007_mappings (DB table, 9776 non-quarantined rows)"

RULES = []

def r(nst_level, nst_code, pad_category, confidence, evidence_level, notes, source_document, source_reference):
    RULES.append({
        "nst_level": nst_level,
        "nst_code": nst_code,
        "nst_label": NST_DIVISIONS.get(nst_code) if nst_level == "division" else NST_GROUPS.get(nst_code, "UNKNOWN"),
        "pad_category": pad_category,
        "pad_category_label": PAD_CATEGORIES[pad_category],
        "confidence": confidence,
        "evidence_level": evidence_level,
        "validation_status": "candidate",
        "requires_operator_validation": True,
        "notes": notes,
        "source_document": source_document,
        "source_reference": source_reference,
    })

# =====================================================================
# DIVISION-LEVEL RULES (confidence max 0.50)
# =====================================================================

# Division 01 — Agriculture, hunting, forestry, fish
r("division", "01", "T02", 0.30, "expert_rule",
  "Division 01 couvre agriculture, chasse, foret et peche. Les produits agricoles bruts (hors cereales/riz) sont des marchandises generales au sens PAD. Ambiguite forte : la division couvre aussi la peche (P01-P05). Confidence faible car la division est trop large pour un seul PAD.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "01", "P05", 0.30, "expert_rule",
  "Division 01 inclut 'fish and other fishing products' (groupe 01.B). P05 = produits de peche NDA, categorie par defaut pour la peche non specifiee. Conflit avec T02/T03/T05 pour les produits agricoles non-peche.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 02 — Coal, crude petroleum, natural gas
r("division", "02", "T11", 0.45, "expert_rule",
  "Division 02 = charbon, petrole brut, gaz naturel. T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Le petrole brut (02.2) correspond directement a T11. Le charbon (02.1) pourrait relever de T07 (charbon, vracs pondereux). Confidence moyenne car charbon et gaz creent une ambiguite.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "02", "T07", 0.35, "expert_rule",
  "Division 02 inclut charbon et lignite (02.1). T07 = clinker, farine, charbon, sable et vracs pondereux. Le charbon est explicitement dans le label T07. Candidate secondaire derriere T11 pour les hydrocarbures liquides.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 03 — Metal ores, mining products
r("division", "03", "T03", 0.40, "expert_rule",
  "Division 03 = minerais metalliques, produits miniers. T03 = acides, sucres et matieres premieres. Les minerais sont des matieres premieres brutes. Ambiguite avec T08 (phosphates, ferrailles) pour certains minerais specifiques.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "03", "T08", 0.35, "expert_rule",
  "Division 03 inclut les mineraux fertilisants (03.3) et le sel (03.4). T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les phosphates et mineraux fertilisants correspondent a T08. Candidate secondaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 04 — Food products, beverages, tobacco
r("division", "04", "T02", 0.40, "expert_rule",
  "Division 04 = produits alimentaires, boissons, tabac. T02 = marchandises generales. Les denrees alimentaires transformees sont classees marchandises generales dans la pratique PAD Dakar. Ambiguite avec T01 pour les boissons alcoolisees (alias PAD existant sous T01) et T05 pour les farines/cereales transformees.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "04", "T05", 0.35, "expert_rule",
  "Division 04 inclut les farines et amidons (04.6). T05 = cereales, ciment, riz et produits assimiles. Les produits cerealiers transformes (farines) se rapprochent de T05. Candidate secondaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 05 — Textiles, leather
r("division", "05", "T12", 0.40, "expert_rule",
  "Division 05 = textiles, cuir. T12 = materiaux et produits manufactures. Les textiles et articles en cuir sont des produits manufactures au sens PAD. Ambiguite possible avec T02 (marchandises generales) pour les textiles bruts.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "05", "T02", 0.30, "expert_rule",
  "Division 05 = textiles et cuir. T02 = marchandises generales. Certains textiles bruts ou en vrac pourraient relever de T02 plutot que T12. Candidate secondaire, depend du degre de transformation.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 06 — Wood, paper
r("division", "06", "T04", 0.45, "expert_rule",
  "Division 06 = bois, liege, papier. T04 = bois et produits divers. Le bois et ses derives correspondent directement au label T04. Confidence raisonnable car le label PAD est explicite.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 07 — Coke, refined petroleum
r("division", "07", "T11", 0.50, "expert_rule",
  "Division 07 = coke et produits petroliers raffines. T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Correspondance directe entre produits petroliers raffines et le label T11. Meilleur match division-level du manifeste.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 08 — Chemicals, plastics, rubber
r("division", "08", "T03", 0.35, "expert_rule",
  "Division 08 = chimie, plastiques, caoutchouc, combustible nucleaire. T03 = acides, sucres et matieres premieres. Les produits chimiques de base (acides) correspondent a T03. Forte ambiguite : la division couvre aussi les plastiques (T12), les engrais (T08), les produits pharmaceutiques (T02).",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "08", "T12", 0.30, "expert_rule",
  "Division 08 inclut les plastiques et caoutchoucs (08.4, 08.6). T12 = materiaux et produits manufactures. Les produits plastiques/caoutchouc manufactures relevent de T12. Candidate secondaire, ambiguite forte avec T03.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 09 — Non-metallic mineral products
r("division", "09", "T07", 0.45, "expert_rule",
  "Division 09 = produits mineraux non metalliques. T07 = clinker, farine, charbon, sable et vracs pondereux. Le ciment (09.2), le sable, le clinker sont dans T07. Ambiguite avec T12 pour les produits mineraux manufactures (verre, ceramique).",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "09", "T05", 0.35, "expert_rule",
  "Division 09 inclut ciment, chaux, platre (09.2). T05 = cereales, ciment, riz et produits assimiles. Le ciment est explicitement dans le label T05. Candidate secondaire, depend du produit exact.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 10 — Basic metals, fabricated metal products
r("division", "10", "T14", 0.40, "expert_rule",
  "Division 10 = metaux de base, produits metalliques. T14 = fil machine et feuillard. Les produits de premiere transformation (10.1) correspondent a T14. Ambiguite avec T12 pour les produits metalliques fabriques et T08 pour les ferrailles.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "10", "T12", 0.35, "expert_rule",
  "Division 10 inclut les produits metalliques fabriques (10.3-10.5). T12 = materiaux et produits manufactures. Les tubes, profiles, produits metalliques structurels sont des produits manufactures. Candidate secondaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "10", "T08", 0.30, "expert_rule",
  "Division 10 peut inclure des ferrailles et dechets metalliques en pratique. T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les ferrailles sont explicitement dans le label T08. Candidate tertiaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 11 — Machinery, equipment, electronics
r("division", "11", "T01", 0.40, "expert_rule",
  "Division 11 = machines, equipements, informatique, electronique. T01 = biens de valeur, electronique, informatique et mobilier. L'informatique et l'electronique sont explicitement dans le label T01. Ambiguite avec T09 pour les machines industrielles et T12 pour les appareils menagers.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "11", "T09", 0.35, "expert_rule",
  "Division 11 inclut les machines agricoles (11.1) et les machines-outils (11.8). T09 = tracteurs, vehicules industriels et materiel de transport. Les machines industrielles et tracteurs correspondent a T09. Candidate secondaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 12 — Transport equipment
r("division", "12", "T09", 0.50, "expert_rule",
  "Division 12 = materiel de transport. T09 = tracteurs, vehicules industriels et materiel de transport. Correspondance directe entre 'transport equipment' et le label T09.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 13 — Furniture, other manufactured goods
r("division", "13", "T01", 0.40, "expert_rule",
  "Division 13 = meubles et autres produits manufactures. T01 = biens de valeur, electronique, informatique et mobilier. Le mobilier est explicitement dans le label T01. Ambiguite avec T12 pour les 'autres produits manufactures'.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("division", "13", "T12", 0.35, "expert_rule",
  "Division 13 inclut 'other manufactured goods' (13.2). T12 = materiaux et produits manufactures. Les produits manufactures divers relevent de T12. Candidate secondaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 14 — Secondary raw materials, wastes
r("division", "14", "T08", 0.40, "expert_rule",
  "Division 14 = matieres premieres secondaires, dechets. T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les ferrailles et dechets metalliques secondaires correspondent a T08. Ambiguite car les dechets municipaux (14.1) ne correspondent a aucune categorie PAD claire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 15 — Mail, parcels
r("division", "15", "T13", 0.35, "expert_rule",
  "Division 15 = courrier, colis. T13 = marchandises diverses en groupage. Les colis et envois postaux sont assimilables au groupage. Usage rare en contexte portuaire Dakar. Confidence faible.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 16 — Transport equipment in service
r("division", "16", "T09", 0.40, "expert_rule",
  "Division 16 = equipements de transport de marchandises en service. T09 = tracteurs, vehicules industriels et materiel de transport. Les conteneurs et caisses mobiles en service sont du materiel de transport.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Division 17 — Removals, baggage
r("division", "17", "T02", 0.30, "expert_rule",
  "Division 17 = demenagement, bagages, vehicules en reparation. T02 = marchandises generales. Les effets personnels de demenagement sont classes marchandises generales par defaut. Usage rare en contexte portuaire commercial Dakar. Confidence tres faible.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Divisions 18, 19, 20 — EXCLUDED (operator blocking mandatory)


# =====================================================================
# GROUP-LEVEL RULES (confidence max 0.65)
# =====================================================================

# --- Division 01 groups ---

r("group", "01.1", "T05", 0.60, "expert_rule",
  "Cereales -> T05 : le label PAD T05 mentionne explicitement 'cereales, ciment, riz'. Match direct entre le groupe NST et le label PAD.",
  DOC_DOCTRINE, "Label PAD T05 = 'Cereales, ciment, riz et produits assimiles'")

r("group", "01.2", "T02", 0.40, "expert_rule",
  "Pommes de terre -> T02 : produit agricole frais, classe marchandises generales en l'absence d'alias PAD specifique. Pas de categorie PAD dediee aux tubercules.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "01.3", "T03", 0.45, "expert_rule",
  "Betteraves sucrieres -> T03 : T03 = acides, sucres et matieres premieres. La betterave sucriere est une matiere premiere pour le sucre.",
  DOC_DOCTRINE, "Label PAD T03 = 'Acides, sucres et matieres premieres'")

r("group", "01.4", "T02", 0.40, "expert_rule",
  "Fruits et legumes frais -> T02 : marchandises generales. Pas de categorie PAD specifique aux fruits/legumes frais.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "01.5", "T04", 0.55, "expert_rule",
  "Produits forestiers et bois d'exploitation -> T04 : T04 = bois et produits divers. Match direct entre bois brut et le label PAD T04.",
  DOC_DOCTRINE, "Label PAD T04 = 'Bois et produits divers'")

r("group", "01.6", "T02", 0.35, "expert_rule",
  "Plantes vivantes et fleurs -> T02 : marchandises generales. Pas de categorie PAD dediee a l'horticulture. Produit fragile, usage rare a Dakar.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "01.7", "T03", 0.40, "expert_rule",
  "Autres substances d'origine vegetale -> T03 : matieres premieres vegetales (caoutchouc naturel, coton brut, fibres). T03 = acides, sucres et matieres premieres.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "01.8", "T02", 0.35, "expert_rule",
  "Animaux vivants -> T02 : marchandises generales. Pas de categorie PAD specifique aux animaux vivants. Transport specialise, rare en conteneur.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "01.9", "T02", 0.30, "expert_rule",
  "Lait cru -> T02 : marchandises generales. Produit refrigere perissable. Pas de categorie PAD dediee aux produits laitiers bruts. Tres rare a Dakar en import maritime.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "01.A", "T02", 0.30, "expert_rule",
  "Autres matieres premieres animales -> T02 : marchandises generales. Peaux brutes, laine, poils. Pas de categorie PAD specifique.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "01.B", "P05", 0.55, "expert_rule",
  "Poissons et produits de la peche -> P05 : P05 = produits de peche non denommes ailleurs. Match direct entre le groupe NST et la famille PAD peche. Des sous-categories plus precises (P01-P04) existent pour crustaces, thonides, etc.",
  DOC_DOCTRINE, "Labels PAD P01-P05 = familles de produits de peche")

# --- Division 02 groups ---

r("group", "02.1", "T07", 0.55, "expert_rule",
  "Charbon et lignite -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le charbon est explicitement dans le label T07.",
  DOC_DOCTRINE, "Label PAD T07 = 'Clinker, farine, charbon, sable et vracs pondereux'")

r("group", "02.2", "T11", 0.60, "expert_rule",
  "Petrole brut -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. 'Petrole brut' est explicitement dans le label T11. Match direct.",
  DOC_DOCTRINE, "Label PAD T11 = 'Petrole brut, essences, bitumes, hydrocarbures raffines'")

r("group", "02.3", "T06", 0.45, "expert_rule",
  "Gaz naturel -> T06 : T06 = gasoil, fuel oil, diesel, butane en vrac, phosphates. Le butane est un gaz dans T06. Ambiguite car le gaz naturel n'est pas explicitement nomme, mais T06 couvre les hydrocarbures en vrac.",
  DOC_DOCTRINE, "Label PAD T06 = 'Gasoil, fuel oil, diesel, butane en vrac, phosphates'")

r("group", "02.3", "T11", 0.40, "expert_rule",
  "Gaz naturel -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Le gaz naturel pourrait aussi relever de T11 comme hydrocarbure. Candidate secondaire derriere T06.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# --- Division 03 groups ---

r("group", "03.1", "T03", 0.50, "expert_rule",
  "Minerais de fer -> T03 : T03 = acides, sucres et matieres premieres. Les minerais de fer sont des matieres premieres brutes.",
  DOC_DOCTRINE, "Label PAD T03 = 'Acides, sucres et matieres premieres'")

r("group", "03.2", "T03", 0.45, "expert_rule",
  "Minerais de metaux non ferreux -> T03 : matieres premieres brutes. Meme raisonnement que 03.1 mais confidence legerement inferieure car les minerais non ferreux sont plus varies.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "03.3", "T08", 0.50, "expert_rule",
  "Mineraux fertilisants -> T08 : T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les phosphates sont explicitement dans le label T08. Match direct.",
  DOC_DOCTRINE, "Label PAD T08 = 'Attapulgite, phosphates, ferrailles, tourteaux, cellulose'")

r("group", "03.3", "T06", 0.40, "expert_rule",
  "Mineraux fertilisants -> T06 : T06 mentionne aussi 'phosphates'. Conflit PAD : les phosphates apparaissent dans T06 ET T08. Validation operateur obligatoire pour arbitrer.",
  DOC_DOCTRINE, "Label PAD T06 = 'Gasoil, fuel oil, diesel, butane en vrac, phosphates'")

r("group", "03.4", "T10", 0.55, "expert_rule",
  "Sel -> T10 : T10 = sel de production locale. Match direct entre sel et le label T10. Note : T10 precise 'production locale', ce qui peut ne pas convenir pour du sel importe. Confidence moyenne car restriction possible.",
  DOC_DOCTRINE, "Label PAD T10 = 'Sel de production locale'")

r("group", "03.5", "T07", 0.55, "expert_rule",
  "Pierre, sable, gravier, argile -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le sable est explicitement dans le label T07. Les granulats et materiaux de carriere sont des vracs pondereux.",
  DOC_DOCTRINE, "Label PAD T07 = 'Clinker, farine, charbon, sable et vracs pondereux'")

r("group", "03.6", "T03", 0.30, "expert_rule",
  "Minerais d'uranium et de thorium -> T03 : matieres premieres specialisees. Extremement rare a Dakar. Confidence tres faible, usage theorique.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# --- Division 04 groups ---

r("group", "04.1", "T02", 0.45, "expert_rule",
  "Viandes, peaux brutes, produits carnes -> T02 : marchandises generales. Denrees alimentaires transformees classees en marchandises generales.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "04.2", "P05", 0.50, "expert_rule",
  "Poissons transformes et conserves -> P05 : P05 = produits de peche NDA. Les produits de peche transformes restent dans la famille PAD peche.",
  DOC_DOCTRINE, "Labels PAD P01-P05")

r("group", "04.3", "T02", 0.45, "expert_rule",
  "Fruits et legumes transformes -> T02 : marchandises generales. Conserves et produits alimentaires transformes.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "04.4", "T02", 0.40, "expert_rule",
  "Huiles et graisses animales et vegetales -> T02 : marchandises generales. Huiles alimentaires en conteneur.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "04.5", "T02", 0.40, "expert_rule",
  "Produits laitiers et creme glacee -> T02 : marchandises generales. Denrees alimentaires refrigerees.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "04.6", "T05", 0.55, "expert_rule",
  "Farines, amidons, aliments pour animaux -> T05 : T05 = cereales, ciment, riz et produits assimiles. Les farines sont des produits cerealiers transformes, directement dans la famille T05.",
  DOC_DOCTRINE, "Label PAD T05 = 'Cereales, ciment, riz et produits assimiles'")

r("group", "04.6", "T07", 0.40, "expert_rule",
  "Farines -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. La farine est explicitement dans le label T07 pour les vracs. Conflit avec T05 : depend si vrac (T07) ou conditionne (T05). Validation operateur necessaire.",
  DOC_DOCTRINE, "Label PAD T07 = 'Clinker, farine, charbon, sable et vracs pondereux'")

r("group", "04.7", "T01", 0.40, "expert_rule",
  "Boissons -> T01 : T01 = biens de valeur. Des alias PAD existants classent 'boissons alcoolisees' sous T01. Ambiguite pour les boissons non alcoolisees qui pourraient relever de T02.",
  DOC_DOCTRINE, "Alias PAD existant : 'boissons alcoolisees sauf vin 13' -> T01")

r("group", "04.7", "T02", 0.35, "expert_rule",
  "Boissons non alcoolisees -> T02 : marchandises generales. Les boissons non alcoolisees (eau, jus) sont des marchandises generales. Candidate secondaire, depend du type de boisson.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "04.8", "T02", 0.45, "expert_rule",
  "Autres produits alimentaires et tabac -> T02 : marchandises generales. Les denrees alimentaires diverses et le tabac sont classes marchandises generales.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "04.8", "T01", 0.35, "expert_rule",
  "Tabac, cigarettes -> T01 : T01 = biens de valeur. Un alias PAD existant classe 'autre tabac, cigarettes, cigares' sous T01. Candidate secondaire pour la composante tabac du groupe.",
  DOC_DOCTRINE, "Alias PAD existant : 'autre tabac cigarettes cigares et filtres' -> T01")

# --- Division 05 groups ---

r("group", "05.1", "T12", 0.45, "expert_rule",
  "Textiles -> T12 : T12 = materiaux et produits manufactures. Les textiles manufactures (tissus, fils) sont des produits manufactures au sens PAD.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "05.2", "T12", 0.45, "expert_rule",
  "Vetements et fourrures -> T12 : produits manufactures. Les vetements sont des produits finis manufactures.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "05.3", "T12", 0.45, "expert_rule",
  "Cuir et articles en cuir -> T12 : produits manufactures. Les articles en cuir (sacs, chaussures) sont des produits manufactures.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# --- Division 06 groups ---

r("group", "06.1", "T04", 0.60, "expert_rule",
  "Produits en bois et liege (hors meubles) -> T04 : T04 = bois et produits divers. Match direct entre bois et le label PAD T04.",
  DOC_DOCTRINE, "Label PAD T04 = 'Bois et produits divers'")

r("group", "06.2", "T04", 0.50, "expert_rule",
  "Pate a papier, papier et produits en papier -> T04 : T04 = bois et produits divers. Le papier derive du bois. Ambiguite possible avec T12 pour les produits en papier tres transformes.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "06.3", "T12", 0.40, "expert_rule",
  "Imprimes et medias enregistres -> T12 : produits manufactures. Les imprimes sont des produits manufactures finis. Pourraient aussi relever de T01 (biens de valeur) si haute valeur.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# --- Division 07 groups ---

r("group", "07.1", "T07", 0.55, "expert_rule",
  "Coke, briquettes, combustibles solides -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le coke et les combustibles solides sont des vracs pondereux.",
  DOC_DOCTRINE, "Label PAD T07")

r("group", "07.2", "T11", 0.65, "nstr_bridge_inferred",
  "Produits petroliers liquides raffines -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Match direct. Le pont NSTR->NST2007 (76 mappings pour division 07) confirme que les codes NSTR petroliers historiques convergent vers NST 07.2, et le label PAD T11 couvre explicitement les produits petroliers raffines.",
  DOC_NSTR_BRIDGE, "76 mappings NSTR division 07 + label PAD T11")

r("group", "07.2", "T06", 0.50, "expert_rule",
  "Produits petroliers liquides raffines -> T06 : T06 = gasoil, fuel oil, diesel. Le gasoil et le diesel sont des produits petroliers raffines liquides. Conflit T06/T11 : T06 couvre les carburants courants en vrac, T11 couvre les hydrocarbures raffines au sens large.",
  DOC_DOCTRINE, "Label PAD T06 = 'Gasoil, fuel oil, diesel, butane en vrac, phosphates'")

r("group", "07.3", "T06", 0.55, "expert_rule",
  "Produits petroliers gazeux, liquefies ou comprimes -> T06 : T06 = gasoil, fuel oil, diesel, butane en vrac. Le butane est un gaz petrolier liquefie, explicitement dans T06.",
  DOC_DOCTRINE, "Label PAD T06 = 'Gasoil, fuel oil, diesel, butane en vrac, phosphates'")

r("group", "07.4", "T11", 0.50, "expert_rule",
  "Produits petroliers solides ou cireux -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Les bitumes (solides/cireux) sont explicitement dans le label T11.",
  DOC_DOCTRINE, "Label PAD T11")

# --- Division 08 groups ---

r("group", "08.1", "T03", 0.55, "expert_rule",
  "Produits chimiques mineraux de base -> T03 : T03 = acides, sucres et matieres premieres. Les acides (sulfurique, chlorhydrique) sont des chimiques mineraux de base, explicitement dans le label T03.",
  DOC_DOCTRINE, "Label PAD T03 = 'Acides, sucres et matieres premieres'")

r("group", "08.2", "T03", 0.45, "expert_rule",
  "Produits chimiques organiques de base -> T03 : matieres premieres chimiques. Les solvants, alcools industriels sont des matieres premieres. Ambiguite possible avec T12 pour les produits chimiques finis.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "08.3", "T08", 0.50, "expert_rule",
  "Composes azotes et engrais -> T08 : T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les engrais chimiques et composes azotes se rapprochent des phosphates/mineraux de T08.",
  DOC_DOCTRINE, "Label PAD T08")

r("group", "08.4", "T03", 0.45, "expert_rule",
  "Plastiques de base et caoutchouc synthetique en formes primaires -> T03 : T03 = matieres premieres. Les resines, granules plastiques bruts sont des matieres premieres industrielles.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "08.4", "T12", 0.40, "expert_rule",
  "Plastiques de base -> T12 : T12 = materiaux et produits manufactures. Si le plastique est sous forme semi-finie (plaques, films), il peut relever de T12. Conflit 08.4 : T03 (matiere premiere brute) vs T12 (semi-fini). Validation operateur necessaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "08.5", "T01", 0.45, "expert_rule",
  "Produits pharmaceutiques et parachemiques -> T01 : T01 = biens de valeur. Les medicaments sont des produits de haute valeur. Alias PAD pertinents sous T01. Ambiguite avec T02 pour les produits parachemiques courants.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "08.5", "T02", 0.35, "expert_rule",
  "Produits parachemiques, pesticides -> T02 : marchandises generales. Les pesticides et produits agro-chimiques courants peuvent relever de T02. Candidate secondaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "08.6", "T12", 0.50, "expert_rule",
  "Produits en caoutchouc ou plastique -> T12 : T12 = materiaux et produits manufactures. Les pneus, tuyaux PVC, articles plastiques finis sont des produits manufactures.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "08.7", "T03", 0.25, "expert_rule",
  "Combustible nucleaire -> T03 : matieres premieres specialisees. Extremement rare a Dakar. Theorique uniquement. Confidence minimale.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# --- Division 09 groups ---

r("group", "09.1", "T12", 0.45, "expert_rule",
  "Verre, ceramique, porcelaine -> T12 : T12 = materiaux et produits manufactures. Les produits en verre et ceramique sont des produits manufactures.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "09.2", "T05", 0.60, "expert_rule",
  "Ciment, chaux, platre -> T05 : T05 = cereales, ciment, riz et produits assimiles. Le ciment est explicitement dans le label T05. Match direct.",
  DOC_DOCTRINE, "Label PAD T05 = 'Cereales, ciment, riz et produits assimiles'")

r("group", "09.2", "T07", 0.45, "expert_rule",
  "Ciment -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le clinker (matiere premiere du ciment) est dans T07. Conflit T05/T07 : depend si ciment fini (T05) ou clinker/vrac (T07). Validation operateur necessaire.",
  DOC_DOCTRINE, "Label PAD T07")

r("group", "09.3", "T12", 0.45, "expert_rule",
  "Autres materiaux de construction manufactures -> T12 : T12 = materiaux et produits manufactures. Carrelage, briques, tuiles sont des materiaux de construction manufactures.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "09.3", "T07", 0.40, "expert_rule",
  "Materiaux de construction en vrac -> T07 : T07 = vracs pondereux. Si les materiaux sont en vrac (graviers, agregats), ils relevent de T07. Candidate secondaire, depend du conditionnement.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# --- Division 10 groups ---

r("group", "10.1", "T14", 0.60, "nstr_bridge_inferred",
  "Fer, acier de base, ferro-alliages et produits de premiere transformation -> T14 : T14 = fil machine et feuillard. Les produits siderurgiques de premiere transformation (barres, billettes, fil machine) correspondent directement a T14. Le pont NSTR->NST2007 (1039 mappings pour division 10) confirme la convergence des codes NSTR siderurgiques historiques vers NST 10.1.",
  DOC_NSTR_BRIDGE, "1039 mappings NSTR division 10 + label PAD T14")

r("group", "10.2", "T12", 0.45, "expert_rule",
  "Metaux non ferreux et produits derives -> T12 : T12 = materiaux et produits manufactures. Les metaux non ferreux transformes (aluminium, cuivre en plaques/fils) sont des materiaux manufactures.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "10.3", "T12", 0.50, "expert_rule",
  "Tubes, tuyaux, profiles creux -> T12 : T12 = materiaux et produits manufactures. Les tubes et profiles metalliques sont des produits manufactures.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "10.4", "T12", 0.50, "expert_rule",
  "Produits metalliques structurels -> T12 : T12 = materiaux et produits manufactures. Les charpentes, pylones, structures metalliques sont des materiaux manufactures.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "10.5", "T12", 0.45, "expert_rule",
  "Chaudieres, quincaillerie, armes, autres produits metalliques -> T12 : produits manufactures. Ambiguite avec T01 pour les armes (biens de valeur). Confidence moyenne.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "10.5", "T01", 0.30, "expert_rule",
  "Armes -> T01 : T01 = biens de valeur. Un alias PAD existant classe 'armurerie' sous T01. Candidate secondaire uniquement pour la composante armes du groupe 10.5.",
  DOC_DOCTRINE, "Alias PAD existant : 'armurerie' -> T01")

# --- Division 11 groups ---

r("group", "11.1", "T09", 0.55, "expert_rule",
  "Machines agricoles et forestieres -> T09 : T09 = tracteurs, vehicules industriels et materiel de transport. Les tracteurs agricoles sont explicitement dans le label T09. Match direct.",
  DOC_DOCTRINE, "Label PAD T09 = 'Tracteurs, vehicules industriels et materiel de transport'")

r("group", "11.2", "T01", 0.45, "expert_rule",
  "Appareils menagers (electromenager blanc) -> T01 : T01 = biens de valeur, electronique, informatique et mobilier. L'electromenager est un bien de valeur. Ambiguite possible avec T12 pour les petits appareils courants.",
  DOC_DOCTRINE, "Label PAD T01")

r("group", "11.3", "T01", 0.60, "expert_rule",
  "Machines de bureau et ordinateurs -> T01 : T01 = biens de valeur, electronique, informatique et mobilier. L'informatique est explicitement dans le label T01. Alias PAD existants : 'mat informatique ordinateurs'. Match direct fort.",
  DOC_DOCTRINE, "Label PAD T01 + alias PAD 'mat informatique ordinateurs' -> T01")

r("group", "11.4", "T01", 0.45, "expert_rule",
  "Machines et appareils electriques NDA -> T01 : T01 = electronique. Les appareils electriques sont assimiles a l'electronique au sens PAD. Ambiguite avec T12 pour les equipements electriques industriels.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "11.4", "T12", 0.35, "expert_rule",
  "Machines electriques industrielles -> T12 : T12 = materiaux et produits manufactures. Les moteurs, transformateurs industriels peuvent relever de T12. Candidate secondaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "11.5", "T01", 0.55, "expert_rule",
  "Composants electroniques, appareils d'emission/transmission -> T01 : T01 = biens de valeur, electronique. Les composants electroniques sont des biens de valeur.",
  DOC_DOCTRINE, "Label PAD T01")

r("group", "11.6", "T01", 0.60, "expert_rule",
  "TV, radio, appareils audio/video -> T01 : T01 = biens de valeur, electronique. Alias PAD existants : 'electrophones chaines hifi', 'magnetophones magnetoscopes tv'. Match direct.",
  DOC_DOCTRINE, "Alias PAD : 'electrophones chaines hifi' -> T01, 'magnetophones magnetoscopes tv' -> T01")

r("group", "11.7", "T01", 0.55, "expert_rule",
  "Instruments medicaux, de precision, optiques, horlogerie -> T01 : T01 = biens de valeur. Alias PAD existants : 'horlogerie', 'instruments de mesure', 'appareils scientifiques'. Match direct.",
  DOC_DOCTRINE, "Alias PAD : 'horlogerie' -> T01, 'instruments de mesure' -> T01")

r("group", "11.8", "T09", 0.45, "expert_rule",
  "Autres machines, machines-outils et pieces -> T09 : T09 = vehicules industriels et materiel de transport. Les machines-outils industrielles se rapprochent du materiel industriel de T09.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "11.8", "T12", 0.40, "expert_rule",
  "Machines-outils et pieces -> T12 : T12 = materiaux et produits manufactures. Les pieces detachees et petites machines sont des produits manufactures. Candidate secondaire.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# --- Division 12 groups ---

r("group", "12.1", "T09", 0.60, "nstr_bridge_inferred",
  "Produits de l'industrie automobile -> T09 : T09 = tracteurs, vehicules industriels et materiel de transport. Les vehicules automobiles correspondent directement a T09. Le pont NSTR->NST2007 (312 mappings pour division 12) confirme la convergence des codes NSTR transport vers NST 12.1.",
  DOC_NSTR_BRIDGE, "312 mappings NSTR division 12 + label PAD T09")

r("group", "12.2", "T09", 0.55, "expert_rule",
  "Autres materiels de transport -> T09 : T09 = materiel de transport. Les navires, avions, wagons, remorques sont du materiel de transport.",
  DOC_DOCTRINE, "Label PAD T09")

# --- Division 13 groups ---

r("group", "13.1", "T01", 0.55, "expert_rule",
  "Meubles -> T01 : T01 = biens de valeur, electronique, informatique et mobilier. Le mobilier est explicitement dans le label T01. Match direct.",
  DOC_DOCTRINE, "Label PAD T01 = 'Biens de valeur, electronique, informatique et mobilier'")

r("group", "13.2", "T12", 0.45, "expert_rule",
  "Autres produits manufactures -> T12 : T12 = materiaux et produits manufactures. Les produits manufactures divers (jouets, articles de sport, bijouterie fantaisie) relevent de T12.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "13.2", "T01", 0.35, "expert_rule",
  "Produits manufactures de valeur -> T01 : T01 = biens de valeur. Certains articles (bijouterie vraie, instruments de musique) sont classes T01 par alias PAD existants. Candidate secondaire, depend du produit exact.",
  DOC_DOCTRINE, "Alias PAD : 'bijouterie sauf bijouterie fantaisie' -> T01, 'instruments de musique' -> T01")

# --- Division 14 groups ---

r("group", "14.1", "T08", 0.35, "expert_rule",
  "Dechets menagers et municipaux -> T08 : T08 inclut ferrailles. Les dechets metalliques menagers pourraient relever de T08. Tres ambigu : les dechets municipaux non metalliques n'ont pas de categorie PAD claire. Confidence faible.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "14.2", "T08", 0.50, "nstr_bridge_inferred",
  "Autres dechets et matieres premieres secondaires -> T08 : T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les ferrailles (matiere premiere secondaire) sont explicitement dans T08. Le pont NSTR->NST2007 (118 mappings pour division 14) confirme la convergence des codes NSTR dechets/ferrailles vers NST 14.2.",
  DOC_NSTR_BRIDGE, "118 mappings NSTR division 14 + label PAD T08")

# --- Division 16 groups ---

r("group", "16.1", "T09", 0.45, "expert_rule",
  "Conteneurs et caisses mobiles en service, vides -> T09 : T09 = materiel de transport. Les conteneurs en service sont du materiel de transport. Note : categorie PAD potentiellement non applicable car les conteneurs vides ne sont pas toujours soumis au droit de passage.",
  DOC_DOCTRINE, "Label PAD T09")

# --- Division 17 groups ---

r("group", "17.1", "T02", 0.35, "expert_rule",
  "Demenagement -> T02 : marchandises generales. Les effets personnels de demenagement sont classes marchandises generales. Usage peu frequent en conteneur maritime a Dakar.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

r("group", "17.5", "T02", 0.25, "expert_rule",
  "Autres marchandises non marchandes NDA -> T02 : marchandises generales par defaut. Categorie residuelle tres vague. Confidence minimale.",
  DOC_DOCTRINE, DOC_DOCTRINE_REF)

# Groups 18.0, 19.1, 19.2 — EXCLUDED (operator blocking mandatory)


# =====================================================================
# VALIDATION
# =====================================================================

PAD_REGEX = re.compile(r"^(T(0[1-9]|1[0-4])|P0[1-5])$")
DIV_CODE_REGEX = re.compile(r"^[0-9]{2}$")
GRP_CODE_REGEX = re.compile(r"^[0-9]{2}\.[0-9A-Z]$")

ERRORS = []

for i, rule in enumerate(RULES):
    rid = f"Rule {i+1} ({rule['nst_level']} {rule['nst_code']} -> {rule['pad_category']})"

    if rule["validation_status"] != "candidate":
        ERRORS.append(f"{rid}: validation_status must be 'candidate', got '{rule['validation_status']}'")
    if rule["requires_operator_validation"] is not True:
        ERRORS.append(f"{rid}: requires_operator_validation must be True")
    if rule["evidence_level"] not in ("expert_rule", "nstr_bridge_inferred"):
        ERRORS.append(f"{rid}: evidence_level '{rule['evidence_level']}' not allowed")
    if not PAD_REGEX.match(rule["pad_category"]):
        ERRORS.append(f"{rid}: pad_category '{rule['pad_category']}' invalid")
    if rule["nst_level"] == "division":
        if rule["confidence"] > 0.50:
            ERRORS.append(f"{rid}: division confidence {rule['confidence']} > 0.50")
        if not DIV_CODE_REGEX.match(rule["nst_code"]):
            ERRORS.append(f"{rid}: division code format invalid")
        if rule["nst_code"] in ("18", "19", "20"):
            ERRORS.append(f"{rid}: division {rule['nst_code']} excluded")
    elif rule["nst_level"] == "group":
        if rule["confidence"] > 0.65:
            ERRORS.append(f"{rid}: group confidence {rule['confidence']} > 0.65")
        if not GRP_CODE_REGEX.match(rule["nst_code"]):
            ERRORS.append(f"{rid}: group code format invalid")
        if rule["nst_code"] in ("18.0", "19.1", "19.2"):
            ERRORS.append(f"{rid}: group {rule['nst_code']} excluded")
    if rule["confidence"] > 0.65:
        ERRORS.append(f"{rid}: confidence {rule['confidence']} > 0.65 global max")
    if rule["nst_label"] == "UNKNOWN":
        ERRORS.append(f"{rid}: nst_label is UNKNOWN")

if ERRORS:
    print("VALIDATION ERRORS:")
    for e in ERRORS:
        print(f"  - {e}")
    sys.exit(1)

print(f"Validation passed: {len(RULES)} rules, 0 errors.")


# =====================================================================
# GENERATE CSV
# =====================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
RULES_DIR = os.path.join(BASE_DIR, "rules")
os.makedirs(RULES_DIR, exist_ok=True)

CSV_PATH = os.path.join(RULES_DIR, "pad_nst_2e_rule_candidates.csv")
CSV_COLS = [
    "nst_level", "nst_code", "nst_label", "pad_category", "pad_category_label",
    "confidence", "evidence_level", "validation_status", "requires_operator_validation",
    "notes", "source_document", "source_reference",
]

with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=CSV_COLS)
    writer.writeheader()
    for rule in sorted(RULES, key=lambda x: (0 if x["nst_level"] == "division" else 1, x["nst_code"], x["pad_category"])):
        writer.writerow(rule)

print(f"CSV written: {CSV_PATH} ({len(RULES)} rows)")


# =====================================================================
# STATISTICS
# =====================================================================

div_rules = [r for r in RULES if r["nst_level"] == "division"]
grp_rules = [r for r in RULES if r["nst_level"] == "group"]

pad_counter = Counter(r["pad_category"] for r in RULES)
evidence_counter = Counter(r["evidence_level"] for r in RULES)

conflicts = defaultdict(list)
for rule in RULES:
    key = (rule["nst_level"], rule["nst_code"])
    conflicts[key].append(rule["pad_category"])
multi_pad = {k: v for k, v in conflicts.items() if len(v) > 1}

excluded_divisions = {"18", "19", "20"}
all_div_codes = set(NST_DIVISIONS.keys()) - excluded_divisions
covered_div = set(r["nst_code"] for r in div_rules)
uncovered_div = all_div_codes - covered_div

excluded_groups = {"18.0", "19.1", "19.2"}
all_grp_codes = set(NST_GROUPS.keys()) - excluded_groups
covered_grp = set(r["nst_code"] for r in grp_rules)
uncovered_grp = all_grp_codes - covered_grp


# =====================================================================
# GENERATE MARKDOWN REPORT
# =====================================================================

MD_PATH = os.path.join(BASE_DIR, "PAD_NST_2E_RULE_CANDIDATES.md")

lines = []
def w(s=""):
    lines.append(s)

w(f"# PAD-NST-2E-A — Rule Candidate Manifest")
w()
w(f"**Date** : {date.today().isoformat()}")
w(f"**Phase** : PAD-NST-2E-A — Manifeste des regles candidates (documentation uniquement)")
w(f"**Statut** : En attente de validation CTO")
w(f"**Import DB** : NON — aucune donnee importee")
w()
w("---")
w()
w("## 1. Resume executif")
w()
w(f"Ce manifeste liste **{len(RULES)} regles candidates** pour le rapprochement NST 2007 -> PAD.")
w(f"Aucune de ces regles n'a ete importee en base de donnees.")
w()
w(f"| Metrique | Valeur |")
w(f"|----------|--------|")
w(f"| Regles division-level | **{len(div_rules)}** |")
w(f"| Regles group-level | **{len(grp_rules)}** |")
w(f"| Total | **{len(RULES)}** |")
w(f"| Regles `validated` | **0** |")
w(f"| Regles `requires_operator_validation = false` | **0** |")
w(f"| Regles `pad_official_extract` | **0** |")
w(f"| Regles `confidence > 0.65` | **0** |")
w(f"| Regles division `confidence > 0.50` | **0** |")
w(f"| Regles pour divisions 18, 19, 20 | **0** |")
w()
w("**Categories PAD verifiees par introspection DB** (`commodity_categories` table, 19 categories confirmees).")
w()
w("---")
w()
w("## 2. Categories PAD utilisees (source : introspection DB commodity_categories)")
w()
w("| PAD | Label officiel DB |")
w("|-----|-------------------|")
for pad in sorted(PAD_CATEGORIES.keys()):
    w(f"| {pad} | {PAD_CATEGORIES[pad]} |")
w()

w("---")
w()
w("## 3. Repartition par categorie PAD")
w()
w("| PAD | Label | Nombre de regles |")
w("|-----|-------|-----------------|")
for pad in sorted(PAD_CATEGORIES.keys()):
    cnt = pad_counter.get(pad, 0)
    if cnt > 0:
        w(f"| {pad} | {PAD_CATEGORIES[pad]} | {cnt} |")
w()
w("Categories PAD sans aucune regle candidate :")
w()
for pad in sorted(PAD_CATEGORIES.keys()):
    if pad_counter.get(pad, 0) == 0:
        w(f"- **{pad}** — {PAD_CATEGORIES[pad]}")
w()

w("---")
w()
w("## 4. Repartition par evidence_level")
w()
w("| Evidence Level | Nombre |")
w("|---------------|--------|")
for ev in sorted(evidence_counter.keys()):
    w(f"| `{ev}` | {evidence_counter[ev]} |")
w()

w("---")
w()
w("## 5. Codes NST sans regle")
w()

if uncovered_div:
    w("### Divisions sans regle")
    w()
    for d in sorted(uncovered_div):
        w(f"- **{d}** — {NST_DIVISIONS[d]}")
    w()
else:
    w("### Divisions sans regle")
    w()
    w("Aucune (toutes les divisions 01-17 ont au moins une regle).")
    w()

w("### Divisions exclues (blocage operateur obligatoire)")
w()
for d in sorted(excluded_divisions):
    w(f"- **{d}** — {NST_DIVISIONS[d]} — Aucune categorie PAD unique possible, validation operateur obligatoire")
w()

if uncovered_grp:
    w("### Groupes sans regle")
    w()
    for g in sorted(uncovered_grp):
        w(f"- **{g}** — {NST_GROUPS[g]}")
    w()
else:
    w("### Groupes sans regle")
    w()
    w("Aucun (tous les groupes hors 18.0/19.1/19.2 ont au moins une regle).")
    w()

w("### Groupes exclus (blocage operateur obligatoire)")
w()
for g in sorted(excluded_groups):
    w(f"- **{g}** — {NST_GROUPS[g]}")
w()

w("---")
w()
w("## 6. Codes NST avec plusieurs categories PAD candidates (conflits)")
w()
if multi_pad:
    w("| Niveau | Code NST | Label | Categories PAD candidates |")
    w("|--------|----------|-------|--------------------------|")
    for (level, code), pads in sorted(multi_pad.items()):
        label = NST_DIVISIONS.get(code, "") if level == "division" else NST_GROUPS.get(code, "")
        short_label = label[:60] + "..." if len(label) > 60 else label
        w(f"| {level} | {code} | {short_label} | {', '.join(sorted(set(pads)))} |")
    w()
    w(f"**Total : {len(multi_pad)} codes NST avec conflits.**")
    w()
    w("Pour chaque conflit, l'application future devra afficher toutes les candidates a l'operateur, pas choisir automatiquement.")
else:
    w("Aucun conflit.")
w()

w("---")
w()
w("## 7. Regles division-level")
w()
w("| Code | Label | PAD | Confidence | Evidence | Notes |")
w("|------|-------|-----|-----------|----------|-------|")
for rule in sorted(div_rules, key=lambda x: (x["nst_code"], x["pad_category"])):
    short_label = rule["nst_label"][:50] + "..." if len(rule["nst_label"]) > 50 else rule["nst_label"]
    short_notes = rule["notes"][:100] + "..." if len(rule["notes"]) > 100 else rule["notes"]
    w(f"| {rule['nst_code']} | {short_label} | {rule['pad_category']} | {rule['confidence']:.2f} | `{rule['evidence_level']}` | {short_notes} |")
w()

w("---")
w()
w("## 8. Regles group-level")
w()
w("| Code | Label | PAD | Confidence | Evidence | Notes |")
w("|------|-------|-----|-----------|----------|-------|")
for rule in sorted(grp_rules, key=lambda x: (x["nst_code"], x["pad_category"])):
    short_label = rule["nst_label"][:50] + "..." if len(rule["nst_label"]) > 50 else rule["nst_label"]
    short_notes = rule["notes"][:100] + "..." if len(rule["notes"]) > 100 else rule["notes"]
    w(f"| {rule['nst_code']} | {short_label} | {rule['pad_category']} | {rule['confidence']:.2f} | `{rule['evidence_level']}` | {short_notes} |")
w()

w("---")
w()
w("## 9. Perimetre strict")
w()
w("| Item | Statut |")
w("|------|--------|")
w("| Import DB | ❌ Aucun |")
w("| Migration | ❌ Aucune |")
w("| `src/` modifications | ❌ Aucune |")
w("| Edge Functions | ❌ Aucune |")
w("| `config.toml` | ❌ Non modifie |")
w("| Runtime impact | ❌ Aucun |")
w()
w("---")
w()
w("## 10. Prochaine etape")
w()
w("Apres validation CTO du manifeste :")
w("- **PAD-NST-2E-B** : import des regles validees en base (`pad_nst_recommendation_rules`)")
w("- L'import ne concernera que les regles explicitement approuvees par le CTO")
w("- Aucune regle ne sera importee avec `validation_status = 'validated'`")

with open(MD_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"Markdown written: {MD_PATH}")
print()
print("=== SUMMARY ===")
print(f"Total rules: {len(RULES)}")
print(f"  Division-level: {len(div_rules)}")
print(f"  Group-level: {len(grp_rules)}")
print(f"  Evidence levels: {dict(evidence_counter)}")
print(f"  PAD distribution: {dict(sorted(pad_counter.items()))}")
print(f"  Conflicts (multi-PAD): {len(multi_pad)}")
print(f"  Uncovered divisions: {sorted(uncovered_div) if uncovered_div else 'none'}")
print(f"  Uncovered groups: {sorted(uncovered_grp) if uncovered_grp else 'none'}")
print(f"  Excluded: divisions 18,19,20 + groups 18.0,19.1,19.2")
