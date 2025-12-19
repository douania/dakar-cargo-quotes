/**
 * Code CTU (Code de bonnes pratiques OMI/OIT/CEE-ONU pour le chargement des cargaisons dans des engins de transport)
 * Référence pour l'application - Janvier 2014
 * 
 * Source: public/data/CTU_Code_French_01.pdf
 */

export const CTU_CODE_REFERENCE = {
  // Informations générales
  general: {
    name: "Code CTU",
    fullName: "Code de bonnes pratiques OMI/OIT/CEE-ONU pour le chargement des cargaisons dans des engins de transport",
    date: "Janvier 2014",
    organizations: ["OMI", "OIT", "CEE-ONU"],
    purpose: "Fournir des conseils sur la sécurité de l'empotage aux personnes préposées au chargement et à l'assujettissement des cargaisons dans des engins de transport"
  },

  // Définitions clés (Chapitre 2)
  definitions: {
    engin_de_transport: "Conteneur, caisse mobile, véhicule, wagon de chemin de fer ou tout autre engin analogue, en particulier lorsqu'il est utilisé pour le transport intermodal.",
    conteneur: "Engin de transport de caractère permanent et assez résistant pour permettre un usage répété, spécialement conçu pour faciliter le transport des marchandises sans rupture de charge, approuvé conformément à la Convention CSC.",
    empoteur: "Partie qui charge ou remplit un engin de transport ou place la cargaison sur un engin; peut être engagé sous contrat par l'expéditeur, le chargeur, le transitaire ou le transporteur.",
    empotage: "Opérations consistant à charger et remplir un engin de transport ou à placer la cargaison sur un engin.",
    chargeur: "Partie nommée sur le connaissement ou sur la lettre de transport comme étant le chargeur et/ou qui a passé un contrat de transport avec un transporteur.",
    expediteur: "Partie qui prépare un chargement qu'elle présente au transport.",
    transitaire: "Partie qui organise des expéditions pour des personnes physiques ou morales et peut également être le transporteur.",
    destinataire: "Partie à laquelle une cargaison est envoyée en vertu d'un contrat de transport.",
    transporteur: "Partie qui, aux termes d'un contrat de transport, s'engage à effectuer ou faire effectuer le transport.",
    masse_brute: "Masse combinée de la cargaison et de l'engin de transport.",
    surcharge: "Situation dans laquelle la masse brute est supérieure à la masse brute maximale admissible.",
    arrimage_solidaire: "Méthode d'assujettissement où la cargaison s'appuie complètement contre l'entourage d'un engin de transport.",
    point_de_rosee: "Température inférieure à la température effective à laquelle une humidité relative donnée atteindrait 100%.",
    condensation: "Transformation de la vapeur d'eau en liquide, se produit généralement lorsque l'air atteint son point de rosée."
  },

  // Responsabilités par acteur (Chapitre 4)
  responsabilites: {
    exploitant_engin: {
      role: "Exploitant de l'engin de transport",
      obligations: [
        "Fournir un engin adapté aux besoins",
        "S'assurer que l'engin satisfait aux normes internationales relatives à l'intégrité de la structure"
      ]
    },
    expediteur: {
      role: "Expéditeur",
      obligations: [
        "Décrire correctement les marchandises, y compris la masse de la charge utile totale",
        "Signaler au préposé au chargement tout paramètre de transport inhabituel (ex: excentricité du centre de gravité)",
        "S'assurer que les colis et unités de charge peuvent résister aux contraintes escomptées",
        "Fournir tous les renseignements nécessaires pour un chargement correct",
        "S'assurer que les marchandises dangereuses sont correctement classées, emballées et étiquetées",
        "Remettre le document de transport des marchandises dangereuses"
      ]
    },
    empoteur: {
      role: "Empoteur / Préposé au chargement",
      obligations: [
        "Vérifier l'engin de transport avant chargement",
        "S'assurer que l'engin est dans un état approprié pour la cargaison",
        "S'assurer que le plancher n'est pas soumis à des contraintes excessives",
        "S'assurer que la cargaison est correctement répartie et soutenue",
        "S'assurer que l'engin n'est pas surchargé",
        "S'assurer que la cargaison est suffisamment assujettie",
        "Fermer correctement l'engin et y apposer un scellé",
        "Apposer les marques et plaques-étiquettes pour marchandises dangereuses",
        "Déterminer avec exactitude la masse brute de l'engin",
        "Fournir le certificat d'empotage du conteneur/véhicule"
      ]
    },
    chargeur: {
      role: "Chargeur",
      obligations: [
        "S'assurer qu'un engin approprié est utilisé pour le mode de transport prévu",
        "S'assurer que l'engin est sûr, propre et exempt de résidus",
        "S'assurer que la cargaison est décrite avec exactitude",
        "Communiquer la masse brute vérifiée au transporteur",
        "Remettre les documents de transport et certificat de chargement",
        "Communiquer le numéro de scellé au transporteur"
      ]
    },
    transporteur_routier: {
      role: "Transporteur routier",
      obligations: [
        "Confirmer que le véhicule respecte les limites de masse, longueur, largeur et hauteur",
        "S'assurer que le conducteur peut prendre suffisamment de repos",
        "Assujettir l'engin convenablement sur la remorque ou le châssis",
        "Déplacer l'engin sans contrainte excessive sur l'engin ou la cargaison"
      ]
    },
    destinataire: {
      role: "Destinataire / Réceptionnaire",
      obligations: [
        "Ne pas soumettre le plancher à des contraintes excessives pendant le déchargement",
        "Aérer correctement l'engin avant d'y entrer",
        "Confirmer que l'atmosphère n'est pas dangereuse avant d'autoriser l'entrée",
        "Détecter tout dommage et le signaler au transporteur",
        "Rendre l'engin vide et propre",
        "Retirer toutes les marques et plaques-étiquettes des chargements antérieurs"
      ]
    }
  },

  // Coefficients d'accélération (Chapitre 5)
  coefficients_acceleration: {
    routier: {
      longitudinal: { cx: 0.8, cy: 0.5, cz: 1.0 },
      transversal: { cx: null, cy: 0.5, cz: 1.0 }
    },
    ferroviaire: {
      longitudinal: { cx: "0.5 (1.0)", cy: "0.5 (1.0)", cz: "1.0 (0.7)" },
      transversal: { cx: null, cy: 0.5, cz: "1.0 (0.7)" },
      note: "Valeurs entre parenthèses pour charges dynamiques de courte durée (≤150ms)"
    },
    maritime: {
      zones: {
        moins_8m: { description: "Mers intérieures et côtières", cx: 0.3, cy: 0.5, cz: 1.0 },
        "8m_12m": { description: "Océans modérés", cx: 0.4, cy: 0.7, cz: 1.0 },
        plus_12m: { description: "Haute mer / grands océans", cx: 0.4, cy: 0.8, cz: 1.0 }
      }
    }
  },

  // Propriétés des conteneurs (Chapitre 6)
  conteneurs: {
    dimensions_iso: true,
    masse_brute_max: "Indiquée sur la plaque d'agrément CSC",
    resistance_parois: {
      laterales: "60% de la charge utile admissible",
      avant: "40% de la charge utile admissible",
      porte: "40% de la charge utile admissible"
    },
    points_ancrage: {
      inferieurs: "CMA ≥ 10 kN (modernes: 20 kN)",
      longerons_superieurs: "CMA ≥ 5 kN"
    },
    charge_plancher: {
      par_essieu: "5 460 kg",
      par_roue: "2 730 kg"
    },
    gerbage: {
      standard: "≥ 192 000 kg (transport sans restriction)",
      limite: "< 192 000 kg (attention particulière en transport intermodal)"
    },
    types: [
      "Conteneur d'usage général (fermé)",
      "Conteneur ventilé",
      "Conteneur à toit ouvert",
      "Conteneur à parois latérales ouvertes",
      "Conteneur plate-forme",
      "Conteneur thermique/frigorifique",
      "Conteneur-citerne",
      "Conteneur pour vrac sec"
    ]
  },

  // Caisses mobiles (Chapitre 6.4)
  caisses_mobiles: {
    largeur: ["2.50 m", "2.55 m"],
    classes: {
      A: { longueur: "12.2 - 13.6 m", masse_brute_max: "34 tonnes" },
      B: { longueur: "9.125 m (30 pieds)" },
      C: { longueur: "7.15, 7.45 ou 7.82 m", masse_brute_max: "16 tonnes" }
    },
    resistance_parois_classe_C: {
      avant_arriere: "40% de la charge utile",
      laterales: "30% de la charge utile"
    },
    charge_plancher: {
      par_essieu: "4 400 kg",
      par_roue: "2 200 kg"
    }
  },

  // Seuils d'humidité
  seuils_humidite: {
    corrosion: {
      seuil: "≥ 40%",
      risque: "Risque accru de corrosion des métaux ferreux"
    },
    moisissures: {
      seuil: "≥ 75%",
      risque: "Risque accru de développement de moisissures sur substances organiques"
    }
  },

  // Règles principales (Chapitre 3)
  regles_principales: {
    a_faire: [
      "Vérifier l'engin de transport avant chargement",
      "Répartir la cargaison de manière uniforme",
      "Assujettir solidement toute la cargaison",
      "Apposer les marques et plaques-étiquettes appropriées",
      "Fermer et sceller correctement l'engin",
      "Documenter avec exactitude le contenu et la masse"
    ],
    a_ne_pas_faire: [
      "Surcharger l'engin de transport",
      "Charger des marchandises incompatibles ensemble",
      "Négliger l'assujettissement de la cargaison",
      "Déclarer une masse incorrecte",
      "Omettre de vérifier l'état de l'engin"
    ]
  }
};

/**
 * Récupère le contexte CTU pertinent pour un sujet donné
 */
export function getCTUContext(topic: string): string {
  const contexts: Record<string, string> = {
    empotage: `
=== CODE CTU - Règles d'empotage ===

DÉFINITION: L'empotage désigne les opérations consistant à charger et remplir un engin de transport ou à placer la cargaison sur un engin.

RESPONSABILITÉS DE L'EMPOTEUR:
${CTU_CODE_REFERENCE.responsabilites.empoteur.obligations.map(o => `• ${o}`).join('\n')}

VÉRIFICATIONS AVANT EMPOTAGE:
• Vérifier que l'engin est adapté à la cargaison
• Vérifier l'intégrité structurelle (plancher, parois, portes, joints)
• S'assurer que l'engin est propre et exempt de résidus
• Vérifier la présence de la plaque CSC valide

LIMITES DE CHARGE DU PLANCHER (Conteneurs ISO):
• Charge par essieu max: ${CTU_CODE_REFERENCE.conteneurs.charge_plancher.par_essieu}
• Charge par roue max: ${CTU_CODE_REFERENCE.conteneurs.charge_plancher.par_roue}
`,
    assujettissement: `
=== CODE CTU - Assujettissement des cargaisons ===

PRINCIPES GÉNÉRAUX:
• La cargaison doit être assujettie pour résister aux accélérations en transport
• L'arrimage solidaire: la cargaison s'appuie complètement contre les parois

COEFFICIENTS D'ACCÉLÉRATION À CONSIDÉRER:
Transport routier: Longitudinal 0.8g, Transversal 0.5g, Vertical 1.0g
Transport ferroviaire: Longitudinal 0.5-1.0g, Transversal 0.5g, Vertical 0.7-1.0g
Transport maritime: Variable selon hauteur de houle (0.3-0.4g long., 0.5-0.8g transv.)

POINTS D'ANCRAGE (Conteneurs ISO):
• Points d'ancrage inférieurs: CMA ≥ 10 kN (conteneurs modernes: 20 kN)
• Longerons supérieurs: CMA ≥ 5 kN

RÉSISTANCE DES PAROIS:
• Parois latérales: peuvent supporter 60% de la charge utile
• Paroi avant et porte: peuvent supporter 40% de la charge utile
`,
    responsabilites: `
=== CODE CTU - Chaîne de responsabilités ===

EXPÉDITEUR:
${CTU_CODE_REFERENCE.responsabilites.expediteur.obligations.slice(0, 4).map(o => `• ${o}`).join('\n')}

EMPOTEUR:
${CTU_CODE_REFERENCE.responsabilites.empoteur.obligations.slice(0, 5).map(o => `• ${o}`).join('\n')}

CHARGEUR:
${CTU_CODE_REFERENCE.responsabilites.chargeur.obligations.slice(0, 4).map(o => `• ${o}`).join('\n')}

DESTINATAIRE:
${CTU_CODE_REFERENCE.responsabilites.destinataire.obligations.slice(0, 4).map(o => `• ${o}`).join('\n')}

PRINCIPE CLÉ: Toute personne dans la chaîne logistique compte sur la compétence de l'empoteur car il est souvent le dernier à voir le contenu jusqu'à destination.
`,
    conteneurs: `
=== CODE CTU - Types de conteneurs ===

CONTENEURS ISO STANDARDS:
${CTU_CODE_REFERENCE.conteneurs.types.map(t => `• ${t}`).join('\n')}

CARACTÉRISTIQUES STRUCTURELLES:
• Masse brute max: indiquée sur la plaque CSC
• Résistance parois latérales: ${CTU_CODE_REFERENCE.conteneurs.resistance_parois.laterales}
• Résistance paroi avant/porte: ${CTU_CODE_REFERENCE.conteneurs.resistance_parois.avant}

GERBAGE:
• Standard (≥192 000 kg): transport sans restriction
• Limité (<192 000 kg): attention particulière en transport intermodal maritime

CAISSES MOBILES (Europe):
• Classe A: 12.2-13.6m, max 34t
• Classe B: 9.125m (30')
• Classe C: 7.15-7.82m, max 16t
`,
    humidite: `
=== CODE CTU - Contrôle de l'humidité ===

SEUILS CRITIQUES:
• Seuil de corrosion: ≥40% d'humidité relative → risque de corrosion des métaux ferreux
• Seuil de moisissures: ≥75% d'humidité relative → risque sur denrées, textiles, bois, cuir

CONDENSATION:
• Se produit quand l'air atteint son point de rosée au contact d'une surface froide
• Lors de longs voyages, les conditions climatiques varient considérablement
• Un contrôle insuffisant de l'humidité peut:
  - Endommager gravement la cargaison
  - Provoquer l'affaissement de la cargaison
  - Entraîner une perte de stabilité de l'engin

CONTENEURS VENTILÉS:
• Équipés de grilles de ventilation étanches aux intempéries
• Permettent un échange d'air et d'humidité limité avec l'atmosphère
`,
    marchandises_dangereuses: `
=== CODE CTU - Marchandises dangereuses ===

OBLIGATIONS DE L'EXPÉDITEUR:
• Classer correctement les marchandises dangereuses
• Emballer et étiqueter conformément aux règlements
• Préparer le document de transport des marchandises dangereuses
• Remettre la documentation au préposé au chargement, transitaire, chargeur et transporteur

OBLIGATIONS DE L'EMPOTEUR:
• Apposer les marques et plaques-étiquettes sur l'engin de transport
• S'assurer que des marchandises dangereuses incompatibles ne sont pas chargées ensemble
• Tenir compte de TOUTES les législations applicables tout au long de la chaîne de transport
• Fournir le certificat d'empotage

CONTENEURS-CITERNES:
• Le caisson et tous les accessoires (soupapes, décompresseurs) doivent être conformes aux règles
• La Convention CSC s'applique au châssis
`
  };

  return contexts[topic] || contexts.empotage;
}

/**
 * Analyse si le Code CTU est pertinent pour une question donnée
 */
export function isCTURelevant(question: string): boolean {
  const ctuKeywords = [
    'empotage', 'empoteur', 'conteneur', 'container', 'chargement', 'déchargement',
    'arrimage', 'assujettissement', 'saisissage', 'ancrage',
    'ctu', 'csc', 'iso',
    'masse brute', 'surcharge', 'gerbage',
    'caisse mobile', 'remorque', 'wagon',
    'fumigation', 'condensation', 'humidité',
    'plaque d\'agrément', 'scellé', 'plombage',
    'transport intermodal', 'transport combiné',
    'responsabilité chargeur', 'responsabilité empoteur'
  ];
  
  const lowerQuestion = question.toLowerCase();
  return ctuKeywords.some(kw => lowerQuestion.includes(kw));
}

/**
 * Retourne tous les contextes CTU pertinents pour une question
 */
export function getAllRelevantCTUContexts(question: string): string[] {
  const contexts: string[] = [];
  const lowerQuestion = question.toLowerCase();
  
  if (/empotage|empoter|chargement|charger/.test(lowerQuestion)) {
    contexts.push(getCTUContext('empotage'));
  }
  if (/arrimage|assujettissement|saisissage|ancrage|point.*(ancrage|saisissage)/.test(lowerQuestion)) {
    contexts.push(getCTUContext('assujettissement'));
  }
  if (/responsabilit|obligation|chargeur|empoteur|transitaire/.test(lowerQuestion)) {
    contexts.push(getCTUContext('responsabilites'));
  }
  if (/conteneur|container|caisse mobile|wagon|remorque|type.*engin/.test(lowerQuestion)) {
    contexts.push(getCTUContext('conteneurs'));
  }
  if (/humidit|condensation|moisissure|rouille|corrosion/.test(lowerQuestion)) {
    contexts.push(getCTUContext('humidite'));
  }
  if (/dangereu|adr|imdg|onu|un\s?\d{4}|classe\s?\d/.test(lowerQuestion)) {
    contexts.push(getCTUContext('marchandises_dangereuses'));
  }
  
  return contexts;
}
