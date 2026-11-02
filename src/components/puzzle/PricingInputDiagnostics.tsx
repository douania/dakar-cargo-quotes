import { useId } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { DiagnosticOwner, DiagnosticState, PricingInputReport } from '../../../supabase/functions/_shared/pricing-input-diagnostic';

const owners:Record<DiagnosticOwner,string>={client:'Information client',operator:'Décision opérateur',reference:'Source tarifaire'};
const states:Record<DiagnosticState,string>={provided:'Disponible',missing:'Manquante',assumption:'Hypothèse à relire',contradiction:'Contradiction à résoudre',invalid:'Valeur à corriger',unqualified:'À qualifier',not_evaluated:'Non évalué'};
const services:Record<string,string>={AIR_HANDLING:'Handling aéroportuaire',TRUCKING:'Transport terrestre',CUSTOMS_DAKAR:'Formalités douanières',AGENCY:'Honoraires',SCOPE:'Périmètre de la demande'};

/** Prepared for a local read-only host. No case lookup, persistence, price or messaging action. */
export function PricingInputDiagnostics({report,status='ready'}:{report:PricingInputReport|null;status?:'ready'|'loading'|'error'}) {
 const titleId=useId();
 return <Card aria-labelledby={titleId} className="border-border/50">
  <CardHeader><CardTitle id={titleId}>Informations utiles au chiffrage</CardTitle></CardHeader>
  <CardContent className="space-y-4 min-w-0">
   {status==='loading'?<p role="status" className="text-sm text-muted-foreground">Vérification des informations…</p>:
    status==='error'?<p role="alert" className="text-sm text-destructive">Diagnostic indisponible. Les informations du dossier restent inchangées.</p>:
    !report||report.needs.length===0?<p className="text-sm text-muted-foreground">Aucune prestation qualifiée fournie pour ce diagnostic. Vérifiez le périmètre et les sources à examiner.</p>:<>
     <p className="text-sm text-muted-foreground">{report.coverage}</p>
     <ul className="space-y-3" aria-label="Informations et décisions par prestation">
      {report.needs.map(n=><li key={n.service_key+':'+n.key} className="rounded-md border border-border p-3 space-y-2 min-w-0 break-words">
       <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-medium text-sm">{services[n.service_key]??n.service_key} — {n.label}</h3>
        <Badge variant={n.state==='contradiction'||n.state==='invalid'?'destructive':'outline'}>{states[n.state]}</Badge></div>
       <p className="text-xs text-muted-foreground">À traiter avec : {owners[n.owner]}</p>
       <p className="text-sm">{n.why}</p><p className="text-sm">{n.next_step}</p>
       {n.observations.length>0&&<ul className="text-xs text-muted-foreground space-y-1" aria-label="Provenance des informations">
        {n.observations.map((o,i)=><li key={i}>{o.value_number!==null?`${o.value_number.toLocaleString('fr-FR')} kg · `:''}{o.source_type==='scenario_assumption'||o.source_type==='ai_assumption'?'Hypothèse conservée':o.is_validated?'Validation enregistrée':'Information disponible, sans validation déclarée'}</li>)}
       </ul>}
       {n.source&&<Collapsible className="text-xs text-muted-foreground"><CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="cursor-pointer">Source et conditions</Button></CollapsibleTrigger><CollapsibleContent>
        <p className="mt-2 break-words">Référence : {n.source.reference}</p>
        <ul className="list-disc pl-4 space-y-1">{n.source.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul>
       </CollapsibleContent></Collapsible>}
      </li>)}
     </ul>
     {report.reserves.length>0&&<section aria-label="Réserves conservées" className="text-sm"><h3 className="font-medium">Réserves conservées</h3><ul className="list-disc pl-5 space-y-1">{report.reserves.map((r,i)=><li key={i}>{r}</li>)}</ul></section>}
     <p role="note" className="text-sm text-muted-foreground">Aucune question client n’est créée automatiquement. Ce diagnostic ne confirme ni le prix de vente, ni les taxes, ni la préparation du devis.</p>
    </>}
  </CardContent>
 </Card>;
}
