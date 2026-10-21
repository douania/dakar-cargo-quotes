import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  TRANSPORT_COLUMNS, TRANSPORT_MAX_BYTES, commitTransportImport, exportTransportWorkbook,
  parseTransportWorkbook, prepareTransportImport, verifyTransportImport,
  type TransportRateRow, type TransportPreview, type ImportOutcome, type TransportImportStore,
} from '@/lib/transportRateWorkbook';

const store: TransportImportStore = {
  read: async ids => {
    const { data, error } = await supabase.from('local_transport_rates').select('*').in('id', ids);
    if (error) throw error;
    return data;
  },
  insert: async rows => {
    // A single INSERT, no upsert, no update, no automatic retry, existing RLS.
    const { error } = await supabase.from('local_transport_rates').insert(rows);
    if (error) throw error;
  },
};

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TransportRateExchange({ rates, allRates, ready }: { rates: TransportRateRow[]; allRates: TransportRateRow[]; ready: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [preview, setPreview] = useState<TransportPreview | null>(null);
  const [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(0);
  const [filename, setFilename] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); }
    catch { setMessage('Opération indisponible. Aucun succès confirmé. Conservez votre fichier et réessayez après vérification.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const reset = () => { setPreview(null); setMessage(''); setOutcome(null); setConfirmed(false); setPage(0); setFilename(''); };
  const readFile = (file?: File) => run(async () => {
    reset();
    if (!file) return;
    setFilename(file.name);
    if (!/\.xlsx$/i.test(file.name) || file.size > TRANSPORT_MAX_BYTES) { setMessage('Choisissez un fichier .xlsx de 5 Mo maximum.'); return; }
    try { setPreview(prepareTransportImport(await parseTransportWorkbook(await file.arrayBuffer()), allRates)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Classeur illisible.'); }
  });
  const save = () => run(async () => {
    if (!preview || preview.errors.length || !confirmed || outcome) return;
    const result = await commitTransportImport(preview.rows, store);
    setOutcome(result);
    if (result.status === 'committed') await queryClient.invalidateQueries({ queryKey: ['transport-rates'] });
  });
  const verify = () => run(async () => {
    if (!preview) return;
    const result = await verifyTransportImport(preview.rows, store);
    setOutcome(result);
    if (result.status === 'committed') await queryClient.invalidateQueries({ queryKey: ['transport-rates'] });
  });
  const exportFile = () => run(async () => {
    setMessage('');
    download(await exportTransportWorkbook(rates), `transport-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setMessage(`${rates.length} ligne(s) chargée(s), après filtres, exportée(s). Les champs de provenance et de portée client sont conservés.`);
  });
  const columns = TRANSPORT_COLUMNS.filter(c => c !== 'created_at' && c !== 'updated_at');
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button ref={importButtonRef} variant="outline" className="gap-2" disabled={busy || !ready} onClick={() => { reset(); setOpen(true); }}><Upload className="h-4 w-4" />Importer Excel</Button>
      <Button variant="outline" className="gap-2" disabled={busy || !ready} onClick={exportFile}><Download className="h-4 w-4" />Exporter ({rates.length} lignes affichées)</Button>
    </div>
    {!open && message && <p role="status" className="max-w-lg text-sm">{message}</p>}
    <Dialog open={open} onOpenChange={value => { if (!busyRef.current) setOpen(value); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" onCloseAutoFocus={e => { e.preventDefault(); importButtonRef.current?.focus(); }} onEscapeKeyDown={e => { if (busyRef.current) e.preventDefault(); }} onPointerDownOutside={e => { if (busyRef.current) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Importer des tarifs transport</DialogTitle>
          <DialogDescription>Création uniquement, sans remplacement. Les nouvelles lignes doivent être inactives (FALSE) et à confirmer (to_confirm), avec leur source. Aucune activation ou validation tarifaire par cet import. La grille officielle Sénégal reste la seule source cotable pour l’intérieur Sénégal.</DialogDescription>
        </DialogHeader>
        <p className="text-sm">Utilisez l’export comme modèle : une feuille Transport, en-têtes inchangés. Ajoutez les nouvelles lignes avec id vide, source_document renseigné, is_active=FALSE et evidence_level=to_confirm. Montants numériques sans conversion, dates AAAA-MM-JJ, rate_includes en liste JSON. Maximum 200 lignes / 5 Mo. Les lignes existantes identiques sont ignorées ; toute modification existante bloque le fichier.</p>
        <div className="space-y-2"><Label htmlFor="transport-workbook">Fichier Excel (.xlsx)</Label><Input ref={fileRef} id="transport-workbook" type="file" accept=".xlsx" disabled={busy || !!outcome} onChange={e => { const file = e.target.files?.[0]; void readFile(file); e.target.value = ''; }} /></div>
        {busy && <p role="status">Traitement en cours… Ne fermez pas cette fenêtre.</p>}
        {message && <p role="alert">{message}</p>}
        {preview && <>
          <p role="status" className="text-sm">{filename} : {preview.rows.length} nouvelle(s) ligne(s), {preview.unchanged} identique(s) ignorée(s), {preview.errors.length} erreur(s). Aucune ligne du fichier n’est écrite tant que des erreurs subsistent.</p>
          {!!preview.errors.length && <ul role="alert" className="max-h-40 overflow-y-auto list-disc pl-5 text-sm text-destructive">{preview.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {!!preview.rows.length && <>
            <div role="region" aria-label="Aperçu des tarifs à créer, défilement horizontal" tabIndex={0} className="overflow-x-auto rounded-md border">
              <Table><TableHeader><TableRow>{columns.map(c => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
                <TableBody>{preview.rows.slice(page * 10, page * 10 + 10).map(r => <TableRow key={r.id}>{columns.map(c => <TableCell className="min-w-32 whitespace-normal break-words" key={c}>{Array.isArray(r[c]) ? JSON.stringify(r[c]) : String(r[c] ?? '—')}</TableCell>)}</TableRow>)}</TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>Précédent</Button><span className="text-sm">Page {page + 1} / {Math.ceil(preview.rows.length / 10)}</span><Button variant="outline" size="sm" disabled={busy || (page + 1) * 10 >= preview.rows.length} onClick={() => setPage(p => p + 1)}>Suivant</Button></div>
            {!outcome && <div className="flex items-start gap-2"><Checkbox id="transport-import-confirm" checked={confirmed} disabled={busy || !!preview.errors.length} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="transport-import-confirm">J’ai vérifié toutes les lignes, les montants, les sources et la portée client. Je confirme la création inactive à confirmer.</Label></div>}
          </>}
        </>}
        {outcome && <p role={outcome.status === 'committed' ? 'status' : 'alert'}>{outcome.message}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Fermer</Button>
          {outcome?.status === 'unknown' && <Button disabled={busy} variant="outline" onClick={verify}>Vérifier l’enregistrement</Button>}
          {!outcome && <Button disabled={busy || !ready || !confirmed || !preview?.rows.length || !!preview?.errors.length} onClick={save}>Créer {preview?.rows.length ?? 0} tarif(s) inactif(s)</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
