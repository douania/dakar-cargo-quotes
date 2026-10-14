import { ImapByteReader, readImapHeaders } from "../_shared/imap-headers.ts";
import { readMailboxSecret, quoteImapString } from "../_shared/mailbox-secret.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";
import { assertImportSearchIdentity, imapAccountKey, imapAccountSnapshot, ImportIdentityConflict } from "../_shared/imap-import-identity.ts";
import { requireImapCommandOk, searchFetchMessages } from "../_shared/imap-subject-search.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THREAD_ANALYSIS_PROMPT = `Tu es un expert en analyse d'échanges commerciaux pour une entreprise de transit logistique au Sénégal (SODATRA).

Analyse cet échange d'emails complet et extrais les connaissances suivantes:

1. **TARIFS & PRICING** (category: "tarif")
   - Prix mentionnés (transport, manutention, dédouanement, frais portuaires)
   - Devise et conditions de paiement
   - Validité des tarifs
   Format: { origine, destination, type_transport, montant, devise, conditions, validite }

2. **TEMPLATES DE RÉPONSE** (category: "template")
   - Structure des cotations envoyées
   - Formules d'introduction et de conclusion
   - Mentions légales et conditions
   Format: { type_document, structure_sections, phrases_cles, style_communication }

3. **CONTACTS** (category: "contact")
   - Clients identifiés avec leurs préférences
   - Compagnies maritimes/aériennes mentionnées
   - Agents et partenaires
   Format: { nom, email, entreprise, role, preferences, historique_interactions }

4. **PATTERNS DE NÉGOCIATION** (category: "negociation")
   - Étapes de la négociation observées
   - Concessions accordées
   - Arguments utilisés
   - Délais de réponse typiques
   Format: { etapes, arguments_cles, concessions, delai_moyen, resultat }

5. **DÉLAIS & CONDITIONS** (category: "condition")
   - Délais de transit mentionnés
   - Conditions de livraison
   - Franchises et pénalités
   Format: { type, valeur, conditions_application }

6. **MARCHANDISES** (category: "marchandise")
   - Types de marchandises traitées
   - Codes SH mentionnés
   - Volumes/poids typiques
   Format: { description, code_sh, volume, poids, conditionnement }

Réponds UNIQUEMENT avec un JSON valide au format:
{
  "summary": "Résumé de l'échange en 2-3 phrases",
  "extractions": [
    {
      "category": "tarif|template|contact|negociation|condition|marchandise",
      "name": "Nom court descriptif",
      "description": "Description détaillée",
      "data": { ... données structurées ... },
      "confidence": 0.0-1.0
    }
  ],
  "quotation_detected": true/false,
  "quotation_amount": "montant si détecté",
  "client_satisfaction": "satisfied|neutral|unsatisfied|unknown"
}

Si aucune connaissance exploitable n'est trouvée, retourne: { "summary": "Aucune information exploitable", "extractions": [], "quotation_detected": false }`;

// Decode MIME encoded headers/filenames
function decodeHeader(text: string): string {
  return text.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_: string, charset: string, encoding: string, content: string) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const decoded = atob(content);
        return new TextDecoder(charset).decode(new Uint8Array([...decoded].map(c => c.charCodeAt(0))));
      } else {
        return content.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      }
    } catch { return content; }
  });
}

function parseEmailDate(dateStr: string): string {
  try {
    const cleaned = dateStr.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    const original = new Date(dateStr);
    if (!isNaN(original.getTime())) return original.toISOString();
  } catch { /* ignore */ }
  return new Date().toISOString();
}

// Decode base64 content
function decodeBase64(content: string): Uint8Array {
  try {
    const cleaned = content.replace(/[\r\n\s]/g, '');
    const binary = atob(cleaned);
    return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
  } catch (e) {
    console.error("Base64 decode error:", e);
    return new Uint8Array(0);
  }
}

// Decode base64 by chunks to handle large attachments
function decodeBase64Chunked(content: string): Uint8Array {
  try {
    // Clean line breaks and whitespace
    const cleaned = content.replace(/[\r\n\s]/g, '');
    
    if (cleaned.length === 0) {
      console.log("[BASE64] Empty content after cleaning");
      return new Uint8Array(0);
    }
    
    // Decode in chunks to avoid memory issues with large files
    const CHUNK_SIZE = 32768; // 32KB chunks (must be multiple of 4 for base64)
    const chunks: Uint8Array[] = [];
    
    for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
      let chunk = cleaned.substring(i, Math.min(i + CHUNK_SIZE, cleaned.length));
      
      // Ensure chunk length is multiple of 4 (except for last chunk)
      if (i + CHUNK_SIZE < cleaned.length) {
        const remainder = chunk.length % 4;
        if (remainder !== 0) {
          chunk = chunk.substring(0, chunk.length - remainder);
        }
      }
      
      try {
        const decoded = atob(chunk);
        chunks.push(new Uint8Array([...decoded].map(c => c.charCodeAt(0))));
      } catch (chunkError) {
        console.error(`[BASE64] Chunk decode error at offset ${i}:`, chunkError);
        // Try to recover by skipping invalid chunk
        continue;
      }
    }
    
    // Concatenate all chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    
    console.log(`[BASE64] Decoded ${cleaned.length} base64 chars to ${result.length} bytes`);
    return result;
  } catch (e) {
    console.error("[BASE64] Decode error:", e);
    return new Uint8Array(0);
  }
}

// Decode quoted-printable content to Uint8Array (for attachments)
function decodeQuotedPrintable(content: string): Uint8Array {
  const decoded = content
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return new TextEncoder().encode(decoded);
}

// Decode quoted-printable content to string (for email body)
function decodeQuotedPrintableText(content: string, charset: string = 'utf-8'): string {
  // First, handle soft line breaks (= at end of line means continue on next line)
  let decoded = content.replace(/=\r?\n/g, '');
  
  // Then decode hex-encoded characters
  decoded = decoded.replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) => {
    const charCode = parseInt(hex, 16);
    return String.fromCharCode(charCode);
  });
  
  // Handle Windows-1252 specific characters if detected
  if (charset.toLowerCase().includes('windows-1252') || charset.toLowerCase().includes('iso-8859')) {
    // Common Windows-1252 to UTF-8 mappings for French characters
    decoded = decoded
      .replace(/\x92/g, "'")  // Right single quotation mark
      .replace(/\x93/g, '"')  // Left double quotation mark
      .replace(/\x94/g, '"')  // Right double quotation mark
      .replace(/\x85/g, '...') // Horizontal ellipsis
      .replace(/\x96/g, '-')  // En dash
      .replace(/\x97/g, '-'); // Em dash
  }
  
  return decoded;
}

// Clean MIME headers and boundary markers from extracted content
function cleanMimeContent(content: string): string {
  let cleaned = content;
  
  // Remove any boundary markers at the start
  cleaned = cleaned.replace(/^--[^\r\n]+[\r\n]*/g, '');
  
  // Remove Content-Type headers
  cleaned = cleaned.replace(/^Content-Type:[^\r\n]*[\r\n]*/gim, '');
  
  // Remove Content-Transfer-Encoding headers
  cleaned = cleaned.replace(/^Content-Transfer-Encoding:[^\r\n]*[\r\n]*/gim, '');
  
  // Remove Content-Disposition headers
  cleaned = cleaned.replace(/^Content-Disposition:[^\r\n]*[\r\n]*/gim, '');
  
  // Remove any leading whitespace/newlines
  cleaned = cleaned.replace(/^[\r\n\s]+/, '');
  
  // Remove trailing boundary markers
  cleaned = cleaned.replace(/[\r\n]+--[^\r\n]*--?[\r\n]*$/g, '');
  
  return cleaned.trim();
}

// Escape special regex characters
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract text/plain and text/html from multipart MIME email
function extractTextFromMultipart(rawBody: string, depth: number = 0): { text: string; html: string } {
  let text = '';
  let html = '';
  
  // Protection against infinite recursion
  if (depth > 5) {
    console.warn('Max MIME nesting depth reached, stopping recursion');
    return { text: '', html: '' };
  }
  
  // Detect the boundary from Content-Type header in the body
  const boundaryMatch = rawBody.match(/boundary\s*=\s*"?([^"\r\n;]+)"?/i);
  
  if (!boundaryMatch) {
    // Not multipart, check if it's HTML or plain text and decode
    const decoded = decodeQuotedPrintableText(rawBody);
    
    // Remove any MIME headers from the beginning
    const headerEnd = decoded.indexOf('\r\n\r\n');
    const cleanedContent = headerEnd !== -1 ? decoded.substring(headerEnd + 4) : decoded;
    
    if (decoded.includes('<html') || decoded.includes('<HTML') || decoded.includes('<body') || decoded.includes('<div')) {
      return { text: stripHtmlTags(cleanedContent), html: cleanedContent };
    }
    return { text: cleanedContent, html: '' };
  }
  
  const boundary = boundaryMatch[1].trim();
  console.log(`Detected MIME boundary (depth ${depth}): ${boundary.substring(0, 50)}...`);
  
  // Split by boundary - use exact boundary delimiter
  const boundaryDelimiter = `--${boundary}`;
  const parts = rawBody.split(boundaryDelimiter);
  
  console.log(`Found ${parts.length} MIME parts at depth ${depth}`);
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.trim() || part.trim() === '--') continue;
    
    // Check if this part has a Content-Type header for text
    const partContentTypeMatch = part.match(/Content-Type:\s*text\/(plain|html)(?:;[^\r\n]*)?/i);
    if (!partContentTypeMatch) {
      // Check for nested multipart
      if (part.match(/Content-Type:\s*multipart\//i)) {
        // Extract the NEW boundary for this nested part
        const nestedBoundaryMatch = part.match(/boundary\s*=\s*"?([^"\r\n;]+)"?/i);
        if (nestedBoundaryMatch) {
          const nestedBoundary = nestedBoundaryMatch[1].trim();
          // Only recurse if it's a different boundary to avoid infinite loop
          if (nestedBoundary !== boundary) {
            console.log(`Found nested multipart with boundary: ${nestedBoundary.substring(0, 30)}...`);
            const nestedResult = extractTextFromMultipart(part, depth + 1);
            if (nestedResult.text && !text) text = nestedResult.text;
            if (nestedResult.html && !html) html = nestedResult.html;
          } else {
            console.warn(`Skipping nested multipart with same boundary to avoid recursion`);
          }
        }
      }
      continue;
    }
    
    const partType = partContentTypeMatch[1].toLowerCase();
    
    // Extract charset if present
    const charsetMatch = part.match(/charset\s*=\s*"?([^"\r\n;]+)"?/i);
    const charset = charsetMatch?.[1] || 'utf-8';
    
    // Find the content (after double CRLF - header/body separator)
    const contentStart = part.indexOf('\r\n\r\n');
    if (contentStart === -1) continue;
    
    let content = part.substring(contentStart + 4);
    
    // Check encoding
    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(quoted-printable|base64|7bit|8bit)/i);
    const encoding = encodingMatch?.[1]?.toLowerCase() || '7bit';
    
    // First, clean up trailing content that might be after the actual content
    // This includes the closing -- or next boundary marker in the next part
    content = content.replace(/[\r\n]+--[^\r\n]*--?[\r\n]*$/, '').trim();
    
    // Decode based on encoding AFTER trimming
    if (encoding === 'quoted-printable') {
      content = decodeQuotedPrintableText(content, charset);
    } else if (encoding === 'base64') {
      try {
        const cleaned = content.replace(/[\r\n\s]/g, '');
        content = atob(cleaned);
      } catch (e) {
        console.error('Base64 decode error for text part:', e);
      }
    }
    
    // Clean any residual MIME headers or boundary markers
    content = cleanMimeContent(content);
    
    if (partType === 'plain' && !text) {
      text = content;
      console.log(`Extracted text/plain (${content.length} chars): ${content.substring(0, 100)}...`);
    } else if (partType === 'html' && !html) {
      html = content;
      console.log(`Extracted text/html (${content.length} chars): ${content.substring(0, 100)}...`);
    }
  }
  
  // If we got HTML but no plain text, convert HTML to text
  if (html && !text) {
    text = stripHtmlTags(html);
  }
  
  return { text, html };
}

// Strip HTML tags and clean up whitespace
function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

interface AttachmentInfo {
  partNumber: string;
  filename: string;
  contentType: string;
  encoding: string;
  size: number;
}

// ============ ROBUST BODYSTRUCTURE PARSER ============

// Tokenizer for IMAP BODYSTRUCTURE
function tokenizeBodyStructure(structure: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  
  while (i < structure.length) {
    const ch = structure[i];
    
    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    
    // Parentheses
    if (ch === '(' || ch === ')') {
      tokens.push(ch);
      i++;
      continue;
    }
    
    // Quoted string
    if (ch === '"') {
      let end = i + 1;
      while (end < structure.length) {
        if (structure[end] === '\\' && end + 1 < structure.length) {
          end += 2; // Skip escaped char
          continue;
        }
        if (structure[end] === '"') {
          break;
        }
        end++;
      }
      tokens.push(structure.substring(i + 1, end)); // Content without quotes
      i = end + 1;
      continue;
    }
    
    // NIL or atom (unquoted word/number)
    if (/[A-Za-z0-9]/.test(ch)) {
      let end = i;
      while (end < structure.length && /[A-Za-z0-9._-]/.test(structure[end])) {
        end++;
      }
      tokens.push(structure.substring(i, end));
      i = end;
      continue;
    }
    
    // Skip unknown characters
    i++;
  }
  
  return tokens;
}

// Extract filename from BODYSTRUCTURE parameters
function extractFilenameFromParams(tokens: string[], startIdx: number): string {
  let filename = '';
  
  // Look for "name" or "filename" parameter in subsequent tokens
  for (let i = startIdx; i < Math.min(startIdx + 100, tokens.length); i++) {
    const token = tokens[i]?.toLowerCase();
    
    // Check for name parameter
    if (token === 'name' || token === 'filename') {
      // Next non-empty token should be the value
      for (let j = i + 1; j < Math.min(i + 5, tokens.length); j++) {
        const val = tokens[j];
        if (val && val !== '(' && val !== ')' && val.toLowerCase() !== 'nil') {
          filename = decodeHeader(val);
          break;
        }
      }
      if (filename) break;
    }
    
    // Check for filename* (RFC 2231 extended parameter)
    if (token && token.startsWith('filename*')) {
      for (let j = i + 1; j < Math.min(i + 5, tokens.length); j++) {
        const val = tokens[j];
        if (val && val !== '(' && val !== ')' && val.toLowerCase() !== 'nil') {
          // Handle UTF-8''encoded format
          const match = val.match(/(?:UTF-8''|utf-8'')?(.*)/i);
          if (match) {
            try {
              filename = decodeURIComponent(match[1] || val);
            } catch {
              filename = match[1] || val;
            }
          }
          break;
        }
      }
      if (filename) break;
    }
  }
  
  return filename;
}

// Recursive parser for BODYSTRUCTURE
interface ParseContext {
  pos: number;
}

function parseMimePart(tokens: string[], ctx: ParseContext, path: string): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  
  if (ctx.pos >= tokens.length || tokens[ctx.pos] !== '(') {
    return attachments;
  }
  
  ctx.pos++; // Skip opening (
  
  // Check if this is multipart (next token is also '(')
  if (tokens[ctx.pos] === '(') {
    // Multipart - parse each subpart
    let subPartNum = 1;
    while (ctx.pos < tokens.length && tokens[ctx.pos] === '(') {
      const subPath = path ? `${path}.${subPartNum}` : String(subPartNum);
      attachments.push(...parseMimePart(tokens, ctx, subPath));
      subPartNum++;
    }
    
    // Skip remaining tokens until closing )
    let depth = 1;
    while (ctx.pos < tokens.length && depth > 0) {
      if (tokens[ctx.pos] === '(') depth++;
      else if (tokens[ctx.pos] === ')') depth--;
      ctx.pos++;
    }
  } else {
    // Single part - parse type, subtype, params, etc.
    // Format: type subtype (params) id description encoding size [lines] [md5] [disposition] [language] [location]
    
    const startPos = ctx.pos;
    const type = tokens[ctx.pos++] || 'unknown';
    const subtype = tokens[ctx.pos++] || 'unknown';
    const contentType = `${type}/${subtype}`.toLowerCase();
    
    // Skip params (could be NIL or (...))
    if (tokens[ctx.pos] === '(') {
      let depth = 1;
      ctx.pos++;
      while (ctx.pos < tokens.length && depth > 0) {
        if (tokens[ctx.pos] === '(') depth++;
        else if (tokens[ctx.pos] === ')') depth--;
        ctx.pos++;
      }
    } else {
      ctx.pos++; // Skip NIL
    }
    
    // Skip id and description (each NIL or "string")
    ctx.pos++; // id
    ctx.pos++; // description
    
    // Get encoding
    const encoding = (tokens[ctx.pos++] || 'base64').toLowerCase();
    
    // Get size
    const sizeStr = tokens[ctx.pos++] || '0';
    const size = parseInt(sizeStr, 10) || 0;
    
    // Skip to end of this part
    let depth = 1;
    const dispositionSearchStart = ctx.pos;
    while (ctx.pos < tokens.length && depth > 0) {
      if (tokens[ctx.pos] === '(') depth++;
      else if (tokens[ctx.pos] === ')') depth--;
      ctx.pos++;
    }
    
    // Only process attachments, not body text parts
    if (contentType !== 'text/plain' && contentType !== 'text/html') {
      // Try to extract filename from params or disposition
      let filename = extractFilenameFromParams(tokens, startPos);
      
      // If no filename found, check disposition section
      if (!filename) {
        for (let i = dispositionSearchStart; i < ctx.pos; i++) {
          const tok = tokens[i]?.toLowerCase();
          if (tok === 'attachment' || tok === 'inline') {
            filename = extractFilenameFromParams(tokens, i);
            if (filename) break;
          }
        }
      }
      
      // Generate filename if still not found
      if (!filename) {
        const extMap: Record<string, string> = {
          'application/pdf': '.pdf',
          'application/vnd.ms-excel': '.xls',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
          'application/msword': '.doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/gif': '.gif',
        };
        const ext = extMap[contentType] || '';
        filename = `attachment_${path || '1'}${ext}`;
      }
      
      const partNumber = path || '1';
      
      console.log(`[BODYSTRUCTURE] Found attachment: ${filename} at part ${partNumber} (${contentType}, ${size} bytes, ${encoding})`);
      
      attachments.push({
        partNumber,
        filename,
        contentType,
        encoding,
        size
      });
    }
  }
  
  return attachments;
}

// Extract BODYSTRUCTURE using balanced parenthesis counting (robust method)
function extractBodyStructure(response: string): string {
  const marker = 'BODYSTRUCTURE ';
  const upperResponse = response.toUpperCase();
  const start = upperResponse.indexOf(marker);
  if (start === -1) return '';
  
  let depth = 0;
  const structureStart = start + marker.length;
  let structureEnd = structureStart;
  let started = false;
  
  for (let i = structureStart; i < response.length; i++) {
    if (response[i] === '(') {
      if (!started) started = true;
      depth++;
    }
    if (response[i] === ')') {
      depth--;
      if (started && depth === 0) {
        structureEnd = i + 1;
        break;
      }
    }
  }
  
  return response.substring(structureStart, structureEnd);
}

// Parse BODYSTRUCTURE to find attachments with correct MIME part numbers
function parseBodyStructure(response: string): AttachmentInfo[] {
  console.log(`[BODYSTRUCTURE] Parsing response (${response.length} chars)`);
  
  // Use balanced parenthesis extraction instead of regex
  const structure = extractBodyStructure(response);
  
  if (!structure || structure.length < 10) {
    console.log("[BODYSTRUCTURE] No BODYSTRUCTURE match found in response");
    console.log(`[BODYSTRUCTURE] Response preview: ${response.substring(0, 500)}`);
    return [];
  }
  
  console.log(`[BODYSTRUCTURE] Extracted structure (${structure.length} chars)`);
  console.log(`[BODYSTRUCTURE] Raw structure: ${structure.substring(0, 300)}...`);
  
  // Tokenize
  const tokens = tokenizeBodyStructure(structure);
  console.log(`[BODYSTRUCTURE] Tokenized into ${tokens.length} tokens`);
  
  // Parse
  const ctx: ParseContext = { pos: 0 };
  const attachments = parseMimePart(tokens, ctx, '');
  
  console.log(`[BODYSTRUCTURE] Found ${attachments.length} attachment(s) from MIME parsing`);
  
  // Fallback: Search by file extension for attachments not detected by MIME type
  // This matches the approach in search-emails which successfully finds Excel/PDF files
  const extensionPattern = /["']([^"']*\.(?:xlsx?|pdf|docx?|csv|zip|rar|pptx?))["']/gi;
  let extMatch;
  while ((extMatch = extensionPattern.exec(structure)) !== null) {
    const filename = decodeHeader(extMatch[1]);
    const lowerFilename = filename.toLowerCase();
    
    // Skip if already detected or inline/temp file
    if (attachments.some(a => a.filename === filename)) continue;
    if (lowerFilename.startsWith('~') || 
        lowerFilename.startsWith('image0') ||
        lowerFilename.includes('signature')) continue;
    
    // Determine content-type from extension
    let contentType = 'application/octet-stream';
    if (lowerFilename.endsWith('.pdf')) contentType = 'application/pdf';
    else if (lowerFilename.endsWith('.xlsx')) 
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (lowerFilename.endsWith('.xls')) contentType = 'application/vnd.ms-excel';
    else if (lowerFilename.endsWith('.docx')) 
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (lowerFilename.endsWith('.doc')) contentType = 'application/msword';
    else if (lowerFilename.endsWith('.csv')) contentType = 'text/csv';
    else if (lowerFilename.endsWith('.pptx') || lowerFilename.endsWith('.ppt')) 
      contentType = 'application/vnd.ms-powerpoint';
    
    // Find part number by counting depth in structure
    const partNumber = findPartNumberByPosition(structure, extMatch.index);
    
    console.log(`[BODYSTRUCTURE] Found attachment by extension: ${filename} -> part ${partNumber}`);
    attachments.push({
      partNumber,
      filename,
      contentType,
      encoding: 'base64',
      size: 0
    });
  }
  
  console.log(`[BODYSTRUCTURE] Total: ${attachments.length} attachment(s)`);
  
  // Log all found attachments for debugging
  for (const att of attachments) {
    console.log(`  - Part ${att.partNumber}: ${att.filename} (${att.contentType}, ${att.size} bytes)`);
  }
  
  return attachments;
}

// Find part number by counting nested sections before position
function findPartNumberByPosition(structure: string, position: number): string {
  const before = structure.substring(0, position);
  let depth = 0;
  let partNum = 0;
  
  for (const char of before) {
    if (char === '(') {
      depth++;
      if (depth === 2) partNum++;
    }
    if (char === ')') depth--;
  }
  
  return String(partNum || 1);
}

// Simple IMAP client with attachment support
export class IMAPClient {
  uidValidity: number | null = null;
  private conn: Deno.TlsConn | Deno.TcpConn | null = null;
  private encoder = new TextEncoder();
  private reader = new ImapByteReader(buffer => this.conn!.read(buffer));
  private tagCounter = 0;


  constructor(private host: string) {}

  private getTag(): string { return `A${++this.tagCounter}`; }

  async connect(): Promise<void> {
    this.conn = await Deno.connect({ hostname: this.host, port: 143 });
    await this.readLine();
    await this.startTls();
  }

  private async readLine(): Promise<string> { return await this.reader.readLine(); }

  private async readUntilTag(tag: string): Promise<string> {
    let result = "";
    while (true) {
      const line = await this.readLine();
      result += line + "\r\n";

      // IMAP literals: a line ending with {N} means the server will send exactly N raw bytes next.
      const literalMatch = line.match(/\{(\d+)\}\s*$/);
      if (literalMatch) {
        const literalSize = parseInt(literalMatch[1], 10);
        console.log(`[IMAP] literal detected: {${literalSize}}`);
        const literalBytes = await this.readBytes(literalSize);
        console.log(`[IMAP] literal read: ${literalBytes.length}/${literalSize} bytes`);
        result += new TextDecoder().decode(literalBytes);
      }

      if (
        line.startsWith(`${tag} OK`) ||
        line.startsWith(`${tag} NO`) ||
        line.startsWith(`${tag} BAD`)
      ) {
        break;
      }
    }
    return result;
  }

  private async readBytes(count: number): Promise<Uint8Array> { return await this.reader.readBytes(count); }

  private async writeCommand(command: string): Promise<void> {
    await this.conn!.write(this.encoder.encode(command + '\r\n'));
  }

  private async sendCommand(command: string): Promise<string> {
    const tag = this.getTag();
    await this.writeCommand(`${tag} ${command}`);
    return await this.readUntilTag(tag);
  }

  private getTlsCandidates(): string[] {
    const candidates = [this.host];
    const parts = this.host.split(".").filter(Boolean);
    if (parts.length >= 3) {
      const domain = parts.slice(1).join(".");
      candidates.push(domain, `mail.${domain}`, `webmail.${domain}`, `smtp.${domain}`);
    } else if (parts.length === 2) {
      candidates.push(`mail.${this.host}`, `webmail.${this.host}`, `smtp.${this.host}`);
    }
    return [...new Set(candidates)];
  }

  private async startTls(): Promise<void> {
    for (const serverName of this.getTlsCandidates()) {
      try {
        const tag = this.getTag();
        await this.writeCommand(`${tag} STARTTLS`);
        const response = await this.readUntilTag(tag);
        if (!response.includes(`${tag} OK`)) throw new Error("STARTTLS failed");
        
        this.reader.clear();
        const tcpConn = this.conn as Deno.TcpConn;
        this.conn = await Deno.startTls(tcpConn, { hostname: serverName });
        
        const noopTag = this.getTag();
        await this.writeCommand(`${noopTag} NOOP`);
        await this.readUntilTag(noopTag);
        return;
      } catch {
        try { this.conn?.close(); } catch { /* ignore */ }
        this.reader.clear();
        this.conn = await Deno.connect({ hostname: this.host, port: 143 });
        await this.readLine();
      }
    }
    throw new Error("Could not establish TLS");
  }

  async login(username: string, password: string): Promise<boolean> {
    const response = await this.sendCommand(`LOGIN ${quoteImapString(username)} ${quoteImapString(password)}`);
    return response.includes("OK");
  }

  async select(mailbox: string): Promise<void> {
    const response = await this.sendCommand(`EXAMINE ${quoteImapString(mailbox)}`);
    requireImapCommandOk(response, 'EXAMINE');
    const validity = response.match(/\[UIDVALIDITY ([1-9]\d*)\]/i);
    this.uidValidity = validity && Number.isSafeInteger(Number(validity[1])) ? Number(validity[1]) : null;
    if (!this.uidValidity || this.uidValidity > 4294967295) throw new ImportIdentityConflict('UIDVALIDITY non vérifiable. Aucun import effectué.');
  }

  async fetchHeaders(uid: number) {
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)]`);
    requireImapCommandOk(response, 'UID FETCH headers');
    const records = searchFetchMessages(response);
    if (records.length !== 1 || records[0].uid !== uid) throw new ImportIdentityConflict('UID retourné absent ou ambigu. Aucun import effectué.');
    return readImapHeaders(records[0].headerResponse, uid, decodeHeader);
  }

  async fetchBodyStructure(uid: number): Promise<AttachmentInfo[]> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODYSTRUCTURE`);
    return parseBodyStructure(response);
  }

  async fetchAttachment(uid: number, partNumber: string, encoding: string): Promise<Uint8Array> {
    console.log(`[FETCH] Fetching attachment: UID ${uid}, part ${partNumber}, encoding ${encoding}`);
    
    // Use BODY.PEEK to not mark as read
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[${partNumber}]`);
    console.log(`[FETCH] Response length: ${response.length} chars`);
    console.log(`[FETCH] Response preview: ${response.substring(0, 300)}`);
    
    let rawContent = '';
    
    // Pattern 1: BODY[X] {size}\r\ncontent - literal format (most common for attachments)
    const literalMatch = response.match(/BODY\[[\d.]+\]\s*\{(\d+)\}/i);
    if (literalMatch) {
      const expectedSize = parseInt(literalMatch[1], 10);
      const literalMarker = `{${expectedSize}}`;
      const afterBrace = response.indexOf(literalMarker) + literalMarker.length;
      
      // Find the \r\n after the literal marker
      let contentStart = afterBrace;
      if (response.substring(afterBrace, afterBrace + 2) === '\r\n') {
        contentStart = afterBrace + 2;
      } else if (response[afterBrace] === '\n') {
        contentStart = afterBrace + 1;
      }
      
      rawContent = response.substring(contentStart, contentStart + expectedSize);
      console.log(`[FETCH] Extracted ${rawContent.length}/${expectedSize} bytes using literal pattern`);
    }
    
    // Pattern 2: BODY[X] "content" - quoted format (rare for binary)
    if (!rawContent) {
      const quotedMatch = response.match(/BODY\[[\d.]+\]\s+"([^"]*)"/i);
      if (quotedMatch && quotedMatch[1]) {
        rawContent = quotedMatch[1];
        console.log(`[FETCH] Extracted ${rawContent.length} bytes using quoted pattern`);
      }
    }
    
    // Pattern 3: Extract content between BODY[X] and closing paren
    if (!rawContent) {
      const bodyStartMatch = response.match(/BODY\[[\d.]+\]\s*/i);
      if (bodyStartMatch) {
        const startIdx = response.indexOf(bodyStartMatch[0]) + bodyStartMatch[0].length;
        // Find the last ) before the final tag response
        const tagMatch = response.match(/\r\n[A-Z]\d+\s+(OK|NO|BAD)/i);
        const endIdx = tagMatch ? response.lastIndexOf(')', response.indexOf(tagMatch[0])) : response.lastIndexOf(')');
        
        if (endIdx > startIdx) {
          rawContent = response.substring(startIdx, endIdx).trim();
          console.log(`[FETCH] Extracted ${rawContent.length} bytes using fallback pattern`);
        }
      }
    }
    
    if (!rawContent || rawContent.length === 0) {
      console.log(`[FETCH] No content extracted for part ${partNumber}`);
      return new Uint8Array(0);
    }
    
    // Decode based on encoding
    if (encoding.toLowerCase() === 'base64') {
      return decodeBase64Chunked(rawContent);
    } else if (encoding.toLowerCase() === 'quoted-printable') {
      return decodeQuotedPrintable(rawContent);
    }
    
    return new TextEncoder().encode(rawContent);
  }

  async fetchMessage(uid: number): Promise<{
    subject: string;
    from: string;
    to: string[];
    date: string;
    messageId: string;
    references: string;
    bodyText: string;
    bodyHtml: string;
    attachments: AttachmentInfo[];
  }> {
    const { subject, from, to, date, messageId, references } = await this.fetchHeaders(uid);

    // Fetch body text with improved MIME parsing
    const bodyResp = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[TEXT]`);
    let bodyText = '';
    let bodyHtml = '';
    
    const bodyMarker = bodyResp.match(/BODY\[TEXT\] \{(\d+)\}\r\n/);
    if (bodyMarker) {
      const bodySize = parseInt(bodyMarker[1], 10);
      const bodyStart = bodyResp.indexOf(bodyMarker[0]) + bodyMarker[0].length;
      const raw = bodyResp.substring(bodyStart, bodyStart + bodySize);

      console.log(`[IMAP] BODY[TEXT] literal size=${bodySize}, extracted=${raw.length}`);

      // Check if this is a multipart email (contains MIME boundaries)
      if (raw.includes('Content-Type:') && raw.includes('boundary')) {
        console.log('Detected multipart MIME email, parsing structure...');
        const extracted = extractTextFromMultipart(raw);
        bodyText = extracted.text;
        bodyHtml = extracted.html;
        console.log(`Multipart extraction result - text: ${bodyText.length} chars, html: ${bodyHtml.length} chars`);
      } else {
        // Simple email - just decode quoted-printable
        const decoded = decodeQuotedPrintableText(raw);

        // Check if it's HTML or plain text
        if (decoded.includes('<html') || decoded.includes('<HTML') || decoded.includes('<body')) {
          bodyHtml = decoded;
          bodyText = stripHtmlTags(decoded);
        } else {
          bodyText = decoded;
        }
      }
    }

    // Fetch attachments info
    const attachments = await this.fetchBodyStructure(uid);
    console.log(`Message ${uid} has ${attachments.length} attachment(s)`);

    return { subject, from, to, date, messageId, references, bodyText, bodyHtml, attachments };
  }

  async logout(): Promise<void> {
    try { await this.sendCommand('LOGOUT'); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
  }
}

async function analyzeThreadWithAI(emails: any[], attachmentTexts: string[], supabase: any): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.log("LOVABLE_API_KEY not configured, skipping AI analysis");
    return null;
  }

  // Build thread context
  const sortedEmails = [...emails].sort((a, b) => 
    new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );

  let threadContent = sortedEmails.map((email, idx) => `
--- EMAIL ${idx + 1}/${sortedEmails.length} ---
DATE: ${email.sent_at}
DE: ${email.from_address}
À: ${email.to_addresses?.join(', ') || 'N/A'}
SUJET: ${email.subject}

CONTENU:
${email.body_text || '(Pas de contenu texte)'}
`).join('\n\n');

  // Add attachment content if available
  if (attachmentTexts.length > 0) {
    threadContent += '\n\n=== PIÈCES JOINTES ANALYSÉES ===\n';
    threadContent += attachmentTexts.join('\n---\n');
  }

  console.log(`Analyzing thread with ${emails.length} emails and ${attachmentTexts.length} attachments...`);

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: THREAD_ANALYSIS_PROMPT },
          { role: "user", content: threadContent }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI analysis error:", response.status, errorText);
      return null;
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content;
    
    try {
      return extractAndParseJSON<any>(content ?? "", {
        label: "import-thread",
        maxLogChars: 500,
        expectRoot: "object",
      });
    } catch (e) {
      console.error("Failed to parse AI response (import-thread):", (e as Error).message);
      return null;
    }
  } catch (error) {
    console.error("AI analysis failed:", error);
    return null;
  }
}

async function storeExtractedKnowledge(
  analysis: any, 
  threadId: string, 
  emailIds: string[], 
  supabase: any
): Promise<number> {
  if (!analysis || !analysis.extractions || analysis.extractions.length === 0) {
    return 0;
  }

  let stored = 0;

  for (const extraction of analysis.extractions) {
    if (extraction.confidence < 0.3) {
      console.log(`Skipping low confidence extraction: ${extraction.name}`);
      continue;
    }

    // Check for existing similar knowledge
    const { data: existing } = await supabase
      .from('learned_knowledge')
      .select('id, confidence')
      .eq('category', extraction.category)
      .eq('name', extraction.name)
      .maybeSingle();

    if (existing) {
      if (extraction.confidence > existing.confidence) {
        await supabase
          .from('learned_knowledge')
          .update({
            data: extraction.data,
            confidence: extraction.confidence,
            description: extraction.description,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        console.log(`Updated knowledge: ${extraction.name}`);
      }
      continue;
    }

    const { error } = await supabase
      .from('learned_knowledge')
      .insert({
        category: extraction.category,
        name: extraction.name,
        description: extraction.description,
        data: {
          ...extraction.data,
          source_thread_id: threadId,
          source_email_ids: emailIds
        },
        source_type: 'email_thread',
        source_id: emailIds[0],
        confidence: extraction.confidence,
        is_validated: extraction.confidence >= 0.8
      });

    if (!error) {
      stored++;
      console.log(`Stored knowledge: ${extraction.name} (${extraction.category})`);
    }
  }

  return stored;
}

// Maximum attachment size to process (5MB) - prevents memory limit errors
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const INLINE_IMAGE_MIN_BYTES = 8000;
const SIGNATURE_IMAGE_FILENAME_PATTERN = /(logo|signature|banner|footer|spacer|facebook|instagram|linkedin)/i;

function getAttachmentDedupKey(filename: string, size: number): string {
  return size > 0 ? `${filename}|${size}` : filename;
}

async function processAttachment(
  client: IMAPClient,
  uid: number,
  attachment: AttachmentInfo,
  emailId: string,
  supabase: any,
  existingAttachmentId?: string
): Promise<{ id: string; extractedText: string } | null> {
  try {
    console.log(`Processing attachment: ${attachment.filename} (${attachment.contentType}, ~${attachment.size} bytes)`);
    
    // Skip large attachments to prevent memory limit errors
    if (attachment.size > MAX_ATTACHMENT_SIZE) {
      console.log(`Skipping large attachment ${attachment.filename} (${(attachment.size / 1024 / 1024).toFixed(2)}MB > 5MB limit)`);
      
      // Create or update a record for the attachment marked as too large
      const oversizedPayload = {
        email_id: emailId,
        filename: attachment.filename,
        content_type: attachment.contentType,
        size: attachment.size,
        storage_path: null,
        is_analyzed: false,
        extracted_text: `[Pièce jointe trop volumineuse: ${(attachment.size / 1024 / 1024).toFixed(2)}MB - non traitée automatiquement]`,
        extracted_data: null,
        analysis_claimed_at: null
      };
      const { data: attachmentRecord } = existingAttachmentId
        ? await supabase
            .from('email_attachments')
            .update(oversizedPayload)
            .eq('id', existingAttachmentId)
            .select()
            .single()
        : await supabase
            .from('email_attachments')
            .insert(oversizedPayload)
            .select()
            .single();
      
      return attachmentRecord ? { id: attachmentRecord.id, extractedText: '' } : null;
    }
    
    if (attachment.contentType.startsWith('image/')) {
      const isTinyImage = attachment.size < INLINE_IMAGE_MIN_BYTES;
      const hasSignatureFilename = SIGNATURE_IMAGE_FILENAME_PATTERN.test(attachment.filename);
      if (isTinyImage || hasSignatureFilename) {
        console.log(`Skipping tiny/signature image: ${attachment.filename} (${attachment.contentType}, ${attachment.size} bytes)`);
        return null;
      }

      console.log(`Keeping inline image candidate: ${attachment.filename} (${attachment.contentType}, ${attachment.size} bytes, part ${attachment.partNumber})`);
    }
    
    // Download attachment content
    const content = await client.fetchAttachment(uid, attachment.partNumber, attachment.encoding);
    
    if (content.length === 0) {
      console.log(`Empty attachment content for ${attachment.filename}`);
      return null;
    }
    
    console.log(`Downloaded ${content.length} bytes for ${attachment.filename}`);
    
    // Generate storage path
    const timestamp = Date.now();
    const safeName = attachment.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `email-attachments/${emailId}/${timestamp}_${safeName}`;
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, content, {
        contentType: attachment.contentType,
        upsert: true
      });
    
    if (uploadError) {
      console.error(`Failed to upload ${attachment.filename}:`, uploadError);
      // P0-1: Persist attachment record even if upload failed — allows repair via force-download-attachment
      const uploadFailPayload = {
        email_id: emailId,
        filename: attachment.filename,
        content_type: attachment.contentType,
        size: attachment.size || content.length,
        storage_path: null,
        is_analyzed: false,
        extracted_text: `[Upload storage échoué — réparable via force-download]`,
        extracted_data: null,
        analysis_claimed_at: null
      };
      const { data: fallbackRecord } = existingAttachmentId
        ? await supabase
            .from('email_attachments')
            .update(uploadFailPayload)
            .eq('id', existingAttachmentId)
            .select()
            .single()
        : await supabase
            .from('email_attachments')
            .insert(uploadFailPayload)
            .select()
            .single();
      return fallbackRecord ? { id: fallbackRecord.id, extractedText: '' } : null;
    }
    
    console.log(`Uploaded to storage: ${storagePath}`);
    
    // Insert attachment record
    // Insert new record or update existing ghost record (storage_path was null)
    const successPayload = {
      email_id: emailId,
      filename: attachment.filename,
      content_type: attachment.contentType,
      size: content.length,
      storage_path: storagePath,
      is_analyzed: false,
      extracted_text: null,
      extracted_data: null,
      analysis_claimed_at: null
    };
    const { data: attachmentRecord, error: insertError } = existingAttachmentId
      ? await supabase
          .from('email_attachments')
          .update(successPayload)
          .eq('id', existingAttachmentId)
          .select()
          .single()
      : await supabase
          .from('email_attachments')
          .insert(successPayload)
          .select()
          .single();
    
    if (insertError) {
      console.error(`Failed to insert attachment record:`, insertError);
      return null;
    }
    
    // Analyze document content if it's a supported type
    const extractedText = '';
    const analyzableTypes = [
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
      'text/plain'
    ];
    
    // Note: text extraction for email attachments is handled by analyze-attachments (separate circuit).
    // The previous inline extraction via parse-document was non-functional (private bucket + wrong payload format)
    // and has been removed in M20b.
    
    return {
      id: attachmentRecord.id,
      extractedText
    };
  } catch (error) {
    console.error(`Error processing attachment ${attachment.filename}:`, error);
    return null;
  }
}

export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let client: IMAPClient | null = null;

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { configId, uids, learningCase, threadKey, searchIdentity } = await req.json();
    if (!Array.isArray(uids) || !uids.length || uids.length > 1000 ||
        uids.some(uid => !Number.isSafeInteger(uid) || uid <= 0 || uid > 4294967295)) {
      throw new ImportIdentityConflict("Liste de UID invalide. Aucun import effectué.");
    }
    const uniqueUids: number[] = [...new Set<number>(uids)];
    
    // Limit batch size to prevent CPU timeout
    const MAX_EMAILS_PER_BATCH = 10;
    const batchUids = uniqueUids.slice(0, MAX_EMAILS_PER_BATCH);
    const remainingUids = uniqueUids.slice(MAX_EMAILS_PER_BATCH);
    
    console.log(`Processing batch of ${batchUids.length} emails (${remainingUids.length} remaining)`);
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get config
    const { data: config, error: configError } = await supabase
      .from('email_configs')
      .select('id,name,host,port,username,folder,use_ssl,is_active,last_sync_at,created_at')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      throw new Error("Configuration email non trouvée");
    }

    const imapPassword = await readMailboxSecret(supabase, config.id);
    client = new IMAPClient(config.host);
    await client.connect();
    
    const loggedIn = await client.login(config.username, imapPassword);
    if (!loggedIn) throw new Error("Échec de l'authentification IMAP");

    await client.select(config.folder || 'INBOX');

    const mailbox = config.folder || 'INBOX';
    const accountKey = await imapAccountKey(config);
    assertImportSearchIdentity(searchIdentity, { configId, mailbox, uidValidity: client.uidValidity, accountKey }, batchUids);

    // Verify the entire batch's header identities before any database/file write.
    const rootOf = (msg: { references: string; messageId: string }) => msg.references.split(/\s+/).filter(Boolean)[0] || msg.messageId;
    const headers = [];
    for (const uid of batchUids) {
      const header = await client.fetchHeaders(uid);
      if (searchIdentity.messages.find(m => m.uid === uid)!.messageId !== header.messageId) {
        throw new ImportIdentityConflict('Le message sélectionné a changé. Relancez la recherche.');
      }
      headers.push({ uid, ...header });
    }
    const roots = [...new Set(headers.map(rootOf))];
    if (roots.length !== 1 || (threadKey !== undefined && threadKey !== roots[0])) {
      throw new ImportIdentityConflict('Racines de conversation incompatibles. Aucun import effectué.');
    }
    const fetched = [];
    for (const header of headers) {
      const msg = await client.fetchMessage(header.uid);
      if (msg.messageId !== header.messageId || rootOf(msg) !== roots[0]) {
        throw new ImportIdentityConflict('Identité IMAP instable. Aucun import effectué.');
      }
      fetched.push({ uid: header.uid, ...msg });
    }
    await client.select(mailbox);
    assertImportSearchIdentity(searchIdentity, { configId, mailbox, uidValidity: client.uidValidity, accountKey }, batchUids);

    // One service-only transaction resolves provenance, adopts identity-only and
    // links NULL thread_ref values. Legacy without reviewed proof fails closed.
    const { data: persisted, error: persistError } = await supabase.rpc('persist_imap_import_batch', {
      p_config_id: configId, p_account: imapAccountSnapshot(config), p_mailbox: mailbox,
      p_uid_validity: client.uidValidity, p_root_message_id: roots[0],
      p_messages: fetched.map(msg => ({
        uid: msg.uid, message_id: msg.messageId, root_message_id: rootOf(msg),
        from_address: msg.from, to_addresses: msg.to.length ? msg.to : [config.username],
        subject: msg.subject, body_text: msg.bodyText || null, body_html: msg.bodyHtml || null,
        sent_at: parseEmailDate(msg.date), is_quotation_request: learningCase === 'quotation',
        extracted_data: learningCase ? { learning_case: learningCase, imported_for_learning: true, attachments_count: msg.attachments.length } : null,
      })),
    });
    if (persistError || !persisted) {
      if (persistError?.code === 'P0001' || persistError?.code === '23505' || persistError?.code === '22023') {
        throw new ImportIdentityConflict('Identité ou rattachement ambigu, adoption préalable requise. Aucun lot enregistré.');
      }
      throw new Error('Persistance atomique IMAP indisponible. Aucun repli historique autorisé.');
    }
    const records = persisted.emails as Array<{ id: string; uid: number; created: boolean }>;
    const allEmailIds = records.map(record => record.id);
    const newIds = new Set(records.filter(record => record.created).map(record => record.id));
    const existingEmailIds = records.filter(record => !record.created).map(record => record.id);
    const threadId: string = persisted.thread_id;
    const { data: storedEmails, error: readError } = await supabase.from('emails').select('*').in('id', allEmailIds);
    if (readError || !storedEmails || storedEmails.length !== allEmailIds.length) {
      throw new Error('Lot enregistré, relecture incomplète. Relancez pour retrouver les mêmes UUID.');
    }
    const importedEmails = storedEmails.map(email => ({ ...email,
      messageId: email.message_id, alreadyExists: !newIds.has(email.id), bodyUpdated: false,
    }));
    const newlyImportedEmails = storedEmails.filter(email => newIds.has(email.id));
    const allEmailsForAnalysis = storedEmails;
    const allAttachmentTexts: string[] = [];
    let totalAttachments = 0;
    // Existing rows are immutable in this path: no body hydration, file repair,
    // attachment insertion or extracted_data update on replay/adoption.
    for (const record of records.filter(record => record.created)) {
      const msg = fetched.find(message => message.uid === record.uid)!;
      for (const attachment of msg.attachments) {
        const result = await processAttachment(client, msg.uid, attachment, record.id, supabase);
        if (result) {
          totalAttachments++;
          if (result.extractedText) allAttachmentTexts.push(`[${attachment.filename}]\n${result.extractedText.substring(0, 5000)}`);
        }
      }
    }
    await client.logout();
    client = null;

    // AI Analysis of the thread (even if all emails already exist)
    let analysisResult = null;
    let knowledgeStored = 0;

    if (learningCase && newlyImportedEmails.length > 0) {
      console.log(`Starting AI analysis of thread with ${allEmailsForAnalysis.length} emails (${newlyImportedEmails.length} new, ${existingEmailIds.length} existing)...`);
      
      // Analyze the complete thread with attachment content
      analysisResult = await analyzeThreadWithAI(allEmailsForAnalysis, allAttachmentTexts, supabase);
      
      if (analysisResult) {
        // Store extracted knowledge
        knowledgeStored = await storeExtractedKnowledge(
          analysisResult, 
          threadId!, 
          allEmailIds, 
          supabase
        );

        // Create/update main thread knowledge entry with analysis summary
        const threadKnowledgeName = `Échange: ${allEmailsForAnalysis[0]?.subject?.substring(0, 80) || 'Sans titre'}`;
        
        // Check if thread knowledge already exists
        const { data: existingKnowledge } = await supabase
          .from('learned_knowledge')
          .select('id')
          .eq('name', threadKnowledgeName)
          .eq('category', 'quotation_exchange')
          .maybeSingle();

        const threadKnowledgeData = {
          name: threadKnowledgeName,
          category: 'quotation_exchange',
          description: analysisResult.summary || `Échange de ${allEmailsForAnalysis.length} emails analysé`,
          source_type: 'email_thread',
          data: {
            email_ids: allEmailIds,
            thread_id: threadId,
            participants: [...new Set(allEmailsForAnalysis.flatMap(e => [e.from_address, ...(e.to_addresses || [])]))],
            date_range: {
              first: allEmailsForAnalysis[allEmailsForAnalysis.length - 1]?.sent_at,
              last: allEmailsForAnalysis[0]?.sent_at
            },
            learning_case: learningCase,
            quotation_detected: analysisResult.quotation_detected,
            quotation_amount: analysisResult.quotation_amount,
            client_satisfaction: analysisResult.client_satisfaction,
            extractions_count: analysisResult.extractions?.length || 0,
            attachments_analyzed: allAttachmentTexts.length
          },
          confidence: 0.7,
          is_validated: false,
          updated_at: new Date().toISOString()
        };

        if (existingKnowledge) {
          await supabase
            .from('learned_knowledge')
            .update(threadKnowledgeData)
            .eq('id', existingKnowledge.id);
          console.log('Updated existing thread knowledge');
        } else {
          await supabase.from('learned_knowledge').insert(threadKnowledgeData);
          console.log('Created new thread knowledge');
        }

        // Update all emails with analysis results
        for (const email of newlyImportedEmails) {
          await supabase
            .from('emails')
            .update({
              extracted_data: {
                ...(typeof email.extracted_data === 'object' ? email.extracted_data : {}),
                ai_analyzed: true,
                analyzed_at: new Date().toISOString(),
                thread_summary: analysisResult.summary,
                learning_case: learningCase
              }
            })
            .eq('id', email.id);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        imported: newlyImportedEmails.length,
        alreadyExisted: existingEmailIds.length,
        totalAnalyzed: allEmailsForAnalysis.length,
        attachmentsProcessed: totalAttachments,
        threadId,
        emails: importedEmails,
        remainingUids: remainingUids,
        hasMore: remainingUids.length > 0,
        analysis: analysisResult ? {
          summary: analysisResult.summary,
          extractionsCount: analysisResult.extractions?.length || 0,
          knowledgeStored,
          quotationDetected: analysisResult.quotation_detected,
          quotationAmount: analysisResult.quotation_amount,
          attachmentsAnalyzed: allAttachmentTexts.length
        } : null
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Import error:", error);
    if (client) {
      try { await client.logout(); } catch { /* ignore */ }
    }
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erreur d'import",
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: error instanceof ImportIdentityConflict ? 409 : 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};
if (Deno.env.get("MAIL_FUNCTION_DISABLE_SERVE") !== "1") serve(handler);
