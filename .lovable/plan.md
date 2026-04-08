# COCKPIT-6 — DONE ✅ + PRICING-GUARD — DONE ✅

## COCKPIT-6 — Brief intelligent + Compteurs honnêtes : DONE ✅

### Volet A — Brief partenaire intelligent
- Query autonome `quote_facts` (routing, cargo, contacts, timing)
- `buildBriefText(facts, partnerName, purpose)` : 3-6 lignes, tolérant aux absences
- Extension `onPrefill(name, purpose, email, briefText)`
- Injection dans `purpose_detail` uniquement si vide

### Volet B — Compteurs opérationnels dans CaseActionPlan
- Badges conditionnels (affichés seulement si > 0) :
  - `draftPartnerRequests` → à préparer
  - `unsentPartnerRequests` → envois à confirmer
  - `pendingPartnerFacts` → faits à valider
  - `draftedClientGaps` → clarifications à envoyer
  - `blockingGapsCount` → gaps bloquants

---

## PRICING-GUARD — Garde-fou communication avant pricing : DONE ✅

### 1. Auto-pricing conditionné (CaseView.tsx)
- Avant lancement auto, vérifie : EQR ouvertes, faits proposés, client gaps non clos
- Si boucle communication ouverte → skip auto-pricing + toast info

### 2. Warning au lancement manuel (PricingCommWarnings.tsx)
- Composant autonome affiché sous PricingLaunchPanel
- Alerte ambrée avec chiffres concrets si communications ouvertes
- Non bloquant (souveraineté opérateur)

### 3. Badge "Provisoire" (PricingResultPanel.tsx)
- Badge ambre conditionnel `isProvisional` calculé côté CaseView
- Tooltip : "Ce pricing a été calculé alors que certaines communications sont encore en cours."
- Aucune migration, déduction UI pure

### Blast radius
| Fichier | Nature |
|---------|--------|
| `CaseView.tsx` | Auto-pricing guard + props comm warnings + provisional |
| `PricingCommWarnings.tsx` | Nouveau composant (warnings comm) |
| `PricingResultPanel.tsx` | +prop `isProvisional`, +badge |
| `.lovable/plan.md` | Plan actif |
| `docs/DEFERRED_BACKLOG.md` | Entrée mise à jour |
