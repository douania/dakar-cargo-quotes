// Guard fail-fast Supabase — DOIT rester en première position pour s'exécuter
// avant tout import transitif de src/integrations/supabase/client.ts.
// Voir docs/DEFERRED_BACKLOG.md → INFRA-PUBLISH-VITE-ENV-001
import "./integrations/supabase/guard";

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// build-tag: 2026-04-25-supabase-guard
createRoot(document.getElementById("root")!).render(<App />);
