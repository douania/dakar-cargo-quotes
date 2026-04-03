UPDATE public.terminal_designations
SET notes = 'Désignation contenant un renvoi tarifaire ; à traiter comme ligne de nomenclature avec indication de redirection, pas comme simple désignation standard.'
WHERE designation_label LIKE 'CHARPENTES%voir tarif%'
  AND terminal_provider = 'dakar_terminal';