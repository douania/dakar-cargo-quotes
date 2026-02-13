
# Correctif Transport Routier LCL + Passage DDP

## Statut : ✅ IMPLÉMENTÉ

---

## Phase 1 — Correctif LCL (terminé)

Le transport routier affichait 3 500 000 FCFA pour du LCL à cause d'un conteneur fantôme 40HC.

### Corrections appliquées

| Action | Fichier | Statut |
|---|---|---|
| Supprimer conteneur fantôme 40HC | quotation-engine/index.ts | ✅ |
| Détecter LCL dans price-service-lines | price-service-lines/index.ts | ✅ |
| Rate card générique LCL (value=0, confidence=0) | DB | ✅ |

---

## Phase 2 — Passage DDP (terminé)

### Architecture validée par CTO

- `request_type` → définit le package (services opérationnels)
- `routing.incoterm` → définit l'inclusion des débours (DAP vs DDP)
- **Pas de package LCL_IMPORT_DDP** — l'incoterm contrôle les débours, pas le package

### Corrections appliquées

| Action | Fichier | Statut |
|---|---|---|
| Ajout `routing.incoterm` à la whitelist | set-case-fact/index.ts | ✅ |
| `run-pricing` utilise `totals.dap`/`totals.ddp` selon incoterm | run-pricing/index.ts | ✅ |
| Stockage breakdown DAP/DDP/debours dans `outputs_json` | run-pricing/index.ts | ✅ |

### Logique totaux dans run-pricing

```text
if incoterm === "DDP":
  total_ht = engine.totals.ddp  (= dap + debours)
else:
  total_ht = engine.totals.dap  (= opérationnel + honoraires + border + terminal)
```

### Prochaine étape

1. Injecter `routing.incoterm = DDP` via `set-case-fact` sur le dossier Lantia
2. Relancer le pricing
3. Vérifier : section droits & taxes visible, total incluant les débours
