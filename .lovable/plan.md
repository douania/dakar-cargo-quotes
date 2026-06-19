## Vérification post-adoption (read-only)

L'opérateur a cliqué "Confirmer l'adoption" manuellement sur le case `08f968c3-b5ff-4bc8-af78-0b81c2c9a7f7`. Je propose une vérification runtime read-only pour confirmer que l'adoption s'est correctement propagée, sans aucune écriture.

### Périmètre strict
- Lecture DB uniquement via `supabase--read_query`
- Aucune mutation, aucun déploiement, aucun patch
- Aucun appel à `run-pricing`, `set-case-fact`, `write-cargo-canonical`, `canonicalize-cargo-from-case` (commit)
- Playwright headless optionnel pour capture UI post-adoption

### Contrôles à exécuter

**A. Tables canoniques cargo**
- `SELECT * FROM cargo_lines WHERE case_id = '08f968c3-...'` → lignes attendues (incl. Bus avec weight_kg / volume_cbm)
- `SELECT * FROM cargo_equipment WHERE case_id = '08f968c3-...'` → équipements alloués/non-alloués

**B. Invariants doctrine `AUTO-PRICING-GUARD-BEFORE-CANONICAL-ADOPTION-1`**
- `quote_facts` du case : aucune mutation de `cargo.*` côté facts (snapshot horodaté avant/après ne peut pas être fait, donc vérification structurelle : pas de nouveau `manual_input` ou `operator` fact créé par l'adoption)
- `quote_gaps` : statuts inchangés (pas de résolution auto)
- `pricing_results` / `quote_pricing_runs` : aucun run créé après l'adoption

**C. Audit trail**
- `SELECT * FROM cargo_canonical_adoptions` (ou table équivalente si existe) pour confirmer la trace d'adoption avec `derived_payload`, `source_email`, `sources_used`, `actor`

**D. UI post-adoption (Playwright optionnel)**
- Recharger `/case/08f968c3-...`, capturer l'état du panel : badge "Adopté", lignes affichées, bouton "Adopter" désactivé/masqué
- Vérifier qu'aucun appel `/functions/v1/run-pricing` ou `set-case-fact` n'est déclenché par le rechargement

**E. Logs Edge**
- `supabase--edge_function_logs` sur `canonicalize-cargo-from-case` pour confirmer un seul appel `mode=commit` récent, exit code OK
- Vérifier absence de logs `write-cargo-canonical` (déprécié dans Patch F)

### Stop conditions
- Si `cargo_lines` vide → FAIL (adoption non propagée)
- Si `quote_facts` mutés ou `pricing_results` créé → FAIL (violation guard)
- Si table audit absente → BLOCKED + rapport

### Livrable
- PASS / FAIL / BLOCKED
- Snapshots SQL (cargo_lines, cargo_equipment, audit trail)
- Logs Edge du commit
- Screenshot UI post-adoption (si Playwright)
- Confirmations : "Aucune mutation volontaire exécutée" / "Aucun pricing déclenché"
