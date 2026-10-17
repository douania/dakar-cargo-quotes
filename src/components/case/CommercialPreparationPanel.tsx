/** Prepared editor; intentionally not mounted in CaseView before the version/persistence scope is approved. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { commercialPreparationSummary, parseCommercialAmount, reviseCommercialPreparation,
  type CommercialAction, type CommercialAmountBasis, type CommercialKind, type CommercialLine, type CommercialPreparation } from '@/lib/commercialPreparation';
import type { AirTariffState } from '../../../supabase/functions/_shared/air-tariff';

interface Props {
  initial: CommercialPreparation;
  actorId: string;
  airState?: AirTariffState;
  isLocked?: boolean;
  onDraftChanged?: (draft: CommercialPreparation) => void;
  persistedRevision?: number;
}
const money = (value: number | null) => value === null ? 'À confirmer' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value)} FCFA`;
const basisLabels: Record<CommercialAmountBasis, string> = { before_sodatra_vat: 'Avant TVA SODATRA', taxes_included: 'Taxes comprises', unknown: 'Base à préciser' };
// Business variant of the canonical Select: outer popup includes its border in the trigger width.
const commercialSelectPopup = { style: { width: 'var(--radix-select-trigger-width)' }, className: '[&_[data-radix-select-viewport]]:min-w-0' };

export function CommercialPreparationPanel(props: Props) {
  return <PreparationEditor key={`${props.initial.case_id}:${props.initial.source_version_id}`} {...props}/>;
}

function PreparationEditor({ initial, actorId, airState, isLocked = false, onDraftChanged, persistedRevision }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [editing, setEditing] = useState<CommercialLine | 'add' | null>(null);
  const [mode, setMode] = useState<'edit' | 'storage'>('edit');
  const [label, setLabel] = useState(''), [kind, setKind] = useState<Exclude<CommercialKind, 'source'>>('additional');
  const [amount, setAmount] = useState(''), [basis, setBasis] = useState<CommercialAmountBasis>('unknown');
  const [reason, setReason] = useState(''), [days, setDays] = useState(''), [weightId, setWeightId] = useState(''), [tariffKey, setTariffKey] = useState('');
  const [error, setError] = useState(''), [page, setPage] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null), reasonRef = useRef<HTMLTextAreaElement>(null), amountRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const summary = commercialPreparationSummary(draft), pageCount = Math.max(1, Math.ceil(draft.lines.length / 10));
  useEffect(() => {
    if (draft.revision <= (persistedRevision ?? 0)) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [draft.revision, persistedRevision]);

  function open(line: CommercialLine | 'add', nextMode: 'edit' | 'storage' = 'edit') {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(line); setMode(nextMode); setError(''); setReason('');
    setLabel(line === 'add' ? '' : line.label); setKind(line === 'add' || line.kind === 'source' ? 'additional' : line.kind);
    setAmount(line === 'add' || line.client_amount_xof === null ? '' : String(line.client_amount_xof));
    setBasis(line === 'add' ? 'unknown' : line.amount_basis); setDays(''); setWeightId(''); setTariffKey('');
  }
  function apply(removal?: 'remove' | 'restore') {
    if (isLocked || !editing) return;
    try {
      if (reason.trim().length < 10) { reasonRef.current?.focus(); throw new Error('Expliquez cette décision en au moins 10 caractères.'); }
      const id = editing === 'add' ? `operator:${crypto.randomUUID()}` : editing.id;
      let action: CommercialAction;
      if (removal) action = { type: removal, line_id: id, reason };
      else if (mode === 'storage') action = { type: 'storage', line_id: id, tariff_key: tariffKey, weight_fact_id: weightId, billable_days: parseCommercialAmount(days), reason };
      else {
        let value: number | null;
        try { value = parseCommercialAmount(amount); } catch (e) { amountRef.current?.focus(); throw e; }
        action = editing === 'add' ? { type: 'add', line_id: id, label, kind, amount: value, basis, reason }
          : { type: 'edit', line_id: id, amount: value, basis, reason };
      }
      const next = reviseCommercialPreparation(draft, action, { expected_revision: draft.revision, operation_id: crypto.randomUUID(), actor_id: actorId,
        occurred_at: new Date().toISOString(), air: airState, air_case_id: initial.case_id });
      setDraft(next); setEditing(null); onDraftChanged?.(structuredClone(next));
    } catch (e) { setError(e instanceof Error ? e.message : 'Décision non retenue.'); }
  }

  return <Card>
    <CardHeader><CardTitle>Frais retenus pour le dossier</CardTitle><CardDescription>Les coûts source restent conservés. Retenez vos montants et estimations pour ce dossier.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <p role="status" className="text-sm text-muted-foreground">{persistedRevision === undefined || draft.revision > persistedRevision ? 'Préparation locale non enregistrée' : 'Préparation enregistrée'} - révision {draft.revision}. Aucun devis existant n'est modifié.</p>
      <p className="text-sm">Choisir « Avant TVA SODATRA » désigne une prestation ou des honoraires SODATRA HT, soumis à la TVA existante de 18 %. « Taxes comprises » n’ajoute aucune TVA SODATRA. Une ligne inconnue n'est pas gratuite.</p>
      <Button type="button" disabled={isLocked || draft.lines.length >= 100} onClick={() => open('add')}>Ajouter une rubrique</Button>
      <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>Prestation</TableHead><TableHead>Coût fournisseur HT</TableHead><TableHead>Montant client</TableHead><TableHead>Décision</TableHead></TableRow></TableHeader>
        <TableBody>{draft.lines.slice(page * 10, (page + 1) * 10).map(line => <TableRow key={line.id}>
          <TableCell className="min-w-40 max-w-xs break-words"><span className={line.included ? '' : 'line-through'}>{line.label}</span>
            <div><Badge variant="outline">{!line.included ? 'Retirée' : line.status === 'estimated' ? 'Estimation opérateur' : line.status === 'source' ? 'Calcul source' : 'À confirmer'}</Badge></div>
            {line.kind === 'customs_estimate' && <p className="text-xs">Provision opérateur ; aucun taux fiscal validé.</p>}
            {line.reason && <p className="text-xs text-muted-foreground">{line.reason}</p>}
          </TableCell>
          <TableCell>{money(line.supplier?.amount_ht_xof ?? null)}{line.supplier?.status === 'estimated' && <p className="text-xs">Coût estimé</p>}
            {line.supplier && <details><summary className="cursor-pointer text-xs">Provenance interne</summary><pre className="max-h-48 max-w-xs overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(line.supplier.evidence, null, 2)}</pre></details>}
          </TableCell>
          <TableCell>{money(line.client_amount_xof)}<p className="text-xs">{basisLabels[line.amount_basis]}</p></TableCell>
          <TableCell><div className="flex flex-col items-start gap-2"><Button type="button" size="sm" variant="outline" disabled={isLocked} onClick={() => open(line)}>Modifier {line.label}</Button>
            {line.kind === 'storage_estimate' && <Button type="button" size="sm" variant="outline" disabled={isLocked || !line.included} onClick={() => open(line, 'storage')}>Estimer le magasinage</Button>}</div></TableCell>
        </TableRow>)}</TableBody>
      </Table></div>
      {!draft.lines.length && <p>Aucune ligne préparée. Ajoutez une rubrique pour commencer.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Page précédente</Button><span>Page {page + 1} sur {pageCount} — {draft.lines.length} rubriques</span><Button type="button" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>Page suivante</Button></div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3"><div><dt>Montants saisis avant TVA SODATRA</dt><dd>{money(summary.before_sodatra_vat)}</dd></div><div><dt>Montants saisis taxes comprises</dt><dd>{money(summary.taxes_included)}</dd></div><div><dt>Montants dont la base reste à préciser</dt><dd>{money(summary.basis_unknown)}</dd></div></dl>
      <p className="text-sm">{summary.unpriced_lines} poste(s) à confirmer ; {summary.estimated_lines} estimation(s). La préparation ne constitue pas un total fiscal validé.</p>
      <details><summary className="cursor-pointer">Historique de la préparation locale ({draft.events.length})</summary><ol className="space-y-2 text-sm">{draft.events.slice(-10).map(e => <li key={e.operation_id}>Révision {e.revision} — {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(e.occurred_at))} UTC — {e.actor_id} : {e.action.type}, {e.after.label}. {e.action.reason}</li>)}</ol></details>
      <Dialog open={editing !== null} onOpenChange={v => { if (!v) setEditing(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); returnFocusRef.current?.focus(); }}>
        <DialogHeader><DialogTitle>{mode === 'storage' ? 'Estimer le magasinage' : editing === 'add' ? 'Ajouter une rubrique' : 'Modifier le montant client'}</DialogTitle><DialogDescription>Décision au dossier, sans modifier le tarif global. Tout montant modifié reste une estimation opérateur.</DialogDescription></DialogHeader>
        <form noValidate className="space-y-3" onSubmit={e => { e.preventDefault(); apply(); }}>
          <fieldset disabled={isLocked} className="space-y-3"><legend className="sr-only">Décision opérateur</legend>
            {editing === 'add' && <><Label htmlFor="commercial-label">Libellé de la rubrique</Label><Input id="commercial-label" maxLength={160} value={label} onChange={e => setLabel(e.target.value)}/>
              <Label htmlFor="commercial-kind">Nature</Label><Select value={kind} onValueChange={v => setKind(v as typeof kind)}><SelectTrigger id="commercial-kind"><SelectValue/></SelectTrigger><SelectContent {...commercialSelectPopup}><SelectItem value="additional">Prestation complémentaire</SelectItem><SelectItem value="customs_estimate">Provision droits et taxes</SelectItem><SelectItem value="storage_estimate">Magasinage estimé</SelectItem></SelectContent></Select></>}
            {mode === 'storage' ? <>
              <Label htmlFor="commercial-weight">Poids documenté du dossier</Label><Select value={weightId} onValueChange={setWeightId}><SelectTrigger id="commercial-weight"><SelectValue placeholder="Choisir une base"/></SelectTrigger><SelectContent {...commercialSelectPopup}>{airState?.facts.filter(f => ['cargo.weight_kg', 'cargo.weight_net_kg', 'cargo.chargeable_weight_kg'].includes(f.fact_key) && f.id).map(f => <SelectItem key={f.id} value={f.id!}>{f.fact_key === 'cargo.weight_kg' ? 'Poids brut' : f.fact_key === 'cargo.weight_net_kg' ? 'Poids net' : 'Poids taxable'} — {f.value_number ?? 'inconnu'} kg</SelectItem>)}</SelectContent></Select>
              <Label htmlFor="commercial-tariff">Tarif de magasinage du catalogue</Label><Select value={tariffKey} onValueChange={setTariffKey}><SelectTrigger id="commercial-tariff"><SelectValue placeholder="Choisir le tarif applicable"/></SelectTrigger><SelectContent {...commercialSelectPopup}>{airState?.catalogue?.payload.entries.filter(e => /^storage_[0-3]$/.test(e.key)).map(e => <SelectItem key={e.key} value={e.key}>{e.value ?? 'inconnu'} {e.unit} — {e.condition}</SelectItem>)}</SelectContent></Select>
              <Label htmlFor="commercial-days">Jours facturables estimés</Label><Input id="commercial-days" inputMode="decimal" value={days} onChange={e => setDays(e.target.value)}/><p className="text-xs">Aucune franchise ni durée absente n’est assimilée à zéro. Le coût calculé reste distinct du montant client.</p>
            </> : <>
              <Label htmlFor="commercial-amount">Montant client en FCFA (vide = à confirmer)</Label><Input ref={amountRef} id="commercial-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}/>
              <Label htmlFor="commercial-basis">Base du montant client</Label><Select value={basis} onValueChange={v => setBasis(v as CommercialAmountBasis)}><SelectTrigger id="commercial-basis"><SelectValue/></SelectTrigger><SelectContent {...commercialSelectPopup}>{Object.entries(basisLabels).map(([k, text]) => <SelectItem key={k} value={k}>{text}</SelectItem>)}</SelectContent></Select>
              {editing && editing !== 'add' && editing.supplier?.amount_ht_xof !== null && editing.supplier?.amount_ht_xof !== undefined && <Button type="button" variant="outline" onClick={() => { setAmount(String(editing.supplier!.amount_ht_xof)); setBasis('before_sodatra_vat'); }}>Reprendre explicitement le coût fournisseur</Button>}
            </>}
            <Label htmlFor="commercial-reason">Justification et source de l’estimation</Label><Textarea ref={reasonRef} id="commercial-reason" className="resize-none" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)}/>
            <p ref={errorRef} tabIndex={-1} role={error ? 'alert' : undefined} className="min-h-5 text-sm text-destructive">{error}</p>
            <DialogFooter className="gap-2"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Annuler</Button><Button type="submit">Retenir dans la préparation</Button></DialogFooter>
            {editing && editing !== 'add' && <Button type="button" variant="ghost" onClick={() => apply(editing.included ? 'remove' : 'restore')}>{editing.included ? 'Retirer cette ligne de la préparation' : 'Rétablir cette ligne'}</Button>}
          </fieldset>
        </form>
      </DialogContent></Dialog>
    </CardContent>
  </Card>;
}
