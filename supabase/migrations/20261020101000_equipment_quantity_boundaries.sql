-- A plain year such as 2020 is not quantity 20 of 20-foot equipment.
-- Keep the installed repair protocol and ACL; change only the quantity boundary.
BEGIN;
DO $baseline$ BEGIN
 IF md5(replace(pg_get_functiondef('public.unicode_equipment_inventory(text)'::regprocedure),chr(13),''))<>'4d231acdcb8746ee627cb0ccd50d333b'
 THEN RAISE EXCEPTION 'Unexpected equipment inventory baseline'; END IF;
END $baseline$;
CREATE OR REPLACE FUNCTION public.unicode_equipment_inventory(p_excerpt text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE m text[]; result jsonb:='[]';
BEGIN
 IF p_excerpt IS NULL OR p_excerpt ~* '(^|[\r\n])[[:space:]]*(>|On .+wrote:|Le .+écrit|From:|De:)' THEN RETURN NULL; END IF;
 FOR m IN SELECT regexp_matches(p_excerpt,'(?<![[:alnum:]])([0-9]+)(?:[[:space:]]*x[[:space:]]*|[[:space:]]+)(20|40)[[:space:]]*[’‘′ʼ＇][[:space:]]*(HC|HQ)(?![[:alnum:]])','gi') LOOP
  IF length(m[1])>6 OR m[1]::integer<1 THEN RETURN NULL; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('quantity',m[1]::integer,'type',m[2]||upper(m[3])));
 END LOOP;
 IF jsonb_array_length(result)<>1 THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM regexp_matches(p_excerpt,'(?<![[:alnum:]])[0-9]+(?:[[:space:]]*x[[:space:]]*|[[:space:]]+)(20|40|45)(?![0-9])[[:space:]]*([''’‘′ʼ＇]|ft|feet|foot)?[[:space:]]*(HC|HQ|GP|DV|FR|OT|RF)?(?![[:alnum:]])','gi'))<>1
  OR (SELECT count(*) FROM regexp_matches(p_excerpt,'(?<![0-9])(20|40|45)[[:space:]]*[''’‘′ʼ＇]?[[:space:]]*(HC|HQ|GP|DV|FR|OT|RF|FT|FEET|FOOT)(?![[:alnum:]])','gi'))<>1
 THEN RETURN NULL; END IF;
 RETURN result;
END; $$;
COMMIT;
