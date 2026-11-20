// =========================================================
// Cerebro de Wendy (funciona sin IA)
// - Busca respuestas en la base de datos (archivo JSON o Supabase)
// - Sabe la hora, la fecha y hace cuentas
// - Aprende cosas nuevas y las guarda
// La base de datos se elige en stores.js; aquí solo se usa con setStore().
// =========================================================

// Palabras que no cambian el significado de la pregunta.
const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "y", "o", "a", "en",
  "me", "por", "favor", "porfa", "wendy", "oye", "dime", "puedes", "podrias", "sabes", "es", "que",
  "cual", "cuales", "como", "se", "lo", "le", "pues", "ok", "bueno", "ey"
]);

// store = { list(): Promise<temas[]>, add(tema): Promise<void> }
let store = { list: async () => [], add: async () => {} };
export function setStore(newStore) { store = newStore; }

export function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/([a-zñ])\1{2,}/g, "$1") // «holaaa» → «hola», «graciasss» → «gracias»
    .replace(/\s+/g, " ")
    .trim();
}
// ¿Dos palabras son casi iguales? (permite un error de dedo: «chsite» ≈ «chiste»)
function nearlySame(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length] <= 1 || (a.length >= 5 && prev[b.length] <= 2 && a.slice(0, 2) === b.slice(0, 2) && a.length === b.length);
}
function contentWords(text) {
  return new Set(normalize(text).split(" ").filter((w) => w && !STOPWORDS.has(w)));
}
function similarity(a, b) {
  const na = normalize(a).replace(/^wendy\s+/, "");
  const nb = normalize(b);
  if (na === nb) return 1;
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w) || [...wb].some((x) => nearlySame(w, x))) shared++;
  shared = Math.min(shared, wa.size, wb.size);
  return shared / (wa.size + wb.size - shared); // índice de Jaccard
}

/* ---------- Hora, fecha y plantillas ---------- */
// La hora se calcula en la zona horaria de quien pregunta (en Netlify el servidor está en otra zona).
function validZone(timeZone) {
  try { new Intl.DateTimeFormat("es", { timeZone }); return timeZone; } catch { return "America/Guatemala"; }
}
function timeText(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour").value) % 24;
  const m = parts.find((p) => p.type === "minute").value;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const part = h < 12 ? "de la mañana" : h < 19 ? "de la tarde" : "de la noche";
  return `${h12}:${m} ${part}`;
}
function fillTemplate(text, timeZone = "America/Guatemala") {
  const zone = validZone(timeZone);
  const now = new Date();
  return text
    .replaceAll("{hora}", timeText(now, zone))
    .replaceAll("{fecha}", now.toLocaleDateString("es-GT", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }))
    .replaceAll("{dia}", now.toLocaleDateString("es-GT", { timeZone: zone, weekday: "long" }));
}
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/* ---------- Calculadora ---------- */
function formatNumber(n) {
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n * 10000) / 10000).replace(".", ",");
}
function tryMath(text) {
  const t = String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/×/g, " x ").replace(/÷/g, " / ");
  const num = "(-?\\d+(?:[.,]\\d+)?)";
  const toNum = (s) => Number(s.replace(",", "."));

  const percent = t.match(new RegExp(`${num}\\s*(?:%|por ciento)\\s*de\\s*${num}`));
  if (percent) {
    const r = formatNumber((toNum(percent[1]) / 100) * toNum(percent[2]));
    return r && `El ${percent[1]} por ciento de ${percent[2]} es ${r}.`;
  }
  const root = t.match(new RegExp(`raiz cuadrada de\\s*${num}`));
  if (root) {
    const r = formatNumber(Math.sqrt(toNum(root[1])));
    return r && `La raíz cuadrada de ${root[1]} es ${r}.`;
  }
  const op = t.match(new RegExp(`${num}\\s*(\\+|mas|-|menos|\\*|x|por|multiplicado por|\\/|entre|dividido entre|dividido por|dividido)\\s*${num}`));
  const looksLikeMath = /cuanto (es|da|son)|calcula|resultado|suma|resta|multiplica|divide/.test(t) ||
    (op && t.replace(op[0], "").replace(/[^a-z0-9]/g, "").length <= 3);
  if (!op || !looksLikeMath) return null;
  const a = toNum(op[1]);
  const b = toNum(op[3]);
  const sign = op[2];
  let result;
  if (["+", "mas"].includes(sign)) result = a + b;
  else if (["-", "menos"].includes(sign)) result = a - b;
  else if (["*", "x", "por", "multiplicado por"].includes(sign)) result = a * b;
  else {
    if (b === 0) return "No se puede dividir entre cero.";
    result = a / b;
  }
  const r = formatNumber(result);
  return r && `${op[1]} ${sign === "+" ? "más" : sign === "-" ? "menos" : sign === "*" || sign === "x" ? "por" : sign === "/" ? "entre" : sign} ${op[3]} es ${r}.`;
}

/* ---------- Aprender cosas nuevas ---------- */
function swapPronouns(text) {
  const map = { mi: "tu", mis: "tus", me: "te", yo: "tú", conmigo: "contigo", mio: "tuyo", mia: "tuya" };
  return text.split(" ").map((w) => map[w.toLowerCase()] ?? w).join(" ");
}
function cleanPiece(text) {
  return text.trim().replace(/^[¿¡"«]+|[?!".,»]+$/g, "").trim();
}
async function tryLearn(text) {
  const t = text.trim();
  // «aprende que cuando te pregunte X respondas Y»
  let m = t.match(/^(?:wendy[,\s]*)?aprende(?:te)?\s+(?:que\s+)?(?:cuando|si)\s+(?:alguien\s+)?(?:te\s+)?(?:pregunte|preguntan|pregunten|diga|digan|digo|pregunto)\s+(.+?)\s*,?\s+(?:respondas|responde|respondes|contestes|contesta|digas|di|dices)\s+(?:que\s+)?(.+)$/i);
  if (m) {
    const question = cleanPiece(m[1]);
    let answer = cleanPiece(m[2]);
    if (!question || !answer) return null;
    answer = `${answer.charAt(0).toUpperCase()}${answer.slice(1)}${/[.!?]$/.test(answer) ? "" : "."}`;
    await addTopic([question], answer);
    return `¡Listo, lo aprendí! Cuando me pregunten «${question}», responderé: ${answer}`;
  }
  // «aprende que mi color favorito es el morado»
  m = t.match(/^(?:wendy[,\s]*)?aprende(?:te)?\s+que\s+(.+?)\s+(es|son|se llama|se llaman)\s+(.+)$/i);
  if (m) {
    const subject = cleanPiece(m[1]);
    const value = cleanPiece(m[3]);
    if (!subject || !value) return null;
    const answerSubject = swapPronouns(subject);
    const answer = `${answerSubject.charAt(0).toUpperCase()}${answerSubject.slice(1)} ${m[2]} ${value}.`;
    await addTopic([`cual es ${subject}`, `quien es ${subject}`, `que es ${subject}`, `como se llama ${subject}`, subject], answer);
    return `¡Listo, lo aprendí! ${answer}`;
  }
  return null;
}
async function addTopic(questions, answer, origin = "voz") {
  const normalized = questions.map(normalize).filter(Boolean);
  await store.add({ preguntas: normalized, respuestas: [answer], aprendido: true, origen: origin });
}

/* ---------- Guardar respuestas de Gemini ---------- */
// Preguntas cuya respuesta cambia con el tiempo o depende de la conversación: no se guardan.
const NO_GUARDAR = /\b(hoy|ahora|ahorita|actual|actualmente|ultim[oa]s?|reciente|recientemente|noticias?|clima|temperatura|llover|lluvia|precio|cuesta|cuestan|vale|valen|dolar|tipo de cambio|manana|ayer|semana|este ano|este mes|hora|horas|fecha|partido|resultado|gano|ganador|elecciones?|presidente|alcalde|ministro|mi|mis|me|yo|conmigo|eso|esto|esa|ese|esas|esos|su|sus|anterior|tambien|otra vez|otro|otra|mas)\b/;

export async function rememberAnswer(question, answer) {
  const q = normalize(question).replace(/^(wendy|ey wendy|hey wendy|oye wendy)\s+/, "");
  const words = q.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 20) return false;
  if (/^(y|pero|entonces|ah|ok)\b/.test(q) || /\b[eé]l\b|\bella\b|\bellos\b|\bellas\b/.test(String(question).toLowerCase())) return false;
  if (NO_GUARDAR.test(q) || /\d/.test(q)) return false;
  // Solo preguntas de verdad (no frases sueltas como «cualquier cosa»).
  const isQuestion = /^(que|quien|quienes|cual|cuales|como|cuando|donde|cuanto|cuanta|cuantos|cuantas|por que|para que|explica|explicame|define|dime|cuentame|hablame)\b/.test(q) ||
    /\b(que es|que son|quien fue|quien es|por que|para que sirve)\b/.test(q);
  if (!isQuestion || words.length < 3) return false;
  if (!answer || answer.length > 700) return false;
  // Si ya la sabemos con seguridad, no la duplicamos.
  const existing = await findTopic(question);
  if (existing && existing.score >= 0.67) return false;
  await addTopic([q], answer.trim(), "gemini");
  return true;
}

/* ---------- Buscar respuesta ---------- */
// Devuelve { answer, score } o null. score: 1 = seguro, 0.5 = dudoso.
async function findTopic(text) {
  let best = null;
  for (const topic of await store.list()) {
    for (const question of topic.preguntas || []) {
      const score = similarity(text, question);
      // En empate gana lo que tú le enseñaste.
      if (!best || score > best.score || (score === best.score && topic.aprendido && !best.topic.aprendido)) best = { topic, score };
    }
  }
  return best;
}

export async function localAnswer(text, { timeZone } = {}) {
  const learned = await tryLearn(text);
  if (learned) return { answer: learned, score: 1 };

  const math = tryMath(text);
  if (math) return { answer: math, score: 1 };

  const best = await findTopic(text);
  if (!best || best.score < 0.5) return null;
  // Una coincidencia dudosa no debe dar la hora/fecha (ej.: «¿qué hora es en Japón?»).
  if (best.score < 0.67 && (best.topic.respuestas || []).some((r) => r.includes("{"))) return null;
  return { answer: fillTemplate(pick(best.topic.respuestas || ["…"]), timeZone), score: best.score };
}
