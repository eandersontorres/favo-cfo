// ─── Plan gate (favo_app_access) ─────────────────────────────────────────────
// Asks the DB whether the active tenant has the "cfo" module in its plan.
// FAIL-OPEN: any technical failure (network, timeout, permission denied,
// missing function, odd payload) lets the app through with console.warn. Only a
// successful response with allowed === false blocks. Never lock a restaurant
// out because of our own bug.

import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

export const APP_ID = 'cfo'
const TIMEOUT_MS = 5000

export async function checkAppAccess(tenantId, appId = APP_ID) {
  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    })
    const { data, error } = await Promise.race([
      supabase.rpc('favo_app_access', { p_tenant_id: tenantId, p_app_id: appId }),
      timeout,
    ])
    if (error) throw error
    if (!data || typeof data !== 'object' || typeof data.allowed !== 'boolean') {
      console.warn('[favo-gate] unexpected response, allowing', data)
      return { allowed: true, reason: 'gate_error' }
    }
    return data
  } catch (e) {
    console.warn('[favo-gate] check failed, allowing:', e?.message || e)
    return { allowed: true, reason: 'gate_error' }
  } finally {
    clearTimeout(timer)
  }
}

// status: 'skipped' (no session/tenant) | 'checking' | 'allowed' | 'blocked'.
// Keyed by user + tenant so a change of either re-checks and a stale answer
// never applies to the new key.
export function useAppAccess(userId, tenantId, enabled = true) {
  const key = enabled && userId && tenantId ? `${userId}:${tenantId}` : null
  const [state, setState] = useState({ key: null, result: null })

  useEffect(() => {
    if (!key) return
    let cancelled = false
    checkAppAccess(tenantId).then(result => {
      if (!cancelled) setState({ key, result })
    })
    return () => { cancelled = true }
  }, [key, tenantId])

  if (!key) return { status: 'skipped', result: null }
  if (state.key !== key) return { status: 'checking', result: null }
  return { status: state.result.allowed === false ? 'blocked' : 'allowed', result: state.result }
}

export function lockMessage(result) {
  switch (result?.reason) {
    case 'not_subscribed':
      return `Este módulo não está incluído no plano de ${result.tenant_name || 'sua empresa'}.`
    case 'trial_expired':
      return 'O período de teste terminou.'
    case 'subscription_canceled':
    case 'subscription_expired':
      return 'A assinatura deste módulo não está ativa.'
    case 'tenant_suspended':
    case 'tenant_canceled':
      return 'A conta está suspensa.'
    default:
      return 'Este módulo não está disponível para esta conta.'
  }
}
