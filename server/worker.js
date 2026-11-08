/**
 * Cloudflare Worker entry point.
 *
 *   1. Create a KV namespace and bind it as TN.
 *   2. Set TN_TOKEN as a secret.
 *   3. Deploy, then paste the worker URL into TabNest's sync page.
 *
 * wrangler.toml:
 *   name = "tabnest-sync"
 *   main = "worker.js"
 *   compatibility_date = "2026-01-01"
 *   kv_namespaces = [{ binding = "TN", id = "<id>" }]
 */
import { handle } from "./handler.mjs";

export default {
  async fetch(request, env) {
    if (!env.TN) return new Response("KV binding TN is missing", { status: 500 });
    return handle(request, env.TN, { token: env.TN_TOKEN });
  },
};
