-- Scenario cargo v2. LOCAL ONLY until a separate Cloud GO.
-- No row updates, no tariff change, no Auth/RLS change.
-- CREATE OR REPLACE preserves the scope validator OID used by existing CHECKs.
begin;

create or replace function public.quote_scenario_cargo_unit_v2_violation(p_unit jsonb, p_path text)
returns text
language plpgsql immutable parallel safe
set search_path = public
as $$
declare
  v_legacy jsonb;
begin
  if coalesce(jsonb_typeof(p_unit), '') <> 'object' then return 'not_an_object:' || p_path; end if;
  if coalesce(jsonb_typeof(p_unit -> 'dangerous_goods'), '') not in ('boolean','null') then return 'invalid:' || p_path || '.dangerous_goods'; end if;
  if (p_unit -> 'ownership') is distinct from 'null'::jsonb
     and not public.quote_scenario_is_enum(p_unit -> 'ownership', array['SOC','COC']) then return 'invalid:' || p_path || '.ownership'; end if;
  if not public.quote_scenario_is_enum(p_unit -> 'weight_basis', array['total','per_unit','unknown']) then return 'invalid:' || p_path || '.weight_basis'; end if;
  if coalesce(jsonb_typeof(p_unit -> 'scenario_basis'), '') <> 'string'
     or length(p_unit ->> 'scenario_basis') > 500 then return 'invalid:' || p_path || '.scenario_basis'; end if;
  if (p_unit -> 'un_number') is distinct from 'null'::jsonb and (
     coalesce(jsonb_typeof(p_unit -> 'un_number'), '') <> 'string'
     or coalesce(p_unit ->> 'un_number','') !~ '^UN[0-9]{4}$'
     or p_unit ->> 'un_number' = 'UN0000') then return 'invalid:' || p_path || '.un_number'; end if;
  if (p_unit -> 'imo_class') is distinct from 'null'::jsonb
     and not public.quote_scenario_is_enum(p_unit -> 'imo_class',
       array['1.1','1.2','1.3','1.4','1.5','1.6','2.1','2.2','2.3','3','4.1','4.2','4.3','5.1','5.2','6.1','6.2','7','8','9'])
     then return 'invalid:' || p_path || '.imo_class'; end if;
  if (p_unit -> 'dangerous_goods') is distinct from 'true'::jsonb
     and ((p_unit -> 'un_number') is distinct from 'null'::jsonb
       or (p_unit -> 'imo_class') is distinct from 'null'::jsonb)
     then return 'invalid:' || p_path || '.danger_classification_conflict'; end if;
  -- VALIDATION projection only: never written, never used as a pricing input.
  v_legacy := (p_unit - array['ownership','un_number','imo_class','weight_basis','scenario_basis'])
    || jsonb_build_object('dangerous_goods', p_unit -> 'dangerous_goods' = 'true'::jsonb);
  return public.quote_scenario_cargo_unit_violation(v_legacy, p_path);
end;
$$;
-- Like the v1 validators: internal CHECK helper under the RPC owner's identity,
-- not a callable Data API. Revoke explicit grants as well on a local replay.
revoke all on function public.quote_scenario_cargo_unit_v2_violation(jsonb,text) from public, anon, authenticated, service_role;

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

  -- Versions numériques explicites ; les snapshots v1 restent inchangés.
  if (p_snapshot -> 'schema_version') is distinct from '1'::jsonb
     and (p_snapshot -> 'schema_version') is distinct from '2'::jsonb then
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
    if p_snapshot -> 'schema_version' = '2'::jsonb then
      v_reason := public.quote_scenario_cargo_unit_v2_violation(
        v_unit, 'scope_snapshot.cargo_units[' || v_i || ']');
    else
      v_reason := public.quote_scenario_cargo_unit_violation(
        v_unit, 'scope_snapshot.cargo_units[' || v_i || ']');
    end if;
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

comment on function public.quote_scenario_scope_violation(jsonb) is
  'Closed scope validator v1/v2. v1 unchanged; v2 adds scenario-only group ownership, tri-state danger, ONU/IMO, weight basis and operator rationale. No facts promoted.';
commit;
