@AGENTS.md

## Spécifique Claude Code
- Modèle/effort par défaut pour ce dépôt : Sonnet, effort high. Opus (effort high/xhigh) uniquement sur GO CTO pour DB/RLS/Auth/migration, pricing, sécurité ou blocage récurrent. Jamais `max` ni ultracode sans périmètre strict écrit.
- Commencer chaque session par le préflight Git ci-dessus et la lecture ciblée de la roadmap (sections 1–2 + pack actif). Ne pas charger `docs/DEFERRED_BACKLOG.md` (1 700 lignes) sauf besoin explicite.
- Travailler en lecture seule (Read/Grep/Glob) tant que le GO du lot n'autorise pas l'écriture ; quand le GO autorise l'écriture, appliquer et tester soi-même dans ce clone plutôt que produire un patch à recopier par une autre IA.
- Découper tout lot > 3 fichiers en sous-lots pour éviter la saturation de sortie.
- Ne pas lire `.env` ; ne jamais coller de clés dans un message ou un commit.
