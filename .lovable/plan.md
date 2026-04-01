

# Analyse pre-smoke-test + clarification cargo.freight_exchange_rate

## Clarification : cargo.freight_exchange_rate

**Constat** : cette cle etait deja presente dans `src/pages/case-view/constants.ts` (EDITABLE_FACT_KEYS ligne 66 + NUMERIC_FACT_KEYS ligne 81) **avant** ce patch PAD. Elle etait donc editable dans le cockpit CaseView mais **non autorisee** par le backend `set-case-fact`.

L'ajout a la whitelist est un **fix de coherence UI/backend** : sans lui, un operateur qui modifie ce champ dans le cockpit recevrait une erreur 400.

Cependant, `build-case-puzzle` a retire cette cle en Phase 16 (commentaires explicites : "cargo.freight_exchange_rate removed — exchange_rates table is source of truth"). C'est donc une cle **legacy/deprecated** cote moteur.

**Ecart reel** : coherence whitelist restauree, mais hors perimetre PAD. A signaler dans le bilan de vague.

## Plan : smoke test runtime

Le smoke test necessite d'interagir avec le preview (saisir des designations, cliquer des boutons, verifier les facts). Cela requiert le mode execution avec les outils browser.

### Tests a executer

1. **Confirmer seul** (toles galvanisees) — verifier 0 fact ecrit
2. **Appliquer au dossier** T12 — verifier cargo.pad_category=T12 + cargo.pad_rate_fcfa_per_ton=4780
3. **Appliquer au dossier** T07 (clinker) — verifier 484
4. **Appliquer au dossier** T01 (ordinateurs portables) — verifier 19239
5. Controles : facts visibles cockpit, 0 erreur console, idempotence au re-clic

### Action requise

Passez en mode execution pour que je puisse lancer le smoke test browser sur ces 4 cas. Je ne peux pas interagir avec le preview en mode plan.

