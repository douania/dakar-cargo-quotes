/**
 * Fonctions de consolidation pour le domaine Quotation
 * Refactor Phase 1 - Étape 2
 */

import type { ThreadEmail, ConsolidatedData, RegulatoryInfo } from '../types';
import { decodeBase64Content, parseSubject, parseEmailBody } from './parsing';

/**
 * Extract regulatory information from email body
 */
export const extractRegulatoryInfo = (body: string): RegulatoryInfo => {
  const info: RegulatoryInfo = {
    customsNotes: [],
    otherNotes: [],
  };
  
  const bodyLower = body.toLowerCase();
  
  // Extract project taxation rates
  const seaTaxMatch = body.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:of\s+)?CIF\s*(?:value)?\s*\(?(?:sea|maritime|mer)\)?/i);
  const airTaxMatch = body.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:of\s+)?CIF\s*(?:value)?\s*\(?(?:air|avion)\)?/i);
  const generalCifMatch = body.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?CIF/i);
  
  if (seaTaxMatch || airTaxMatch || generalCifMatch) {
    info.projectTaxation = {};
    if (seaTaxMatch) info.projectTaxation.sea = seaTaxMatch[1] + '%';
    if (airTaxMatch) info.projectTaxation.air = airTaxMatch[1] + '%';
    if (!seaTaxMatch && !airTaxMatch && generalCifMatch) {
      info.projectTaxation.sea = generalCifMatch[1] + '%';
    }
  }
  
  // DPI detection
  if (bodyLower.includes('dpi')) {
    info.dpiRequired = true;
    
    // Extract threshold
    const thresholdMatch = body.match(/(?:cif|value)\s*(?:>|above|supérieur|greater)\s*(?:€|eur|euro)?\s*(\d+(?:[\s,]\d+)*)/i);
    if (thresholdMatch) {
      info.dpiThreshold = '€' + thresholdMatch[1].replace(/\s/g, '');
    }
    
    // Extract deadline
    const deadlineMatch = body.match(/(\d+)\s*(?:hours?|heures?|h)\s*(?:per|par|for|pour)/i);
    if (deadlineMatch) {
      info.dpiDeadline = deadlineMatch[1] + 'h par facture';
    }
    
    // Check for 15 days before departure
    if (bodyLower.includes('15') && (bodyLower.includes('day') || bodyLower.includes('jour'))) {
      info.customsNotes.push('Deadline DPI: 15 jours avant départ');
    }
  }
  
  // APE detection
  if (bodyLower.includes('ape') || bodyLower.includes('autorisation préalable')) {
    info.apeAvailable = true;
    info.customsNotes.push('APE possible si exemption manquante');
  }
  
  // NINEA detection
  if (bodyLower.includes('ninea')) {
    info.customsNotes.push('NINEA requis');
  }
  
  // PPM detection
  if (bodyLower.includes('ppm')) {
    info.customsNotes.push('Code PPM requis');
  }
  
  // Check for exemption mentions
  if (bodyLower.includes('exempt') || bodyLower.includes('exonér')) {
    info.otherNotes.push('Régime exonéré mentionné');
  }
  
  // Check for project cargo
  if (bodyLower.includes('project') && bodyLower.includes('cargo')) {
    info.otherNotes.push('Projet cargo identifié');
  }
  
  return info;
};

/**
 * Normalize subject for matching (remove Re:, Fwd:, etc.)
 */
export const normalizeSubject = (subject: string | null): string => {
  if (!subject) return '';
  return subject
    .replace(/^(RE:|FW:|TR:|AW:|SV:|VS:)\s*/gi, '')
    .replace(/^(RE:|FW:|TR:|AW:|SV:|VS:)\s*/gi, '') // Do twice for "RE: FW:" patterns
    .trim()
    .toLowerCase();
};

/**
 * Consolidate data from all thread emails
 */
export const consolidateThreadData = (emails: ThreadEmail[]): ConsolidatedData => {
  const consolidated: ConsolidatedData = {
    cargoTypes: [],
    containerTypes: [],
    containers: [],
    origins: [],
    specialRequirements: [],
  };
  
  // Sort by date (oldest first) to process chronologically
  const sortedEmails = [...emails].sort((a, b) => {
    const dateA = new Date(a.sent_at || a.received_at);
    const dateB = new Date(b.sent_at || b.received_at);
    return dateA.getTime() - dateB.getTime();
  });
  
  // First email is the original request
  const firstEmail = sortedEmails[0];
  if (firstEmail) {
    const senderEmail = firstEmail.from_address.toLowerCase();
    const senderDomain = senderEmail.split('@')[1]?.split('.')[0]?.toUpperCase() || '';
    const senderName = senderEmail.split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
    
    // Store original requestor info
    consolidated.originalRequestor = {
      email: firstEmail.from_address,
      name: senderName,
      company: senderDomain,
    };
  }
  
  // Process each email
  for (const email of sortedEmails) {
    const decodedBody = decodeBase64Content(email.body_text);
    
    // Parse subject
    const subjectData = parseSubject(email.subject);
    if (subjectData.incoterm && !consolidated.incoterm) {
      consolidated.incoterm = subjectData.incoterm;
    }
    if (subjectData.finalDestination && !consolidated.finalDestination) {
      consolidated.finalDestination = subjectData.finalDestination;
    }
    if (subjectData.cargoTypes) {
      consolidated.cargoTypes = [...new Set([...consolidated.cargoTypes, ...subjectData.cargoTypes])];
    }
    if (subjectData.containerTypes) {
      consolidated.containerTypes = [...new Set([...consolidated.containerTypes, ...subjectData.containerTypes])];
    }
    
    // Parse body
    const bodyData = parseEmailBody(decodedBody);
    if (bodyData.destination && !consolidated.destination) {
      consolidated.destination = bodyData.destination;
    }
    if (bodyData.projectLocation && !consolidated.projectLocation) {
      consolidated.projectLocation = bodyData.projectLocation;
    }
    if (bodyData.specialRequirements) {
      consolidated.specialRequirements = [...new Set([...consolidated.specialRequirements, ...bodyData.specialRequirements])];
    }
    
    // Aggregate containers with quantities from body parsing
    if (bodyData.containers && bodyData.containers.length > 0) {
      for (const container of bodyData.containers) {
        // Check if we already have this container type
        const existing = consolidated.containers.find(c => c.type === container.type);
        if (existing) {
          // Keep the higher quantity (don't add, as it might be duplicated)
          existing.quantity = Math.max(existing.quantity, container.quantity);
          if (container.notes) existing.notes = container.notes;
          if (container.coc_soc) existing.coc_soc = container.coc_soc;
        } else {
          consolidated.containers.push({ ...container });
        }
      }
    }
    
    // Also check extracted_data if available
    if (email.extracted_data) {
      const ed = email.extracted_data;
      if (ed.incoterm && !consolidated.incoterm) {
        consolidated.incoterm = ed.incoterm;
      }
      if (ed.destination && !consolidated.destination) {
        consolidated.destination = ed.destination;
      }
      if (ed.origin && !consolidated.origins.includes(ed.origin)) {
        consolidated.origins.push(ed.origin);
      }
    }
    
    // Extract project name from first subject
    if (!consolidated.projectName && email.subject) {
      consolidated.projectName = email.subject
        .replace(/^(RE:|FW:|TR:)\s*/gi, '')
        .replace(/^(demande|offre|cotation|devis)[\s:]+/gi, '')
        .substring(0, 100);
    }
  }
  
  return consolidated;
};
