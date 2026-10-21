import ExcelJS from 'exceljs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSPORT_COLUMNS, parseTransportWorkbook, exportTransportWorkbook, prepareTransportImport, commitTransportImport, verifyTransportImport, type TransportRateRow, type ImportRate } from './transportRateWorkbook';

// Entirely synthetic; no production source, client, amount or approval.
export const fixture = (): TransportRateRow => ({
  id: '11111111-1111-4111-8111-111111111111', origin: 'ORIGINE_TEST', destination: 'DESTINATION_TEST',
  container_type: '20DV', cargo_category: null, rate_amount: 123, rate_currency: 'XOF',
  provider: 'PRESTATAIRE_SYNTHETIQUE', rate_includes: ['TEST'], notes: '=literal text',
  source_document: 'SOURCE_SYNTHETIQUE_NON_APPROUVEE', source_attachment_id: null, evidence_level: 'to_confirm',
  client_code: 'CLIENT_SYNTHETIQUE', validity_start: '2026-01-01', validity_end: '2026-12-31',
  is_active: false, created_at: '2026-01-01T00:00:00Z', updated_at: null,
});
async function workbook(change?: (sheet: ExcelJS.Worksheet) => void) {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Transport');
  sheet.addRow([...TRANSPORT_COLUMNS]); const row = fixture();
  sheet.addRow(TRANSPORT_COLUMNS.map(c => c === 'rate_includes' ? JSON.stringify(row[c]) : row[c]));
  change?.(sheet);
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
const cell = (sheet: ExcelJS.Worksheet, column: typeof TRANSPORT_COLUMNS[number], value: ExcelJS.CellValue) => { sheet.getRow(2).getCell(TRANSPORT_COLUMNS.indexOf(column) + 1).value = value; };
describe('classeur Transport et intégrité import (données synthétiques)', () => {
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); }); afterEach(() => { vi.unstubAllGlobals(); });
  it('exporte tous les champs sans interpréter une chaîne comme formule, puis réimporte sans perte', async () => {
    const bytes = await exportTransportWorkbook([fixture()]);
    const parsed = await parseTransportWorkbook(bytes.buffer as ArrayBuffer);
    const { created_at, updated_at, ...expected } = fixture();
    expect(parsed.errors).toEqual([]); expect(parsed.rows[0]).toEqual(expected);
    expect(parsed.rows[0].notes).toBe('=literal text'); expect(parsed.rows[0].client_code).toBe('CLIENT_SYNTHETIQUE');
    expect(prepareTransportImport(parsed, [fixture()])).toEqual({ rows: [], errors: [], unchanged: 1 });
  });
  it('génère un identifiant stable pour les reprises sans id fourni', async () => {
    const buffer = await workbook(s => cell(s, 'id', null));
    const a = await parseTransportWorkbook(buffer), b = await parseTransportWorkbook(buffer);
    expect(a.errors).toEqual([]); expect(a.rows[0].id).toBe(b.rows[0].id);
    expect(a.rows[0].id).toMatch(/^[\da-f-]{36}$/);
  });
  it.each([
    ['rate_amount', '123'], ['rate_amount', -1], ['rate_amount', null], ['rate_currency', 'XXX'],
    ['is_active', 'false'], ['validity_end', '2026-02-30'], ['container_type', 'inconnu'],
    ['source_attachment_id', 'inconnu'], ['rate_includes', '[1]'], ['evidence_level', 'approved'],
    ['notes', { formula: '1+1', result: 2 }], ['source_document', { text: 'source', hyperlink: 'https://invalid.example' }],
    ['source_document', 's'.repeat(256)], ['provider', 'p'.repeat(101)], ['cargo_category', 'c'.repeat(51)], ['validity_start', '0000-01-01'],
  ] as [typeof TRANSPORT_COLUMNS[number], ExcelJS.CellValue][])('rejette la valeur invalide de %s', async (column, value) => {
    const parsed = await parseTransportWorkbook(await workbook(s => cell(s, column, value)));
    expect(parsed.errors).toHaveLength(1); expect(parsed.rows).toHaveLength(0);
  });
  it('rejette colonnes altérées, feuilles supplémentaires et limites dépassées', async () => {
    await expect(parseTransportWorkbook(await workbook(s => { s.getCell('A1').value = 'bad'; }))).rejects.toThrow('Colonnes');
    await expect(parseTransportWorkbook(await workbook(s => { s.workbook.addWorksheet('Autre'); }))).rejects.toThrow('Une seule');
    await expect(parseTransportWorkbook(await workbook(s => { s.getCell('A202').value = 'excess'; }))).rejects.toThrow('200');
    await expect(parseTransportWorkbook(new ArrayBuffer(5 * 1024 * 1024 + 1))).rejects.toThrow('5 Mo');
  });
  it('bloque les doublons dans le fichier, montants absents et fenêtres inversées', async () => {
    const parsed = await parseTransportWorkbook(await workbook(s => { s.addRow(s.getRow(2).values); }));
    expect(parsed.errors[0]).toContain('répété');
    const reversed = await parseTransportWorkbook(await workbook(s => cell(s, 'validity_end', '2025-01-01')));
    expect(reversed.errors[0]).toContain('antérieure');
  });
  it('ne promeut, ne remplace et ne réactive aucun tarif, exige une source', () => {
    const existing = fixture();
    const parsed = { rows: [{ ...existing, rate_amount: 999 }], errors: [], unchanged: 0 };
    expect(prepareTransportImport(parsed, [existing]).errors[0]).toContain('modification');
    const active = prepareTransportImport({ ...parsed, rows: [{ ...existing, is_active: true, evidence_level: 'official' }] }, []);
    expect(active.errors[0]).toContain('validation distincte');
    const noSource = prepareTransportImport({ ...parsed, rows: [{ ...existing, source_document: null }] }, []);
    expect(noSource.errors[0]).toContain('source_document');
  });
  it('insère en un seul appel et confirme uniquement après relecture intégrale', async () => {
    let saved: TransportRateRow[] = [];
    const insert = vi.fn(async (rows: ImportRate[]) => { saved = rows.map(r => ({ ...r, created_at: null, updated_at: null })); });
    const read = vi.fn(async () => saved);
    expect((await commitTransportImport([fixture()], { read, insert })).status).toBe('committed');
    expect(insert).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
    expect((await commitTransportImport([fixture()], { read, insert })).status).toBe('committed');
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it('rapproche une réponse perdue, sans deuxième écriture', async () => {
    const read = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([fixture()]);
    const insert = vi.fn().mockRejectedValue(new TypeError('lost response'));
    expect((await commitTransportImport([fixture()], { read, insert })).status).toBe('committed');
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it('conserve UNKNOWN si relecture impossible, partielle ou contradictoire', async () => {
    const insert = vi.fn();
    expect((await verifyTransportImport([fixture()], { insert, read: vi.fn().mockRejectedValue(new Error()) })).status).toBe('unknown');
    expect((await verifyTransportImport([fixture()], { insert, read: async () => [] })).status).toBe('unknown');
    expect((await commitTransportImport([fixture()], { insert, read: async () => [{ ...fixture(), client_code: 'AUTRE_TEST' }] })).status).toBe('unknown');
    expect(insert).not.toHaveBeenCalled();
  });
  it('ne lance aucune écriture si le contrôle préalable échoue', async () => {
    const insert = vi.fn();
    expect((await commitTransportImport([fixture()], { insert, read: vi.fn().mockRejectedValue(new Error()) })).status).toBe('blocked');
    expect(insert).not.toHaveBeenCalled();
  });
  it('distingue un refus SQLSTATE/RLS avéré d’une réponse réseau perdue', async () => {
    const insert = vi.fn().mockRejectedValue({ code: '42501', message: 'synthetic private detail must not leak' });
    const outcome = await commitTransportImport([fixture()], { insert, read: async () => [] });
    expect(outcome.status).toBe('blocked'); expect(outcome.message).toContain('Aucune écriture de cette tentative');
    expect(outcome.message).not.toContain('private detail'); expect(insert).toHaveBeenCalledTimes(1);
  });
});
