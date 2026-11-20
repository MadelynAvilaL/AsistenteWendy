// =========================================================
// Servidor de Wendy para tu computadora (npm start).
// En Netlify se usa netlify/functions/api.mjs con la misma lógica (api.js).
// =========================================================
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./api.js";
import { chooseStore } from "./stores.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const KB_PATH = path.join(__dirname, "data", "conocimiento.json");

const baseTopics = JSON.parse(fs.readFileSync(KB_PATH, "utf8")).temas || [];
const store = await chooseStore({ env: process.env, baseTopics, filePath: KB_PATH });
const api = createApi({ env: process.env, store });

const app = express();
app.set("trust proxy", "loopback");
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // TensorFlow.js (visión sin IA) necesita 'unsafe-eval' para funcionar.
        "script-src": ["'self'", "'unsafe-eval'"],
        "img-src": ["'self'", "data:", "blob:", "https://image.pollinations.ai"],
        "media-src": ["'self'", "blob:", "mediastream:"],
        "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        // Pesos del modelo de visión (Google) e imágenes creadas (Pollinations).
        "connect-src": ["'self'", "https://storage.googleapis.com", "https://tfhub.dev", "https://www.kaggle.com", "https://*.kaggle.com", "https://*.kaggleusercontent.com", "https://image.pollinations.ai"],
        "worker-src": ["'self'", "blob:"],
        // Sin esto el navegador intenta usar https en localhost y la página puede salir sin estilos.
        "upgrade-insecure-requests": null
      }
    }
  })
);
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
  next();
});

app.use(express.static(path.join(__dirname, "public")));
// Imágenes que Wendy guardó en versiones anteriores.
app.use("/imagenes", express.static(path.join(__dirname, "imagenes")));
// Librerías de visión: si aún no se copiaron a public/vendor, se sirven desde node_modules.
app.use("/vendor/tfjs", express.static(path.join(__dirname, "node_modules", "@tensorflow", "tfjs", "dist")));
app.use("/vendor/coco-ssd", express.static(path.join(__dirname, "node_modules", "@tensorflow-models", "coco-ssd", "dist")));
app.use("/vendor/pose-detection", express.static(path.join(__dirname, "node_modules", "@tensorflow-models", "pose-detection", "dist")));

app.all("/api/*", express.json({ limit: "8mb" }), async (req, res) => {
  const result = await api.handle({
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    ip: req.ip,
    headers: req.headers
  });
  res.status(result.status).json(result.body);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`WENDY está lista en http://localhost:${PORT}`);
  console.log(`Base de datos: ${store.kind === "supabase" ? "Supabase" : "data/conocimiento.json"}`);
  console.log(api.hasGemini()
    ? `Gemini activado. Texto: ${api.TEXT_MODELS.join(" → ")} | Fotos: ${api.VISION_MODELS.join(" → ")}`
    : "Modo sin IA: Wendy usará su base de datos. Agrega GEMINI_API_KEY en .env para activar Gemini.");
});
