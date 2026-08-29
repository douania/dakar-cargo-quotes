-- Phase P1-A2 — Objet SCÉNARIO de premier rang (périmètre immuable, révisions,
-- supersession, sélection) + RPC atomique service_role-only
-- public.manage_quote_scenario.
--
-- PORTÉE STRICTE
--   * tables créées : public.quote_scenarios, public.quote_scenario_links,
--     public.quote_scenario_selections, public.quote_scenario_mutations ;
--   * AUCUNE table existante modifiée : quote_scenario_assumptions (P1-A1) est
--     seulement RÉFÉRENCÉE en lecture (FK + contrôle de statut au moment du
--     lien) ; rien n'y est écrit, aucun statut d'hypothèse n'y est changé ;
--   * AUCUNE écriture dans quote_facts / quote_gaps / client_gap_requests /
--     quote_request_lines / quotation_versions / pricing_runs / tarifs ;
--   * AUCUN calcul de prix, AUCUN montant, AUCUNE donnée tarifaire : le
--     snapshot de périmètre REJETTE récursivement toute clé monétaire ;
--   * AUCUNE promotion (ni vers quote_facts, ni vers `promoted_to_final`) et
--     AUCUNE propagation d'hypothèse : la RPC les refuse explicitement ;
--   * aucune extension d'enum partagé : la timeline réutilise `manual_action`,
--     déjà autorisé par le CHECK courant de case_timeline_events (20260325163446).
--
-- ADDITIVE ET NON DESTRUCTIVE
--   * création pure, aucun DROP, aucun ALTER d'objet existant, aucun DELETE ;
--   * chaque bloc est gardé (IF NOT EXISTS / pg_constraint / pg_policies /
--     pg_trigger) : la migration est rejouable sans effet de bord.
--
-- ARBITRAGES INSCRITS DANS LE SCHÉMA
--   1. Le périmètre d'un scénario est un SNAPSHOT IMMUABLE + un hash calculé
--      PAR LA BASE (jamais par l'appelant), jamais un identifiant de ligne.
--   2. Une révision ne réécrit rien : elle crée une nouvelle ligne, supersède
--      l'ancienne dans la MÊME transaction et hérite de la racine.
--   3. La SÉLECTION est un acte séparé du périmètre : table propre, historisée,
--      au plus une sélection ouverte par dossier. Une révision LIBÈRE la
--      sélection de l'ancienne ligne et ne sélectionne JAMAIS le successeur.
--   4. Les liens (hypothèse P1-A1 XOR réserve doctrinale) sont immuables : un
--      lien historique demeure même si l'hypothèse liée change de statut plus
--      tard. Aucune promotion, aucune propagation, aucun effet de bord.
--   5. Les points ouverts tracent une ambiguïté RÉELLE. Une contrainte connue
--      (marchandises dangereuses, transit, payeur distinct, jeux documentaires
--      séparés, RoRo/ConRo) n'est PAS un point ouvert. P1-A2 les TRACE ; il
--      n'exige pas qu'un `draft` les couvre tous et ne calcule aucun prix.

-- =====================================================================
-- 1. Validateur STRUCTUREL du snapshot de périmètre
--    Miroir SQL de `snapshotStructuralViolation` (domain.ts). La base reste
--    l'autorité : ce validateur est appliqué par un CHECK, donc même un appel
--    direct de la RPC ne peut pas persister un périmètre non conforme.
-- =====================================================================

-- Jetons monétaires interdits, comparés TOKEN À TOKEN sur les segments `_` de
-- chaque clé. Jamais en sous-chaîne : `separate_documents` contient « rate » et
-- `chargeable_weight_kg` contient « charge », or ces clés sont légitimes.
create or replace function public.quote_scenario_monetary_token(p_key text)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select exists (
    select 1
      from unnest(string_to_array(p_key, '_')) as t(token)
     where t.token in (
       'price','prices','pricing','prix',
       'tarif','tarifs','tariff','taux',
       'rate','rates',
       'amount','amounts','montant','montants',
       'total','totals','subtotal','sum',
       'cost','costs','cout','couts',
       'fee','fees','frais',
       'charge','charges',
       'currency','currencies','devise','devises',
       'money','monnaie','invoice','facture','billing',
       'margin','marge','discount','remise','surcharge',
       'tax','taxes','taxe','duty','duties','droit','droits','vat','tva',
       'usd','eur','xof','fcfa','cfa'
     )
  );
$$;

-- Renvoie NULL si le nœud est conforme, sinon un motif stable et lisible.
create or replace function public.quote_scenario_snapshot_violation(
  p_node jsonb,
  p_depth integer default 0
)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_key   text;
  v_value jsonb;
  v_child text;
  v_num   numeric;
  v_str   text;
begin
  if p_node is null then
    return 'snapshot_null';
  end if;
  if p_depth > 6 then
    return 'depth_exceeded:6';
  end if;

  case jsonb_typeof(p_node)
    when 'object' then
      for v_key, v_value in select * from jsonb_each(p_node) loop
        if v_key !~ '^[a-z][a-z0-9_]{0,48}$' then
          return 'key_format:' || v_key;
        end if;
        if public.quote_scenario_monetary_token(v_key) then
          return 'monetary_key:' || v_key;
        end if;
        v_child := public.quote_scenario_snapshot_violation(v_value, p_depth + 1);
        if v_child is not null then
          return v_child;
        end if;
      end loop;

    when 'array' then
      for v_value in select * from jsonb_array_elements(p_node) loop
        v_child := public.quote_scenario_snapshot_violation(v_value, p_depth + 1);
        if v_child is not null then
          return v_child;
        end if;
      end loop;

    when 'number' then
      -- Aucun décimal : un périmètre ne porte que des ENTIERS exprimés dans une
      -- unité de base. C'est ce qui rend le hash du périmètre stable, et c'est
      -- incompatible par construction avec un montant.
      v_num := (p_node #>> '{}')::numeric;
      if v_num <> trunc(v_num) then
        return 'non_integer_number:' || v_num::text;
      end if;
      if abs(v_num) > 1000000000000 then
        return 'integer_out_of_range:' || v_num::text;
      end if;

    when 'string' then
      v_str := p_node #>> '{}';
      if length(v_str) > 200 then
        return 'string_too_long';
      end if;
      -- Caractères de contrôle interdits (ARE \xhh) : leur échappement fait
      -- diverger la mesure de taille et le hash entre la base et l'appelant.
      if v_str ~ '[\x01-\x1F\x7F]' then
        return 'control_character';
      end if;
      -- Aucun identifiant de ligne dans le périmètre : un snapshot décrit un
      -- périmètre, pas un graphe de lignes. Un UUID y ferait entrer une
      -- référence dont ni le cycle de vie ni le dossier ne sont contrôlés.
      if v_str ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return 'uuid_in_snapshot';
      end if;

    when 'boolean' then
      null;

    when 'null' then
      null;

    else
      return 'unsupported_type:' || coalesce(jsonb_typeof(p_node), 'unknown');
  end case;

  return null;
end;
$$;

-- =====================================================================
-- 1.2 Validateur de SCHÉMA FERMÉ v1 — miroir SQL de `validateScopeSnapshot`
--
--     Le validateur structurel ci-dessus interdit des FORMES (clé monétaire,
--     décimal, UUID, profondeur, caractère de contrôle). Celui-ci impose le
--     VOCABULAIRE : aucune clé inconnue, champs requis présents, énumérations
--     fermées, types et bornes exacts, `unit_ref` unique.
--
--     POURQUOI EN BASE. L'Edge Function n'est pas la seule voie d'appel : un
--     porteur de la clé service_role atteint la RPC sans jamais traverser
--     domain.ts. Si la base ne connaissait que la forme, un périmètre portant
--     une clé inconnue serait persisté ET HASHÉ comme s'il en faisait partie,
--     alors que rien ne la lit : le snapshot cesserait d'être fermé, et deux
--     périmètres identiques au regard du métier auraient deux hash distincts.
--
--     TOTALITÉ. Aucune de ces fonctions ne lève d'exception, quelle que soit
--     l'entrée : elles sont évaluées par des CHECK dont PostgreSQL ne spécifie
--     pas l'ordre d'évaluation, et une erreur brute y remplacerait une
--     violation de contrainte lisible.
-- =====================================================================

-- Chaîne JSON appartenant à un vocabulaire fermé. Renvoie FALSE — jamais NULL —
-- pour une clé absente : un champ manquant est une violation, pas un silence.
create or replace function public.quote_scenario_is_enum(
  p_value jsonb,
  p_allowed text[]
)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_value is not null
     and jsonb_typeof(p_value) = 'string'
     and (p_value #>> '{}') = any (p_allowed);
$$;

-- Référence ANONYME (unité, lieu, tiers) : miroir exact de REF_RE côté TS.
-- Aucune donnée client réelle n'entre dans un périmètre.
create or replace function public.quote_scenario_is_ref(p_value jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_value is not null
     and jsonb_typeof(p_value) = 'string'
     and (p_value #>> '{}') ~ '^[a-z0-9][a-z0-9._-]{0,63}$';
$$;

-- Entier JSON borné, exprimé dans l'unité de base que porte le nom du champ.
-- Miroir de `isSnapshotInteger` + bornes du champ.
create or replace function public.quote_scenario_is_int(
  p_value jsonb,
  p_min numeric,
  p_max numeric
)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_value is not null
     and jsonb_typeof(p_value) = 'number'
     and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
     and abs((p_value #>> '{}')::numeric) <= 1000000000000
     and (p_value #>> '{}')::numeric between p_min and p_max;
$$;

-- Première clé hors vocabulaire, dans un ordre déterministe (donc un motif
-- d'erreur stable) ; NULL si l'objet est fermé. Le CASE garantit la totalité :
-- `jsonb_object_keys` sur un scalaire lèverait une erreur brute.
create or replace function public.quote_scenario_unknown_key(
  p_node jsonb,
  p_allowed text[]
)
returns text
language sql
immutable
parallel safe
as $$
  select t.k
    from jsonb_object_keys(
           case when jsonb_typeof(p_node) = 'object' then p_node else '{}'::jsonb end
         ) as t(k)
   where t.k <> all (p_allowed)
   order by t.k collate "C"
   limit 1;
$$;

-- Lieu (origine / destination). `location_status` est le seul champ requis :
-- un lieu peut être à proposer, c'est précisément ce que trace un point ouvert.
create or replace function public.quote_scenario_place_violation(
  p_place jsonb,
  p_path text
)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_key text;
  v_alt jsonb;
  v_i   integer := 0;
begin
  if coalesce(jsonb_typeof(p_place), '') <> 'object' then
    return 'not_an_object:' || p_path;
  end if;

  v_key := public.quote_scenario_unknown_key(
    p_place,
    array['location_kind','location_code','location_status','alternatives']
  );
  if v_key is not null then
    return 'unknown_key:' || p_path || '.' || v_key;
  end if;

  if not public.quote_scenario_is_enum(
       p_place -> 'location_status',
       array['confirmed','to_propose','alternatives_open']) then
    return 'invalid:' || p_path || '.location_status';
  end if;

  if p_place ? 'location_kind'
     and not public.quote_scenario_is_enum(
       p_place -> 'location_kind',
       array['PORT','AIRPORT','CITY','INLAND_POINT']) then
    return 'invalid:' || p_path || '.location_kind';
  end if;

  if p_place ? 'location_code'
     and jsonb_typeof(p_place -> 'location_code') <> 'null'
     and not public.quote_scenario_is_ref(p_place -> 'location_code') then
    return 'invalid:' || p_path || '.location_code';
  end if;

  if p_place ? 'alternatives' then
    if jsonb_typeof(p_place -> 'alternatives') <> 'array' then
      return 'invalid:' || p_path || '.alternatives';
    end if;
    if jsonb_array_length(p_place -> 'alternatives') > 8 then
      return 'too_many:' || p_path || '.alternatives';
    end if;
    for v_alt in select * from jsonb_array_elements(p_place -> 'alternatives') loop
      if not public.quote_scenario_is_ref(v_alt) then
        return 'invalid:' || p_path || '.alternatives[' || v_i || ']';
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  return null;
end;
$$;

-- Lot. `equipment_code`, les trois mesures et la consigne de température sont
-- OBLIGATOIREMENT PRÉSENTS, valeur `null` autorisée : « inconnu » doit être dit
-- explicitement — c'est ce qui rend la dérivation d'un point ouvert possible.
-- Une clé absente serait un silence, jamais un manque déclaré.
create or replace function public.quote_scenario_cargo_unit_violation(
  p_unit jsonb,
  p_path text
)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_key   text;
  v_field text;
begin
  if coalesce(jsonb_typeof(p_unit), '') <> 'object' then
    return 'not_an_object:' || p_path;
  end if;

  v_key := public.quote_scenario_unknown_key(
    p_unit,
    array[
      'unit_ref','unit_kind','equipment_code','packaging','quantity',
      'gross_weight_kg','chargeable_weight_kg','volume_dm3',
      'temperature_control_required','temperature_setpoint_celsius',
      'classification_status','destination_ref','dangerous_goods',
      'required_attachment_status'
    ]
  );
  if v_key is not null then
    return 'unknown_key:' || p_path || '.' || v_key;
  end if;

  if not public.quote_scenario_is_ref(p_unit -> 'unit_ref') then
    return 'invalid:' || p_path || '.unit_ref';
  end if;
  if not public.quote_scenario_is_enum(
       p_unit -> 'unit_kind',
       array['CONTAINER','BREAKBULK','VEHICLE','PALLET','PACKAGE','BULK']) then
    return 'invalid:' || p_path || '.unit_kind';
  end if;
  if not public.quote_scenario_is_enum(
       p_unit -> 'packaging',
       array['unknown','crated','palletized','loose','bagged','unpacked']) then
    return 'invalid:' || p_path || '.packaging';
  end if;
  if not public.quote_scenario_is_enum(
       p_unit -> 'classification_status',
       array['confirmed','unknown','conflict']) then
    return 'invalid:' || p_path || '.classification_status';
  end if;
  if not public.quote_scenario_is_enum(
       p_unit -> 'required_attachment_status',
       array['not_required','provided','missing']) then
    return 'invalid:' || p_path || '.required_attachment_status';
  end if;

  foreach v_field in array array['dangerous_goods','temperature_control_required'] loop
    if coalesce(jsonb_typeof(p_unit -> v_field), '') <> 'boolean' then
      return 'invalid:' || p_path || '.' || v_field;
    end if;
  end loop;

  if coalesce(jsonb_typeof(p_unit -> 'equipment_code'), '') <> 'null'
     and not public.quote_scenario_is_ref(p_unit -> 'equipment_code') then
    return 'invalid:' || p_path || '.equipment_code';
  end if;

  if not public.quote_scenario_is_int(p_unit -> 'quantity', 1, 1000000000000) then
    return 'invalid:' || p_path || '.quantity';
  end if;

  foreach v_field in array array['gross_weight_kg','chargeable_weight_kg','volume_dm3'] loop
    if coalesce(jsonb_typeof(p_unit -> v_field), '') <> 'null'
       and not public.quote_scenario_is_int(p_unit -> v_field, 0, 1000000000000) then
      return 'invalid:' || p_path || '.' || v_field;
    end if;
  end loop;

  -- Consigne en degrés Celsius ENTIERS : une consigne fractionnaire doit être
  -- exprimée dans une unité de base plus fine, jamais en décimal.
  if coalesce(jsonb_typeof(p_unit -> 'temperature_setpoint_celsius'), '') <> 'null'
     and not public.quote_scenario_is_int(
       p_unit -> 'temperature_setpoint_celsius', -60, 60) then
    return 'invalid:' || p_path || '.temperature_setpoint_celsius';
  end if;

  -- Seul champ OPTIONNEL du lot : une destination non affectée n'est ambiguë
  -- que si le périmètre annonce une multi-destination (cf. dérivation).
  if p_unit ? 'destination_ref'
     and jsonb_typeof(p_unit -> 'destination_ref') <> 'null'
     and not public.quote_scenario_is_ref(p_unit -> 'destination_ref') then
    return 'invalid:' || p_path || '.destination_ref';
  end if;

  return null;
end;
$$;

-- Renvoie NULL si le périmètre est conforme au schéma FERMÉ v1, sinon un motif
-- stable et lisible, repris tel quel par l'erreur SNAPSHOT_REJECTED de la RPC.
create or replace function public.quote_scenario_scope_violation(p_snapshot jsonb)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_reason text;
  v_key    text;
  v_place  text;
  v_node   jsonb;
  v_unit   jsonb;
  v_ref    text;
  v_refs   text[] := '{}';
  v_alt    jsonb;
  v_i      integer := 0;
begin
  -- Les invariants structurels d'abord : ils décrivent ce qu'un périmètre ne
  -- peut JAMAIS contenir, indépendamment du schéma métier.
  v_reason := public.quote_scenario_snapshot_violation(p_snapshot);
  if v_reason is not null then
    return v_reason;
  end if;

  if coalesce(jsonb_typeof(p_snapshot), '') <> 'object' then
    return 'not_an_object:scope_snapshot';
  end if;
  -- Même borne que le CHECK de la colonne : l'appelant reçoit un motif lisible
  -- au lieu d'une violation de contrainte opaque.
  if octet_length(p_snapshot::text) > 16384 then
    return 'snapshot_too_large:' || octet_length(p_snapshot::text)::text;
  end if;

  v_key := public.quote_scenario_unknown_key(
    p_snapshot,
    array[
      'schema_version','transport_mode','movement_direction',
      'terminal_operation_mode','origin','destination','cargo_units',
      'customs','booking','documents','parties','constraints'
    ]
  );
  if v_key is not null then
    return 'unknown_key:scope_snapshot.' || v_key;
  end if;

  -- Version du schéma : le NOMBRE 1, pas la chaîne « 1 ». Un périmètre versionné
  -- autrement se lirait avec d'autres règles ; il n'a rien à faire ici.
  if (p_snapshot -> 'schema_version') is distinct from '1'::jsonb then
    return 'invalid:scope_snapshot.schema_version';
  end if;

  if not public.quote_scenario_is_enum(
       p_snapshot -> 'transport_mode',
       array['AIR','MARITIME','ROUTE','MULTIMODAL']) then
    return 'invalid:scope_snapshot.transport_mode';
  end if;
  if not public.quote_scenario_is_enum(
       p_snapshot -> 'movement_direction',
       array['IMPORT','EXPORT','REEXPORT','TRANSIT','CROSS_TRADE']) then
    return 'invalid:scope_snapshot.movement_direction';
  end if;

  -- Clé OBLIGATOIREMENT présente, valeur `null` autorisée : « inconnu » se dit,
  -- il ne se déduit pas d'une clé absente.
  if not (p_snapshot ? 'terminal_operation_mode') then
    return 'missing:scope_snapshot.terminal_operation_mode';
  end if;
  if jsonb_typeof(p_snapshot -> 'terminal_operation_mode') <> 'null'
     and not public.quote_scenario_is_enum(
       p_snapshot -> 'terminal_operation_mode',
       array['LOLO','RORO','CONRO']) then
    return 'invalid:scope_snapshot.terminal_operation_mode';
  end if;

  foreach v_place in array array['origin','destination'] loop
    if p_snapshot ? v_place then
      v_reason := public.quote_scenario_place_violation(
        p_snapshot -> v_place, 'scope_snapshot.' || v_place);
      if v_reason is not null then
        return v_reason;
      end if;
    end if;
  end loop;

  if coalesce(jsonb_typeof(p_snapshot -> 'cargo_units'), '') <> 'array' then
    return 'invalid:scope_snapshot.cargo_units';
  end if;
  if jsonb_array_length(p_snapshot -> 'cargo_units') not between 1 and 12 then
    return 'cargo_units_count:'
        || jsonb_array_length(p_snapshot -> 'cargo_units')::text;
  end if;
  for v_unit in select * from jsonb_array_elements(p_snapshot -> 'cargo_units') loop
    v_reason := public.quote_scenario_cargo_unit_violation(
      v_unit, 'scope_snapshot.cargo_units[' || v_i || ']');
    if v_reason is not null then
      return v_reason;
    end if;
    -- Deux lots homonymes rendraient la clé d'un point ouvert ambiguë.
    v_ref := v_unit ->> 'unit_ref';
    if v_ref = any (v_refs) then
      return 'duplicate_unit_ref:' || v_ref;
    end if;
    v_refs := v_refs || v_ref;
    v_i := v_i + 1;
  end loop;

  if p_snapshot ? 'customs' then
    v_node := p_snapshot -> 'customs';
    if coalesce(jsonb_typeof(v_node), '') <> 'object' then
      return 'not_an_object:scope_snapshot.customs';
    end if;
    v_key := public.quote_scenario_unknown_key(
      v_node, array['regime_status','regime_code','split_declarations']);
    if v_key is not null then
      return 'unknown_key:scope_snapshot.customs.' || v_key;
    end if;
    if not public.quote_scenario_is_enum(
         v_node -> 'regime_status', array['known','unknown']) then
      return 'invalid:scope_snapshot.customs.regime_status';
    end if;
    if v_node ? 'regime_code'
       and jsonb_typeof(v_node -> 'regime_code') <> 'null'
       and not public.quote_scenario_is_ref(v_node -> 'regime_code') then
      return 'invalid:scope_snapshot.customs.regime_code';
    end if;
    if v_node ? 'split_declarations'
       and coalesce(jsonb_typeof(v_node -> 'split_declarations'), '') <> 'boolean' then
      return 'invalid:scope_snapshot.customs.split_declarations';
    end if;
  end if;

  if p_snapshot ? 'booking' then
    v_node := p_snapshot -> 'booking';
    if coalesce(jsonb_typeof(v_node), '') <> 'object' then
      return 'not_an_object:scope_snapshot.booking';
    end if;
    v_key := public.quote_scenario_unknown_key(v_node, array['stage','carrier_ref']);
    if v_key is not null then
      return 'unknown_key:scope_snapshot.booking.' || v_key;
    end if;
    if not public.quote_scenario_is_enum(
         v_node -> 'stage', array['none','pre_booking','booked']) then
      return 'invalid:scope_snapshot.booking.stage';
    end if;
    if v_node ? 'carrier_ref'
       and jsonb_typeof(v_node -> 'carrier_ref') <> 'null'
       and not public.quote_scenario_is_ref(v_node -> 'carrier_ref') then
      return 'invalid:scope_snapshot.booking.carrier_ref';
    end if;
  end if;

  if p_snapshot ? 'documents' then
    v_node := p_snapshot -> 'documents';
    if coalesce(jsonb_typeof(v_node), '') <> 'object' then
      return 'not_an_object:scope_snapshot.documents';
    end if;
    v_key := public.quote_scenario_unknown_key(
      v_node, array['split_required','sets_count']);
    if v_key is not null then
      return 'unknown_key:scope_snapshot.documents.' || v_key;
    end if;
    if coalesce(jsonb_typeof(v_node -> 'split_required'), '') <> 'boolean' then
      return 'invalid:scope_snapshot.documents.split_required';
    end if;
    if v_node ? 'sets_count'
       and not public.quote_scenario_is_int(
         v_node -> 'sets_count', 1, 1000000000000) then
      return 'invalid:scope_snapshot.documents.sets_count';
    end if;
  end if;

  if p_snapshot ? 'parties' then
    v_node := p_snapshot -> 'parties';
    if coalesce(jsonb_typeof(v_node), '') <> 'object' then
      return 'not_an_object:scope_snapshot.parties';
    end if;
    v_key := public.quote_scenario_unknown_key(
      v_node, array['payer_is_shipper','payer_ref','consignee_ref']);
    if v_key is not null then
      return 'unknown_key:scope_snapshot.parties.' || v_key;
    end if;
    if coalesce(jsonb_typeof(v_node -> 'payer_is_shipper'), '') <> 'boolean' then
      return 'invalid:scope_snapshot.parties.payer_is_shipper';
    end if;
    foreach v_place in array array['payer_ref','consignee_ref'] loop
      if v_node ? v_place
         and jsonb_typeof(v_node -> v_place) <> 'null'
         and not public.quote_scenario_is_ref(v_node -> v_place) then
        return 'invalid:scope_snapshot.parties.' || v_place;
      end if;
    end loop;
  end if;

  if p_snapshot ? 'constraints' then
    v_node := p_snapshot -> 'constraints';
    if coalesce(jsonb_typeof(v_node), '') <> 'object' then
      return 'not_an_object:scope_snapshot.constraints';
    end if;
    v_key := public.quote_scenario_unknown_key(
      v_node, array['multi_destination','transit_country_refs']);
    if v_key is not null then
      return 'unknown_key:scope_snapshot.constraints.' || v_key;
    end if;
    if coalesce(jsonb_typeof(v_node -> 'multi_destination'), '') <> 'boolean' then
      return 'invalid:scope_snapshot.constraints.multi_destination';
    end if;
    if v_node ? 'transit_country_refs' then
      if jsonb_typeof(v_node -> 'transit_country_refs') <> 'array' then
        return 'invalid:scope_snapshot.constraints.transit_country_refs';
      end if;
      if jsonb_array_length(v_node -> 'transit_country_refs') > 8 then
        return 'too_many:scope_snapshot.constraints.transit_country_refs';
      end if;
      v_i := 0;
      for v_alt in
        select * from jsonb_array_elements(v_node -> 'transit_country_refs')
      loop
        if not public.quote_scenario_is_ref(v_alt) then
          return 'invalid:scope_snapshot.constraints.transit_country_refs['
              || v_i || ']';
        end if;
        v_i := v_i + 1;
      end loop;
    end if;
  end if;

  return null;
end;
$$;

-- =====================================================================
-- 1.3 Dérivation SERVEUR des points ouverts — miroir de `deriveOpenPoints`
--
--     La base ne fait AUCUNE confiance à un tableau de points ouverts reçu :
--     elle le recalcule. Un appel service_role forgé ne peut donc ni effacer un
--     point (en envoyant `[]`) ni en inventer un.
--
--     Un point ouvert signale une AMBIGUÏTÉ ou un MANQUE réel. Les contraintes
--     connues — marchandises dangereuses, transit, payeur distinct, jeux
--     documentaires séparés, multi-destination entièrement affectée, RoRo/ConRo
--     — sont DESCRIPTIVES : elles n'ouvrent rien.
--
--     Le tri final est en collation "C" (ordre des octets) : c'est exactement
--     l'ordre du comparateur JavaScript sur des clés ASCII, sans quoi la
--     comparaison stricte avec la dérivation de l'Edge dépendrait de la
--     collation de la base.
-- =====================================================================

create or replace function public.quote_scenario_open_point(
  p_code text,
  p_ref text
)
returns jsonb
language sql
immutable
parallel safe
as $$
  select jsonb_build_object(
    'key',  case when p_ref is null then p_code else p_code || ':' || p_ref end,
    'code', p_code,
    'ref',  p_ref
  );
$$;

create or replace function public.quote_scenario_derive_open_points(p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
as $$
declare
  v_list       jsonb[] := '{}';
  v_points     jsonb;
  v_mode       text;
  v_place      text;
  v_node       jsonb;
  v_unit       jsonb;
  v_ref        text;
  v_gross      jsonb;
  v_chargeable jsonb;
  v_multi      boolean := false;
  v_unassigned boolean := false;
begin
  -- Fonction TOTALE : évaluée par un CHECK, elle ne peut pas lever d'erreur sur
  -- un périmètre non conforme — c'est l'autre CHECK qui rejettera la ligne.
  if coalesce(jsonb_typeof(p_snapshot), '') <> 'object' then
    return '[]'::jsonb;
  end if;

  v_mode := p_snapshot ->> 'transport_mode';

  foreach v_place in array array['origin','destination'] loop
    v_node := p_snapshot -> v_place;
    if coalesce(jsonb_typeof(v_node), '') = 'object' then
      if v_node ->> 'location_status' = 'to_propose' then
        v_list := v_list || public.quote_scenario_open_point('port_to_propose', v_place);
      end if;
      if v_node ->> 'location_status' = 'alternatives_open' then
        v_list := v_list || public.quote_scenario_open_point('port_alternatives_open', v_place);
      end if;
    end if;
  end loop;

  -- Le mode terminal n'est requis que pour un périmètre maritime ; `null` y est
  -- une information manquante réelle. RoRo et ConRo renseignés n'ouvrent rien.
  if v_mode = 'MARITIME'
     and jsonb_typeof(p_snapshot -> 'terminal_operation_mode') = 'null' then
    v_list := v_list || public.quote_scenario_open_point('terminal_operation_mode_unknown', null::text);
  end if;

  v_multi := coalesce(
    jsonb_typeof(p_snapshot -> 'constraints') = 'object'
      and (p_snapshot -> 'constraints' -> 'multi_destination') = 'true'::jsonb,
    false);

  if jsonb_typeof(p_snapshot -> 'cargo_units') = 'array' then
    for v_unit in select * from jsonb_array_elements(p_snapshot -> 'cargo_units') loop
      if coalesce(jsonb_typeof(v_unit), '') <> 'object' then
        continue;
      end if;
      v_ref := v_unit ->> 'unit_ref';

      if v_unit ->> 'packaging' = 'unknown' then
        v_list := v_list || public.quote_scenario_open_point('packaging_unknown', v_ref);
      end if;
      if jsonb_typeof(v_unit -> 'equipment_code') = 'null' then
        v_list := v_list || public.quote_scenario_open_point('equipment_unknown', v_ref);
      end if;
      if (v_unit -> 'temperature_control_required') = 'true'::jsonb
         and jsonb_typeof(v_unit -> 'temperature_setpoint_celsius') = 'null' then
        v_list := v_list || public.quote_scenario_open_point('temperature_setpoint_missing', v_ref);
      end if;
      if v_unit ->> 'classification_status' = 'unknown' then
        v_list := v_list || public.quote_scenario_open_point('commodity_classification_unknown', v_ref);
      end if;
      if v_unit ->> 'classification_status' = 'conflict' then
        v_list := v_list || public.quote_scenario_open_point('classification_conflict', v_ref);
      end if;
      if v_unit ->> 'required_attachment_status' = 'missing' then
        v_list := v_list || public.quote_scenario_open_point('attachment_required', v_ref);
      end if;

      -- Aérien : la base de taxation dépend du couple poids brut / poids taxable.
      -- Absence du taxable, ou taxable strictement inférieur au brut, est une
      -- contradiction à lever — jamais un montant, jamais un tarif.
      if v_mode = 'AIR' then
        v_gross      := v_unit -> 'gross_weight_kg';
        v_chargeable := v_unit -> 'chargeable_weight_kg';
        if coalesce(jsonb_typeof(v_chargeable), 'null') = 'null'
           or (jsonb_typeof(v_chargeable) = 'number'
               and jsonb_typeof(v_gross) = 'number'
               and (v_chargeable #>> '{}')::numeric < (v_gross #>> '{}')::numeric) then
          v_list := v_list || public.quote_scenario_open_point('chargeable_basis_unconfirmed', v_ref);
        end if;
      end if;

      if coalesce(jsonb_typeof(v_unit -> 'destination_ref'), 'null') = 'null' then
        v_unassigned := true;
      end if;
    end loop;
  end if;

  -- Multi-destination ANNONCÉE mais répartition incomplète : ambiguïté réelle.
  -- Multi-destination entièrement affectée : contrainte connue, aucun point.
  if v_multi and v_unassigned then
    v_list := v_list || public.quote_scenario_open_point('destination_split_unknown', null::text);
  end if;

  if jsonb_typeof(p_snapshot -> 'customs') = 'object'
     and p_snapshot -> 'customs' ->> 'regime_status' = 'unknown' then
    v_list := v_list || public.quote_scenario_open_point('customs_regime_unknown', null::text);
  end if;

  if jsonb_typeof(p_snapshot -> 'booking') = 'object'
     and p_snapshot -> 'booking' ->> 'stage' = 'pre_booking' then
    v_list := v_list || public.quote_scenario_open_point('booking_pre_booking', null::text);
  end if;

  select coalesce(jsonb_agg(p order by (p ->> 'key') collate "C"), '[]'::jsonb)
    into v_points
    from unnest(v_list) as t(p);

  return v_points;
end;
$$;

-- =====================================================================
-- 2. quote_scenarios — l'objet scénario
-- =====================================================================
create table if not exists public.quote_scenarios (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,

  -- Racine de la chaîne de révisions. Revision 1 est sa propre racine :
  -- toutes les révisions d'un même périmètre partagent cette valeur.
  root_scenario_id uuid not null,
  revision_no integer not null
    constraint quote_scenarios_revision_no_positive check (revision_no >= 1),

  -- Lien ARRIÈRE faisant autorité (la révision désigne ce qu'elle remplace) et
  -- son miroir AVANT, posé dans la même transaction.
  supersedes_scenario_id uuid null,
  superseded_by_scenario_id uuid null,

  -- Vocabulaire DOCTRINAL COMPLET (docs/PROVISIONAL_SCENARIO_QUOTES.md §8).
  -- P1-A2 n'ÉCRIT que draft, blocked et superseded (ce dernier posé par la RPC
  -- lors d'une révision) : les statuts d'estimation supposent un pricing par
  -- scénario (P1-A4) et `promoted_to_final` suppose la promotion explicite
  -- (P1-A3). Le vocabulaire est déclaré ici pour que la doctrine soit lisible
  -- dans le catalogue ; la RPC est la seule voie d'écriture et refuse le reste.
  status text not null default 'draft'
    constraint quote_scenarios_status_check
      check (status in (
        'draft','provisional_estimated','partial_scoped',
        'blocked','superseded','promoted_to_final'
      )),

  title text not null
    constraint quote_scenarios_title_not_empty check (btrim(title) <> '')
    constraint quote_scenarios_title_len check (length(title) <= 200),

  -- Périmètre : snapshot FERMÉ, borné, sans aucune donnée monétaire.
  scope_snapshot jsonb not null
    constraint quote_scenarios_scope_snapshot_is_object
      check (jsonb_typeof(scope_snapshot) = 'object')
    constraint quote_scenarios_scope_snapshot_bounded
      check (octet_length(scope_snapshot::text) <= 16384)
    constraint quote_scenarios_scope_snapshot_structure
      check (public.quote_scenario_snapshot_violation(scope_snapshot) is null)
    -- SCHÉMA FERMÉ v1, imposé PAR LA BASE. Le validateur renvoie un motif ou
    -- NULL : la contrainte ne peut donc jamais valoir NULL, et un CHECK NULL
    -- serait réputé SATISFAIT par PostgreSQL. Toute dimension manquante,
    -- inconnue, mal typée ou hors bornes est une violation, jamais un silence.
    -- Un appelant service_role qui court-circuiterait l'Edge Function bute
    -- exactement sur la même règle que domain.ts.
    constraint quote_scenarios_scope_snapshot_schema_v1
      check (public.quote_scenario_scope_violation(scope_snapshot) is null),

  -- SHA-256 du périmètre, calculé PAR LA RPC sur la forme jsonb normalisée par
  -- PostgreSQL (ordre des clés canonique, doublons éliminés) : deux payloads
  -- ne différant que par l'ordre des clés ont le MÊME hash.
  scope_hash text not null
    constraint quote_scenarios_scope_hash_sha256
      check (scope_hash ~ '^[0-9a-f]{64}$'),

  -- Points ouverts DÉRIVÉS du snapshot (fonction pure côté serveur). Jamais
  -- fournis par l'appelant ; jamais des contraintes connues.
  --
  -- AUCUN DEFAULT : une valeur par défaut serait fausse dès que le périmètre
  -- ouvre un point, et le CHECK ci-dessous la rejetterait. Les points ouverts
  -- se disent toujours, et ils ne peuvent valoir QUE la dérivation.
  open_points jsonb not null
    constraint quote_scenarios_open_points_is_array
      check (jsonb_typeof(open_points) = 'array')
    -- INTÉGRITÉ NON CONTOURNABLE : quelle que soit la voie d'écriture, les
    -- points ouverts persistés sont EXACTEMENT ceux que la base dérive du
    -- périmètre. Un appelant service_role ne peut donc ni en effacer un (en
    -- envoyant `[]`) ni en ajouter un qui ne découle pas du snapshot.
    constraint quote_scenarios_open_points_derived
      check (open_points = public.quote_scenario_derive_open_points(scope_snapshot)),

  blocked_reason text null
    constraint quote_scenarios_blocked_reason_len check (length(blocked_reason) <= 500),
  revision_reason text null
    constraint quote_scenarios_revision_reason_len check (length(revision_reason) <= 500),

  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by uuid null,
  resolved_at timestamptz null,

  -- ── Cohérence statut ↔ champs ────────────────────────────────────────
  -- `blocked` est un statut assumé et légitime, mais jamais muet.
  constraint quote_scenarios_blocked_requires_reason
    check (status <> 'blocked' or btrim(coalesce(blocked_reason, '')) <> ''),
  -- Implication à sens unique : une ligne bloquée puis supersédée CONSERVE son
  -- motif de blocage (l'historique ne se réécrit pas).
  constraint quote_scenarios_superseded_requires_ref
    check (status <> 'superseded'
      or (superseded_by_scenario_id is not null
          and resolved_at is not null and resolved_by is not null)),
  constraint quote_scenarios_supref_only_when_superseded
    check (superseded_by_scenario_id is null or status = 'superseded'),

  -- ── Chaîne de révision ───────────────────────────────────────────────
  constraint quote_scenarios_root_of_first_revision
    check (revision_no <> 1
      or (root_scenario_id = id and supersedes_scenario_id is null
          and revision_reason is null)),
  constraint quote_scenarios_revision_requires_predecessor
    check (revision_no = 1
      or (supersedes_scenario_id is not null and root_scenario_id <> id
          and btrim(coalesce(revision_reason, '')) <> '')),
  constraint quote_scenarios_no_self_supersedes
    check (supersedes_scenario_id is null or supersedes_scenario_id <> id),
  constraint quote_scenarios_no_self_superseded_by
    check (superseded_by_scenario_id is null or superseded_by_scenario_id <> id)
);

-- Clés étrangères de chaîne. Le lien AVANT est DEFERRABLE : une révision doit
-- pouvoir, dans UNE transaction, (a) sortir l'ancienne ligne de son statut
-- courant — ce qui exige déjà son superseded_by_scenario_id — puis (b) insérer
-- le successeur. Sans report, la séquence est impossible. La contrainte reste
-- INITIALLY IMMEDIATE : seule la RPC la reporte, et elle est TOUJOURS vérifiée
-- au commit.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quote_scenarios'::regclass
      and conname = 'quote_scenarios_root_scenario_id_fkey'
  ) then
    alter table public.quote_scenarios
      add constraint quote_scenarios_root_scenario_id_fkey
      foreign key (root_scenario_id) references public.quote_scenarios(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quote_scenarios'::regclass
      and conname = 'quote_scenarios_supersedes_scenario_id_fkey'
  ) then
    alter table public.quote_scenarios
      add constraint quote_scenarios_supersedes_scenario_id_fkey
      foreign key (supersedes_scenario_id) references public.quote_scenarios(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quote_scenarios'::regclass
      and conname = 'quote_scenarios_superseded_by_scenario_id_fkey'
  ) then
    alter table public.quote_scenarios
      add constraint quote_scenarios_superseded_by_scenario_id_fkey
      foreign key (superseded_by_scenario_id) references public.quote_scenarios(id)
      deferrable initially immediate;
  end if;
end $$;

-- Chaîne ACYCLIQUE et LINÉAIRE, garantie par trois unicités :
--   * un seul scénario par (racine, numéro de révision) ;
--   * un seul successeur par prédécesseur, et réciproquement ;
--   * une seule tête vivante (non supersédée) par racine.
-- Combinées au trigger qui impose revision_no = prédécesseur + 1 et racine
-- identique, elles interdisent toute boucle et tout embranchement.
create unique index if not exists uq_quote_scenarios_root_revision
  on public.quote_scenarios (root_scenario_id, revision_no);
create unique index if not exists uq_quote_scenarios_supersedes
  on public.quote_scenarios (supersedes_scenario_id)
  where supersedes_scenario_id is not null;
create unique index if not exists uq_quote_scenarios_superseded_by
  on public.quote_scenarios (superseded_by_scenario_id)
  where superseded_by_scenario_id is not null;
create unique index if not exists uq_quote_scenarios_live_head
  on public.quote_scenarios (root_scenario_id)
  where status <> 'superseded';

create index if not exists idx_quote_scenarios_case
  on public.quote_scenarios (case_id);
create index if not exists idx_quote_scenarios_case_status
  on public.quote_scenarios (case_id, status);
create index if not exists idx_quote_scenarios_scope_hash
  on public.quote_scenarios (case_id, scope_hash);

-- =====================================================================
-- 3. quote_scenario_links — liens immuables vers hypothèses / réserves
-- =====================================================================
create table if not exists public.quote_scenario_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  scenario_id uuid not null references public.quote_scenarios(id),

  -- EXACTEMENT une cible : une hypothèse P1-A1 OU un code de réserve doctrinal.
  assumption_id uuid null references public.quote_scenario_assumptions(id),
  reserve_code text null
    constraint quote_scenario_links_reserve_code_check
      check (reserve_code in (
        'MISSING_CARGO_VALUE','MISSING_HS_CODE','PAD_CATEGORY_UNRESOLVED',
        'PARTNER_COST_PENDING','RATE_PENDING_CONFIRMATION'
      )),
  constraint quote_scenario_links_target_xor
    check ((assumption_id is not null) <> (reserve_code is not null)),

  -- Couverture ÉVENTUELLE d'un point ouvert du scénario. Non obligatoire :
  -- P1-A2 trace les points ouverts, il n'exige pas leur couverture.
  open_point_key text null
    constraint quote_scenario_links_open_point_key_len
      check (open_point_key is null or length(open_point_key) between 1 and 120),

  created_by uuid not null,
  created_at timestamptz not null default now()
);

-- Un même couple (cible, point ouvert couvert) n'est lié qu'une fois.
create unique index if not exists uq_quote_scenario_links_identity
  on public.quote_scenario_links (
    scenario_id,
    coalesce(assumption_id::text, ''),
    coalesce(reserve_code, ''),
    coalesce(open_point_key, '')
  );
create index if not exists idx_quote_scenario_links_scenario
  on public.quote_scenario_links (scenario_id);
create index if not exists idx_quote_scenario_links_assumption
  on public.quote_scenario_links (assumption_id)
  where assumption_id is not null;

-- =====================================================================
-- 4. quote_scenario_selections — sélection historisée, séparée du périmètre
-- =====================================================================
create table if not exists public.quote_scenario_selections (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  scenario_id uuid not null references public.quote_scenarios(id),

  selected_by uuid not null,
  selected_at timestamptz not null default now(),

  released_by uuid null,
  released_at timestamptz null,
  release_reason text null
    constraint quote_scenario_selections_release_reason_check
      check (release_reason in ('superseded_by_revision','replaced_by_selection')),

  constraint quote_scenario_selections_release_complete
    check (
      (released_at is null and released_by is null and release_reason is null)
      or (released_at is not null and released_by is not null and release_reason is not null)
    )
);

-- Au plus UNE sélection ouverte par dossier.
create unique index if not exists uq_quote_scenario_selections_open
  on public.quote_scenario_selections (case_id)
  where released_at is null;
create index if not exists idx_quote_scenario_selections_scenario
  on public.quote_scenario_selections (scenario_id);

-- =====================================================================
-- 5. quote_scenario_mutations — registre d'idempotence APPEND-ONLY
--    L'idempotence est une propriété de la REQUÊTE, pas de la ligne mutée :
--    un même scénario subit plusieurs mutations (create → revise → select).
-- =====================================================================
create table if not exists public.quote_scenario_mutations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  scenario_id uuid not null references public.quote_scenarios(id),
  operation text not null
    constraint quote_scenario_mutations_operation_check
      check (operation in ('create','revise','select')),
  -- `no_op` distingue une RELANCE (périmètre et liens inchangés) d'une
  -- révision réelle : rejouer une requête ne doit jamais créer de révision.
  outcome text not null
    constraint quote_scenario_mutations_outcome_check
      check (outcome in ('applied','no_op')),
  result_status text not null
    constraint quote_scenario_mutations_result_status_check
      check (result_status in ('draft','blocked')),
  idempotency_key text not null
    constraint quote_scenario_mutations_key_len
      check (length(idempotency_key) between 8 and 128),
  request_fingerprint text not null
    constraint quote_scenario_mutations_fingerprint_sha256
      check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_quote_scenario_mutations_idem
  on public.quote_scenario_mutations (case_id, idempotency_key);
create index if not exists idx_quote_scenario_mutations_scenario
  on public.quote_scenario_mutations (scenario_id);

-- =====================================================================
-- 6. updated_at (helper existant, réutilisé tel quel)
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.quote_scenarios'::regclass
  ) then
    create trigger set_updated_at before update on public.quote_scenarios
      for each row execute function public.update_updated_at_column();
  end if;
end $$;

-- =====================================================================
-- 7. Gardes de cohérence — aucun CHECK ne peut interroger une autre table
-- =====================================================================

-- 7.1 Scénario : même dossier pour la racine, le prédécesseur et le successeur ;
--     chaîne strictement incrémentale (donc acyclique) ; snapshot/titre/liens
--     de chaîne/points ouverts IMMUABLES après insertion, seule la transition
--     atomique vers `superseded` étant autorisée.
create or replace function public.quote_scenarios_enforce_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case uuid;
  v_root uuid;
  v_rev  integer;
begin
  if tg_op = 'INSERT' then
    if new.root_scenario_id <> new.id then
      select case_id, root_scenario_id into v_case, v_root
        from quote_scenarios where id = new.root_scenario_id;
      if v_case is not null and v_case <> new.case_id then
        raise exception 'FORBIDDEN_CROSS_CASE: racine % appartient au dossier %, pas au dossier %',
          new.root_scenario_id, v_case, new.case_id using errcode = '23514';
      end if;
      if v_root is not null and v_root <> new.root_scenario_id then
        raise exception 'VALIDATION_FAILED: root_scenario_id % n''est pas une racine (sa racine est %)',
          new.root_scenario_id, v_root using errcode = '23514';
      end if;
    end if;

    if new.supersedes_scenario_id is not null then
      select case_id, root_scenario_id, revision_no into v_case, v_root, v_rev
        from quote_scenarios where id = new.supersedes_scenario_id;
      if v_case is not null and v_case <> new.case_id then
        raise exception 'FORBIDDEN_CROSS_CASE: scénario supersédé % appartient au dossier %, pas au dossier %',
          new.supersedes_scenario_id, v_case, new.case_id using errcode = '23514';
      end if;
      if v_root is not null and v_root <> new.root_scenario_id then
        raise exception 'VALIDATION_FAILED: une révision hérite de la racine du scénario révisé (% attendu, % fourni)',
          v_root, new.root_scenario_id using errcode = '23514';
      end if;
      -- Numérotation strictement incrémentale : c'est ce qui rend un cycle
      -- impossible, indépendamment de toute logique applicative.
      if v_rev is not null and new.revision_no <> v_rev + 1 then
        raise exception 'VALIDATION_FAILED: revision_no attendu %, fourni %',
          v_rev + 1, new.revision_no using errcode = '23514';
      end if;
    end if;

    return new;
  end if;

  -- UPDATE : le périmètre est IMMUABLE. Seul le passage atomique à
  -- `superseded` est autorisé, et rien d'autre ne peut bouger avec lui.
  if new.id <> old.id
     or new.case_id <> old.case_id
     or new.root_scenario_id <> old.root_scenario_id
     or new.revision_no <> old.revision_no
     or new.supersedes_scenario_id is distinct from old.supersedes_scenario_id
     or new.title <> old.title
     or new.scope_snapshot <> old.scope_snapshot
     or new.scope_hash <> old.scope_hash
     or new.open_points <> old.open_points
     or new.blocked_reason is distinct from old.blocked_reason
     or new.revision_reason is distinct from old.revision_reason
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'CONFLICT_INVALID_STATE: un scénario est immuable (périmètre, titre, points ouverts, chaîne et identité). Créer une révision.'
      using errcode = '23514';
  end if;

  if old.status = 'superseded' then
    raise exception 'CONFLICT_INVALID_STATE: un scénario supersédé est définitif'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if new.status <> 'superseded' then
      raise exception 'CONFLICT_INVALID_STATE: seule la transition vers superseded est autorisée (demandée: % -> %)',
        old.status, new.status using errcode = '23514';
    end if;
    if new.superseded_by_scenario_id is null then
      raise exception 'CONFLICT_INVALID_STATE: une supersession doit désigner son successeur'
        using errcode = '23514';
    end if;
  elsif new.superseded_by_scenario_id is distinct from old.superseded_by_scenario_id then
    raise exception 'CONFLICT_INVALID_STATE: le lien de supersession ne se pose qu''avec le statut superseded'
      using errcode = '23514';
  end if;

  if new.superseded_by_scenario_id is not null then
    select case_id, root_scenario_id into v_case, v_root
      from quote_scenarios where id = new.superseded_by_scenario_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: successeur % appartient au dossier %, pas au dossier %',
        new.superseded_by_scenario_id, v_case, new.case_id using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'quote_scenarios_invariants'
      and tgrelid = 'public.quote_scenarios'::regclass
  ) then
    create trigger quote_scenarios_invariants
      before insert or update on public.quote_scenarios
      for each row execute function public.quote_scenarios_enforce_invariants();
  end if;
end $$;

-- 7.2 Liens : même dossier, hypothèse liable, immuabilité totale.
create or replace function public.quote_scenario_links_enforce_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case   uuid;
  v_status text;
  v_points jsonb;
begin
  if tg_op = 'UPDATE' then
    raise exception 'CONFLICT_INVALID_STATE: un lien de scénario est immuable. Créer une révision du scénario.'
      using errcode = '23514';
  end if;

  select case_id, open_points into v_case, v_points
    from quote_scenarios where id = new.scenario_id;
  if v_case is not null and v_case <> new.case_id then
    raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
      new.scenario_id, v_case, new.case_id using errcode = '23514';
  end if;

  -- Un lien ne peut couvrir qu'un point ouvert RÉELLEMENT dérivé du périmètre.
  if new.open_point_key is not null and v_points is not null then
    if not exists (
      select 1 from jsonb_array_elements(v_points) as p
       where p ->> 'key' = new.open_point_key
    ) then
      raise exception 'VALIDATION_FAILED: open_point_key % n''est pas un point ouvert du scénario %',
        new.open_point_key, new.scenario_id using errcode = '23514';
    end if;
  end if;

  if new.assumption_id is not null then
    select case_id, status into v_case, v_status
      from quote_scenario_assumptions where id = new.assumption_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: hypothèse % appartient au dossier %, pas au dossier %',
        new.assumption_id, v_case, new.case_id using errcode = '23514';
    end if;
    -- Au moment du lien, seules une hypothèse en vigueur ou compatible client
    -- peuvent être liées. Réfutée / supersédée / promue : non liable.
    -- Ce contrôle est ponctuel : le lien HISTORIQUE demeure si l'hypothèse
    -- change de statut plus tard — on ne réécrit jamais le passé.
    if v_status is not null and v_status not in ('active','client_confirmed') then
      raise exception 'CONFLICT_INVALID_STATE: hypothèse % non liable (statut %) ; seules active et client_confirmed le sont',
        new.assumption_id, v_status using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'quote_scenario_links_invariants'
      and tgrelid = 'public.quote_scenario_links'::regclass
  ) then
    create trigger quote_scenario_links_invariants
      before insert or update on public.quote_scenario_links
      for each row execute function public.quote_scenario_links_enforce_invariants();
  end if;
end $$;

-- 7.3 Sélections : même dossier, append + libération uniquement.
create or replace function public.quote_scenario_selections_enforce_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case   uuid;
  v_status text;
begin
  if tg_op = 'INSERT' then
    select case_id, status into v_case, v_status
      from quote_scenarios where id = new.scenario_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
        new.scenario_id, v_case, new.case_id using errcode = '23514';
    end if;
    if v_status = 'superseded' then
      raise exception 'CONFLICT_INVALID_STATE: un scénario supersédé ne peut pas être sélectionné'
        using errcode = '23514';
    end if;
    if new.released_at is not null then
      raise exception 'VALIDATION_FAILED: une sélection naît ouverte' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.case_id <> old.case_id
     or new.scenario_id <> old.scenario_id
     or new.selected_by <> old.selected_by
     or new.selected_at <> old.selected_at then
    raise exception 'CONFLICT_INVALID_STATE: une sélection est immuable hors libération'
      using errcode = '23514';
  end if;
  if old.released_at is not null then
    raise exception 'CONFLICT_INVALID_STATE: sélection déjà libérée' using errcode = '23514';
  end if;
  if new.released_at is null then
    raise exception 'CONFLICT_INVALID_STATE: seule la libération est autorisée' using errcode = '23514';
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'quote_scenario_selections_invariants'
      and tgrelid = 'public.quote_scenario_selections'::regclass
  ) then
    create trigger quote_scenario_selections_invariants
      before insert or update on public.quote_scenario_selections
      for each row execute function public.quote_scenario_selections_enforce_invariants();
  end if;
end $$;

-- 7.4 Registre : une mutation ne peut pas rattacher un dossier au scénario
--     d'un autre dossier.
create or replace function public.quote_scenario_mutations_enforce_same_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case uuid;
begin
  select case_id into v_case from quote_scenarios where id = new.scenario_id;
  if v_case is not null and v_case <> new.case_id then
    raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
      new.scenario_id, v_case, new.case_id using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'quote_scenario_mutations_same_case'
      and tgrelid = 'public.quote_scenario_mutations'::regclass
  ) then
    create trigger quote_scenario_mutations_same_case
      before insert or update on public.quote_scenario_mutations
      for each row execute function public.quote_scenario_mutations_enforce_same_case();
  end if;
end $$;

-- =====================================================================
-- 8. RPC ATOMIQUE — seule voie de mutation
--    Opérations P1-A2 : create | revise | select.
--    Promotion et propagation sont REJETÉES explicitement.
--    Codes d'erreur en préfixe stable, consommés par l'Edge Function.
-- =====================================================================
create or replace function public.manage_quote_scenario(
  p_case_id uuid,
  p_operation text,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_scenario_id uuid default null,
  p_title text default null,
  p_scope_snapshot jsonb default null,
  p_open_points jsonb default null,
  p_links jsonb default null,
  p_status text default null,
  p_blocked_reason text default null,
  p_revision_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_replay       public.quote_scenario_mutations%rowtype;
  v_target       public.quote_scenarios%rowtype;
  v_result       public.quote_scenarios%rowtype;
  v_selection    public.quote_scenario_selections%rowtype;
  v_key          text;
  v_status       text;
  v_scope_hash   text;
  v_violation    text;
  v_result_id    uuid;
  v_outcome      text := 'applied';
  v_supersedes   uuid := null;
  v_selection_id uuid := null;
  v_released_id  uuid := null;
  v_case_exists  boolean;
  v_actor_exists boolean;
  v_links        jsonb;
  v_open_points  jsonb;
  v_link_sig     text;
  v_prev_sig     text;
  v_link         jsonb;
  v_link_count   integer := 0;
begin
  -- ── 0. Promotion / propagation : refus explicites et non contournables ──
  if p_operation in ('promote','promote_to_fact','promote_to_facts',
                     'promote_to_final','promotion','finalize') then
    raise exception 'PROMOTION_NOT_ALLOWED: la promotion d''un scénario ou d''une hypothèse est hors périmètre P1-A2'
      using errcode = '22023';
  end if;
  if p_operation in ('propagate','propagate_assumption','propagate_assumptions','propagation') then
    raise exception 'PROPAGATION_NOT_ALLOWED: une hypothèse ne se propage jamais d''un périmètre à un autre'
      using errcode = '22023';
  end if;
  if p_operation in ('price','run_pricing','estimate') then
    raise exception 'PRICING_NOT_ALLOWED: P1-A2 ne calcule aucun prix'
      using errcode = '22023';
  end if;

  if p_operation is null or p_operation not in ('create','revise','select') then
    raise exception 'VALIDATION_FAILED: opération invalide (%). Autorisées: create, revise, select', p_operation
      using errcode = '22023';
  end if;

  -- ── 1. Identité et dossier ──────────────────────────────────────────
  if p_case_id is null then
    raise exception 'VALIDATION_FAILED: p_case_id est obligatoire' using errcode = '22023';
  end if;
  if p_actor_user_id is null then
    raise exception 'VALIDATION_FAILED: p_actor_user_id est obligatoire' using errcode = '22023';
  end if;

  select exists (select 1 from quote_cases where id = p_case_id) into v_case_exists;
  if not v_case_exists then
    raise exception 'NOT_FOUND: dossier % introuvable', p_case_id using errcode = '22023';
  end if;

  -- Identité non forgeable : l'Edge Function ne transmet que auth.user.id ;
  -- cette vérification empêche qu'un appelant service_role fautif fabrique un
  -- created_by arbitraire.
  select exists (select 1 from auth.users where id = p_actor_user_id) into v_actor_exists;
  if not v_actor_exists then
    raise exception 'FORBIDDEN_IDENTITY: utilisateur % inconnu', p_actor_user_id using errcode = '22023';
  end if;

  -- ── 2. Estampille d'idempotence ─────────────────────────────────────
  v_key := btrim(coalesce(p_idempotency_key, ''));
  if length(v_key) < 8 or length(v_key) > 128 then
    raise exception 'VALIDATION_FAILED: p_idempotency_key doit faire 8 à 128 caractères' using errcode = '22023';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED: p_request_fingerprint doit être un SHA-256 hexadécimal minuscule' using errcode = '22023';
  end if;

  -- ── 3. Sérialisation par dossier (concurrence) ──────────────────────
  perform pg_advisory_xact_lock(hashtext('quote_scenario_' || p_case_id::text));

  -- ── 4. Rejeu idempotent ─────────────────────────────────────────────
  select * into v_replay
    from quote_scenario_mutations
   where case_id = p_case_id and idempotency_key = v_key;

  if found then
    if v_replay.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: la clé % a déjà été utilisée avec un contenu différent', v_key
        using errcode = '23505';
    end if;
    select * into v_result from quote_scenarios where id = v_replay.scenario_id;
    return jsonb_build_object(
      'scenario_id',       v_replay.scenario_id,
      'root_scenario_id',  v_result.root_scenario_id,
      'revision_no',       v_result.revision_no,
      'status',            v_replay.result_status,
      'scope_hash',        v_result.scope_hash,
      'operation',         v_replay.operation,
      'outcome',           v_replay.outcome,
      'idempotent_replay', true
    );
  end if;

  -- ── 5. Normalisation commune create/revise ──────────────────────────
  if p_operation in ('create','revise') then
    if p_title is null or btrim(p_title) = '' then
      raise exception 'VALIDATION_FAILED: title est obligatoire' using errcode = '22023';
    end if;
    if p_scope_snapshot is null or jsonb_typeof(p_scope_snapshot) <> 'object' then
      raise exception 'VALIDATION_FAILED: scope_snapshot doit être un objet JSON' using errcode = '22023';
    end if;

    -- Schéma FERMÉ v1 : clés inconnues, champs requis, énumérations, types et
    -- bornes. Le CHECK de la colonne applique la MÊME règle ; la vérifier ici
    -- ne fait que rendre le refus lisible au lieu d'opaque.
    v_violation := public.quote_scenario_scope_violation(p_scope_snapshot);
    if v_violation is not null then
      raise exception 'SNAPSHOT_REJECTED: périmètre non conforme (%)', v_violation using errcode = '22023';
    end if;

    v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'draft');
    if v_status not in ('draft','blocked') then
      raise exception 'VALIDATION_FAILED: P1-A2 n''écrit que les statuts draft et blocked (demandé: %)', v_status
        using errcode = '22023';
    end if;
    if v_status = 'blocked' and btrim(coalesce(p_blocked_reason, '')) = '' then
      raise exception 'VALIDATION_FAILED: status=blocked exige blocked_reason' using errcode = '22023';
    end if;
    if v_status <> 'blocked' and btrim(coalesce(p_blocked_reason, '')) <> '' then
      raise exception 'VALIDATION_FAILED: blocked_reason n''a de sens que pour status=blocked' using errcode = '22023';
    end if;

    -- Hash calculé PAR LA BASE sur la forme jsonb normalisée : l'ordre des clés
    -- du payload n'a aucune influence, et l'appelant ne peut pas le choisir.
    v_scope_hash := encode(sha256(convert_to(p_scope_snapshot::text, 'UTF8')), 'hex');

    -- ── Points ouverts : DÉRIVÉS, jamais reçus ────────────────────────
    -- `p_open_points` demeure dans la signature pour la compatibilité de
    -- l'appelant, mais il n'alimente JAMAIS l'écriture : la seule valeur
    -- persistée est celle que la base dérive du périmètre. Fournir un tableau
    -- reste possible, à une condition — qu'il soit EXACTEMENT la dérivation.
    --
    -- Les deux gardes sont volontairement cumulatives :
    --   * la dérivation rend le forgeage INOPÉRANT (rien de ce qui est reçu
    --     n'est écrit), y compris si p_open_points est NULL ;
    --   * la comparaison stricte le rend VISIBLE, au lieu d'être absorbée en
    --     silence. Un écart signale soit un appel forgé, soit une divergence
    --     entre `deriveOpenPoints` (Edge) et cette fonction (base) : dans les
    --     deux cas, la requête doit échouer, pas être devinée.
    v_open_points := public.quote_scenario_derive_open_points(p_scope_snapshot);
    if p_open_points is not null then
      if jsonb_typeof(p_open_points) <> 'array' then
        raise exception 'VALIDATION_FAILED: open_points doit être un tableau' using errcode = '22023';
      end if;
      if p_open_points <> v_open_points then
        raise exception 'OPEN_POINTS_FORGED: les points ouverts sont dérivés du périmètre par la base (% dérivé(s)), jamais déclarés par l''appelant (% fourni(s))',
          jsonb_array_length(v_open_points), jsonb_array_length(p_open_points)
          using errcode = '22023';
      end if;
    end if;

    v_links := coalesce(p_links, '[]'::jsonb);
    if jsonb_typeof(v_links) <> 'array' then
      raise exception 'VALIDATION_FAILED: links doit être un tableau' using errcode = '22023';
    end if;

    -- Signature ENSEMBLISTE des liens demandés : triée, donc insensible à
    -- l'ordre d'envoi. Sert à distinguer une relance d'une révision réelle.
    select coalesce(string_agg(sig, e'\n' order by sig), '')
      into v_link_sig
      from (
        select coalesce(l ->> 'assumption_id', '') || '|' ||
               coalesce(l ->> 'reserve_code', '')  || '|' ||
               coalesce(l ->> 'open_point_key', '') as sig
          from jsonb_array_elements(v_links) as l
      ) s;
  end if;

  -- ── 6. Opérations ───────────────────────────────────────────────────
  if p_operation = 'create' then
    v_result_id := gen_random_uuid();

    insert into quote_scenarios (
      id, case_id, root_scenario_id, revision_no, status, title,
      scope_snapshot, scope_hash, open_points, blocked_reason, created_by
    ) values (
      v_result_id, p_case_id, v_result_id, 1, v_status, btrim(p_title),
      p_scope_snapshot, v_scope_hash, v_open_points,
      nullif(btrim(coalesce(p_blocked_reason, '')), ''), p_actor_user_id
    );

  elsif p_operation = 'revise' then
    if p_scenario_id is null then
      raise exception 'VALIDATION_FAILED: p_scenario_id est obligatoire pour revise' using errcode = '22023';
    end if;
    if btrim(coalesce(p_revision_reason, '')) = '' then
      raise exception 'VALIDATION_FAILED: revision_reason est obligatoire pour revise' using errcode = '22023';
    end if;

    select * into v_target from quote_scenarios where id = p_scenario_id for update;
    if not found then
      raise exception 'NOT_FOUND: scénario % introuvable', p_scenario_id using errcode = '22023';
    end if;
    if v_target.case_id <> p_case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
        p_scenario_id, v_target.case_id, p_case_id using errcode = '23514';
    end if;
    if v_target.status = 'superseded' then
      raise exception 'CONFLICT_INVALID_STATE: le scénario % est déjà supersédé par % ; réviser la tête de chaîne',
        p_scenario_id, v_target.superseded_by_scenario_id using errcode = '23514';
    end if;
    if v_target.status not in ('draft','blocked') then
      raise exception 'CONFLICT_INVALID_STATE: P1-A2 ne révise que les scénarios draft ou blocked (statut courant: %)',
        v_target.status using errcode = '23514';
    end if;

    select coalesce(string_agg(sig, e'\n' order by sig), '')
      into v_prev_sig
      from (
        select coalesce(assumption_id::text, '') || '|' ||
               coalesce(reserve_code, '')        || '|' ||
               coalesce(open_point_key, '')      as sig
          from quote_scenario_links
         where scenario_id = v_target.id
      ) s;

    -- RELANCE ≠ RÉVISION : périmètre, liens, statut, motif de blocage et titre
    -- identiques ⇒ la requête ne dit rien de neuf, aucune révision n'est créée.
    if v_target.scope_hash = v_scope_hash
       and v_prev_sig = v_link_sig
       and v_target.status = v_status
       and coalesce(v_target.blocked_reason, '') = coalesce(nullif(btrim(coalesce(p_blocked_reason, '')), ''), '')
       and v_target.title = btrim(p_title) then
      v_outcome   := 'no_op';
      v_result_id := v_target.id;
    else
      v_result_id  := gen_random_uuid();
      v_supersedes := v_target.id;

      -- Report du seul lien AVANT : le successeur n'existe pas encore au moment
      -- où l'ancienne ligne doit le désigner. Vérifié au commit.
      set constraints public.quote_scenarios_superseded_by_scenario_id_fkey deferred;

      update quote_scenarios
         set status = 'superseded',
             superseded_by_scenario_id = v_result_id,
             resolved_at = now(),
             resolved_by = p_actor_user_id
       where id = v_target.id;

      insert into quote_scenarios (
        id, case_id, root_scenario_id, revision_no, status, title,
        scope_snapshot, scope_hash, open_points, blocked_reason, revision_reason,
        supersedes_scenario_id, created_by
      ) values (
        v_result_id, p_case_id, v_target.root_scenario_id, v_target.revision_no + 1,
        v_status, btrim(p_title), p_scope_snapshot, v_scope_hash, v_open_points,
        nullif(btrim(coalesce(p_blocked_reason, '')), ''), btrim(p_revision_reason),
        v_target.id, p_actor_user_id
      );

      -- Une révision LIBÈRE la sélection portée par l'ancienne ligne et ne
      -- sélectionne JAMAIS le successeur : choisir reste un acte explicite.
      update quote_scenario_selections
         set released_at = now(),
             released_by = p_actor_user_id,
             release_reason = 'superseded_by_revision'
       where case_id = p_case_id
         and scenario_id = v_target.id
         and released_at is null
      returning id into v_released_id;
    end if;

  else
    -- select : acte SÉPARÉ du périmètre, historisé.
    if p_scenario_id is null then
      raise exception 'VALIDATION_FAILED: p_scenario_id est obligatoire pour select' using errcode = '22023';
    end if;

    select * into v_target from quote_scenarios where id = p_scenario_id for update;
    if not found then
      raise exception 'NOT_FOUND: scénario % introuvable', p_scenario_id using errcode = '22023';
    end if;
    if v_target.case_id <> p_case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
        p_scenario_id, v_target.case_id, p_case_id using errcode = '23514';
    end if;
    if v_target.status = 'superseded' then
      raise exception 'CONFLICT_INVALID_STATE: un scénario supersédé ne peut pas être sélectionné ; son successeur est %',
        v_target.superseded_by_scenario_id using errcode = '23514';
    end if;

    v_result_id := v_target.id;
    v_status    := v_target.status;

    select * into v_selection
      from quote_scenario_selections
     where case_id = p_case_id and released_at is null
     for update;

    if found and v_selection.scenario_id = v_target.id then
      v_outcome := 'no_op';
    else
      if found then
        update quote_scenario_selections
           set released_at = now(),
               released_by = p_actor_user_id,
               release_reason = 'replaced_by_selection'
         where id = v_selection.id
        returning id into v_released_id;
      end if;

      insert into quote_scenario_selections (case_id, scenario_id, selected_by)
      values (p_case_id, v_target.id, p_actor_user_id)
      returning id into v_selection_id;
    end if;
  end if;

  -- ── 7. Liens (create / revise appliquée uniquement) ─────────────────
  -- Aucun lien n'est recopié automatiquement : une révision REDÉCLARE son jeu
  -- de liens. Les liens de l'ancienne ligne restent attachés à l'ancienne ligne.
  if p_operation in ('create','revise') and v_outcome = 'applied' then
    for v_link in select * from jsonb_array_elements(v_links) loop
      if ((v_link ->> 'assumption_id') is not null) = ((v_link ->> 'reserve_code') is not null) then
        raise exception 'VALIDATION_FAILED: chaque lien porte EXACTEMENT assumption_id ou reserve_code'
          using errcode = '22023';
      end if;
      insert into quote_scenario_links (
        case_id, scenario_id, assumption_id, reserve_code, open_point_key, created_by
      ) values (
        p_case_id, v_result_id,
        nullif(v_link ->> 'assumption_id', '')::uuid,
        nullif(v_link ->> 'reserve_code', ''),
        nullif(v_link ->> 'open_point_key', ''),
        p_actor_user_id
      );
      v_link_count := v_link_count + 1;
    end loop;
  end if;

  select * into v_result from quote_scenarios where id = v_result_id;

  -- ── 8. Enregistrement de la requête (append-only, même transaction) ──
  insert into quote_scenario_mutations (
    case_id, scenario_id, operation, outcome, result_status,
    idempotency_key, request_fingerprint, actor_user_id
  ) values (
    p_case_id, v_result_id, p_operation, v_outcome, v_result.status,
    v_key, p_request_fingerprint, p_actor_user_id
  );

  -- ── 9. Journalisation transactionnelle ──────────────────────────────
  -- `manual_action` est DÉJÀ autorisé par le CHECK courant de
  -- case_timeline_events : aucune extension d'enum partagé n'est nécessaire.
  -- L'opération réelle est portée par event_data.
  insert into case_timeline_events (case_id, event_type, actor_type, actor_user_id, event_data)
  values (
    p_case_id, 'manual_action', 'operator', p_actor_user_id,
    jsonb_build_object(
      'source',                 'manage-quote-scenario',
      'operation',              p_operation,
      'outcome',                v_outcome,
      'scenario_id',            v_result_id,
      'root_scenario_id',       v_result.root_scenario_id,
      'revision_no',            v_result.revision_no,
      'scenario_status',        v_result.status,
      'scope_hash',             v_result.scope_hash,
      'supersedes_scenario_id', v_supersedes,
      'open_points_count',      jsonb_array_length(v_result.open_points),
      'links_count',            v_link_count,
      'selection_id',           v_selection_id,
      'released_selection_id',  v_released_id,
      'idempotency_key',        v_key,
      'request_fingerprint',    p_request_fingerprint,
      'promoted_to_fact',       false,
      'priced',                 false
    )
  );

  return jsonb_build_object(
    'scenario_id',           v_result_id,
    'root_scenario_id',      v_result.root_scenario_id,
    'revision_no',           v_result.revision_no,
    'status',                v_result.status,
    'scope_hash',            v_result.scope_hash,
    'operation',             p_operation,
    'outcome',               v_outcome,
    'supersedes_scenario_id', v_supersedes,
    'selection_id',          v_selection_id,
    'released_selection_id', v_released_id,
    'links_count',           v_link_count,
    'idempotent_replay',     false
  );
end;
$$;

-- =====================================================================
-- 9. RLS — lecture shared authenticated operator workspace (miroir P1-A1)
-- =====================================================================
alter table public.quote_scenarios enable row level security;
alter table public.quote_scenario_links enable row level security;
alter table public.quote_scenario_selections enable row level security;
-- Registre d'audit interne : RLS activée SANS policy (deny-all) et aucun GRANT.
alter table public.quote_scenario_mutations enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'quote_scenarios'
                   and policyname = 'quote_scenarios_select') then
    create policy "quote_scenarios_select"
      on public.quote_scenarios for select to authenticated
      using (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'quote_scenario_links'
                   and policyname = 'quote_scenario_links_select') then
    create policy "quote_scenario_links_select"
      on public.quote_scenario_links for select to authenticated
      using (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'quote_scenario_selections'
                   and policyname = 'quote_scenario_selections_select') then
    create policy "quote_scenario_selections_select"
      on public.quote_scenario_selections for select to authenticated
      using (auth.role() = 'authenticated');
  end if;
end $$;

-- Aucune policy INSERT / UPDATE / DELETE nulle part : la posture lue dans le
-- catalogue est la posture réelle. La RPC SECURITY DEFINER est l'unique voie
-- d'écriture.

-- =====================================================================
-- 10. PRIVILÈGES MINIMAUX
-- =====================================================================
revoke all on table public.quote_scenarios from public;
revoke all on table public.quote_scenarios from anon;
revoke all on table public.quote_scenarios from authenticated;
revoke all on table public.quote_scenarios from service_role;
grant select on table public.quote_scenarios to authenticated;
grant select on table public.quote_scenarios to service_role;

revoke all on table public.quote_scenario_links from public;
revoke all on table public.quote_scenario_links from anon;
revoke all on table public.quote_scenario_links from authenticated;
revoke all on table public.quote_scenario_links from service_role;
grant select on table public.quote_scenario_links to authenticated;
grant select on table public.quote_scenario_links to service_role;

revoke all on table public.quote_scenario_selections from public;
revoke all on table public.quote_scenario_selections from anon;
revoke all on table public.quote_scenario_selections from authenticated;
revoke all on table public.quote_scenario_selections from service_role;
grant select on table public.quote_scenario_selections to authenticated;
grant select on table public.quote_scenario_selections to service_role;

-- Registre d'idempotence : strictement interne, aucun accès Data API.
revoke all on table public.quote_scenario_mutations from public;
revoke all on table public.quote_scenario_mutations from anon;
revoke all on table public.quote_scenario_mutations from authenticated;
revoke all on table public.quote_scenario_mutations from service_role;

-- RPC : service_role exclusivement.
revoke all on function public.manage_quote_scenario(uuid, text, uuid, text, text, uuid, text, jsonb, jsonb, jsonb, text, text, text) from public;
revoke all on function public.manage_quote_scenario(uuid, text, uuid, text, text, uuid, text, jsonb, jsonb, jsonb, text, text, text) from anon;
revoke all on function public.manage_quote_scenario(uuid, text, uuid, text, text, uuid, text, jsonb, jsonb, jsonb, text, text, text) from authenticated;
grant execute on function public.manage_quote_scenario(uuid, text, uuid, text, text, uuid, text, jsonb, jsonb, jsonb, text, text, text) to service_role;

-- Triggers de garde : jamais appelables directement.
revoke all on function public.quote_scenarios_enforce_invariants() from public;
revoke all on function public.quote_scenarios_enforce_invariants() from anon;
revoke all on function public.quote_scenarios_enforce_invariants() from authenticated;
revoke all on function public.quote_scenario_links_enforce_invariants() from public;
revoke all on function public.quote_scenario_links_enforce_invariants() from anon;
revoke all on function public.quote_scenario_links_enforce_invariants() from authenticated;
revoke all on function public.quote_scenario_selections_enforce_invariants() from public;
revoke all on function public.quote_scenario_selections_enforce_invariants() from anon;
revoke all on function public.quote_scenario_selections_enforce_invariants() from authenticated;
revoke all on function public.quote_scenario_mutations_enforce_same_case() from public;
revoke all on function public.quote_scenario_mutations_enforce_same_case() from anon;
revoke all on function public.quote_scenario_mutations_enforce_same_case() from authenticated;

-- Validateurs de snapshot : évalués par des CHECK sous l'identité du
-- propriétaire de la RPC (SECURITY DEFINER). Aucun rôle Data API n'ayant de
-- privilège d'écriture sur ces tables, aucun d'eux ne peut les déclencher.
revoke all on function public.quote_scenario_snapshot_violation(jsonb, integer) from public;
revoke all on function public.quote_scenario_snapshot_violation(jsonb, integer) from anon;
revoke all on function public.quote_scenario_snapshot_violation(jsonb, integer) from authenticated;
revoke all on function public.quote_scenario_monetary_token(text) from public;
revoke all on function public.quote_scenario_monetary_token(text) from anon;
revoke all on function public.quote_scenario_monetary_token(text) from authenticated;

-- Validateur de schéma fermé, ses auxiliaires et la dérivation des points
-- ouverts : même posture. Ils décrivent la règle, ils ne sont pas une API.
revoke all on function public.quote_scenario_scope_violation(jsonb) from public;
revoke all on function public.quote_scenario_scope_violation(jsonb) from anon;
revoke all on function public.quote_scenario_scope_violation(jsonb) from authenticated;
revoke all on function public.quote_scenario_place_violation(jsonb, text) from public;
revoke all on function public.quote_scenario_place_violation(jsonb, text) from anon;
revoke all on function public.quote_scenario_place_violation(jsonb, text) from authenticated;
revoke all on function public.quote_scenario_cargo_unit_violation(jsonb, text) from public;
revoke all on function public.quote_scenario_cargo_unit_violation(jsonb, text) from anon;
revoke all on function public.quote_scenario_cargo_unit_violation(jsonb, text) from authenticated;
revoke all on function public.quote_scenario_unknown_key(jsonb, text[]) from public;
revoke all on function public.quote_scenario_unknown_key(jsonb, text[]) from anon;
revoke all on function public.quote_scenario_unknown_key(jsonb, text[]) from authenticated;
revoke all on function public.quote_scenario_is_enum(jsonb, text[]) from public;
revoke all on function public.quote_scenario_is_enum(jsonb, text[]) from anon;
revoke all on function public.quote_scenario_is_enum(jsonb, text[]) from authenticated;
revoke all on function public.quote_scenario_is_ref(jsonb) from public;
revoke all on function public.quote_scenario_is_ref(jsonb) from anon;
revoke all on function public.quote_scenario_is_ref(jsonb) from authenticated;
revoke all on function public.quote_scenario_is_int(jsonb, numeric, numeric) from public;
revoke all on function public.quote_scenario_is_int(jsonb, numeric, numeric) from anon;
revoke all on function public.quote_scenario_is_int(jsonb, numeric, numeric) from authenticated;
revoke all on function public.quote_scenario_open_point(text, text) from public;
revoke all on function public.quote_scenario_open_point(text, text) from anon;
revoke all on function public.quote_scenario_open_point(text, text) from authenticated;
revoke all on function public.quote_scenario_derive_open_points(jsonb) from public;
revoke all on function public.quote_scenario_derive_open_points(jsonb) from anon;
revoke all on function public.quote_scenario_derive_open_points(jsonb) from authenticated;

-- =====================================================================
-- 11. Documentation catalogue
-- =====================================================================
comment on table public.quote_scenarios is
  'P1-A2. Scenario provisoire comme objet de premier rang : perimetre IMMUABLE (scope_snapshot + scope_hash), revisions chainees par root_scenario_id/revision_no, supersession atomique. Aucun prix, aucun montant, aucune promotion. Ecriture exclusivement via manage_quote_scenario.';
comment on column public.quote_scenarios.scope_snapshot is
  'Perimetre FERME schema_version=1, impose par la base : quote_scenario_snapshot_violation (formes interdites : cle monetaire, decimal, UUID, profondeur) ET quote_scenario_scope_violation (vocabulaire ferme : aucune cle inconnue, champs requis, enums, types, bornes). Aucun identifiant de ligne, aucune donnee client reelle attendue.';
comment on column public.quote_scenarios.scope_hash is
  'SHA-256 de scope_snapshot::text calcule PAR LA RPC sur la forme jsonb normalisee par PostgreSQL. Insensible a l ordre des cles du payload. Jamais fourni par l appelant.';
comment on column public.quote_scenarios.open_points is
  'Points ouverts DERIVES du snapshot PAR LA BASE (quote_scenario_derive_open_points), jamais fournis par l appelant : un CHECK impose l egalite stricte avec la derivation, donc aucun appel service_role ne peut en ajouter ni en supprimer. Ambiguite ou manque reel uniquement : une contrainte connue (DG, transit, payeur distinct, documents separes, RoRo/ConRo) n est PAS un point ouvert. P1-A2 les trace ; il n exige pas leur couverture.';
comment on column public.quote_scenarios.status is
  'Vocabulaire doctrinal complet. P1-A2 n ecrit que draft, blocked et superseded (pose par la RPC lors d une revision). provisional_estimated / partial_scoped supposent un pricing par scenario ; promoted_to_final suppose la promotion explicite.';
comment on table public.quote_scenario_links is
  'P1-A2. Liens IMMUABLES scenario -> hypothese P1-A1 XOR code de reserve doctrinal. Aucune promotion, aucune propagation, aucun effet sur l hypothese liee. Le lien historique demeure si l hypothese change de statut plus tard.';
comment on table public.quote_scenario_selections is
  'P1-A2. Historique des selections : au plus UNE selection ouverte par dossier. Une revision libere la selection de l ancienne ligne et ne selectionne JAMAIS le successeur.';
comment on table public.quote_scenario_mutations is
  'P1-A2. Registre append-only des requetes de mutation de scenario (idempotence + distinction relance/revision). service_role only, RLS activee sans policy, aucun GRANT. Aucun DELETE applicatif.';
comment on function public.manage_quote_scenario(uuid, text, uuid, text, text, uuid, text, jsonb, jsonb, jsonb, text, text, text) is
  'P1-A2. Seule voie de mutation des scenarios. service_role only. Operations: create | revise | select. Rejette explicitement promotion, propagation et pricing. Les points ouverts sont DERIVES par la base : p_open_points n alimente jamais l ecriture et, s il est fourni, doit etre exactement la derivation (sinon OPEN_POINTS_FORGED). N ecrit jamais dans quote_facts, quote_gaps, client_gap_requests, quote_request_lines, quotation_versions ni aucune donnee tarifaire.';
comment on function public.quote_scenario_scope_violation(jsonb) is
  'P1-A2. Miroir SQL de validateScopeSnapshot (domain.ts) : schema FERME v1. Renvoie NULL si conforme, sinon un motif stable (unknown_key / invalid / missing / cargo_units_count / duplicate_unit_ref / snapshot_too_large). Fonction TOTALE : ne leve jamais, car evaluee par un CHECK dont l ordre n est pas specifie.';
comment on function public.quote_scenario_derive_open_points(jsonb) is
  'P1-A2. Miroir SQL de deriveOpenPoints (domain.ts). Seule source des open_points persistes : la base ne fait aucune confiance a un tableau recu. Tri en collation "C" pour coincider octet pour octet avec la derivation de l Edge Function. Fonction TOTALE : renvoie [] sur une entree non conforme plutot que de lever.';

-- =====================================================================
-- 12. ASSERTIONS D'INTÉGRITÉ — exécutables telles quelles, HORS migration
--
--     Ces assertions ne sont pas jouées par la migration : elles la
--     VÉRIFIENT. Les blocs purs (A) ne touchent aucune table ; les blocs
--     transactionnels (B) écrivent puis ROLLBACK, et ne laissent donc rien.
--
--     Exécution (base locale) :
--       docker exec -i supabase_db_<ref> psql -U postgres -d postgres \
--         -v ON_ERROR_STOP=1 -f - < ce_bloc.sql
--     Un ASSERT en échec fait échouer la commande : le silence vaut succès.
--
--     Retirer les deux lignes de délimitation de commentaire ci-dessous.
-- =====================================================================
/*
-- ── A. Périmètre : schéma FERMÉ v1 (aucune écriture) ──────────────────
do $$
declare
  v_ok   jsonb := '{
    "schema_version": 1,
    "transport_mode": "MARITIME",
    "movement_direction": "IMPORT",
    "terminal_operation_mode": "LOLO",
    "origin": {"location_kind":"PORT","location_code":"port-a","location_status":"confirmed"},
    "destination": {"location_kind":"PORT","location_code":"port-b","location_status":"confirmed"},
    "cargo_units": [{
      "unit_ref":"lot-1","unit_kind":"CONTAINER","equipment_code":"eq-40hc",
      "packaging":"palletized","quantity":2,"gross_weight_kg":18000,
      "chargeable_weight_kg":18000,"volume_dm3":60000,
      "temperature_control_required":false,"temperature_setpoint_celsius":null,
      "classification_status":"confirmed","destination_ref":"dest-main",
      "dangerous_goods":false,"required_attachment_status":"not_required"
    }],
    "customs": {"regime_status":"known","regime_code":"reg-c400","split_declarations":false},
    "booking": {"stage":"booked","carrier_ref":"carrier-x"},
    "documents": {"split_required":false,"sets_count":1},
    "parties": {"payer_is_shipper":true,"payer_ref":"party-1","consignee_ref":"party-2"},
    "constraints": {"multi_destination":false,"transit_country_refs":[]}
  }'::jsonb;
  v_open jsonb;
begin
  -- A1. Un périmètre conforme est accepté TEL QUEL.
  assert public.quote_scenario_scope_violation(v_ok) is null,
    'A1 : perimetre valide refuse (' || coalesce(public.quote_scenario_scope_violation(v_ok), '') || ')';
  assert public.quote_scenario_derive_open_points(v_ok) = '[]'::jsonb,
    'A1 : perimetre net, aucun point ouvert attendu';

  -- A2. CLÉ INCONNUE — le défaut corrigé. Au premier rang comme dans un lot.
  assert public.quote_scenario_scope_violation(v_ok || '{"rogue_field":"x"}'::jsonb)
       = 'unknown_key:scope_snapshot.rogue_field', 'A2 : cle inconnue de premier rang acceptee';
  assert public.quote_scenario_scope_violation(
           jsonb_set(v_ok, '{cargo_units,0,rogue_field}', '"x"'))
       = 'unknown_key:scope_snapshot.cargo_units[0].rogue_field', 'A2 : cle inconnue de lot acceptee';
  assert public.quote_scenario_scope_violation(
           jsonb_set(v_ok, '{customs,rogue_field}', '"x"'))
       = 'unknown_key:scope_snapshot.customs.rogue_field', 'A2 : cle inconnue douaniere acceptee';

  -- A3. Champs requis, énumérations, types et bornes.
  assert public.quote_scenario_scope_violation(v_ok - 'terminal_operation_mode')
       = 'missing:scope_snapshot.terminal_operation_mode', 'A3 : mode terminal absent accepte';
  assert public.quote_scenario_scope_violation(jsonb_set(v_ok, '{schema_version}', '2'))
       = 'invalid:scope_snapshot.schema_version', 'A3 : schema_version=2 accepte';
  assert public.quote_scenario_scope_violation(jsonb_set(v_ok, '{schema_version}', '"1"'))
       = 'invalid:scope_snapshot.schema_version', 'A3 : schema_version chaine acceptee';
  assert public.quote_scenario_scope_violation(jsonb_set(v_ok, '{transport_mode}', '"RAIL"'))
       = 'invalid:scope_snapshot.transport_mode', 'A3 : mode de transport hors vocabulaire accepte';
  assert public.quote_scenario_scope_violation(jsonb_set(v_ok, '{cargo_units,0,quantity}', '0'))
       = 'invalid:scope_snapshot.cargo_units[0].quantity', 'A3 : quantite nulle acceptee';
  assert public.quote_scenario_scope_violation(
           jsonb_set(v_ok, '{cargo_units,0,temperature_setpoint_celsius}', '80'))
       = 'invalid:scope_snapshot.cargo_units[0].temperature_setpoint_celsius', 'A3 : consigne hors plage acceptee';
  assert public.quote_scenario_scope_violation(
           jsonb_set(v_ok, '{cargo_units,0}', (v_ok -> 'cargo_units' -> 0) - 'equipment_code'))
       = 'invalid:scope_snapshot.cargo_units[0].equipment_code', 'A3 : equipment_code absent accepte';
  assert public.quote_scenario_scope_violation(jsonb_set(v_ok, '{cargo_units}', '[]'))
       = 'cargo_units_count:0', 'A3 : perimetre sans lot accepte';
  assert public.quote_scenario_scope_violation(
           jsonb_set(v_ok, '{cargo_units}',
             (v_ok -> 'cargo_units') || (v_ok -> 'cargo_units')))
       = 'duplicate_unit_ref:lot-1', 'A3 : unit_ref duplique accepte';
  -- Les invariants structurels restent en amont.
  assert public.quote_scenario_scope_violation(v_ok || '{"total_amount":1}'::jsonb)
       = 'monetary_key:total_amount', 'A3 : cle monetaire acceptee';

  -- A4. DÉRIVATION EXACTE : ni plus, ni moins, dans l'ordre de l'Edge.
  v_open := jsonb_set(
              jsonb_set(v_ok, '{cargo_units,0,packaging}', '"unknown"'),
              '{cargo_units,0,equipment_code}', 'null');
  assert public.quote_scenario_derive_open_points(v_open) = '[
    {"key":"equipment_unknown:lot-1","code":"equipment_unknown","ref":"lot-1"},
    {"key":"packaging_unknown:lot-1","code":"packaging_unknown","ref":"lot-1"}
  ]'::jsonb, 'A4 : derivation inexacte pour packaging/equipment inconnus';
  assert public.quote_scenario_derive_open_points(
           jsonb_set(v_ok, '{terminal_operation_mode}', 'null')) = '[
    {"key":"terminal_operation_mode_unknown","code":"terminal_operation_mode_unknown","ref":null}
  ]'::jsonb, 'A4 : mode terminal maritime inconnu non derive';
  -- Contrainte CONNUE : une marchandise dangereuse déclarée n'ouvre rien.
  assert public.quote_scenario_derive_open_points(
           jsonb_set(v_ok, '{cargo_units,0,dangerous_goods}', 'true')) = '[]'::jsonb,
    'A4 : une contrainte connue a ete prise pour un point ouvert';

  raise notice 'A : schema ferme et derivation — OK';
end $$;

-- ── B. Voies d'écriture (tout est annulé par le ROLLBACK final) ───────
begin;
do $$
declare
  v_case     uuid;
  v_actor    uuid;
  v_id       uuid := gen_random_uuid();
  v_result   jsonb;
  v_points   jsonb;
  v_snapshot jsonb;
begin
  select id into v_case from public.quote_cases limit 1;
  select id into v_actor from auth.users limit 1;
  if v_case is null or v_actor is null then
    raise notice 'B : ignore (aucun dossier ou aucun utilisateur local)';
    return;
  end if;

  v_snapshot := '{
    "schema_version": 1, "transport_mode": "MARITIME", "movement_direction": "IMPORT",
    "terminal_operation_mode": "LOLO",
    "cargo_units": [{
      "unit_ref":"lot-1","unit_kind":"CONTAINER","equipment_code":null,
      "packaging":"unknown","quantity":1,"gross_weight_kg":18000,
      "chargeable_weight_kg":18000,"volume_dm3":60000,
      "temperature_control_required":false,"temperature_setpoint_celsius":null,
      "classification_status":"confirmed","destination_ref":"dest-main",
      "dangerous_goods":false,"required_attachment_status":"not_required"
    }]
  }'::jsonb;

  -- B1. Le défaut reproduit : RPC service_role, clé inconnue dans le périmètre.
  begin
    perform public.manage_quote_scenario(
      p_case_id => v_case, p_operation => 'create', p_actor_user_id => v_actor,
      p_idempotency_key => 'assert-rogue-key-01', p_request_fingerprint => repeat('a', 64),
      p_title => 'Assertion cle inconnue',
      p_scope_snapshot => v_snapshot || '{"rogue_field":"x"}'::jsonb);
    raise exception 'B1 ECHEC : un perimetre porteur de rogue_field a ete accepte';
  exception when others then
    if sqlerrm not like 'SNAPSHOT_REJECTED%' then raise; end if;
  end;

  -- B2. Le défaut reproduit : open_points forgés à [] alors que le périmètre
  --     en dérive deux. La requête échoue, elle n'est pas silencieusement
  --     corrigée : un écart signale un appel forgé ou une divergence Edge/base.
  begin
    perform public.manage_quote_scenario(
      p_case_id => v_case, p_operation => 'create', p_actor_user_id => v_actor,
      p_idempotency_key => 'assert-forged-op-1', p_request_fingerprint => repeat('b', 64),
      p_title => 'Assertion points ouverts forges',
      p_scope_snapshot => v_snapshot, p_open_points => '[]'::jsonb);
    raise exception 'B2 ECHEC : des open_points forges ont ete acceptes';
  exception when others then
    if sqlerrm not like 'OPEN_POINTS_FORGED%' then raise; end if;
  end;

  -- B3. Points ouverts NON fournis : la base les dérive, exactement, et le
  --     draft les conserve non couverts (aucune garde de couverture en P1-A2).
  v_result := public.manage_quote_scenario(
    p_case_id => v_case, p_operation => 'create', p_actor_user_id => v_actor,
    p_idempotency_key => 'assert-derived-01', p_request_fingerprint => repeat('c', 64),
    p_title => 'Assertion derivation base', p_scope_snapshot => v_snapshot,
    p_open_points => null);
  select open_points into v_points
    from public.quote_scenarios where id = (v_result ->> 'scenario_id')::uuid;
  assert v_points = public.quote_scenario_derive_open_points(v_snapshot),
    'B3 : open_points persistes differents de la derivation';
  assert jsonb_array_length(v_points) = 2, 'B3 : deux points ouverts attendus';
  assert (v_result ->> 'status') = 'draft', 'B3 : un draft a points ouverts doit rester draft';

  -- B4. Hors RPC : l'INSERT direct bute sur les MÊMES contraintes.
  begin
    insert into public.quote_scenarios (
      id, case_id, root_scenario_id, revision_no, status, title,
      scope_snapshot, scope_hash, open_points, created_by)
    values (v_id, v_case, v_id, 1, 'draft', 'Assertion insert forge',
      v_snapshot, repeat('d', 64), '[]'::jsonb, v_actor);
    raise exception 'B4 ECHEC : un INSERT direct a fixe des open_points arbitraires';
  exception when check_violation then null;
  end;

  begin
    insert into public.quote_scenarios (
      id, case_id, root_scenario_id, revision_no, status, title,
      scope_snapshot, scope_hash, open_points, created_by)
    values (v_id, v_case, v_id, 1, 'draft', 'Assertion insert rogue',
      v_snapshot || '{"rogue_field":"x"}'::jsonb, repeat('d', 64),
      public.quote_scenario_derive_open_points(v_snapshot), v_actor);
    raise exception 'B4 ECHEC : un INSERT direct a persiste une cle inconnue';
  exception when check_violation then null;
  end;

  raise notice 'B : voies d ecriture — OK';
end $$;
rollback;
*/
