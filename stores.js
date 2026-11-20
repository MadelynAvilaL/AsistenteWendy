// =========================================================
// Dónde guarda Wendy lo que sabe:
// - En tu computadora: data/conocimiento.json (como siempre)
// - En internet (Netlify): Supabase, si configuras SUPABASE_URL y SUPABASE_SECRET_KEY
//   Los temas base siguen viniendo del JSON; en Supabase solo se guarda lo aprendido.
// =========================================================
import { normalize } from "./brain.js";

/* ---------- Archivo JSON (solo en tu computadora) ---------- */
export async function fileStore(filePath) {
  const fs = await import("node:fs");
  let cache = null;
  let cacheMtime = 0;
  const read = () => {
    const mtime = fs.statSync(filePath).mtimeMs;
    if (!cache || mtime !== cacheMtime) {
      // Se vuelve a leer si editas el archivo a mano.
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!Array.isArray(data.temas)) data.temas = [];
      cache = data;
      cacheMtime = mtime;
    }
    return cache;
  };
  return {
    kind: "archivo",
    async list() {
      try { return read().temas; } catch (error) {
        console.error("No pude leer data/conocimiento.json:", error.message);
        return [];
      }
    },
    async add(topic) {
      const data = read();
      // Si ya existía esa pregunta aprendida, la reemplazamos.
      data.temas = data.temas.filter((t) => !t.aprendido || !t.preguntas.some((q) => topic.preguntas.includes(normalize(q))));
      data.temas.push(topic);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      cacheMtime = fs.statSync(filePath).mtimeMs;
    }
  };
}

/* ---------- Solo memoria (Netlify sin Supabase: lo aprendido se pierde) ---------- */
export function memoryStore(baseTopics) {
  const learned = [];
  return {
    kind: "memoria",
    async list() { return [...baseTopics, ...learned]; },
    async add(topic) {
      const i = learned.findIndex((t) => t.preguntas.some((q) => topic.preguntas.includes(q)));
      if (i >= 0) learned.splice(i, 1);
      learned.push(topic);
    }
  };
}

/* ---------- Supabase ---------- */
export function supabaseStore({ url, key, baseTopics }) {
  const base = url.replace(/\/+$/, "");
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Las claves nuevas (sb_secret_...) van solo en «apikey»; las antiguas (JWT) también en Authorization.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  let cache = null;
  let cacheAt = 0;
  return {
    kind: "supabase",
    async list() {
      if (cache && Date.now() - cacheAt < 30000) return cache;
      try {
        const response = await fetch(`${base}/rest/v1/aprendidos?select=preguntas,respuestas,origen&order=id.asc&limit=5000`, {
          headers, signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) throw new Error(`Supabase respondió ${response.status}: ${await response.text()}`);
        const rows = await response.json();
        cache = [...baseTopics, ...rows.map((r) => ({ ...r, aprendido: true }))];
        cacheAt = Date.now();
        return cache;
      } catch (error) {
        console.error("Supabase (leer):", error.message);
        return cache || baseTopics;
      }
    },
    async add(topic) {
      const row = { clave: topic.preguntas[0], preguntas: topic.preguntas, respuestas: topic.respuestas, origen: topic.origen || "voz" };
      const response = await fetch(`${base}/rest/v1/aprendidos?on_conflict=clave`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) console.error("Supabase (guardar):", response.status, await response.text());
      cache = null;
    }
  };
}

// Elige la base de datos según la configuración.
export async function chooseStore({ env, baseTopics, filePath }) {
  if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    return supabaseStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SECRET_KEY, baseTopics });
  }
  if (filePath) return fileStore(filePath);
  return memoryStore(baseTopics);
}
