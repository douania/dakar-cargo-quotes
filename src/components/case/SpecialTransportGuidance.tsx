import { STANDARD_TRANSPORT_ESTIMATE_MAX_CARGO_KG } from '../../../supabase/functions/_shared/local-transport-estimate';

const regulationUrl = 'https://e-docucenter.uemoa.int/fr/reglement-ndeg142005cmuemoa-relatif-lharmonisation-des-normes-et-des-procedures-du-controle-du';

/** Operator guidance only: never changes eligibility, pricing or cargo facts.
 * A group total is not evidence of an equal distribution between containers. */
export function SpecialTransportGuidance({ snapshot }: { snapshot: unknown }) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const scope = snapshot as Record<string, unknown>;
  if (scope.transport_mode !== 'MARITIME' || scope.movement_direction !== 'IMPORT') return null;
  const units = Array.isArray(scope.cargo_units) ? scope.cargo_units : [];
  const heavy = units.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const u = raw as Record<string, unknown>;
    const qty = u.quantity;
    if (u.unit_kind !== 'CONTAINER' || typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty <= 0) return [];
    const weight = u.gross_weight_kg;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= STANDARD_TRANSPORT_ESTIMATE_MAX_CARGO_KG) return [];
    if (u.weight_basis !== 'per_unit' && !(u.weight_basis === 'total' && qty === 1)) return [];
    return [{ ref: typeof u.unit_ref === 'string' ? u.unit_ref : 'Lot', qty, weight,
      dangerous: u.dangerous_goods === true || u.un_number != null || u.imo_class != null,
      un: typeof u.un_number === 'string' ? u.un_number : null }];
  });
  if (!heavy.length) return null;
  return <section aria-label="Orientation transport des lots lourds" className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm space-y-3">
    <h3 className="font-semibold">Transport des lots lourds — consultation spécialisée</h3>
    {heavy.map((lot, i) => <div key={`${lot.ref}-${i}`} className="space-y-1">
      <p className="font-medium">{lot.ref} : {lot.qty} unité(s), {lot.weight.toLocaleString('fr-FR')} kg par unité</p>
      <p>Ce poids dépasse le seuil interne de l’estimation standard provisoire (18 000 kg). Ce seuil n’est pas une limite légale. Faire chiffrer une solution adaptée par un transporteur spécialisé.</p>
      {lot.weight > 51000 && <p>Le poids déclaré par unité dépasse 51 tonnes, avant prise en compte du véhicule. Pour un acheminement au Sénégal, examiner avec le transporteur le régime de transport exceptionnel prévu par l’article 7 du règlement UEMOA 14/2005 et les dispositions nationales applicables.</p>}
      {lot.dangerous && <p>Classement dangereux retenu dans cette base de cotation{lot.un ? ` — ${lot.un}` : ''} : transmettre la déclaration et les contraintes d’enlèvement du terminal au transporteur pour son acceptation.</p>}
    </div>)}
    <details>
      <summary className="cursor-pointer font-medium">Préparer la consultation transporteur</summary>
      <ul className="list-disc pl-5 mt-2 space-y-1">
        <li>Joindre les photos et la fiche technique disponibles : un porte-char photographié constitue une référence de matériel, pas une preuve de conformité sur ce trajet.</li>
        <li>Préciser le trajet exact, la quantité, les dimensions et le poids par unité ; indiquer si ce poids comprend la tare du conteneur.</li>
        <li>Demander la configuration tracteur/remorque, la capacité du matériel, sa tare et la répartition prévue des charges par groupe d’essieux.</li>
        <li>Faire préciser les autorisations, contraintes d’itinéraire et mesures d’accompagnement éventuellement nécessaires, ainsi que la disponibilité pour l’enlèvement.</li>
        <li>Obtenir un prix par unité ou forfaitaire, sa devise, ses taxes, sa validité et les prestations incluses ou exclues : manutention, attente, autorisations et accompagnement.</li>
      </ul>
      <p className="mt-2">Consigner les offres dans les demandes partenaires en indiquant le lot. L’intégration automatique d’une offre de transport spécialisé au devis n’est pas disponible dans ce parcours.</p>
      <p className="mt-2 text-xs text-muted-foreground">Repère : <a className="underline" href={regulationUrl} target="_blank" rel="noreferrer">règlement UEMOA 14/2005, articles 5 et 7</a>. Les écarts entre le dépliant sénégalais et les tickets de pesage restent à clarifier ; aucune tolérance ni configuration conforme n’est déduite ici.</p>
    </details>
  </section>;
}
