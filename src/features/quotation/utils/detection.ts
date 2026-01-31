/**
 * Fonctions de détection pour le domaine Quotation
 * Refactor Phase 1 - Étape 2
 */

import type { ThreadEmail, QuotationOffer, RegulatoryInfo } from '../types';
import { 
  isInternalEmail, 
  decodeBase64Content, 
  containsOfferKeywords, 
  detectOfferType,
  getEmailSenderName
} from './parsing';
import { extractRegulatoryInfo } from './consolidation';

/**
 * Detect quotation offers in thread emails
 */
export const detectQuotationOffers = (
  emails: ThreadEmail[], 
  allAttachments: Array<{ id: string; filename: string; content_type: string; email_id?: string }>
): QuotationOffer[] => {
  const offers: QuotationOffer[] = [];
  
  for (const email of emails) {
    // Check if from internal domain
    if (!isInternalEmail(email.from_address)) continue;
    
    const body = decodeBase64Content(email.body_text);
    
    // Check for offer keywords
    if (!containsOfferKeywords(body)) continue;
    
    // Determine offer type
    const offerType = detectOfferType(email);
    if (!offerType) continue;
    
    // Get attachments for this email
    const emailAttachments = allAttachments.filter(a => a.email_id === email.id);
    
    // Detect content from body
    const detectedContent: string[] = [];
    const bodyLower = body.toLowerCase();
    
    if (bodyLower.includes('dry container') || bodyLower.includes('dry')) {
      detectedContent.push('Dry containers');
    }
    if (bodyLower.includes('dg container') || bodyLower.includes('dangerous')) {
      detectedContent.push('DG containers');
    }
    if (bodyLower.includes('special ig') || bodyLower.includes('in-gauge')) {
      detectedContent.push('Special IG');
    }
    if (bodyLower.includes('special oog') || bodyLower.includes('out-of-gauge')) {
      detectedContent.push('Special OOG');
    }
    if (bodyLower.includes('flat rack') || bodyLower.includes('40fr')) {
      detectedContent.push('Flat Rack');
    }
    if (bodyLower.includes('open top') || bodyLower.includes('ot')) {
      detectedContent.push('Open Top');
    }
    if (bodyLower.includes('ex-hook') || bodyLower.includes('fot')) {
      detectedContent.push('Ex-hook / FOT');
    }
    if (bodyLower.includes('dap') && bodyLower.includes('site')) {
      detectedContent.push('DAP to site');
    }
    
    offers.push({
      type: offerType,
      email,
      sentAt: email.sent_at || email.received_at,
      senderName: getEmailSenderName(email.from_address),
      senderEmail: email.from_address,
      attachments: emailAttachments,
      detectedContent,
    });
  }
  
  return offers;
};

/**
 * Extract regulatory info from all emails in thread
 */
export const extractAllRegulatoryInfo = (emails: ThreadEmail[]): RegulatoryInfo => {
  const combined: RegulatoryInfo = {
    customsNotes: [],
    otherNotes: [],
  };
  
  for (const email of emails) {
    const body = decodeBase64Content(email.body_text);
    const info = extractRegulatoryInfo(body);
    
    if (info.projectTaxation) {
      combined.projectTaxation = {
        ...combined.projectTaxation,
        ...info.projectTaxation,
      };
    }
    if (info.dpiRequired) combined.dpiRequired = true;
    if (info.dpiThreshold) combined.dpiThreshold = info.dpiThreshold;
    if (info.dpiDeadline) combined.dpiDeadline = info.dpiDeadline;
    if (info.apeAvailable) combined.apeAvailable = true;
    
    combined.customsNotes = [...new Set([...combined.customsNotes, ...info.customsNotes])];
    combined.otherNotes = [...new Set([...combined.otherNotes, ...info.otherNotes])];
  }
  
  return combined;
};
