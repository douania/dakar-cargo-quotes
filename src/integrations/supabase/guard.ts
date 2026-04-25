// ============================================================================
// supabase/guard — Mitigation fail-fast pour bundle publié sans VITE_*
// ----------------------------------------------------------------------------
// Ce module est volontairement importé EN TOUT PREMIER dans src/main.tsx,
// avant tout import qui touche transitivement à src/integrations/supabase/client.ts.
//
// Rôle :
//   - Vérifier au boot que VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY
//     sont présents dans le bundle.
//   - Si absents : afficher un panneau d'erreur lisible (DOM APIs, sans React)
//     et throw pour empêcher createClient(undefined, undefined) → écran noir.
//   - Si présents : no-op pur (zéro coût runtime).
//
// Ce fichier ne corrige PAS la cause racine (injection des variables au build
// publish). Il transforme un écran noir opaque en signal exploitable.
//
// Voir docs/DEFERRED_BACKLOG.md → INFRA-PUBLISH-VITE-ENV-001
// ============================================================================

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const missing: string[] = [];
if (!url) missing.push('VITE_SUPABASE_URL');
if (!key) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');

if (missing.length > 0) {
  const message = `[supabase/guard] Variables manquantes au build : ${missing.join(', ')}`;
  // eslint-disable-next-line no-console
  console.error(message);

  const render = () => {
    const root = document.getElementById('root') || document.body;
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0f172a',
      color: '#f1f5f9',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '24px',
      boxSizing: 'border-box',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      maxWidth: '520px',
      width: '100%',
      textAlign: 'center',
    });

    const h1 = document.createElement('h1');
    h1.textContent = 'Configuration manquante';
    Object.assign(h1.style, {
      fontSize: '20px',
      margin: '0 0 12px 0',
      fontWeight: '600',
    });

    const p1 = document.createElement('p');
    p1.textContent =
      "Les variables d'environnement Supabase ne sont pas présentes dans le bundle publié.";
    Object.assign(p1.style, {
      fontSize: '14px',
      opacity: '0.85',
      margin: '0 0 16px 0',
      lineHeight: '1.5',
    });

    const code = document.createElement('pre');
    code.textContent = missing.join('\n');
    Object.assign(code.style, {
      background: '#1e293b',
      padding: '12px',
      borderRadius: '6px',
      fontSize: '12px',
      textAlign: 'left',
      margin: '0',
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    });

    const p2 = document.createElement('p');
    p2.textContent =
      "Republier le projet depuis Lovable. Si l'erreur persiste, contacter le support.";
    Object.assign(p2.style, {
      fontSize: '12px',
      opacity: '0.7',
      margin: '16px 0 0 0',
    });

    card.append(h1, p1, code, p2);
    wrap.append(card);
    root.append(wrap);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  } else {
    render();
  }

  throw new Error(message);
}
