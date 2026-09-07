// ─── favoKeycloak.js — OIDC login against Keycloak, opt-in, dev only ────────
//
// Copy this file next to favoSso.js in each app. It does NOT replace the
// existing handoff: both mechanisms run side by side and the app keeps working
// exactly as before unless this one is explicitly switched on.
//
// INSTALL (three lines, in the app's existing bootstrap)
//
//     import { consumeFavoHandoff } from "./lib/favoSso.js";
//     import { keycloakEnabled, consumeKeycloakCode, keycloakLogin } from "./lib/favoKeycloak.js";
//
//     // The Hub handoff still wins when present — it is the cheaper path and
//     // the one production uses.
//     if (!consumeFavoHandoff(SESSION_KEY)) {
//       await consumeKeycloakCode(SESSION_KEY);   // returning from Keycloak?
//     }
//
// and wherever the app decides it needs a login, offer `keycloakLogin()` as an
// alternative to its own form. Nothing else changes.
//
// ── WHY IT IS SAFE TO SHIP DISABLED ────────────────────────────────────────
//
// Two independent conditions must BOTH hold or every function here no-ops:
//
//   1. VITE_KEYCLOAK_URL is set at build time. Vite inlines env vars, so a
//      production build made without it cannot contain a Keycloak URL at all.
//   2. The page is on a host this file recognises as non-production
//      (*.favo.lan, or localhost). A production build that somehow carried the
//      variable would still refuse to redirect.
//
// Condition 2 exists because condition 1 is a build-time promise and build
// pipelines get edited. Belt and braces on an auth path is worth the ten lines.
//
// ── WHY THE TOKEN IS EXCHANGED, NOT JUST READ ──────────────────────────────
//
// Keycloak returns its OWN token. The apps' data layer is Supabase RLS, which
// validates Supabase-issued JWTs — a Keycloak token is not interchangeable.
// So on return we keep the Supabase session that the federated login already
// established (Keycloak brokers TO Supabase, so signing in through Keycloak
// leaves a valid Supabase session behind) and store the Keycloak token
// alongside it for anything that wants the richer claims (roles, tenant_id).
//
// That is a deliberate stopgap for the dev environment. The end state is the
// engine validating Keycloak tokens directly, at which point the exchange
// disappears rather than growing.

const KC_URL = import.meta.env.VITE_KEYCLOAK_URL || "";
const KC_REALM = import.meta.env.VITE_KEYCLOAK_REALM || "favo";
const KC_CLIENT = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || "";

const VERIFIER_KEY = "favo_kc_verifier";
const TOKEN_KEY = "favo_kc_token";

/** Hosts where the Keycloak path may run. Production is deliberately absent. */
function devHost() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h.endsWith(".favo.lan") || h === "localhost" || h === "127.0.0.1";
}

/** Both gates must pass. Everything else in this module checks this first. */
export function keycloakEnabled() {
  return Boolean(KC_URL && KC_CLIENT) && devHost();
}

function realmBase() {
  return `${KC_URL.replace(/\/$/, "")}/realms/${KC_REALM}`;
}

// ── PKCE ───────────────────────────────────────────────────────────────────
// Public clients cannot hold a secret, so the realm requires PKCE S256. The
// verifier is generated per attempt and consumed once.

function randomVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// ── login ──────────────────────────────────────────────────────────────────

/**
 * Send the browser to Keycloak. Returns false (and does nothing) when the
 * Keycloak path is not enabled, so a caller can fall back to its own form:
 *
 *     if (!keycloakLogin()) showPasswordForm();
 */
export async function keycloakLogin(redirectPath) {
  if (!keycloakEnabled()) return false;

  const verifier = randomVerifier();
  try {
    sessionStorage.setItem(VERIFIER_KEY, verifier);
  } catch {
    return false; // no storage, no PKCE, no login — fall back rather than fail
  }

  const redirectUri = window.location.origin + (redirectPath || "/");
  const url = new URL(`${realmBase()}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", KC_CLIENT);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("code_challenge", await challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
  return true;
}

/**
 * Called on boot. If we are back from Keycloak with ?code=, exchange it and
 * store the token. Returns the decoded claims, or null when there is nothing
 * to do — which is the overwhelmingly common case, so it stays cheap.
 *
 * @param {string|function} [target] optional: where to ALSO write a Supabase-
 *        shaped session, for apps that read one from storage. Same contract as
 *        consumeFavoHandoff's target.
 */
export async function consumeKeycloakCode(target) {
  if (!keycloakEnabled()) return null;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const iss = params.get("iss");
  // `iss` is present on Keycloak's callback and lets us ignore a ?code= that
  // belongs to some other flow (Square OAuth, for one, uses the same param).
  if (!code || !iss || !iss.includes(`/realms/${KC_REALM}`)) return null;

  let verifier = null;
  try { verifier = sessionStorage.getItem(VERIFIER_KEY); } catch { /* ignore */ }
  if (!verifier) return null;

  // Clean the URL before anything can fail: a spent code must not be retried
  // on reload, and it should not sit in history.
  try { sessionStorage.removeItem(VERIFIER_KEY); } catch { /* ignore */ }
  const clean = new URLSearchParams(window.location.search);
  ["code", "iss", "session_state", "state"].forEach((k) => clean.delete(k));
  const qs = clean.toString();
  window.history.replaceState(null, "",
    window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);

  let tokens;
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: KC_CLIENT,
      code,
      redirect_uri: window.location.origin + window.location.pathname,
      code_verifier: verifier,
    });
    const res = await fetch(`${realmBase()}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    tokens = await res.json();
  } catch {
    return null;
  }
  if (!tokens?.access_token) return null;

  const claims = decodeClaims(tokens.access_token);

  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 900),
      claims,
    }));
    // Apps that gate on a Supabase-shaped session in storage get one written
    // too, so this path does not require touching their auth guard. The token
    // inside is Keycloak's; see the note at the top about why that is a
    // stopgap and not the destination.
    if (target) {
      const session = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 900),
        expires_in: tokens.expires_in || 900,
        token_type: "bearer",
        user: claims ? { id: claims.sub, email: claims.email } : null,
      };
      if (typeof target === "function") target(session, claims);
      else localStorage.setItem(target, JSON.stringify(session));
    }
  } catch {
    return null;
  }

  return claims;
}

function decodeClaims(jwt) {
  try {
    const p = jwt.split(".")[1];
    const pad = p.length % 4 ? "=".repeat(4 - (p.length % 4)) : "";
    const json = atob(p.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

/** The stored Keycloak token, or null. Includes roles and tenant_id claims. */
export function getKeycloakToken() {
  if (!keycloakEnabled()) return null;
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (!t) return null;
    if (t.expires_at && t.expires_at * 1000 < Date.now()) return null;
    return t;
  } catch {
    return null;
  }
}

/** Realm roles from the token, for role checks that used email whitelists. */
export function getKeycloakRoles() {
  const t = getKeycloakToken();
  return t?.claims?.realm_access?.roles || [];
}

/** Log out of Keycloak as well as locally. No-op when disabled. */
export function keycloakLogout(redirectPath) {
  if (!keycloakEnabled()) return false;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  const url = new URL(`${realmBase()}/protocol/openid-connect/logout`);
  url.searchParams.set("client_id", KC_CLIENT);
  url.searchParams.set("post_logout_redirect_uri",
    window.location.origin + (redirectPath || "/"));
  window.location.assign(url.toString());
  return true;
}
