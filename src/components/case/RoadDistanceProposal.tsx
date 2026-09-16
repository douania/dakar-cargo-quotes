import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import type { Candidate } from '../../../supabase/functions/propose-road-distance/domain';

export function RoadDistanceProposal({ caseId, value, onChange }: {
  caseId: string; value: string | boolean; onChange: (v: string) => void;
}) {
  const current = useRef({ value, caseId }); current.current = { value, caseId };
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [choices, setChoices] = useState<{ snapshot: string | boolean; caseId: string; destination: string; candidates: Candidate[] } | null>(null);
  async function request(selected?: string) {
    const snapshot = value;
    setPending(true); setMessage('');
    try {
      const draft = JSON.parse(String(snapshot));
      const destination = selected && choices?.snapshot === snapshot ? choices.destination : String(draft.destination ?? '');
      const { data, error } = await supabase.functions.invoke('propose-road-distance', {
        body: { case_id: caseId, destination, ...(selected ? { selected_id: selected } : {}) },
      });
      if (current.current.value !== snapshot || current.current.caseId !== caseId) { setMessage('Le formulaire a changé : relancez la proposition.'); return; }
      if (error) {
        let detail = 'Distance indisponible. La saisie manuelle reste possible.';
        try { const body = await error.context.json(); if (typeof body.error === 'string') detail = body.error; } catch { /* Generic error, no network details. */ }
        setMessage(detail); return;
      }
      if (data?.status === 'choose_destination') {
        setChoices({ snapshot, caseId, destination: data.destination, candidates: data.candidates });
        setMessage(data.candidates.length ? data.message : 'Aucun lieu trouvé : précisez la destination ou saisissez une distance sourcée.');
      } else if (data?.status === 'proposed' && typeof data.distance_km === 'number' && data.distance_km > 0 && typeof data.distance_source === 'string') {
        onChange(JSON.stringify({ ...draft, destination: data.destination, distance_km: data.distance_km,
          distance_source: data.distance_source, verified_on: data.verified_on }));
        setChoices(null); setMessage(data.message);
      } else setMessage('Réponse cartographique non exploitable. Saisie manuelle disponible.');
    } catch { setMessage('Distance indisponible. La saisie manuelle reste possible.'); }
    finally { setPending(false); }
  }
  return <div className="space-y-2">
    <p>Départ par défaut : repère approximatif au port de Dakar, pas une sortie vérifiée ni le zéro officiel du barème. La référence utilisée figure dans la source de la distance. Seul le lieu de livraison est transmis à TomTom, pas l’e-mail ni les marchandises.</p>
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => request()}>
      {pending ? 'Recherche en cours…' : 'Proposer la distance routière'}
    </Button>
    {message && <p role="status">{message}</p>}
    {choices?.snapshot === value && choices.caseId === caseId && choices.candidates.map(c => <Button key={c.id} type="button" variant="outline" size="sm"
      disabled={pending} onClick={() => request(c.id)}>Choisir {c.label}{c.precise ? '' : ' — point approximatif'}</Button>)}
    <p className="text-muted-foreground">© TomTom. Proposition indicative, pas une validation du trajet poids lourd. Aucun enregistrement automatique.</p>
  </div>;
}
