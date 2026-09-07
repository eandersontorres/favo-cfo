// Consome o handoff do My Favo Team (app.favo.team).
//
// Precisa ser o PRIMEIRO import do main.jsx: lib/supabase.js cria o client no
// topo do modulo e le o storage na construcao, e ESM avalia TODOS os imports
// antes do corpo do main — chamar la seria tarde demais.
import { consumeFavoHandoff } from "./lib/favoSso.js";

// supabase-js names its storage key after the first label of the project host.
const sbRef = new URL(import.meta.env.VITE_SUPABASE_URL || "https://huurnewugpwerkeusolt.supabase.co").hostname.split(".")[0];
consumeFavoHandoff(`sb-${sbRef}-auth-token`);


// Dev-only alternative sign-in: Keycloak at auth.favo.lan brokers identity for
// the whole ecosystem. This does NOT replace the Hub handoff above — both run
// in parallel, the handoff wins when present, and a production build (no
// VITE_KEYCLOAK_URL, non-.lan host) makes every function here a no-op.
import { consumeKeycloakCode } from "./lib/favoKeycloak.js";
consumeKeycloakCode(`sb-${sbRef}-auth-token`);
