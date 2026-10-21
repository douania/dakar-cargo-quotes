import type ExcelJS from 'exceljs';
import type { Database } from '@/integrations/supabase/types';

export type TransportRateRow = Database['public']['Tables']['local_transport_rates']['Row'];
export const TRANSPORT_COLUMNS = [
  'id', 'origin', 'destination', 'container_type', 'cargo_category', 'rate_amount',
  'rate_currency', 'provider', 'rate_includes', 'notes', 'source_document',
  'source_attachment_id', 'evidence_level', 'client_code', 'validity_start',
  'validity_end', 'is_active', 'created_at', 'updated_at',
] as const;
const PAYLOAD_COLUMNS = TRANSPORT_COLUMNS.filter(c => !['id', 'created_at', 'updated_at'].includes(c));
export const TRANSPORT_MAX_ROWS = 200;
export const TRANSPORT_MAX_BYTES = 5 * 1024 * 1024;
export type ImportRate = Omit<TransportRateRow, 'created_at' | 'updated_at'>;
export interface TransportPreview { rows: ImportRate[]; errors: string[]; unchanged: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVIDENCE = ['official', 'validated_internal', 'observed', 'historical_only', 'to_confirm', 'client_override'];
const CONTAINERS = ['20DV', '40DV', '40HC', '20RF', '40RF', 'FLATBED', 'LOWBED', "20' Dry", "40' Dry"];

function scalar(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  throw new Error('Cellule complexe, formule ou lien interdit ; utilisez une valeur simple.');
}
function text(value: unknown, required = false, max = 4000): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error('Champ obligatoire vide.');
    return null;
  }
  if (typeof value !== 'string' || value.length > max) throw new Error(`Texte attendu (${max} caractères maximum).`);
  if (required && !value.trim()) throw new Error('Champ obligatoire vide.');
  return value;
}
function date(value: unknown): string | null {
  const s = text(value);
  if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000-') || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s)) throw new Error('Date attendue : AAAA-MM-JJ (année 0001 à 9999).');
  return s;
}
export function transportFingerprint(row: Partial<TransportRateRow>): string {
  return JSON.stringify(PAYLOAD_COLUMNS.map(c => row[c] ?? null));
}
async function stableId(row: ImportRate): Promise<string> {
  // Stable for the exact payload across retries/reloads, without a DB upsert.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`dcq-transport-import-v1:${transportFingerprint(row)}`)));
  digest[6] = (digest[6] & 15) | 80; digest[8] = (digest[8] & 63) | 128;
  const hex = Array.from(digest.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function exportTransportWorkbook(rows: TransportRateRow[]): Promise<Uint8Array> {
  const { default: Excel } = await import('exceljs');
  const book = new Excel.Workbook();
  const sheet = book.addWorksheet('Transport');
  sheet.addRow([...TRANSPORT_COLUMNS]);
  for (const row of rows) sheet.addRow(TRANSPORT_COLUMNS.map(c => c === 'rate_includes' ? (row[c] === null ? null : JSON.stringify(row[c])) : row[c]));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.columns.forEach(c => { c.width = 24; });
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export async function parseTransportWorkbook(buffer: ArrayBuffer): Promise<TransportPreview> {
  if (buffer.byteLength > TRANSPORT_MAX_BYTES) throw new Error('Fichier trop volumineux (5 Mo maximum).');
  const { default: Excel } = await import('exceljs');
  const book = new Excel.Workbook();
  await book.xlsx.load(buffer);
  if (book.worksheets.length !== 1 || book.worksheets[0].name !== 'Transport') throw new Error('Une seule feuille nommée Transport est attendue. Utilisez l’export comme modèle.');
  const sheet = book.worksheets[0];
  if (sheet.rowCount > TRANSPORT_MAX_ROWS + 1) throw new Error('200 lignes maximum par import.');
  const headers = TRANSPORT_COLUMNS.map((_, i) => scalar(sheet.getRow(1).getCell(i + 1).value));
  if (sheet.columnCount !== TRANSPORT_COLUMNS.length || headers.some((v, i) => v !== TRANSPORT_COLUMNS[i])) throw new Error('Colonnes incorrectes : conservez les en-têtes et leur ordre dans l’export.');
  const rows: ImportRate[] = []; const errors: string[] = []; const seen = new Set<string>();
  for (let line = 2; line <= sheet.rowCount; line++) {
    const cells = sheet.getRow(line);
    if (!cells.hasValues) continue;
    try {
      const raw = Object.fromEntries(TRANSPORT_COLUMNS.map((c, i) => [c, scalar(cells.getCell(i + 1).value)]));
      const amount = raw.rate_amount;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) throw new Error('Montant numérique positif ou nul requis ; aucune conversion implicite.');
      if (typeof raw.is_active !== 'boolean') throw new Error('is_active doit être un booléen Excel TRUE/FALSE.');
      const container = text(raw.container_type, true);
      if (!CONTAINERS.includes(container)) throw new Error('Type de conteneur non reconnu.');
      const currency = text(raw.rate_currency, true);
      if (!['XOF', 'EUR', 'USD'].includes(currency)) throw new Error('Devise attendue : XOF, EUR ou USD.');
      const evidence = text(raw.evidence_level);
      if (evidence !== null && !EVIDENCE.includes(evidence)) throw new Error('Niveau de preuve non reconnu.');
      const attachment = text(raw.source_attachment_id);
      if (attachment && !UUID.test(attachment)) throw new Error('source_attachment_id doit être un UUID.');
      let includes: string[] | null = null;
      if (raw.rate_includes !== null) {
        includes = JSON.parse(text(raw.rate_includes, true));
        if (!Array.isArray(includes) || includes.length > 50 || includes.some(v => typeof v !== 'string' || !v.trim() || v.length > 200)) throw new Error('rate_includes doit être une liste JSON de textes.');
      }
      const row: ImportRate = {
        id: text(raw.id) || '', origin: text(raw.origin, true), destination: text(raw.destination, true),
        container_type: container, cargo_category: text(raw.cargo_category, false, 50), rate_amount: amount,
        rate_currency: currency, provider: text(raw.provider, false, 100), rate_includes: includes, notes: text(raw.notes),
        source_document: text(raw.source_document, false, 255), source_attachment_id: attachment,
        evidence_level: evidence, client_code: text(raw.client_code),
        validity_start: date(raw.validity_start), validity_end: date(raw.validity_end), is_active: raw.is_active,
      };
      if (row.validity_start && row.validity_end && row.validity_start > row.validity_end) throw new Error('Fin de validité antérieure au début.');
      if (row.id && !UUID.test(row.id)) throw new Error('id doit être vide ou un UUID.');
      if (!row.id) row.id = await stableId(row);
      const fingerprint = transportFingerprint(row);
      if (seen.has(row.id) || seen.has(fingerprint)) throw new Error('Ligne ou identifiant répété dans le fichier.');
      seen.add(row.id); seen.add(fingerprint); rows.push(row);
    } catch (error) { errors.push(`Ligne ${line} : ${error instanceof Error ? error.message : 'Valeur invalide.'}`); }
  }
  if (!rows.length && !errors.length) errors.push('Le fichier ne contient aucun tarif.');
  return { rows, errors, unchanged: 0 };
}

export function prepareTransportImport(parsed: TransportPreview, existing: TransportRateRow[]): TransportPreview {
  const errors = [...parsed.errors]; const rows: ImportRate[] = []; let unchanged = 0;
  for (const row of parsed.rows) {
    const old = existing.find(r => r.id === row.id);
    if (old) {
      if (transportFingerprint(old) === transportFingerprint(row)) unchanged++;
      else errors.push(`Identifiant ${row.id} : modification d’un tarif existant interdite par cet import.`);
      continue;
    }
    if (existing.some(r => transportFingerprint(r) === transportFingerprint(row))) { unchanged++; continue; }
    if (!row.source_document?.trim()) errors.push(`Destination ${row.destination} : source_document obligatoire pour un nouveau tarif.`);
    if (row.is_active !== false || row.evidence_level !== 'to_confirm') errors.push(`Destination ${row.destination} : nouvelle ligne attendue inactive (FALSE), evidence_level=to_confirm. L’activation nécessite une validation distincte.`);
    rows.push(row);
  }
  return { rows, errors, unchanged };
}

export interface TransportImportStore {
  read: (ids: string[]) => Promise<TransportRateRow[]>;
  insert: (rows: ImportRate[]) => Promise<void>;
}
export type ImportOutcome = { status: 'committed' | 'unknown' | 'blocked'; message: string };
export async function verifyTransportImport(rows: ImportRate[], store: TransportImportStore): Promise<ImportOutcome> {
  try {
    const found = await store.read(rows.map(r => r.id));
    if (found.length === rows.length && rows.every(r => found.some(f => f.id === r.id && transportFingerprint(f) === transportFingerprint(r)))) return { status: 'committed', message: `${rows.length} tarif(s) enregistré(s) et relu(s).` };
    return { status: 'unknown', message: 'Enregistrement non confirmé par relecture. Ne relancez pas l’import avant vérification ; le fichier et les identifiants permettent le rapprochement.' };
  } catch { return { status: 'unknown', message: 'Relecture indisponible. Résultat UNKNOWN ; conservez le fichier et vérifiez avant toute nouvelle écriture.' }; }
}
export async function commitTransportImport(rows: ImportRate[], store: TransportImportStore): Promise<ImportOutcome> {
  if (!rows.length) return { status: 'blocked', message: 'Aucun nouveau tarif à enregistrer.' };
  try {
    const found = await store.read(rows.map(r => r.id));
    if (found.length) return await verifyTransportImport(rows, store);
  } catch { return { status: 'blocked', message: 'Vérification préalable indisponible. Aucune écriture lancée.' }; }
  let refused = false;
  try { await store.insert(rows); } catch (error) {
    // PostgREST preserves SQLSTATE. A known transaction refusal differs from a
    // transport failure, whose response may have been lost after commit.
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    refused = ['42501', '23505', '23503', '23514', '22001', '22003', '22P02'].includes(code);
  }
  if (refused) {
    const verified = await verifyTransportImport(rows, store);
    if (verified.status === 'committed') return verified;
    return { status: 'blocked', message: 'INSERT refusé par les droits ou les contraintes de données. Aucune écriture de cette tentative ; faites vérifier le refus avant une nouvelle tentative. L’absence éventuelle de lignes invisibles n’est pas attestée.' };
  }
  return await verifyTransportImport(rows, store);
}
