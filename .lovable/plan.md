# Phase 8.8 — Qualification Assistée Minimale

## Statut : ✅ IMPLÉMENTÉE

## Objectif CTO

Une phase de **qualification minimale** qui :
- ✅ Analyse l'email et détecte les incohérences/ambiguïtés
- ✅ Génère un draft de clarification structuré (sans chiffres)
- ✅ Détecte explicitement : temporary import, multi-destinations, services demandés
- ❌ NE fait PAS de suggestions HS/régime
- ❌ NE calcule AUCUN prix

---

## Garde-fous CTO Implémentés

### 🔒 Garde-fou #1 — Edge Function STATEless et NON persistante

`qualify-quotation-minimal` :
- ❌ Ne crée aucune ligne DB
- ❌ Ne modifie aucun quote_fact
- ❌ Ne modifie aucun quote_gap
- ✅ Retourne uniquement un payload éphémère pour l'UI

### 🔒 Garde-fou #2 — Cotation reste IMPOSSIBLE techniquement

- Le bouton "Générer la réponse" reste bloqué si `blocking_gaps.length > 0`
- Le bouton reste bloqué si `quoteCaseStatus !== READY_TO_PRICE`
- La clarification ne débloque rien automatiquement

### 🔒 Garde-fou #3 — Langage questionnant, jamais suggestif

Dans le prompt et les drafts :
- ❌ Pas de "Le régime le plus adapté est…"
- ❌ Pas de "Nous recommandons…"
- ✅ Uniquement "Merci de préciser…" / "Pouvez-vous confirmer…"

---

## Fichiers Créés

| Fichier | Description |
|---------|-------------|
| `supabase/functions/qualify-quotation-minimal/index.ts` | Edge function stateless de qualification |
| `src/components/puzzle/ClarificationPanel.tsx` | UI affichage draft + ambiguïtés |

---

## Fichiers Modifiés

| Fichier | Modification |
|---------|--------------|
| `src/pages/QuotationSheet.tsx` | Intégration appel async + ClarificationPanel |
| `supabase/config.toml` | Ajout qualify-quotation-minimal |

---

## Flux Utilisateur Phase 8.8

```text
1. Opérateur ouvre un dossier avec gaps bloquants
2. BlockingGapsPanel affiche "Cotation incomplète - X éléments bloquants"
3. Clic "Demander clarification" → appel edge function
4. Edge function analyse l'email et détecte ambiguïtés
5. ClarificationPanel s'affiche avec :
   - Ambiguïtés détectées (temporary import, multi-destinations, etc.)
   - Draft email bilingue FR/EN
6. Opérateur révise et copie le draft
7. L'opérateur envoie via son client email (pas d'envoi automatique)
```

---

## Ce qui est EXPLICITEMENT REPORTÉ en Phase 9

| Fonctionnalité | Phase |
|----------------|-------|
| Sélection HS codes via IA | Phase 9 |
| Sélection régimes douaniers | Phase 9 |
| UI DecisionSupportPanel complet | Phase 9 |
| Scénarios multi-destinations automatisés | Phase 9 |
| Scores de pertinence complexes | Phase 9 |
| Calcul ou suggestion de droits & taxes | Phase 9 |
| Persistance des choix opérateur | Phase 9 |

---

## Tests Manuels

Pour tester Phase 8.8 :
1. Ouvrir un dossier avec gaps bloquants
2. Cliquer sur "Demander clarification"
3. Vérifier que le ClarificationPanel s'affiche
4. Vérifier que le draft contient des questions claires
5. Vérifier qu'aucun prix ou suggestion technique n'apparaît
6. Vérifier que le bouton "Générer la réponse" reste bloqué
