// Référence légale - Code des Douanes du Sénégal (Loi 2014-10 du 28 février 2014)
// Ce fichier contient les extraits pertinents pour les cotations et régimes douaniers

export const CUSTOMS_CODE_REFERENCE = {
  source: "Loi n° 2014-10 du 28 février 2014 portant Code des Douanes du Sénégal",
  lastUpdate: "2014-02-28",
  
  regimes: {
    // CHAPITRE V - ADMISSION TEMPORAIRE (Articles 208-227)
    admission_temporaire: {
      articles: "208-227",
      title: "ADMISSION TEMPORAIRE",
      sections: {
        perfectionnement_actif: {
          articles: "209-212",
          description: "Admission temporaire pour perfectionnement actif - permet l'importation de marchandises destinées à être transformées, ouvrées ou réparées puis réexportées",
          conditions: [
            "Les marchandises importées doivent être réexportées après transformation",
            "Délai maximum fixé par l'administration",
            "Suspension des droits et taxes à l'importation",
            "Garantie ou caution exigée"
          ]
        },
        perfectionnement_passif: {
          articles: "213-216",
          description: "Admission temporaire pour perfectionnement passif - permet l'exportation temporaire de marchandises nationales pour transformation à l'étranger",
          conditions: [
            "Réimportation après transformation avec exonération partielle des droits",
            "Délai fixé par l'administration"
          ]
        },
        ate: {
          articles: "217-218",
          title: "Admission Temporaire Exceptionnelle (ATE)",
          description: "Régime permettant l'utilisation temporaire de marchandises importées avec suspension des droits",
          article_217: `L'admission temporaire exceptionnelle permet l'importation en suspension des droits et taxes de marchandises destinées à être réexportées dans un délai déterminé, après avoir servi à l'usage prévu.`,
          conditions: [
            "Marchandises identifiables à la réexportation",
            "Usage prévu conforme à la demande",
            "Délai de séjour limité (généralement 6 mois renouvelable)",
            "Garantie ou engagement de réexportation",
            "Pas de transformation substantielle autorisée",
            "Réexportation obligatoire ou mise à la consommation avec paiement des droits"
          ],
          usages_courants: [
            "Matériel d'entrepreneurs pour travaux temporaires",
            "Équipements de chantier",
            "Matériel de spectacle ou d'exposition",
            "Conteneurs et emballages réutilisables",
            "Véhicules de tourisme (carnet ATA)",
            "Échantillons commerciaux"
          ],
          attention: "L'ATE n'est PAS appropriée pour les marchandises en transit vers un pays tiers (utiliser TRIE)"
        },
        ats: {
          articles: "219",
          title: "Admission Temporaire Spéciale (ATS)",
          description: "Régime spécifique pour certaines catégories de marchandises avec conditions particulières"
        }
      },
      dispositions_communes: {
        articles: "220-227",
        garanties: "Caution ou consignation des droits et taxes suspendus",
        apurement: "Par réexportation, mise à la consommation, ou transfert vers un autre régime",
        sanctions: "Non-respect des délais = exigibilité immédiate des droits + pénalités"
      }
    },

    // CHAPITRE III - TRANSIT (Articles 161-169)
    transit: {
      articles: "161-169",
      title: "TRANSIT",
      description: "Régime permettant le transport de marchandises sous douane d'un point à un autre du territoire",
      types: {
        transit_ordinaire: {
          description: "Transit national - d'un bureau à un autre dans le même territoire",
          conditions: ["Déclaration de transit", "Garantie", "Scellement des moyens de transport"]
        },
        transit_international: {
          code: "TRIE (S120)",
          title: "Transit International Routier de l'Espace CEDEAO/UEMOA",
          description: "Transit pour marchandises destinées à un pays tiers membre de la CEDEAO/UEMOA",
          conditions: [
            "Déclaration T1 (ou équivalent TRIE)",
            "Cautionnement couvrant les droits et taxes",
            "Scellement douanier obligatoire",
            "Itinéraire et délai fixés",
            "Apurement au bureau de destination"
          ],
          destinations: ["Mali", "Burkina Faso", "Niger", "Guinée", "Gambie", "autres pays CEDEAO"]
        }
      },
      attention: "Pour les marchandises destinées au Mali ou autre pays tiers → TRIE obligatoire, PAS l'ATE"
    },

    // CHAPITRE IV - ENTREPÔTS (Articles 170-207)
    entrepot: {
      articles: "170-207",
      title: "ENTREPÔTS DE DOUANE",
      types: {
        entrepot_public: {
          articles: "175-178",
          description: "Entrepôt ouvert à tous les importateurs"
        },
        entrepot_prive: {
          articles: "179-185",
          description: "Entrepôt réservé à un seul utilisateur"
        },
        entrepot_special: {
          articles: "186-192",
          description: "Pour produits pétroliers, énergétiques ou spécifiques"
        }
      }
    },

    // MISE À LA CONSOMMATION (Articles 155-160)
    mise_consommation: {
      articles: "155-160",
      title: "MISE À LA CONSOMMATION",
      description: "Régime définitif avec paiement de tous les droits et taxes",
      droits_applicables: [
        "Droits de Douane (DD) selon le code SH",
        "Redevance Statistique (RS)",
        "Prélèvement Communautaire de Solidarité (PCS)",
        "Prélèvement Communautaire CEDEAO (PCC)",
        "TVA à l'importation",
        "Autres taxes spécifiques selon la marchandise"
      ]
    }
  },

  // VALEUR EN DOUANE (Articles 18-19)
  valeur: {
    articles: "18-19",
    methode_principale: "Valeur transactionnelle (Accord OMC Article VII du GATT)",
    methodes_substitution: [
      "Valeur transactionnelle de marchandises identiques",
      "Valeur transactionnelle de marchandises similaires", 
      "Méthode de la valeur déductive",
      "Méthode de la valeur calculée",
      "Méthode du dernier recours"
    ]
  },

  // INFRACTIONS ET SANCTIONS (Titre XII, Articles 300+)
  sanctions: {
    retard_paiement: "Intérêts de retard calculés au taux légal",
    fausse_declaration: "Amende et confiscation possible",
    non_respect_regime_suspensif: "Exigibilité immédiate des droits + pénalités (10% à 100%)"
  },

  // RÈGLES D'APPLICATION
  regles_application: {
    article_4: "Les marchandises qui entrent ou sortent du territoire sont passibles des droits et taxes selon le tarif des douanes",
    article_13: "Les marchandises sont soumises au tarif dans l'état où elles se trouvent au moment de l'application",
    article_21: "Sont prohibées les marchandises dont l'importation/exportation est interdite ou soumise à restrictions"
  }
};

// Fonction pour obtenir le contexte légal selon le régime
export function getLegalContextForRegime(regimeCode: string): string {
  const code = CUSTOMS_CODE_REFERENCE;
  let context = `\n\n=== RÉFÉRENCE LÉGALE - CODE DES DOUANES (Loi 2014-10) ===\n`;
  
  const regimeUpper = regimeCode.toUpperCase();
  
  if (regimeUpper.includes('ATE') || regimeUpper.includes('TEMPORAIRE')) {
    const ate = code.regimes.admission_temporaire.sections.ate;
    context += `\n## ${ate.title} (Articles ${ate.articles})\n`;
    context += `${ate.article_217}\n\n`;
    context += `**Conditions d'application:**\n`;
    ate.conditions.forEach(c => context += `- ${c}\n`);
    context += `\n**Usages courants:**\n`;
    ate.usages_courants.forEach(u => context += `- ${u}\n`);
    context += `\n⚠️ ATTENTION: ${ate.attention}\n`;
    context += `\n**Garanties (Art. 220-227):** ${code.regimes.admission_temporaire.dispositions_communes.garanties}\n`;
    context += `**Sanctions:** ${code.regimes.admission_temporaire.dispositions_communes.sanctions}\n`;
  }
  
  if (regimeUpper.includes('TRIE') || regimeUpper.includes('S120') || regimeUpper.includes('TRANSIT')) {
    const transit = code.regimes.transit;
    const trie = transit.types.transit_international;
    context += `\n## ${trie.title} (${trie.code})\n`;
    context += `${trie.description}\n\n`;
    context += `**Conditions:**\n`;
    trie.conditions.forEach(c => context += `- ${c}\n`);
    context += `\n**Destinations TRIE:** ${trie.destinations.join(', ')}\n`;
  }
  
  if (regimeUpper.includes('C10') || regimeUpper.includes('CONSOMMATION')) {
    const mc = code.regimes.mise_consommation;
    context += `\n## ${mc.title} (Articles ${mc.articles})\n`;
    context += `${mc.description}\n\n`;
    context += `**Droits applicables:**\n`;
    mc.droits_applicables.forEach(d => context += `- ${d}\n`);
  }
  
  // Ajouter les règles de valeur
  context += `\n## VALEUR EN DOUANE (Art. ${code.valeur.articles})\n`;
  context += `Méthode principale: ${code.valeur.methode_principale}\n`;
  
  // Ajouter les sanctions
  context += `\n## SANCTIONS\n`;
  context += `- Non-respect régime suspensif: ${code.sanctions.non_respect_regime_suspensif}\n`;
  
  return context;
}

// Fonction pour analyser le régime approprié selon le contexte
export function analyzeRegimeAppropriateness(requestedRegime: string, destination: string, operation: string): {
  isAppropriate: boolean;
  recommendedRegime: string;
  explanation: string;
  legalBasis: string;
} {
  const destUpper = (destination || '').toUpperCase();
  const regimeUpper = (requestedRegime || '').toUpperCase();
  
  // Destinations pays tiers CEDEAO/UEMOA
  const paysTransit = ['MALI', 'BURKINA', 'NIGER', 'GUINÉE', 'GAMBIE', 'GUINEE BISSAU'];
  const isPaysTransit = paysTransit.some(p => destUpper.includes(p));
  
  // Si destination pays tiers mais ATE demandé
  if (isPaysTransit && (regimeUpper.includes('ATE') || regimeUpper.includes('TEMPORAIRE'))) {
    return {
      isAppropriate: false,
      recommendedRegime: 'TRIE (S120)',
      explanation: `L'ATE n'est pas approprié pour une destination ${destination}. Le régime TRIE (Transit International Routier CEDEAO) est obligatoire pour les marchandises en transit vers un pays tiers.`,
      legalBasis: 'Articles 161-169 et 217-218 du Code des Douanes - L\'ATE est réservé aux marchandises devant séjourner temporairement au Sénégal puis être réexportées, pas pour le transit vers pays tiers.'
    };
  }
  
  // Si transit local mais TRIE demandé
  if (!isPaysTransit && destUpper.includes('DAKAR') && regimeUpper.includes('TRIE')) {
    return {
      isAppropriate: false,
      recommendedRegime: 'C10 (Mise à la consommation) ou ATE selon l\'usage',
      explanation: 'Le TRIE n\'est pas nécessaire pour une destination finale au Sénégal.',
      legalBasis: 'Articles 155-160 pour mise à la consommation ou 217-218 pour admission temporaire'
    };
  }
  
  return {
    isAppropriate: true,
    recommendedRegime: requestedRegime,
    explanation: 'Le régime demandé semble approprié pour cette opération.',
    legalBasis: 'Conforme aux dispositions du Code des Douanes'
  };
}
