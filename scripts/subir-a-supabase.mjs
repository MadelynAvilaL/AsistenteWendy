// Sube a Supabase lo que Wendy aprendió en tu computadora (data/conocimiento.json).
// Uso: npm run subir-supabase   (necesita SUPABASE_URL y SUPABASE_SECRET_KEY en .env)
import "dotenv/config";
import fs from "node:fs";
import { supabaseStore } from "../stores.js";

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Falta SUPABASE_URL o SUPABASE_SECRET_KEY en tu archivo .env");
  process.exit(1);
}
const kb = JSON.parse(fs.readFileSync(new URL("../data/conocimiento.json", import.meta.url), "utf8"));
const learned = (kb.temas || []).filter((t) => t.aprendido);
const store = supabaseStore({ url: SUPABASE_URL, key: SUPABASE_SECRET_KEY, baseTopics: [] });
for (const topic of learned) {
  await store.add(topic);
  console.log("Subido:", topic.preguntas[0]);
}
const total = (await store.list()).length;
console.log(`Listo. ${learned.length} temas aprendidos enviados; Supabase tiene ${total}.`);
