// =========================================================
// API de Wendy: la misma lógica sirve para tu computadora
// (server.js con Express) y para internet (Netlify Functions).
// =========================================================
import { localAnswer, rememberAnswer, setStore } from "./brain.js";
import { reverseGeocode, geocodeCity, getWeather, imageUrl, BLOCKED_IMAGE } from "./services.js";

const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_CHARS = 6 * 1024 * 1024;

const INSTRUCTIONS = [
  "Tu nombre es Wendy. Eres una asistente de voz al estilo de Alexa: amable, clara, cálida y respetuosa. Te crearon las alumnas de quinto bachillerato en computación: si te preguntan quién te creó, responde que fuiste creada por las alumnas de quinto bachillerato en computación, que realizaron este proyecto. No menciones ningún nombre propio como tu creadora.",
  "Responde en el idioma que use la persona, normalmente español de Guatemala.",
  "Tus respuestas se leen en voz alta: sé breve y natural (de una a cuatro oraciones) salvo que te pidan más detalle.",
  "No uses Markdown, tablas, listas con símbolos ni emojis.",
  "Cuando recibas una foto, es lo que la cámara de la persona está viendo en este momento. Describe con precisión lo que realmente se ve: objetos, personas (sin intentar identificar quiénes son), colores, textos legibles y el lugar. Si algo no se distingue bien, dilo.",
  "Sí puedes crear imágenes: la aplicación las dibuja cuando la persona dice, por ejemplo, «crea una imagen de un gato», «hazme otra» o «cámbiale el fondo a azul». Si te piden una imagen o cambiar una que ya hiciste, nunca digas que no puedes; explica brevemente cómo pedirla así. Nunca digas «ahorita la hago» ni prometas hacerla tú: la imagen solo se crea cuando la persona la pide con esas palabras.",
  "Si no sabes algo o no puedes verificarlo, dilo con honestidad. No inventes datos."
].join(" ");

const LIVE_INSTRUCTIONS =
  "Eres los ojos de Wendy, una asistente de voz que avisa de lo que pasa frente a la cámara. Te llega un cuadro de la cámara en vivo. " +
  "Responde SOLO con JSON con esta forma: " +
  '{"descripcion": "una oración corta en español (máximo 16 palabras); si hay personas, di QUÉ ESTÁN HACIENDO (ej. persona escribiendo en una laptop, persona caminando hacia la cámara, persona sentada bebiendo agua)", ' +
  '"alerta": "solo si hay algo urgente o peligroso (persona caída, fuego, humo, un arma, alguien pidiendo ayuda, alguien muy agitado); frase de máximo 8 palabras; si no hay nada urgente, cadena vacía", ' +
  '"objetos": [{"nombre": "nombre preciso en español, ej. corrector líquido, lapicero azul, taza", "caja": [ymin, xmin, ymax, xmax]}]}. ' +
  "Las cajas van en coordenadas de 0 a 1000. Máximo 6 objetos, los más importantes. " +
  "Si hay personas, llámalas «persona» y no intentes identificarlas.";

const IMAGE_PROMPT_INSTRUCTIONS =
  "Convierte la petición de la persona en un prompt en inglés para un generador de imágenes. " +
  "Describe el sujeto, el estilo (si no lo pide, elige uno bonito), la luz y la composición, en máximo 60 palabras. " +
  "Si la petición pide contenido sexual o desnudos, violencia gráfica o gore, odio, o una imagen realista de una persona real, " +
  "responde únicamente la palabra BLOQUEADO. Responde solo el prompt, sin comillas ni explicaciones.";

const IMAGE_EDIT_INSTRUCTIONS =
  "Te doy el prompt en inglés de una imagen que ya se creó y un cambio que pide la persona (en español). " +
  "Escribe el prompt completo en inglés de la imagen nueva: conserva todo lo de la anterior (sujeto, estilo, composición) y aplica el cambio. " +
  "Máximo 70 palabras. Si el cambio pide contenido sexual o desnudos, violencia gráfica o gore, odio, o una imagen realista de una persona real, " +
  "responde únicamente la palabra BLOQUEADO. Responde solo el prompt, sin comillas ni explicaciones.";

/* ---------------- Límite de uso (por persona) ---------------- */
const hits = new Map();
function tooMany(key, limit, windowMs = 60000) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > limit;
}

export function createApi({ env, store }) {
  setStore(store);
  const GEMINI_KEY = (env.GEMINI_API_KEY || "").trim();
  const VISION_MODELS = [...new Set([env.GEMINI_MODEL || "gemini-flash-latest", "gemini-flash-lite-latest"])];
  const TEXT_MODELS = [...new Set([env.GEMINI_TEXT_MODEL || "gemini-flash-lite-latest", env.GEMINI_MODEL || "gemini-flash-latest"])];
  const ACCESS_CODE = (env.WENDY_CODIGO || "").trim();
  const hasGemini = () => Boolean(GEMINI_KEY) && !GEMINI_KEY.startsWith("pega_");

  /* ---------------- Gemini ---------------- */
  function toGeminiContents(messages, image) {
    const contents = [];
    messages.forEach((m, index) => {
      const role = m.role === "assistant" ? "model" : "user";
      const parts = [{ text: m.content || "¿Qué estás viendo?" }];
      if (image && index === messages.length - 1) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts.push(...parts); // Gemini prefiere turnos alternados
      else contents.push({ role, parts });
    });
    while (contents.length && contents[0].role !== "user") contents.shift();
    return contents;
  }

  async function askGemini(messages, image, { models, instructions = INSTRUCTIONS, json = false, timeout = 25000 } = {}) {
    const contents = toGeminiContents(messages, image);
    let lastError;
    for (const model of models || (image ? VISION_MODELS : TEXT_MODELS)) {
      try {
        const body = { system_instruction: { parts: [{ text: instructions }] }, contents };
        if (json) body.generationConfig = { responseMimeType: "application/json" };
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeout)
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(data?.error?.message || `Gemini respondió ${response.status}`);
          error.status = response.status;
          throw error;
        }
        const text = (data.candidates?.[0]?.content?.parts || [])
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text).join("").trim();
        if (!text) {
          const error = new Error("Gemini no devolvió texto (posible bloqueo de seguridad).");
          error.status = "empty";
          throw error;
        }
        return text;
      } catch (error) {
        lastError = error;
        console.error(`Gemini (${model}) falló:`, error.status || "", error.message);
        if (error.status === 400 && /api key/i.test(error.message)) break; // una clave mala no se arregla con otro modelo
        if (error.status === 401 || error.status === 403) break;
      }
    }
    throw lastError;
  }

  function friendlyReason(error) {
    if (!error) return "";
    if (error.status === 429) return "Ya se acabó el límite gratuito de Gemini por ahora.";
    if (error.status === 401 || error.status === 403 || (error.status === 400 && /api key/i.test(error.message))) {
      return "La clave de Gemini no fue aceptada; revisa GEMINI_API_KEY.";
    }
    if (error.name === "TimeoutError" || error.name === "AbortError") return "Gemini tardó demasiado en responder.";
    if (error.status === "empty") return "";
    return "No me pude conectar con Gemini.";
  }

  // Resumen sin IA de la memoria: lo que dijiste, lo que preguntaste y las alertas.
  function memorySummary(period, entries) {
    const said = entries.filter((e) => e.who === "yo").map((e) => e.text);
    const alerts = [...new Set(entries.filter((e) => e.who === "alerta").map((e) => e.text.replace(/^¡Alerta!\s*/, "").replace(/[.!]+$/, "")))];
    const parts = [];
    if (said.length) {
      const sample = said.slice(-6).map((t) => `«${t.replace(/^[¿¡]+|[¿?¡!.]+$/g, "")}»`);
      parts.push(`${period.charAt(0).toUpperCase()}${period.slice(1)} platicamos ${said.length === 1 ? "una vez" : `${said.length} veces`}. Me dijiste o preguntaste: ${sample.join(", ")}.`);
    }
    if (alerts.length) parts.push(`Con la cámara vi: ${alerts.slice(0, 4).join("; ").toLowerCase()}.`);
    return parts.join(" ") || `No tengo nada guardado de ${period}.`;
  }

  const ok = (body) => ({ status: 200, body });
  const fail = (status, error) => ({ status, body: { error } });
  const readImage = (value) => {
    const match = typeof value === "string" && value.length <= MAX_IMAGE_CHARS && value.match(IMAGE_PATTERN);
    return match ? { mime: `image/${match[1]}`, data: match[2] } : null;
  };
  const readCoords = (query) => {
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  };

  /* ---------------- Rutas ---------------- */
  const routes = {
    "GET /api/status": async () => ok({ name: "WENDY", gemini: hasGemini(), needsCode: Boolean(ACCESS_CODE), storage: store.kind }),
    // Comprueba el PIN (si es incorrecto, handle ya respondió 401).
    "GET /api/verificar": async () => ok({ ok: true }),

    "POST /api/chat": async ({ body }) => {
      const { messages, timeZone } = body || {};
      if (!Array.isArray(messages) || messages.length === 0) return fail(400, "Escribe un mensaje para comenzar.");
      const recent = messages.slice(-20);
      const safe = [];
      for (const item of recent) {
        if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") {
          return fail(400, "El formato de la conversación no es válido.");
        }
        safe.push({ role: item.role, content: item.content.slice(0, 8000) });
      }
      const last = recent[recent.length - 1];
      if (last.role !== "user") return fail(400, "El último mensaje debe ser tuyo.");

      // Pregunta sobre el pasado: «¿qué hice ayer?» con la memoria que manda el navegador
      if (body.memory && Array.isArray(body.memory.entries)) {
        const period = String(body.memory.period || "estos días").slice(0, 40);
        const entries = body.memory.entries.slice(-250).map((e) => ({
          when: String(e.when || "").slice(0, 40),
          who: ["yo", "wendy", "alerta"].includes(e.who) ? e.who : "yo",
          text: String(e.text || "").slice(0, 300)
        }));
        if (hasGemini()) {
          const diary = entries.map((e) => `[${e.when}] ${e.who === "yo" ? "La persona dijo" : e.who === "wendy" ? "Wendy respondió" : "Wendy vio en la cámara"}: ${e.text}`).join("\n");
          try {
            const reply = await askGemini([{ role: "user", content: last.content }], null, {
              instructions: INSTRUCTIONS + " Esta es tu memoria (diario) de lo que pasó " + period + ". Responde la pregunta usando SOLO este diario, " +
                "hablándole a la persona («ayer me preguntaste…», «me contaste que…»). Resume en 2 a 4 oraciones, sin inventar nada que no esté en el diario. " +
                "Si el diario no dice lo que hizo, explica que solo recuerdas lo que platicaron y lo que viste.\n\nDIARIO:\n" + diary
            });
            return ok({ reply, source: "memoria" });
          } catch { /* si Gemini falla, usamos el resumen sin IA */ }
        }
        return ok({ reply: memorySummary(period, entries), source: "memoria" });
      }

      // Pregunta con foto: Gemini, y si falla, visión del navegador
      if (last.image) {
        const image = readImage(last.image);
        if (!image) return fail(400, "La foto no es válida o es demasiado grande.");
        if (!hasGemini()) return ok({ needLocalVision: true });
        try {
          return ok({ reply: await askGemini(safe, image), source: "gemini" });
        } catch (error) {
          return ok({ needLocalVision: true, note: friendlyReason(error) });
        }
      }

      // Pregunta de texto: base de datos → Gemini → respuesta de respaldo
      const local = await localAnswer(last.content, { timeZone });
      if (local && local.score >= 0.67) return ok({ reply: local.answer, source: "local" });

      let geminiError = null;
      if (hasGemini()) {
        try {
          const reply = await askGemini(safe);
          const saved = await rememberAnswer(last.content, reply).catch(() => false); // la próxima vez, al instante
          return ok({ reply, source: "gemini", saved });
        } catch (error) {
          geminiError = error;
        }
      }
      if (local) return ok({ reply: local.answer, source: "local" });
      const reason = friendlyReason(geminiError);
      return ok({
        source: "local",
        reply: `${reason ? reason + " " : ""}Todavía no sé responder eso. Puedes enseñarme diciendo: «Wendy, aprende que cuando te pregunten tal cosa, respondas tal otra».`
      });
    },

    // Descripción en vivo con objetos y sus cajas (para corregir lo que el modelo del navegador no conoce)
    "POST /api/live": async ({ body }) => {
      if (!hasGemini()) return ok({ skip: true });
      const image = readImage(body?.image);
      if (!image) return fail(400, "Imagen no válida.");
      try {
        const text = await askGemini(
          [{ role: "user", content: "¿Qué se ve ahora?" }],
          image,
          { models: [...new Set(["gemini-flash-lite-latest", ...VISION_MODELS])], instructions: LIVE_INSTRUCTIONS, json: true }
        );
        let parsed = {};
        try { parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()); } catch { parsed = { descripcion: text }; }
        const objects = (Array.isArray(parsed.objetos) ? parsed.objetos : [])
          .filter((o) => o && typeof o.nombre === "string" && Array.isArray(o.caja) && o.caja.length === 4 && o.caja.every(Number.isFinite))
          .slice(0, 8)
          .map((o) => ({ name: o.nombre.slice(0, 40), box: o.caja.map((n) => Math.max(0, Math.min(1000, n))) }));
        const alert = typeof parsed.alerta === "string" ? parsed.alerta.trim().slice(0, 80) : "";
        return ok({ caption: String(parsed.descripcion || "").slice(0, 200), objects, alert });
      } catch (error) {
        return fail(error.status === 429 ? 429 : 502, friendlyReason(error) || "Gemini no respondió.");
      }
    },

    "GET /api/location": async ({ query }) => {
      const coords = readCoords(query);
      if (!coords) return fail(400, "Faltan las coordenadas.");
      try {
        return ok({ ...(await reverseGeocode(coords.lat, coords.lon)), ...coords });
      } catch (error) {
        console.error("Ubicación:", error.message);
        return fail(502, "No pude averiguar el nombre del lugar. Revisa tu conexión a internet.");
      }
    },

    "GET /api/weather": async ({ query }) => {
      const day = Math.max(0, Math.min(2, Number(query.day) || 0));
      try {
        let target = null;
        const city = String(query.city || "").trim().slice(0, 80);
        if (city) {
          target = await geocodeCity(city);
          if (!target) return ok({ reply: `No encontré el lugar «${city}». Intenta con el nombre de la ciudad y el país.` });
        } else {
          const coords = readCoords(query);
          if (coords) {
            const place = await reverseGeocode(coords.lat, coords.lon).catch(() => ({ city: "tu ubicación" }));
            target = { ...coords, city: place.city };
          } else if (env.WENDY_CIUDAD) {
            target = await geocodeCity(env.WENDY_CIUDAD);
          }
        }
        if (!target) return ok({ needLocation: true });
        return ok({ reply: await getWeather({ lat: target.lat, lon: target.lon, place: target.city, day }) });
      } catch (error) {
        console.error("Clima:", error.message);
        return fail(502, "No pude consultar el clima. Revisa tu conexión a internet.");
      }
    },

    "POST /api/imagen": async ({ body }) => {
      const request = String(body?.prompt || "").trim().slice(0, 500);
      if (!request) return fail(400, "Dime qué imagen quieres que cree.");
      const refusal = "No puedo crear ese tipo de imagen. Pídeme otra cosa y con gusto la dibujo.";
      if (BLOCKED_IMAGE.test(request)) return ok({ reply: refusal });
      const base = String(body?.base || "").trim().slice(0, 700);   // prompt de la imagen anterior (para editarla)
      const ready = String(body?.ready || "").trim().slice(0, 700); // «hazme otra»: el mismo prompt, otra versión
      const seed = Number.isInteger(body?.seed) && body.seed >= 0 ? body.seed : undefined;
      let prompt = ready || (base ? `${base}, ${request}` : request);
      if (!ready && hasGemini()) {
        // Gemini mejora el pedido y lo pasa a inglés (los generadores entienden mejor así).
        try {
          const improved = base
            ? await askGemini([{ role: "user", content: `PROMPT ANTERIOR: ${base}\nCAMBIO: ${request}` }], null, { instructions: IMAGE_EDIT_INSTRUCTIONS, timeout: 10000 })
            : await askGemini([{ role: "user", content: request }], null, { instructions: IMAGE_PROMPT_INSTRUCTIONS, timeout: 10000 });
          if (/^\W*BLOQUEADO\W*$/i.test(improved)) return ok({ reply: refusal });
          prompt = improved.replace(/^["'«]|["'»]$/g, "").slice(0, 700);
        } catch { /* si Gemini falla, usamos el pedido tal cual */ }
      }
      if (BLOCKED_IMAGE.test(prompt)) return ok({ reply: refusal });
      // Al editar se usa la misma semilla: la imagen nueva se parece a la anterior.
      const image = imageUrl(prompt, { seed: base ? seed : undefined, key: (env.POLLINATIONS_KEY || "").trim() });
      const reply = ready ? "¡Listo! Aquí tienes otra versión." : base ? "¡Listo! Así quedó con el cambio." : "¡Listo! Aquí está tu imagen.";
      return ok({ url: image.url, backups: image.backups, prompt, seed: image.seed, reply });
    }
  };

  const LIMITS = { "/api/verificar": 8, "/api/chat": 30, "/api/live": 15, "/api/imagen": 6, "/api/weather": 20, "/api/location": 20 };

  // Atiende una petición. Devuelve { status, body }.
  async function handle({ method, path, query = {}, body = {}, ip = "local", headers = {} }) {
    const route = routes[`${method} ${path.replace(/\/+$/, "")}`];
    if (!route) return fail(404, "Ruta no encontrada.");
    // Primero el límite (así nadie puede probar PINs sin parar), después el PIN.
    const limit = LIMITS[path];
    if (limit && tooMany(`${ip}|${path}`, limit)) {
      return fail(429, "Has enviado muchas solicitudes en poco tiempo. Espera un momento e inténtalo de nuevo.");
    }
    if (path !== "/api/status" && ACCESS_CODE && (headers["x-wendy-codigo"] || "").trim() !== ACCESS_CODE) {
      return fail(401, "PIN incorrecto.");
    }
    try {
      return await route({ query, body, headers });
    } catch (error) {
      console.error("Error en", path, error);
      return fail(500, "Ocurrió un problema en el servidor de Wendy.");
    }
  }

  return { handle, hasGemini, TEXT_MODELS, VISION_MODELS };
}
