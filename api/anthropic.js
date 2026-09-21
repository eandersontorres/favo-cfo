// api/anthropic.js — proxy autenticado pro Anthropic (sem chamadas no src hoje;
// o parse de PDF usa /api/parse-statement e /api/parse-paystub). Toda a logica
// (JWT, tenant, CORS, whitelist, metering) fica em _lib/anthropicProxy.js.

import { createAnthropicProxy } from './_lib/anthropicProxy.js'

export default createAnthropicProxy({
  app: 'favo-cfo',
  models: ['claude-opus-4-5'],
  maxTokensCap: 8192,
  origins: ['https://cfo.favo.team', 'https://cfo.clariva.cloud'],
  // Portao do CFO: owner/admin (ceo_admins) ou super admin — nao r7_user_tenants.
  tenantRpc: 'r7_get_my_cfo_tenant_ids',
})
