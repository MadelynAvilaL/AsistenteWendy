// =========================================================
// Wendy en Netlify: todas las rutas /api/* pasan por aquí.
// Usa la misma lógica que el servidor local (api.js).
// =========================================================
import { createApi } from "../../api.js";
import { chooseStore } from "../../stores.js";
import kb from "../../data/conocimiento.json" with { type: "json" };

let apiPromise = null;
function getApi() {
  if (!apiPromise) {
    apiPromise = chooseStore({ env: process.env, baseTopics: kb.temas || [] })
      .then((store) => createApi({ env: process.env, store }));
  }
  return apiPromise;
}

export default async (req, context) => {
  const api = await getApi();
  const url = new URL(req.url);
  let body = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const result = await api.handle({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    body,
    ip: context?.ip || req.headers.get("x-nf-client-connection-ip") || "anon",
    headers: Object.fromEntries(req.headers)
  });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
};

export const config = { path: "/api/*" };
