/**
 * Fonctions de parsing pour le domaine Quotation
 * Refactor Phase 1 - Étape 2
 */

import { INTERNAL_DOMAINS, OFFER_KEYWORDS, incoterms } from '../constants';
import type { ThreadEmail, ConsolidatedData } from '../types';

/**
 * Decode base64 content if necessary
 */
export const decodeBase64Content = (content: string | null): string => {
  if (!content) return '';
  
  // Check if content looks like base64
  const base64Pattern = /^[A-Za-z0-9+/=]+$/;
  const cleanContent = content.replace(/\s/g, '');
  
  if (base64Pattern.test(cleanContent) && cleanContent.length > 100) {
    try {
      return atob(cleanContent);
    } catch {
      return content;
    }
  }
  return content;
};

/**
 * Check if email is from internal domain
 */
export const isInternalEmail = (email: string): boolean => {
  const emailLower = email.toLowerCase();
  return INTERNAL_DOMAINS.some(domain => emailLower.includes(`@${domain}`));
};

/**
 * Check if email body contains offer keywords
 */
export const containsOfferKeywords = (body: string): boolean => {
  const bodyLower = body.toLowerCase();
  return OFFER_KEYWORDS.some(keyword => bodyLower.includes(keyword));
};

/**
 * Detect offer type from email content
 */
export const detectOfferType = (email: ThreadEmail): 'container' | 'breakbulk' | 'combined' | null => {
  const bodyLower = decodeBase64Content(email.body_text).toLowerCase();
  const subjectLower = (email.subject || '').toLowerCase();
  const combinedText = bodyLower + ' ' + subjectLower;
  
  const hasContainer = combinedText.includes('container') || 
                       combinedText.includes('conteneur') ||
                       combinedText.includes('40hc') ||
                       combinedText.includes('40fr') ||
                       combinedText.includes('20dv') ||
                       combinedText.includes('dthc') ||
                       combinedText.includes('soc') ||
                       combinedText.includes('coc');
  
  const hasBreakbulk = combinedText.includes('breakbulk') ||
                       combinedText.includes('break bulk') ||
                       combinedText.includes('conventionnel') ||
                       combinedText.includes('ex-hook') ||
                       combinedText.includes('fot') ||
                       combinedText.includes('stevedoring');
  
  if (hasContainer && hasBreakbulk) return 'combined';
  if (hasContainer) return 'container';
  if (hasBreakbulk) return 'breakbulk';
  return null;
};

/**
 * Parse email subject to extract incoterm, destination, cargo type
 */
export const parseSubject = (subject: string | null): Partial<ConsolidatedData> => {
  if (!subject) return {};
  
  const result: Partial<ConsolidatedData> = {
    cargoTypes: [],
    containerTypes: [],
    origins: [],
  };
  
  const subjectUpper = subject.toUpperCase();
  const subjectLower = subject.toLowerCase();
  
  // Extract incoterm
  for (const inc of incoterms) {
    if (subjectUpper.includes(inc)) {
      result.incoterm = inc;
      break;
    }
  }
  
  // Extract destination from subject
  const destinationPatterns = [
    /(?:DAP|DDP|CIF|CFR|FOB|FCA)\s+([A-Z][A-Z\s-]+)/i,
    /(?:to|vers|pour)\s+([A-Z][A-Z\s-]+)/i,
    /(?:destination|dest[.:]?)\s*([A-Z][A-Z\s-]+)/i,
  ];
  
  for (const pattern of destinationPatterns) {
    const match = subject.match(pattern);
    if (match) {
      const dest = match[1].trim().replace(/\s+/g, ' ');
      if (dest.length > 2 && dest.length < 50) {
        result.finalDestination = dest;
        break;
      }
    }
  }
  
  // Extract cargo types from subject
  if (subjectLower.includes('breakbulk') || subjectLower.includes('break bulk')) {
    result.cargoTypes?.push('breakbulk');
  }
  if (subjectLower.includes('container') || subjectLower.includes('conteneur')) {
    result.cargoTypes?.push('container');
  }
  if (subjectLower.includes('project') || subjectLower.includes('projet')) {
    result.cargoTypes?.push('project');
  }
  
  // Extract container types mentioned
  const containerPatterns = ['40FR', '40HC', '40DV', '20DV', '20HC', '40OT', '40HC OT', 'FLAT RACK', 'OPEN TOP'];
  for (const ct of containerPatterns) {
    if (subjectUpper.includes(ct)) {
      result.containerTypes?.push(ct.replace(' ', '-'));
    }
  }
  
  return result;
};

/**
 * Parse email body for additional data including multi-container extraction
 */
export const parseEmailBody = (body: string | null): Partial<ConsolidatedData> => {
  if (!body) return {};
  
  const result: Partial<ConsolidatedData> = {
    cargoTypes: [],
    specialRequirements: [],
    origins: [],
    containers: [],
  };
  
  const bodyLower = body.toLowerCase();
  
  // === NEW: Multi-container extraction with quantities ===
  // Pattern: "09 X 40' HC", "2 x 20DV", "1 X 40' open top", etc.
  const containerPatterns = [
    // "09 X 40' HC" or "9 x 40HC"
    /(\d+)\s*[xX×]\s*(\d{2})'?\s*(HC|DV|OT|FR|RF|GP|DC)/gi,
    // "09 X 40' HC + 1 X 40' open top"
    /(\d+)\s*[xX×]\s*(\d{2})['']?\s*(open\s*top|flat\s*rack|high\s*cube|reefer|dry)/gi,
    // "2 x 20' containers"
    /(\d+)\s*[xX×]\s*(\d{2})['']?\s*(?:containers?|conteneurs?)/gi,
  ];
  
  const containerTypeMap: Record<string, string> = {
    'hc': '40HC',
    'high cube': '40HC',
    'dv': '20DV',
    'gp': '20DV',
    'dc': '20DV',
    'dry': '20DV',
    'ot': '40OT',
    'open top': '40OT',
    'fr': '40FR',
    'flat rack': '40FR',
    'rf': '40RF',
    'reefer': '40RF',
  };
  
  for (const pattern of containerPatterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const quantity = parseInt(match[1], 10);
      const size = match[2]; // 20 or 40
      const typeRaw = match[3].toLowerCase().replace(/\s+/g, ' ').trim();
      
      // Normalize container type
      let containerType = containerTypeMap[typeRaw] || `${size}${typeRaw.toUpperCase().substring(0, 2)}`;
      
      // Check for OOG notes
      const hasOog = bodyLower.includes('oog') || bodyLower.includes('out of gauge') || 
                     bodyLower.includes('hors gabarit') || bodyLower.includes('oversized');
      
      if (quantity > 0 && !isNaN(quantity)) {
        result.containers?.push({
          type: containerType,
          quantity,
          notes: hasOog ? 'OOG' : undefined
        });
      }
    }
  }
  
  // Check for SOC/COC mentions and apply to containers
  const isSoc = bodyLower.includes('soc') || bodyLower.includes('shipper owned');
  const isCoc = bodyLower.includes('coc') || bodyLower.includes('carrier owned');
  
  if (isSoc) {
    result.specialRequirements?.push('SOC (Shipper Owned Containers)');
    result.containers?.forEach(c => c.coc_soc = 'SOC');
  }
  if (isCoc) {
    result.specialRequirements?.push('COC (Carrier Owned Containers)');
    result.containers?.forEach(c => c.coc_soc = 'COC');
  }
  
  // Check for specific services mentioned
  if (bodyLower.includes('dthc')) {
    result.specialRequirements?.push('DTHC demandé');
  }
  if (bodyLower.includes('on carriage') || bodyLower.includes('on-carriage')) {
    result.specialRequirements?.push('On-carriage demandé');
  }
  if (bodyLower.includes('empty return') || bodyLower.includes('retour vide')) {
    result.specialRequirements?.push('Retour conteneur vide');
  }
  
  // Check for location patterns for project site
  const locationPatterns = [
    /project\s+location\s*[:=]?\s*(https?:\/\/[^\s]+)/i,
    /site\s*[:=]?\s*(https?:\/\/maps[^\s]+)/i,
  ];
  
  for (const pattern of locationPatterns) {
    const match = body.match(pattern);
    if (match) {
      result.projectLocation = match[1];
      break;
    }
  }
  
  // Check for specific destinations
  const destPatterns = [
    /(?:POD|port of destination)\s*[:=]?\s*([A-Za-z\s-]+)/i,
    /(?:destination finale|final destination)\s*[:=]?\s*([A-Za-z\s-]+)/i,
  ];
  
  for (const pattern of destPatterns) {
    const match = body.match(pattern);
    if (match) {
      const dest = match[1].trim();
      if (dest.length > 2 && dest.length < 50) {
        if (!result.destination) result.destination = dest;
      }
    }
  }
  
  return result;
};

/**
 * Get sender name from email address
 */
export const getEmailSenderName = (email: string): string => {
  return email.split('@')[0]
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
};
