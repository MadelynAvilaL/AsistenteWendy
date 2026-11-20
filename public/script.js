/* =========================================================
   WENDY — asistente de voz con cámara (tipo Alexa)
   - Habla (síntesis de voz del navegador)
   - Escucha (reconocimiento de voz: botón 🎤 o diciendo «Ey Wendy»)
   - Toma fotos con la cámara y describe lo que ve
   ========================================================= */
const $ = (selector) => document.querySelector(selector);
const messagesEl = $("#messages");
const welcome = $("#welcome");
const input = $("#messageInput");
const form = $("#chatForm");
const sendButton = $("#sendButton");
const micButton = $("#micButton");
const cameraButton = $("#cameraButton");
const cameraPanel = $("#cameraPanel");
const video = $("#cameraVideo");
const voiceBanner = $("#voiceBanner");
const voiceBannerText = $("#voiceBannerText");
const STORAGE_KEY = "wendy_conversations_v1";
const VOICE_KEY = "wendy_voice_on";

/* ---------------- Tipo de dispositivo ---------------- */
// En tablets y celulares el micrófono solo lo puede usar una cosa a la vez:
// ahí el anillo no abre el micrófono, para no quitárselo al reconocimiento de voz.
const IS_TOUCH_DEVICE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
let userVoiceUntil = 0; // hasta cuándo animar el anillo porque el reconocimiento oyó tu voz

/* ---------------- Conexión con el servidor ---------------- */
const CODE_KEY = "wendy_codigo";
let accessCode = localStorage.getItem(CODE_KEY) || "";
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Guatemala";
// Igual que fetch, pero agrega el código de acceso (si la Wendy publicada tiene uno).
async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (accessCode) headers["x-wendy-codigo"] = accessCode;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) askForCode();
  return response;
}
function askForCode() {
  $("#codeOverlay").hidden = false;
  setTimeout(() => $("#codeInput").focus(), 50);
}

/* ---------------- Estado del orbe ---------------- */
function updateOrbState() {
  const listening = typeof recMode !== "undefined" && (recMode === "push" || conversationActive);
  document.body.classList.toggle("wendy-listening", Boolean(listening) && !busy && !speaking);
  document.body.classList.toggle("wendy-thinking", busy);
  const text = busy ? "Pensando…"
    : speaking ? "Hablando…"
    : listening ? "Te escucho…"
    : (typeof wakeMode !== "undefined" && wakeMode) ? "Di «Ey Wendy» para hablarme."
    : "Toca el micrófono o escríbeme.";
  $("#orbState").textContent = text;
}

let conversations = loadConversations();
let activeId = conversations[0]?.id || null;
let busy = false;

/* ---------------- Conversación actual ---------------- */
// No se guarda historial: solo existe la conversación actual, y al recargar la página empieza en blanco.
function loadConversations() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* sin almacenamiento */ } // borra el historial de versiones anteriores
  return [];
}
function save() { /* a propósito no se guarda nada */ }
function makeId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function activeChat() { return conversations.find((chat) => chat.id === activeId); }
function titleFrom(text) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 28 ? clean.slice(0, 28) + "…" : clean || "Nueva conversación";
}
function renderHistory() {
  // Solo se muestra el título de la conversación actual (no hay lista de conversaciones).
  $("#currentTitle").textContent = activeChat()?.title || "Nueva conversación";
}
const SOURCE_LABELS = { local: "base de datos", gemini: "Gemini", camara: "visión sin IA", clima: "Open-Meteo", ubicacion: "OpenStreetMap", imagen: "imagen creada", memoria: "memoria" };
function addMessage(role, content, { temporary = false, image = null, source = null } = {}) {
  const row = document.createElement("article");
  row.className = `message ${role}`;
  const avatar = role === "assistant" ? "W" : "T";
  const name = role === "assistant"
    ? `Wendy${SOURCE_LABELS[source] ? ` <small class="source-tag">· ${SOURCE_LABELS[source]}</small>` : ""}`
    : "Tú";
  const actions = role === "assistant" && !temporary
    ? '<div class="message-actions"><button class="copy-button">▢ Copiar</button><button class="speak-button">🔊 Escuchar</button></div>'
    : "";
  row.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-body"><div class="message-name">${name}</div><div class="message-bubble"></div>${actions}</div>`;
  const bubble = row.querySelector(".message-bubble");
  const generated = typeof image === "string" && (source === "imagen" || image.startsWith("/imagenes/") || image.startsWith("https://image.pollinations.ai/"));
  if (generated) {
    // Imagen creada por Wendy: se carga directo del servicio de imágenes y se abre en grande al tocarla.
    const link = document.createElement("a");
    link.href = image; link.target = "_blank"; link.rel = "noopener"; link.className = "generated-link";
    const img = document.createElement("img");
    img.className = "generated-image loading";
    img.alt = content;
    img.src = image;
    img.addEventListener("load", () => { img.classList.remove("loading"); scrollToBottom(); }, { once: true });
    img.addEventListener("error", () => {
      img.classList.remove("loading");
      img.alt = "";
      img.replaceWith(Object.assign(document.createElement("div"), {
        className: "message-photo",
        textContent: "La imagen no cargó: el servicio gratuito está ocupado. Pídemela otra vez en un minuto."
      }));
    }, { once: true });
    link.appendChild(img);
    bubble.appendChild(link);
    const download = document.createElement("button");
    download.textContent = "⬇ Descargar";
    download.addEventListener("click", async () => {
      try {
        const blob = await (await fetch(image)).blob();
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `wendy-${Date.now()}.jpg` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch { window.open(image, "_blank", "noopener"); }
    });
    row.querySelector(".message-actions")?.appendChild(download);
  } else if (image) {
    const img = document.createElement("img");
    img.className = "message-photo";
    img.alt = "Foto tomada con la cámara";
    img.src = image;
    bubble.appendChild(img);
  }
  bubble.appendChild(document.createTextNode(content));
  row.querySelector(".copy-button")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(content); toast("Respuesta copiada."); }
    catch { toast("No se pudo copiar automáticamente."); }
  });
  row.querySelector(".speak-button")?.addEventListener("click", () => speak(content, { force: true }));
  messagesEl.appendChild(row);
  welcome.hidden = true;
  document.body.classList.add("has-chat");
  return row;
}
function render() {
  renderHistory();
  messagesEl.innerHTML = "";
  const chat = activeChat();
  $("#currentTitle").textContent = chat?.title || "Nuevo comienzo";
  welcome.hidden = Boolean(chat?.messages?.length);
  document.body.classList.toggle("has-chat", Boolean(chat?.messages?.length));
  if (chat) chat.messages.forEach((m) => addMessage(m.role, m.content, { image: m.image, source: m.source }));
  scrollToBottom();
}
function scrollToBottom() {
  const panel = $("#conversation");
  // Sin mensajes se queda arriba para que se vea el orbe completo.
  requestAnimationFrame(() => { panel.scrollTop = messagesEl.children.length ? panel.scrollHeight : 0; });
}
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 3200);
}
function createChat() {
  const chat = { id: makeId(), title: "Nueva conversación", messages: [], createdAt: Date.now() };
  conversations = [chat]; // la conversación anterior se descarta
  lastImage = null;
  activeId = chat.id;
  save(); render();
}
function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
  updateOrbState();
}
function showTyping(label = "Wendy está pensando") {
  const row = document.createElement("article");
  row.className = "message assistant";
  row.id = "typingIndicator";
  row.innerHTML = `<div class="message-avatar">W</div><div class="message-body"><div class="message-name">${label}</div><div class="message-bubble"><div class="typing"><i></i><i></i><i></i></div></div></div>`;
  messagesEl.appendChild(row); scrollToBottom();
}

/* ---------------- Enviar mensajes (texto y/o foto) ---------------- */
async function sendMessage(text, photo = null) {
  const content = (text || "").trim() || (photo ? "¿Qué estás viendo?" : "");
  if (!content) return;
  if (busy) { toast("Espera un momento, todavía estoy terminando lo anterior."); return; }
  if (!activeChat()) createChat();
  const chat = activeChat();
  const userMessage = { role: "user", content };
  remember("yo", photo ? `${content} (con una foto de la cámara)` : content);
  if (photo) userMessage.image = photo.thumb; // guardamos solo una miniatura en el historial
  chat.messages.push(userMessage);
  if (chat.messages.filter((m) => m.role === "user").length === 1) chat.title = titleFrom(content);
  save(); renderHistory();
  welcome.hidden = true;
  addMessage("user", content, { image: photo?.thumb });
  input.value = ""; resizeInput();
  setBusy(true); pauseWake();
  showTyping(photo ? "Wendy está mirando la foto" : "Wendy está pensando");

  try {
    const payload = chat.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    if (photo) payload[payload.length - 1].image = photo.full; // la foto completa solo viaja en este envío
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: payload, timeZone: TIME_ZONE })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo conectar con Wendy.");

    let reply = data.reply;
    let source = data.source || "local";
    if (data.needLocalVision && photo) {
      // Sin Gemini: reconocemos objetos aquí mismo, en el navegador.
      $("#typingIndicator .message-name").textContent = "Wendy está reconociendo objetos";
      try {
        reply = await window.WendyVision.describeLocally(photo.full);
        if (/l[eé]e|texto|dice/i.test(content)) reply += " Sin Gemini no puedo leer textos, solo reconocer objetos.";
      } catch (visionError) {
        console.error(visionError);
        reply = "No pude cargar el reconocimiento de objetos. Revisa tu conexión a internet la primera vez que lo uses.";
      }
      if (data.note) reply = `${data.note} ${reply}`;
      source = "camara";
    }

    chat.messages.push({ role: "assistant", content: reply, source });
    remember("wendy", reply);
    save();
    $("#typingIndicator")?.remove();
    addMessage("assistant", reply, { source });
    data.reply = reply;
    scrollToBottom();
    setBusy(false);
    await speak(data.reply);
  } catch (error) {
    $("#typingIndicator")?.remove();
    addMessage("assistant", `No pude responder: ${error.message}`, { temporary: true });
    setBusy(false);
    await speak(error.message);
  } finally {
    setBusy(false); renderHistory(); scrollToBottom();
    resumeWake();
  }
}
function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
}

/* ---------------- Voz de Wendy (hablar) ---------------- */
const LANG = (navigator.language || "").toLowerCase().startsWith("es") ? navigator.language : "es-ES";
const RATE_KEY = "wendy_rate";
const VOLUME_KEY = "wendy_volume";
const WAKE_KEY = "wendy_wake";
let voiceOn = localStorage.getItem(VOICE_KEY) !== "off";
let speechRate = Number(localStorage.getItem(RATE_KEY)) || 1;
let speechVolume = Number(localStorage.getItem(VOLUME_KEY) ?? 1);
if (!Number.isFinite(speechVolume)) speechVolume = 1;
let speaking = false;
let chosenVoice = null;
let pendingSpeech = null; // lo que no se pudo decir porque el navegador bloqueó el audio

function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("es"));
  if (!voices.length) return;
  const preferred = ["paloma", "dalia", "sabina", "helena", "elvira", "laura", "monica", "mónica", "paulina", "google español"];
  chosenVoice =
    voices.find((v) => v.lang.toLowerCase() === LANG.toLowerCase() && preferred.some((p) => v.name.toLowerCase().includes(p))) ||
    voices.find((v) => preferred.some((p) => v.name.toLowerCase().includes(p))) ||
    voices.find((v) => v.lang.toLowerCase() === LANG.toLowerCase()) ||
    voices[0];
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

function cleanForSpeech(text) {
  return text
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "el enlace")
    .replace(/[*_#`>|~]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .trim();
}
function splitIntoChunks(text) {
  // Chrome corta frases muy largas, así que hablamos por partes.
  const sentences = text.match(/[^.!?\n]+[.!?]*/g) || [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).length > 200 && current) { chunks.push(current.trim()); current = ""; }
    current += " " + sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
// listen: true → Wendy sigue escuchando «Ey Wendy» mientras habla (narración y alertas, que son frases cortas).
let speechId = 0;              // cada frase nueva tiene su número: así una frase cortada no apaga a la siguiente
let speakingListen = false;    // lo que se dice ahora deja el micrófono abierto
let spokenText = "";           // lo que Wendy está diciendo (para no confundir su propia voz con una orden)
let echoUntil = 0;             // hasta cuándo se descarta lo que suene igual a lo que dijo Wendy
function speak(text, { force = false, rate = null, listen = false } = {}) {
  return new Promise((resolve) => {
    if ((!voiceOn && !force) || !("speechSynthesis" in window) || !text) return resolve();
    const chunks = splitIntoChunks(cleanForSpeech(text));
    if (!chunks.length) return resolve();
    const id = ++speechId;
    speechSynthesis.cancel();
    speaking = true;
    speakingListen = listen;
    spokenText = norm(text);
    echoUntil = Infinity;
    document.body.classList.add("wendy-speaking");
    updateOrbState();
    // El micrófono se pausa cuando la voz de verdad empieza: si el navegador no deja hablar
    // (al abrir la página, antes de tocarla), Wendy sigue escuchando «Ey Wendy».
    if (listen) resumeWake();
    let started = false;
    let finished = false;
    let safety = null;
    const onStart = () => {
      if (started) return;
      started = true;
      if (!listen && id === speechId) pauseWake();
    };
    const startCheck = setTimeout(() => {
      if (started || finished) return;
      // La voz nunca empezó (Chrome no deja hablar hasta el primer toque): se muestra el aviso
      // y Wendy sigue escuchando en vez de quedarse trabada en «Hablando…».
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) { pendingSpeech = text; showUnlock(); }
      speechSynthesis.cancel();
      done();
    }, 3000);
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safety);
      clearTimeout(startCheck);
      if (id === speechId) {
        // Solo la frase más reciente cambia el estado (las cortadas por otra no cuentan).
        speaking = false;
        speakingListen = false;
        echoUntil = Date.now() + 3000; // el eco de su voz puede llegar un poco después
        document.body.classList.remove("wendy-speaking");
        updateOrbState();
        setTimeout(resumeWake, 300); // una pausa corta para no oír el final de su propia voz
      }
      resolve();
    };
    // Por si el navegador nunca avisa que terminó.
    safety = setTimeout(done, 8000 + text.length * 80);
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = chosenVoice?.lang || LANG;
      if (chosenVoice) utterance.voice = chosenVoice;
      utterance.rate = rate || speechRate;
      utterance.volume = speechVolume;
      utterance.pitch = 1.05;
      utterance.onstart = onStart;
      utterance.onerror = (event) => {
        // Chrome no deja hablar hasta que la persona toque la página una vez.
        if (event.error === "not-allowed") { pendingSpeech = text; showUnlock(); }
        if (index === chunks.length - 1 || event.error === "not-allowed" || event.error === "interrupted" || event.error === "canceled") done();
      };
      if (index === chunks.length - 1) utterance.onend = done;
      speechSynthesis.speak(utterance);
    });
  });
}
function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
function updateVoiceToggle() {
  const btn = $("#voiceToggle");
  btn.classList.toggle("on", voiceOn);
  btn.setAttribute("aria-pressed", String(voiceOn));
  btn.innerHTML = voiceOn ? '🔊 <span class="chip-text">Voz</span>' : '🔇 <span class="chip-text">Silencio</span>';
}

/* ---- Desbloquear el audio (Chrome exige un toque la primera vez) ---- */
const unlockOverlay = $("#unlockOverlay");
function showUnlock() { unlockOverlay.hidden = false; }
function unlockAudio() {
  unlockOverlay.hidden = true;
  const toSay = pendingSpeech;
  pendingSpeech = null;
  if (wakePref() && !wakeMode) setWake(true, { quiet: true });
  speak(toSay || "¡Hola! Ya estoy lista. Di «Ey Wendy» cuando me necesites.");
}
unlockOverlay.addEventListener("click", unlockAudio);

/* ---------------- Escuchar (reconocimiento de voz) ---------------- */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const CONVERSATION_MS = 20000; // tiempo que Wendy sigue escuchando sin que digas «Wendy»
let recognition = null;
let recMode = null;              // "push" (botón 🎤) o "wake" (escucha continua)
let wakeMode = false;
let conversationActive = false;  // dijiste «Ey Wendy»: puedes seguir hablando sin repetir su nombre
let conversationTimer = null;
const WAKE_WORD = /\b(wendy|wendi|wendie|wendys|g[uü]endy|g[uü]endi|uendy|bendy|wenddy|windy|gwendy)\b[\s,.!?¡¿]*/i;
let recCount = 0;
let interimTimer = null;
let handledResult = "";
// ¿Es la propia voz de Wendy que el micrófono volvió a oír?
function isEcho(text) {
  if (!spokenText || Date.now() > echoUntil) return false;
  const words = norm(text).split(" ").filter((w) => w.length > 2 && !/^(wendy|wendi)$/.test(w));
  if (!words.length) return false;
  const said = new Set(spokenText.split(" "));
  return words.filter((w) => said.has(w)).length / words.length >= 0.6;
}
// Órdenes cortas y claras que se pueden atender en cuanto se reconocen.
function quickCommand(text) {
  const n = norm(text.replace(WAKE_WORD, " "));
  return CMD.liveStart.test(n) || CMD.liveStop.test(n) || CMD.narrate.test(n) ||
    CMD.openCamera.test(n) || CMD.closeCamera.test(n) || CMD.farewell.test(n) || CMD.stopListening.test(n);
}
const FILLER_ONLY = /^(ey|hey|ei|oye|ok|okey|okay|hola|alo|al[oó]|buenas)?[\s,.!?¡¿]*$/i;

function wakePref() { return localStorage.getItem(WAKE_KEY) !== "off"; }
function showBanner(text) {
  voiceBanner.hidden = false;
  voiceBannerText.textContent = text;
}
function hideBanner() { voiceBanner.hidden = true; }
function updateMicUI() {
  micButton.classList.toggle("listening", recMode === "push");
  updateOrbState();
  voiceBanner.classList.toggle("active", conversationActive);
  if (recMode === "push") showBanner("Te escucho… habla ahora");
  else if (recMode === "wake") {
    // Esperando «Ey Wendy»: el texto ya aparece debajo del orbe.
    if (conversationActive) showBanner("Te escucho… (di «con esto terminamos» para terminar)");
    else hideBanner();
  } else hideBanner();
}
function startConversationTimer() {
  clearTimeout(conversationTimer);
  if (!conversationActive) return;
  conversationTimer = setTimeout(() => {
    conversationActive = false;
    updateMicUI();
  }, CONVERSATION_MS);
}

function startRecognition(mode) {
  if (!SpeechRec) {
    toast("Tu navegador no reconoce voz. Usa Google Chrome o Microsoft Edge.");
    return false;
  }
  stopRecognition();
  const rec = new SpeechRec();
  rec.lang = LANG;
  rec.interimResults = true;
  rec.continuous = mode === "wake";
  rec.maxAlternatives = 1;
  recognition = rec;
  recMode = mode;
  rec.__n = ++recCount;
  clearTimeout(interimTimer);

  rec.__at = Date.now();
  rec.onstart = () => { rec.__started = true; };
  rec.onspeechstart = () => { userVoiceUntil = Date.now() + 1500; };
  rec.onsoundstart = () => { userVoiceUntil = Math.max(userVoiceUntil, Date.now() + 600); };
  rec.onresult = (event) => {
    userVoiceUntil = Date.now() + 900;
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += transcript; else interim += transcript;
    }
    if (mode === "push") {
      input.value = final || interim; resizeInput();
      if (final.trim()) { stopRecognition(); handleCommand(final); }
    } else {
      if (conversationActive) clearTimeout(conversationTimer); // estás hablando: no cortar la conversación
      const last = event.results.length - 1;
      if (interim && (conversationActive || WAKE_WORD.test(interim)) && !isEcho(interim)) showBanner(`«${interim.trim()}»`);
      if (final.trim()) {
        clearTimeout(interimTimer);
        if (handledResult === `${rec.__n}:${last}`) { handledResult = ""; return; } // ya se atendió con el texto provisional
        handleWakeSpeech(final);
        return;
      }
      // Rapidez: Chrome tarda en dar el texto «final». Si dijiste «Wendy …» y te quedas callada
      // un momento, atendemos el texto provisional sin esperar.
      clearTimeout(interimTimer);
      const text = interim.trim();
      if (text && (WAKE_WORD.test(text) || conversationActive)) {
        const wait = !WAKE_WORD.test(text) ? 1200 : quickCommand(text) ? 450 : 1000;
        interimTimer = setTimeout(() => {
          if (recognition !== rec) return;
          handledResult = `${rec.__n}:${last}`;
          handleWakeSpeech(text);
        }, wait);
      }
    }
  };
  rec.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      toast("Permite el uso del micrófono en el navegador (ícono del candado junto a la dirección).");
      setWake(false, { quiet: true, keepPref: true });
    } else if (event.error === "network") {
      const msg = navigator.brave
        ? "Brave bloquea el reconocimiento de voz. Abre Wendy en Google Chrome o Microsoft Edge para hablarle."
        : "El servicio de reconocimiento de voz no respondió. Usa Google Chrome o Microsoft Edge y revisa tu conexión.";
      toast(msg);
      setWake(false, { quiet: true, keepPref: true }); // evita reintentar sin parar
      speak(msg);
    } else if (event.error === "no-speech" && mode === "push") {
      toast("No te escuché. Toca 🎤 e inténtalo de nuevo.");
    } else if (event.error === "audio-capture") {
      toast("No se encontró un micrófono.");
      setWake(false, { quiet: true, keepPref: true });
    }
  };
  rec.onend = () => {
    if (recognition === rec) { recognition = null; recMode = null; }
    updateMicUI();
    setTimeout(resumeWake, 350); // en modo «Ey Wendy» volvemos a escuchar solos
  };
  try { rec.start(); } catch { /* ya estaba iniciado */ }
  updateMicUI();
  return true;
}
function stopRecognition() {
  if (recognition) {
    const rec = recognition;
    recognition = null;
    recMode = null;
    try { rec.abort(); } catch { /* nada */ }
  }
  updateMicUI();
}
// Vigilante: si el micrófono de «Ey Wendy» se quedó apagado o trabado, lo vuelve a encender solo.
setInterval(() => {
  if (!wakeMode || busy || (speaking && !speakingListen) || recMode === "push") return;
  if (!recognition) { resumeWake(); return; }
  if (recMode === "wake" && !recognition.__started && Date.now() - recognition.__at > 4000) {
    console.warn("El reconocimiento de voz no arrancó; lo reinicio.");
    stopRecognition();
    setTimeout(resumeWake, 300);
  }
}, 3000);
function pauseWake() {
  if (recMode === "wake") stopRecognition();
}
function resumeWake() {
  if (wakeMode && !recognition && (!speaking || speakingListen) && !busy) {
    startRecognition("wake");
    startConversationTimer();
  }
}
function setWake(on, { quiet = false, keepPref = false } = {}) {
  wakeMode = on;
  if (!keepPref) localStorage.setItem(WAKE_KEY, on ? "on" : "off");
  const btn = $("#wakeToggle");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  if (on) {
    if (!SpeechRec) { toast("Tu navegador no reconoce voz. Usa Google Chrome o Microsoft Edge."); setWake(false, { quiet: true, keepPref: true }); return; }
    if (!quiet) toast("Modo manos libres: di «Ey Wendy» y luego tu pregunta.");
    resumeWake();
  } else {
    conversationActive = false;
    clearTimeout(conversationTimer);
    if (recMode === "wake") stopRecognition();
    updateMicUI();
  }
}
function handleWakeSpeech(text) {
  const said = text.trim();
  if (!said) return;
  const match = said.match(WAKE_WORD);
  // Lo que suena igual a lo que Wendy acaba de decir es su propia voz (eco), no una orden.
  if (isEcho(said)) return;
  if (speaking && speakingListen) {
    // Narrando con el micrófono abierto: solo cuenta si dices «Wendy» (o «basta», «silencio»…).
    const n = norm(said);
    if (!match && !CMD.stop.test(n) && !CMD.liveStop.test(n)) return;
    stopSpeaking();
  }
  if (!conversationActive && !match) return; // no te dirigiste a Wendy
  conversationActive = true;
  let command = match ? `${said.slice(0, match.index)} ${said.slice(match.index + match[0].length)}`.trim() : said;
  // «Hey Wendy, ¿qué hora es?» → «¿qué hora es?» (el saludo no es parte de la pregunta)
  command = command.replace(/^(?:ey|hey|ei|oye|ok|okey|okay|hola|alo|aló|buenas)[\s,.!¡¿?]+(?=\S)/i, "").trim();
  if (FILLER_ONLY.test(command)) {
    speak(pick(["¿Sí? Dime.", "Aquí estoy, dime.", "¿En qué te ayudo?"]));
    return;
  }
  handleCommand(command);
}

/* ---------------- Comandos de voz ---------------- */
function norm(text) {
  return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
}
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

const CMD = {
  stop: /^(ya )?(para|parale|detente|silencio|callate|basta|stop|shh|ya|apagalo|quitalo|alto)( ya| wendy| por favor| porfa)?$/,
  closeCamera: /\b(cierra|cerrar|apaga|apagar|desactiva|quita|oculta)\b.*\bcamara\b/,
  switchCamera: /\b(cambia|cambiar|voltea|gira)\b.*\bcamara\b|\bcamara (frontal|trasera|de atras|de enfrente)\b/,
  vision: /\b(toma|tomame|tomale|saca|sacame|haz|hazme|captura)\b (una |la )?(foto|fotografia|imagen)|\bque (estas viendo|ves|miras|hay (enfrente|delante|aqui|ahi)|es esto|tengo (aqui|en la mano))\b|\bque estoy (viendo|mirando)\b|\bdescribe (lo que ves|esto|la foto|la imagen|lo que hay)\b|\bmira esto\b|\blee(me)? (esto|este texto|lo que dice)\b|\busa la camara\b|\bde que color es\b|\bque objeto es\b/,
  openCamera: /\b(abre|abrir|enciende|encender|activa|activar|prende|prender|pon|ponme|quiero|muestrame|muestra|necesito)\b.*\bcamara\b/,
  stopListening: /\b(deja de escuchar|apaga el microfono|desactiva el microfono|no me escuches|cierra el microfono)\b/,
  farewell: /\b(con esto (estamos|terminamos|es todo|seria todo|quedamos)|eso (es|seria) todo|es todo por (hoy|ahora)|ya terminamos|terminamos|hemos terminado|ya acabamos|acabamos|ya no te necesito|hasta luego|hasta pronto|hasta manana|adios|nos vemos|chao|bye|buenas noches wendy|ya estuvo|apagate|descansa|ve a dormir|duermete)\b/,
  voiceOff: /\b(desactiva|apaga|quita) (tu|la) voz\b|\bno hables\b|\bya no hables\b|\bmodo (texto|silencioso)\b/,
  voiceOn: /\b(activa|enciende|prende) (tu|la) voz\b|\bhablame en voz alta\b|\bvuelve a hablar\b/,
  repeat: /^(repite|repitelo|repitemelo|repite eso|repite lo que dijiste|que dijiste|como dijiste|otra vez|no te escuche|no te entendi|puedes repetir)( por favor| porfa)?$/,
  faster: /\b(habla|hablame) mas (rapido|rapida)\b|^mas rapido$/,
  slower: /\b(habla|hablame) mas (lento|despacio|lenta)\b|^mas (lento|despacio)$/,
  normalSpeed: /\b(habla normal|velocidad normal)\b/,
  louder: /\b(sube el volumen|habla mas fuerte|mas fuerte|subele)\b|^mas alto$/,
  quieter: /\b(baja el volumen|habla mas (bajo|quedito|suave)|bajale)\b|^mas (bajo|quedito)$/,
  liveStop: /\b(deten|detener|para|parar|quita|quitar|apaga|apagar|desactiva|desactivar|termina|terminar|cierra|cerrar|sal del|salir del)\b.*\b(en vivo|envivo|tiempo real|narracion|narrar|descripcion)\b|\bdeja de (narrar|describir)\b|\bya no (narres|describas)\b|\b(no|sin) narr[a-z]*\b/,
  liveStopAll: /\b(en vivo|envivo|tiempo real|descripcion)\b|\bdeja de describir\b/,
  liveStart: /\b(modo en vivo|en tiempo real|en vivo|envivo|describe (todo el tiempo|continuamente|sin parar)|narr[a-z]*|ve describiendo|ve diciendo lo que ves|dime lo que (ves|pasa))\b/,
  narrate: /\b(narr[a-z]*|ve describiendo|ve diciendo lo que ves|dime lo que (ves|pasa)|en voz alta)\b/,
  location: /\b(donde estoy|donde me encuentro|donde estamos|cual es mi ubicacion|mi ubicacion|en que (lugar|ciudad|pais|zona|departamento|municipio) estoy|en que (lugar|ciudad|pais) estamos|ubicame)\b/,
  weather: /\b(clima|que tiempo hace|como esta el tiempo|que tal el tiempo|el tiempo (de|en|para) |temperatura|va a llover|llovera|esta lloviendo|hace (frio|calor)|pronostico)\b/,
  notWeather: /\b(agua|ebullicion|cuerpo|humano|fiebre|sol|horno|corporal)\b/,
  memory: /\b(que hice|que hicimos|que estuve haciendo|de que hablamos|de que platicamos|que te dije|que te pregunte|que te conte|que me dijiste|que me contestaste|que paso|que viste|que alertas|te acuerdas|recuerdas|resumen de (hoy|ayer|la semana|esta semana))\b/,
  memoryTime: /\b(hoy|ayer|anteayer|antier|antes de ayer|semana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|hace rato|hace un rato|hace poco|esta manana|en la manana)\b/,
  forget: /\b(borra|olvida|elimina|limpia) (tu|toda tu|la) memoria\b|\bolvida todo\b/,
  newChat: /\b(nueva conversacion|empecemos de nuevo|empezar de nuevo|borra (la|esta) conversacion|limpia (el|la) (chat|pantalla|conversacion))\b/
};

// Guarda un intercambio resuelto aquí mismo (sin servidor) y lo dice en voz alta.
function localReply(userText, reply) {
  if (!activeChat()) createChat();
  const chat = activeChat();
  chat.messages.push({ role: "user", content: userText });
  chat.messages.push({ role: "assistant", content: reply, source: "local" });
  remember("yo", userText);
  remember("wendy", reply);
  if (chat.messages.filter((m) => m.role === "user").length === 1) chat.title = titleFrom(userText);
  save(); renderHistory();
  welcome.hidden = true;
  addMessage("user", userText);
  addMessage("assistant", reply, { source: "local" });
  input.value = ""; resizeInput();
  scrollToBottom();
  return speak(reply);
}
function lastAssistantReply() {
  const messages = activeChat()?.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return messages[i].content;
  return null;
}

function handleCommand(text) {
  const original = text.trim();
  const n = norm(original);
  if (!n) return;

  if (CMD.stop.test(n)) {
    stopSpeaking(); input.value = "";
    if (narrating) { setNarrate(false); toast("Narración apagada."); }
    else if (live) stopLive();
    return;
  }

  // Memoria: «¿qué hice ayer?», «¿de qué hablamos hoy?», «¿te acuerdas…?»
  if (CMD.forget.test(n)) {
    memory = []; saveMemory();
    localReply(original, "Listo, borré mi memoria. Ya no recuerdo nada de lo que platicamos antes.");
    memory = []; saveMemory();
    return;
  }
  if (CMD.memory.test(n) && (CMD.memoryTime.test(n) || /\b(te acuerdas|recuerdas)\b/.test(n))) { askMemory(original, n); return; }

  // Modo en vivo
  if (CMD.liveStop.test(n)) {
    if (narrating && !CMD.liveStopAll.test(n)) { setNarrate(false); localReply(original, "Listo, ya me callo. Sigo mostrando lo que veo en la pantalla."); }
    else { stopLive(); localReply(original, "Listo, ya lo apagué."); }
    return;
  }
  if (CMD.liveStart.test(n)) {
    input.value = "";
    const withVoice = CMD.narrate.test(n);
    startLive({ narrate: withVoice }).then((ok) => ok && localReply(original, withVoice
      ? "Listo, te voy diciendo lo que veo. Para que me calle, dime basta."
      : "Listo, ya está activado. Abajo del video verás lo que reconozco."));
    return;
  }

  // Crear imágenes
  // «Crea otra», «hazme otra igual»: otra versión de la última imagen
  const imageEdit = parseImageEdit(original);
  if (imageEdit?.again) { createImage(original, null, imageEdit); return; }
  const imageRequest = parseImageRequest(original);
  if (imageRequest) { createImage(original, imageRequest); return; }

  // Ubicación y clima
  if (CMD.location.test(n)) { tellLocation(original); return; }
  if (CMD.weather.test(n) && !CMD.notWeather.test(n)) { tellWeather(original); return; }

  if (CMD.closeCamera.test(n)) { closeCamera(); localReply(original, "Listo, cerré la cámara."); return; }
  if (CMD.switchCamera.test(n)) { switchCamera().then((ok) => localReply(original, ok ? "Cambié de cámara." : "No pude cambiar de cámara.")); return; }
  if (CMD.vision.test(n)) { input.value = ""; askAboutCamera(original); return; }
  if (CMD.openCamera.test(n)) {
    openCamera().then((ok) => ok && localReply(original, "Listo, la cámara está encendida. Pregúntame «¿qué estás viendo?» cuando quieras."));
    return;
  }

  if (CMD.stopListening.test(n)) {
    setWake(false, { quiet: true, keepPref: true });
    localReply(original, "Listo, apagué el micrófono. Toca el botón Ey Wendy o el micrófono cuando me necesites.");
    return;
  }
  if (CMD.farewell.test(n)) {
    // Termina la conversación, pero Wendy sigue esperando «Ey Wendy» mientras la página esté abierta.
    conversationActive = false;
    clearTimeout(conversationTimer);
    closeCamera();
    if (!wakeMode && SpeechRec && !navigator.brave) setWake(true, { quiet: true });
    localReply(original, pick([
      "¡Con mucho gusto! Cuando me necesites, solo di «Ey Wendy».",
      "¡Listo! Aquí estaré. Llámame con «Ey Wendy» cuando quieras.",
      "¡Hasta luego! Me quedo esperando; di «Ey Wendy» para volver a platicar."
    ]));
    updateMicUI();
    return;
  }

  if (CMD.voiceOff.test(n)) {
    localReply(original, "Está bien, desde ahora solo te respondo por escrito.");
    voiceOn = false; localStorage.setItem(VOICE_KEY, "off"); updateVoiceToggle();
    return;
  }
  if (CMD.voiceOn.test(n)) {
    voiceOn = true; localStorage.setItem(VOICE_KEY, "on"); updateVoiceToggle();
    localReply(original, "¡Listo! Ya puedo hablar de nuevo.");
    return;
  }
  if (CMD.repeat.test(n)) {
    const last = lastAssistantReply();
    if (last) speak(last, { force: true }); else speak("Todavía no he dicho nada en esta conversación.", { force: true });
    input.value = "";
    return;
  }
  if (CMD.faster.test(n) || CMD.slower.test(n) || CMD.normalSpeed.test(n)) {
    speechRate = CMD.normalSpeed.test(n) ? 1 : Math.min(1.8, Math.max(0.6, speechRate + (CMD.faster.test(n) ? 0.2 : -0.2)));
    speechRate = Math.round(speechRate * 10) / 10;
    localStorage.setItem(RATE_KEY, String(speechRate));
    localReply(original, speechRate === 1 ? "Listo, hablo a velocidad normal." : CMD.faster.test(n) ? "Listo, hablo más rápido." : "Listo, hablo más despacio.");
    return;
  }
  if (CMD.louder.test(n) || CMD.quieter.test(n)) {
    const louder = CMD.louder.test(n);
    if (louder && speechVolume >= 1) {
      localReply(original, "Ya estoy en mi volumen máximo. Sube el volumen de tu computadora.");
      return;
    }
    speechVolume = Math.min(1, Math.max(0.2, Math.round((speechVolume + (louder ? 0.2 : -0.2)) * 10) / 10));
    localStorage.setItem(VOLUME_KEY, String(speechVolume));
    localReply(original, louder ? "Listo, hablo más fuerte." : "Listo, hablo más bajito.");
    return;
  }
  if (CMD.newChat.test(n)) {
    createChat();
    speak("Listo, empezamos una conversación nueva.");
    input.value = "";
    return;
  }
  // «Hazla más azul», «ponle un sombrero», «cámbiale el fondo»: edita la última imagen
  if (imageEdit) { createImage(original, null, imageEdit); return; }

  sendMessage(original);
}

/* ---------------- Cámara ---------------- */
let stream = null;
let facingMode = "environment"; // cámara trasera en el celular; en la laptop usa la que haya

async function openCamera() {
  if (stream) { cameraPanel.hidden = false; return true; }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("La cámara solo funciona en http://localhost o en una página https.");
    return false;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
  } catch (error) {
    const reason = error.name === "NotAllowedError"
      ? "Permite el acceso a la cámara en el navegador (ícono del candado junto a la dirección)."
      : error.name === "NotFoundError"
        ? "No se encontró ninguna cámara conectada."
        : error.name === "NotReadableError"
          ? "La cámara está siendo usada por otra aplicación, como Zoom o Teams."
          : "No se pudo abrir la cámara.";
    toast(reason);
    speak(reason);
    return false;
  }
  video.srcObject = stream;
  const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
  video.classList.toggle("mirrored", settings.facingMode !== "environment");
  cameraPanel.hidden = false;
  cameraButton.classList.add("active");
  return true;
}
function closeCamera() {
  stopLive({ quiet: true });
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  cameraPanel.hidden = true;
  cameraButton.classList.remove("active");
}
async function switchCamera() {
  facingMode = facingMode === "environment" ? "user" : "environment";
  const wasLive = live;
  const wasNarrating = narrating;
  closeCamera();
  const ok = await openCamera();
  if (ok && wasLive) await startLive({ narrate: wasNarrating }); // el modo en vivo sigue con la otra cámara
  return ok;
}
function waitForVideo() {
  return new Promise((resolve) => {
    if (video.readyState >= 2 && video.videoWidth) return setTimeout(resolve, 250);
    const timeout = setTimeout(resolve, 4000);
    video.addEventListener("loadeddata", () => {
      clearTimeout(timeout);
      setTimeout(resolve, 700); // deja que la cámara ajuste la luz
    }, { once: true });
  });
}
function capturePhoto() {
  if (!video.videoWidth) return null;
  const draw = (maxSide, quality) => {
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const flash = $("#cameraFlash");
  flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
  return { full: draw(1024, 0.82), thumb: draw(320, 0.7) };
}
async function askAboutCamera(question) {
  if (busy) return;
  const ok = await openCamera();
  if (!ok) return;
  await waitForVideo();
  const photo = capturePhoto();
  if (!photo) { toast("La cámara todavía no muestra imagen. Inténtalo otra vez."); return; }
  sendMessage(question || "¿Qué estás viendo?", photo);
}

/* ---------------- Memoria de Wendy (escondida) ---------------- */
// Wendy recuerda lo que hablaron y lo que vio, aunque no se muestre el historial.
// Se guarda solo en este navegador, máximo 30 días. «Borra tu memoria» la borra.
const MEMORY_KEY = "wendy_memoria";
const MEMORY_DAYS = 30;
let memory = loadMemory();

function loadMemory() {
  try {
    const list = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
    const limit = Date.now() - MEMORY_DAYS * 86400000;
    return Array.isArray(list) ? list.filter((m) => m && m.t > limit) : [];
  } catch { return []; }
}
function saveMemory() {
  try {
    if (memory.length > 2000) memory = memory.slice(-2000);
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch { memory = memory.slice(-500); }
}
// k: "yo" (lo que dijiste), "wendy" (lo que respondió), "alerta" (lo que vio en vivo)
function remember(k, text) {
  const x = String(text || "").replace(/\s+/g, " ").trim().slice(0, 280);
  if (!x) return;
  memory.push({ t: Date.now(), k, x });
  saveMemory();
}

// Rango de fechas de la pregunta: hoy, ayer, anteayer, un día de la semana, esta semana, la semana pasada…
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function memoryRange(n) {
  const today = startOfDay(new Date());
  const day = 86400000;
  if (/\b(anteayer|antier|antes de ayer)\b/.test(n)) return { from: +today - 2 * day, to: +today - day, label: "anteayer" };
  if (/\bayer\b/.test(n)) return { from: +today - day, to: +today, label: "ayer" };
  if (/\bsemana pasada\b/.test(n)) {
    const monday = +today - ((today.getDay() + 6) % 7) * day;
    return { from: monday - 7 * day, to: monday, label: "la semana pasada" };
  }
  if (/\besta semana\b/.test(n)) {
    const monday = +today - ((today.getDay() + 6) % 7) * day;
    return { from: monday, to: Date.now() + 1, label: "esta semana" };
  }
  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b(el )?${w}\\b`).test(n));
  if (wd >= 0) {
    let back = (today.getDay() - wd + 7) % 7 || 7;
    const from = +today - back * day;
    return { from, to: from + day, label: `el ${WEEKDAYS[wd].replace("miercoles", "miércoles").replace("sabado", "sábado")}` };
  }
  if (/\b(hace rato|hace un rato|hace poco)\b/.test(n)) return { from: Date.now() - 3 * 3600000, to: Date.now() + 1, label: "hace un rato" };
  if (/\b(esta manana|en la manana)\b/.test(n)) return { from: +today, to: +today + 12 * 3600000, label: "esta mañana" };
  if (/\bhoy\b/.test(n)) return { from: +today, to: Date.now() + 1, label: "hoy" };
  return { from: Date.now() - 7 * day, to: Date.now() + 1, label: "estos días" };
}
function whenText(t) {
  const d = new Date(t);
  const today = startOfDay(new Date());
  const time = d.toLocaleTimeString("es-GT", { hour: "numeric", minute: "2-digit" });
  if (t >= +today) return `hoy ${time}`;
  if (t >= +today - 86400000) return `ayer ${time}`;
  return `${d.toLocaleDateString("es-GT", { weekday: "long", day: "numeric" })} ${time}`;
}

function askMemory(userText, n) {
  const range = memoryRange(n);
  // Lo que se dijo justo ahora (esta misma pregunta) no cuenta.
  const entries = memory.filter((m) => m.t >= range.from && m.t < range.to && m.t < Date.now() - 1500).slice(-250);
  runTask(userText, "Wendy está recordando", async () => {
    if (!entries.length) {
      return { reply: `No tengo nada guardado de ${range.label}. Solo recuerdo lo que platicamos aquí y lo que vi con la cámara, en este navegador.` };
    }
    const data = await fetchJSON("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: userText }],
        timeZone: TIME_ZONE,
        memory: { period: range.label, entries: entries.map((m) => ({ when: whenText(m.t), who: m.k, text: m.x })) }
      })
    });
    return { reply: data.reply, source: data.source || "local" };
  });
}

/* ---------------- Tareas con espera (clima, ubicación, imágenes) ---------------- */
let geminiAvailable = false;

// Muestra tu mensaje, el indicador de «pensando», y luego la respuesta de la tarea.
async function runTask(userText, typingLabel, task) {
  if (busy) { toast("Espera un momento, todavía estoy terminando lo anterior."); return; }
  if (!activeChat()) createChat();
  const chat = activeChat();
  chat.messages.push({ role: "user", content: userText });
  if (chat.messages.filter((m) => m.role === "user").length === 1) chat.title = titleFrom(userText);
  save(); renderHistory();
  welcome.hidden = true;
  addMessage("user", userText);
  input.value = ""; resizeInput();
  setBusy(true); pauseWake();
  showTyping(typingLabel);
  let result;
  try {
    result = await task();
  } catch (error) {
    result = { reply: error.message || "Algo salió mal. Inténtalo de nuevo.", source: "local" };
  }
  $("#typingIndicator")?.remove();
  try {
    const message = { role: "assistant", content: result.reply, source: result.source || "local" };
    if (result.image) message.image = result.image;
    chat.messages.push(message);
    save();
    if (!/^(¿)?(qu[eé] hice|de qu[eé] hablamos)/i.test(userText) && result.source !== "memoria") { remember("yo", userText); remember("wendy", message.content); }
    addMessage("assistant", message.content, { source: message.source, image: message.image });
    scrollToBottom();
  } finally {
    setBusy(false); // pase lo que pase, Wendy queda lista para lo siguiente
  }
  await speak(result.spoken || result.reply);
  resumeWake();
}
async function fetchJSON(url, options) {
  const response = await apiFetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No pude conectarme con el servidor de Wendy.");
  return data;
}

/* ---------------- Ubicación ---------------- */
let cachedCoords = null;
let cachedCoordsAt = 0;
let lastGeoError = null;

function getCoords() {
  return new Promise((resolve) => {
    if (cachedCoords && Date.now() - cachedCoordsAt < 10 * 60 * 1000) return resolve(cachedCoords);
    if (!navigator.geolocation) { lastGeoError = { code: 0 }; return resolve(null); }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        cachedCoords = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy };
        cachedCoordsAt = Date.now();
        lastGeoError = null;
        resolve(cachedCoords);
      },
      (error) => { lastGeoError = error; resolve(null); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  });
}
function geoErrorText() {
  if (lastGeoError?.code === 1) return "Necesito permiso para ver tu ubicación. Toca el candado junto a la dirección de la página y permite Ubicación.";
  if (lastGeoError?.code === 2) return "No pude obtener tu ubicación. Revisa que la ubicación de Windows esté activada en Configuración, Privacidad y seguridad, Ubicación.";
  if (lastGeoError?.code === 3) return "Tu ubicación tardó demasiado en llegar. Inténtalo otra vez.";
  return "Este navegador no me deja ver tu ubicación.";
}
function tellLocation(userText) {
  runTask(userText, "Wendy está buscando dónde estás", async () => {
    const coords = await getCoords();
    if (!coords) return { reply: geoErrorText() };
    const place = await fetchJSON(`/api/location?lat=${coords.lat}&lon=${coords.lon}`);
    const approx = coords.accuracy > 1500 ? " Es una ubicación aproximada, porque la computadora la calcula con la red de internet." : "";
    return { reply: `Estás en ${place.label}.${approx}`, source: "ubicacion" };
  });
}

/* ---------------- Clima ---------------- */
const NOT_A_PLACE = /^(hoy|mañana|manana|ahora|ahorita|aqu[ií]|ac[aá]|este momento|esta semana|la semana|mi ciudad|mi zona|mi casa|donde estoy|la tarde|la noche|la mañana|la manana)$/i;
function parseWeatherRequest(text) {
  const t = text.toLowerCase().replace(/[¿?¡!.]/g, " ").replace(/\s+/g, " ").trim();
  const day = /pasado mañana|pasado manana/.test(t) ? 2 : /\b(mañana|manana)\b/.test(t) && !/\b(en|por|de|esta) la (mañana|manana)\b/.test(t) ? 1 : 0;
  let city = "";
  const m = t.match(/(?:clima|tiempo|temperatura|llover|llueve|lloviendo|pronóstico|pronostico|frío|frio|calor)\b.*?\b(?:en|de|para)\s+(.+)$/);
  if (m) {
    city = m[1]
      .replace(/\b(pasado )?(mañana|manana|hoy|ahora|ahorita|esta semana)\b/g, "")
      .replace(/^(la ciudad de|el pueblo de|el municipio de)\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (NOT_A_PLACE.test(city) || city.length < 3) city = "";
  }
  return { day, city };
}
function tellWeather(userText) {
  const { day, city } = parseWeatherRequest(userText);
  runTask(userText, city ? `Wendy está revisando el clima en ${city}` : "Wendy está revisando el clima", async () => {
    const params = new URLSearchParams({ day: String(day) });
    if (city) params.set("city", city);
    else {
      const coords = await getCoords();
      if (coords) { params.set("lat", coords.lat); params.set("lon", coords.lon); }
    }
    const data = await fetchJSON(`/api/weather?${params}`);
    if (data.needLocation) {
      return { reply: `${geoErrorText()} También puedes preguntarme por una ciudad, por ejemplo: «¿Qué clima hace en Antigua Guatemala?».` };
    }
    return { reply: data.reply, source: "clima" };
  });
}

/* ---------------- Crear imágenes ---------------- */
const IMAGE_VERBS = "crea|cr[eé]ame|crear|genera|gen[eé]rame|generar|dibuja|dib[uú]jame|dibujar|pinta|p[ií]ntame|pintar|dise[ñn]a|dis[eé][ñn]ame|ilustra|il[uú]strame|haz|hazme|hacer|muestra|mu[eé]strame";
const IMAGE_NOUNS = "im[aá]gen(?:es)?|dibujo|ilustraci[oó]n|foto(?:graf[ií]a)?|retrato|logo(?:tipo)?|paisaje|pintura|caricatura|p[oó]ster|fondo de pantalla|wallpaper|personaje|icono|meme|arte";
const IMAGE_RE = new RegExp(
  `^(?:wendy[, ]*)?(?:por favor[, ]*)?(?:puedes |podr[ií]as |quiero que )?(${IMAGE_VERBS})\\s+(?:me\\s+)?(?:(?:una?|el|la|otra|otro|otras|otros|unas|unos|mas|m[aá]s|nueva|nuevo|una nueva|un nuevo|\\d+)\\s+)?(?:(${IMAGE_NOUNS})\\s*)?(?:(?:de|del|sobre|con|que sea|que tenga|donde|en la que)\\s+)?(.+)$`,
  "i"
);
function parseImageRequest(text) {
  const clean = text.trim().replace(/[.!?]+$/, "");
  const m = clean.match(IMAGE_RE);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const noun = (m[2] || "").toLowerCase();
  const subject = (m[3] || "").trim();
  if (!subject) return null;
  // «hazme/muéstrame…» solo cuenta si pide una imagen o dibujo; «hazme una foto» es tomar foto con la cámara.
  if (/^(haz|hazme|hacer|muestra|mu)/.test(verb) && (!noun || noun.startsWith("foto"))) return null;
  // «crea/genera…» sin sustantivo: solo si no parece otra cosa (ej. «crea una lista»).
  if (!noun && /^(cr|gen|dise)/.test(verb) && /^(una? )?(lista|resumen|texto|poema|cuento|historia|correo|carta|tabla|plan)\b/.test(subject)) return null;
  if (!noun || /^(im|foto)/.test(noun)) return subject;
  return /^(para|con|sobre|en|estilo|que)\b/i.test(subject) ? `${noun} ${subject}` : `${noun} de ${subject}`;
}
// La última imagen que creó Wendy en esta conversación (para «otra», «cámbiale el fondo», etc.).
let lastImage = null; // { request, prompt, seed }
const IMAGE_AGAIN = /^(?:y |ahora |mejor |otra vez |porfa |por favor )*(?:(?:haz|hazme|crea|creame|genera|generame|dibuja|dibujame|dame|muestrame|quiero)\s+)?(?:otra|otra igual|otra parecida|otra version|otra vez la imagen|una (?:igual|parecida|similar)|otra opcion)(?: (?:igual|parecida|similar|distinta|diferente|version|opcion|por favor|porfa))*$/;
const IMAGE_EDIT = /^(?:y |ahora |mejor |pero |tambien |porfa |por favor )*(?:hazla|hazlo|haz que|ponle|ponla|ponlo|pon(?:le)? (?:el|la|un|una)|agregale|agrega|anadele|anade|quitale|quita|cambiale|cambia|cambiala|cambialo|pintala|pintalo|dale|edita|editala|modifica|modificala|mejorala|que (?:sea|tenga|este|se vea|lleve|salga)|con (?:el|la|un|una|mas|menos)|en (?:estilo|blanco y negro|color|version|caricatura|anime|acuarela|3d|de noche|de dia)|mas |menos |sin |de noche|de dia|en la noche|al atardecer|estilo )/;
function parseImageEdit(text) {
  if (!lastImage) return null;
  const n = norm(text);
  if (IMAGE_AGAIN.test(n)) return { again: true };
  // Solo si habla de la imagen (o justo después de crearla): «hazla más azul», «ponle un sombrero al gato».
  const recent = lastAssistantSource() === "imagen";
  if (IMAGE_EDIT.test(n) && (recent || /\b(imagen|dibujo|foto|ilustracion|logo|fondo)\b/.test(n))) return { change: text.trim() };
  return null;
}
// Descarga la imagen y avisa si llegó (true) o no (false) antes del tiempo límite.
function loadImage(url, timeoutMs) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ""; resolve(false); }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}
function lastAssistantSource() {
  const messages = activeChat()?.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return messages[i].source;
  return null;
}
function createImage(userText, prompt, edit = null) {
  const label = edit ? "Wendy está cambiando la imagen" : "Wendy está dibujando (puede tardar hasta un minuto)";
  runTask(userText, label, async () => {
    const body = edit?.again
      ? { prompt: lastImage.request, ready: lastImage.prompt }                       // la misma idea, otra versión
      : edit ? { prompt: edit.change, base: lastImage.prompt, seed: lastImage.seed } // cambia la anterior
        : { prompt };
    const data = await fetchJSON("/api/imagen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!data.url) return { reply: data.reply };
    // Espera a que la imagen esté lista de verdad antes de decir «¡Listo!» (el servicio gratis tarda).
    const typing = $("#typingIndicator .message-name");
    let url = data.url;
    let loaded = await loadImage(url, 90000);
    if (!loaded) {
      if (typing) typing.textContent = "El servicio de imágenes está lento, lo intento otra vez…";
      await new Promise((r) => setTimeout(r, 4000));
      url = `${data.url}&intento=2`;
      loaded = await loadImage(url, 90000);
    }
    if (!loaded) return { reply: "El servicio gratuito de imágenes no me la entregó a tiempo. Pídemela otra vez en un minuto, por favor." };
    data.url = url;
    const request = edit && !edit.again ? `${lastImage.request}, ${edit.change}` : edit ? lastImage.request : prompt;
    lastImage = { request, prompt: data.prompt || request, seed: data.seed };
    const title = edit?.again ? `Otra versión de: ${lastImage.request}` : edit ? `Cambié la imagen: ${edit.change}` : `Imagen de: ${prompt}`;
    return { reply: title, spoken: data.reply, image: data.url, source: "imagen" };
  });
}

/* ---------------- Modo en vivo ---------------- */
// Precisión:
// 1) Modelo COCO-SSD completo (mobilenet_v2), más preciso que la versión ligera.
// 2) Seguimiento entre cuadros: un objeto solo aparece si se ve en varios cuadros seguidos
//    (quita los «fantasmas» que salen un instante).
// 3) Gemini (si está activado) devuelve objetos con su nombre real y su caja; esos nombres
//    reemplazan las etiquetas del modelo local (ej. «celular» → «corrector líquido»).
const liveCanvas = $("#liveCanvas");
const liveCtx = liveCanvas.getContext("2d");
let live = false;
let narrating = false;
let liveTimer = null;
let tracks = [];            // objetos seguidos entre cuadros
let nextTrackId = 1;
let stableKey = "";
let candidateKey = "";
let candidateSince = 0;
let lastSentence = "";
let lastNarratedKey = "";
let lastNarratedAt = 0;
let geminiLiveBusy = false;
let lastGeminiAt = 0;
let lastGeminiKey = "";
let geminiPausedUntil = 0;
let geminiObjects = [];     // [{ name, bbox:[x,y,w,h] en píxeles del video }]
let geminiObjectsAt = 0;
const GEMINI_FRESH_MS = 15000;

function setLiveUI() {
  $("#liveButton").setAttribute("aria-pressed", String(live));
  $("#narrateButton").setAttribute("aria-pressed", String(narrating));
  $("#liveBadge").hidden = !live;
  $("#liveCaption").hidden = !live;
  document.body.classList.toggle("wendy-live", live);
}
function setNarrate(on) {
  narrating = on;
  lastNarratedKey = "";
  lastNarratedAt = 0;
  setLiveUI();
  if (on) toast("Narración activada: te digo lo que veo en voz alta.");
}
async function startLive({ narrate = false } = {}) {
  if (!(await openCamera())) return false;
  if (narrate) { narrating = true; lastNarratedKey = ""; lastNarratedAt = 0; }
  if (live) { setLiveUI(); return true; }
  live = true;
  tracks = [];
  geminiObjects = [];
  stableKey = candidateKey = lastNarratedKey = lastGeminiKey = lastSentence = "";
  $("#liveLocal").textContent = "Preparando el reconocimiento de objetos… (la primera vez tarda un poco)";
  $("#liveGemini").hidden = true;
  setLiveUI();
  try {
    await window.WendyVision.ready();
  } catch (error) {
    console.error(error);
    $("#liveLocal").textContent = "No pude cargar el reconocimiento de objetos. Revisa tu conexión a internet.";
    return true;
  }
  // Posturas (distancia, manos, caídas): se carga aparte para no retrasar lo demás.
  poseReady = false;
  window.WendyAlerts?.ready().then(() => { poseReady = true; }).catch((error) => console.warn("Sin detector de posturas:", error));
  liveTick();
  return true;
}
function stopLive({ quiet = false } = {}) {
  live = false;
  narrating = false;
  people = [];
  $("#liveAlert").hidden = true;
  clearTimeout(liveTimer);
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  setLiveUI();
  if (!quiet) toast("Modo en vivo desactivado.");
}

/* ---- Seguimiento entre cuadros ---- */
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}
function updateTracks(detections) {
  const used = new Set();
  for (const d of detections) {
    let best = null;
    let bestIou = 0.25;
    for (const t of tracks) {
      if (used.has(t.id) || t.cls !== d.class) continue;
      const v = iou(t.box, d.bbox);
      if (v > bestIou) { best = t; bestIou = v; }
    }
    if (best) {
      // Suaviza la caja para que no tiemble.
      best.box = best.box.map((v, i) => v * 0.5 + d.bbox[i] * 0.5);
      best.hits++;
      best.misses = 0;
      best.score = best.score * 0.6 + d.score * 0.4;
      used.add(best.id);
    } else {
      const t = { id: nextTrackId++, cls: d.class, box: [...d.bbox], hits: 1, misses: 0, score: d.score };
      tracks.push(t);
      used.add(t.id);
    }
  }
  for (const t of tracks) if (!used.has(t.id)) t.misses++;
  tracks = tracks.filter((t) => t.misses <= 3);
  // Visible si se vio en al menos 3 cuadros y con confianza suficiente.
  return tracks.filter((t) => t.hits >= 3 && t.misses <= 1 && t.score >= 0.55)
    .map((t) => ({ class: t.cls, score: t.score, bbox: t.box, id: t.id }));
}

/* ---- Nombres de Gemini sobre las cajas ---- */
function geminiFresh() { return geminiObjects.length && Date.now() - geminiObjectsAt < GEMINI_FRESH_MS; }
function betterName(det) {
  if (!geminiFresh()) return null;
  let best = null;
  let bestIou = 0.2;
  for (const g of geminiObjects) {
    const v = iou(g.bbox, det.bbox);
    if (v > bestIou) { best = g; bestIou = v; }
  }
  return best?.name || null;
}

function drawLabel(x, y, text, color, W) {
  const th = Math.max(22, W / 28);
  liveCtx.font = `600 ${Math.round(th * 0.6)}px "Plus Jakarta Sans", "DM Sans", sans-serif`;
  const tw = liveCtx.measureText(text).width + th * 0.6;
  const ty = y > th + 4 ? y - th - 4 : y + 4;
  liveCtx.fillStyle = color;
  liveCtx.beginPath();
  liveCtx.roundRect ? liveCtx.roundRect(x, ty, tw, th, th / 2) : liveCtx.rect(x, ty, tw, th);
  liveCtx.fill();
  liveCtx.fillStyle = "#04101f";
  liveCtx.fillText(text, x + th * 0.3, ty + th * 0.7);
}
function drawBoxes(detections, mirrored) {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (liveCanvas.width !== W || liveCanvas.height !== H) { liveCanvas.width = W; liveCanvas.height = H; }
  liveCtx.clearRect(0, 0, W, H);
  const line = Math.max(2, W / 300);
  const flip = (b) => (mirrored ? [W - b[0] - b[2], b[1], b[2], b[3]] : b);
  const covered = new Set();

  // Objetos del modelo local (con el nombre de Gemini si coincide)
  for (const d of detections) {
    const [x, y, w, h] = flip(d.bbox);
    const geminiName = betterName(d);
    if (geminiName) covered.add(geminiName);
    // Si Gemini revisó la escena y no confirma este objeto, se muestra como duda.
    const doubtful = !geminiName && geminiFresh() && d.class !== "person";
    const color = geminiName ? "#ff9bd2" : doubtful ? "rgba(255,255,255,.55)" : "#5ef2c2";
    liveCtx.strokeStyle = color;
    liveCtx.lineWidth = line;
    liveCtx.beginPath();
    liveCtx.roundRect ? liveCtx.roundRect(x, y, w, h, Math.min(16, w / 6)) : liveCtx.rect(x, y, w, h);
    liveCtx.stroke();
    const name = geminiName || window.WendyVision.label(d.class);
    const text = geminiName ? `✨ ${name}` : doubtful ? `¿${name}?` : `${name} ${Math.round(d.score * 100)}%`;
    drawLabel(x, y, text, color, W);
  }
  // Objetos que solo Gemini reconoció (el modelo local no los conoce, ej. un lapicero)
  if (geminiFresh()) {
    for (const g of geminiObjects) {
      if (covered.has(g.name) || /persona/i.test(g.name) && detections.some((d) => d.class === "person")) continue;
      const [x, y, w, h] = flip(g.bbox);
      liveCtx.setLineDash([line * 4, line * 3]);
      liveCtx.strokeStyle = "#ff9bd2";
      liveCtx.lineWidth = line;
      liveCtx.strokeRect(x, y, w, h);
      liveCtx.setLineDash([]);
      drawLabel(x, y, `✨ ${g.name}`, "#ff9bd2", W);
    }
  }
}

/* ---- Alertas ---- */
let poseReady = false;
let people = [];                 // personas con postura (de WendyAlerts)
const alertLast = new Map();     // tipo de alerta → última vez que se dijo
let lastAlertSpokenAt = 0;
const memoryAlertLast = new Map();
let alertHideTimer = null;
const ALERT_RATE = 1.15;         // las alertas se dicen un poco más rápido
const NARRATE_RATE = 1.05;

function handleAlerts(alerts) {
  if (!alerts.length) return;
  const now = Date.now();
  // La más importante primero; cada alerta se repite como máximo cada 6 segundos (caídas cada 4).
  const fresh = alerts
    .filter((a) => now - (alertLast.get(a.type) || 0) > (a.level >= 3 ? 5000 : 10000))
    .sort((x, y) => y.level - x.level);
  if (!fresh.length) return;
  const top = fresh[0];
  fresh.forEach((a) => alertLast.set(a.type, now));
  // Se guarda en la memoria (como mucho una vez por minuto por tipo) para poder preguntar «¿qué viste ayer?».
  fresh.forEach((a) => {
    const kind = a.type.replace(/-\d+$/, "");
    if (now - (memoryAlertLast.get(kind) || 0) > 60000) { memoryAlertLast.set(kind, now); remember("alerta", a.text); }
  });
  const banner = $("#liveAlert");
  banner.textContent = fresh.map((a) => a.text).join(" · ");
  banner.dataset.level = String(top.level);
  banner.hidden = false;
  clearTimeout(alertHideTimer);
  alertHideTimer = setTimeout(() => { banner.hidden = true; }, 3500);
  // En voz: solo si está narrando; las alertas interrumpen lo que se estaba diciendo.
  if (narrating && now - lastAlertSpokenAt > 4000 && !speaking && (!busy || top.level >= 3)) { // ocupada (ej. dibujando): solo lo urgente
    lastAlertSpokenAt = now;
    lastNarratedAt = now;
    speak(fresh.slice(0, 2).map((a) => a.text).join(" "), { rate: ALERT_RATE, force: true, listen: true });
  }
}

function drawSkeletons(mirrored) {
  if (!people.length) return;
  const W = video.videoWidth;
  const fx = (x) => (mirrored ? W - x : x);
  const line = Math.max(2, W / 320);
  for (const p of people) {
    const alert = p.fallen || p.handsUp || (p.distance != null && p.distance < 1);
    liveCtx.strokeStyle = alert ? "rgba(245, 139, 200, .95)" : "rgba(154, 123, 255, .85)";
    liveCtx.lineWidth = line;
    for (const [a, b] of window.WendyAlerts.BONES) {
      const ka = window.WendyAlerts.keypoint(p.pose, a);
      const kb = window.WendyAlerts.keypoint(p.pose, b);
      if (!ka || !kb) continue;
      liveCtx.beginPath();
      liveCtx.moveTo(fx(ka.x), ka.y);
      liveCtx.lineTo(fx(kb.x), kb.y);
      liveCtx.stroke();
    }
    for (const name of ["left_wrist", "right_wrist"]) {
      const k = window.WendyAlerts.keypoint(p.pose, name);
      if (!k) continue;
      liveCtx.fillStyle = p.handsUp || p.oneHandUp ? "#f58bc8" : "#62e7f5";
      liveCtx.beginPath();
      liveCtx.arc(fx(k.x), k.y, line * 3, 0, Math.PI * 2);
      liveCtx.fill();
    }
    // Distancia junto a la cabeza
    const head = window.WendyAlerts.keypoint(p.pose, "nose") || window.WendyAlerts.keypoint(p.pose, "left_shoulder");
    if (head && p.distance != null) {
      const label = p.distance < 1 ? "< 1 m" : `${String(Math.round(p.distance * 2) / 2).replace(".", ",")} m`;
      drawLabel(fx(head.x) - 30, head.y - 30, `📏 ${label}`, p.distance < 1 ? "#f58bc8" : "#62e7f5", W);
    }
  }
}

// Para no calentar la computadora: unas 4 revisiones por segundo (menos si la compu es lenta),
// y el detector de posturas solo corre cuando hay una persona a la vista.
let tickCount = 0;
let lastPersonAt = 0;
let lastPoseResult = null;
async function liveTick() {
  if (!live) return;
  if (document.hidden || !video.videoWidth) { liveTimer = setTimeout(liveTick, 800); return; }
  const started = performance.now();
  try {
    const mirrored = video.classList.contains("mirrored");
    tickCount++;
    const raw = await window.WendyVision.detect(video, 0.45);
    if (raw.some((d) => d.class === "person")) lastPersonAt = Date.now();
    const wantPose = poseReady && Date.now() - lastPersonAt < 3000;
    let poseResult = null;
    if (wantPose && (tickCount % 2 === 0 || !lastPoseResult)) {
      poseResult = await window.WendyAlerts.analyze(video).catch(() => null);
      lastPoseResult = poseResult;
    } else if (wantPose) {
      poseResult = lastPoseResult ? { ...lastPoseResult, alerts: [] } : null; // reutiliza la última postura
    } else lastPoseResult = null;
    if (!live) return;
    const detections = updateTracks(raw);
    people = poseResult?.people || [];
    drawBoxes(detections, mirrored);
    drawSkeletons(mirrored);
    if (poseResult) handleAlerts(poseResult.alerts);

    // Frase en vivo: personas (con distancia y lo que hacen) + otros objetos.
    const others = detections.filter((d) => d.class !== "person");
    const peopleText = people.map((p) => window.WendyAlerts.describePerson(p)).join(". ");
    const objectsText = geminiFresh()
      ? `Veo: ${[...new Set(geminiObjects.map((g) => g.name).filter((n) => !/persona/i.test(n)))].join(", ")}`
      : others.length ? window.WendyVision.describe(others, video.videoWidth, mirrored).split(". ")[0] : ""; // corto, para decirlo rápido
    let sentence = [peopleText, objectsText].filter(Boolean).join(". ").replace(/\.\./g, ".").replace(/\.?$/, ".");
    if (!peopleText && !objectsText) sentence = detections.length ? window.WendyVision.describe(detections, video.videoWidth, mirrored) : "Buscando objetos…";
    $("#liveLocal").textContent = sentence;

    // ¿Cambió la escena? (se considera cambio si dura medio segundo)
    const peopleKey = people.map((p) => `${p.handsUp ? "M" : p.oneHandUp ? "m" : ""}${p.fallen ? "C" : ""}${p.distance == null ? "" : p.distance < 1 ? "<1" : Math.round(p.distance)}`).join(",");
    const key = `${window.WendyVision.summaryKey(detections)}#${peopleKey}`;
    if (key !== candidateKey) { candidateKey = key; candidateSince = Date.now(); }
    if (candidateKey !== stableKey && Date.now() - candidateSince > 500) {
      stableKey = candidateKey;
      lastSentence = sentence;
    }
    maybeAskGeminiLive();
    maybeNarrate();
  } catch (error) {
    console.error("Modo en vivo:", error);
  }
  const spent = performance.now() - started;
  liveTimer = setTimeout(liveTick, Math.max(LIVE_MIN_GAP, spent * 1.5));
}
const LIVE_MIN_GAP = 220; // ms de descanso entre revisiones
// La narración se dice aunque la voz esté en silencio (la pediste) y deja el micrófono abierto
// para que «Ey Wendy, deja de narrar» funcione en cualquier momento.
function narrate(text) {
  if (!text) return;
  lastNarratedAt = Date.now();
  lastNarratedKey = stableKey;
  speak(text, { rate: NARRATE_RATE, force: true, listen: true });
}
function maybeNarrate(text = null) {
  if (!narrating || speaking || busy) return;
  const now = Date.now();
  if (text) { narrate(text); return; }
  const changed = stableKey !== lastNarratedKey;
  // Escena nueva: se dice (como mucho cada 4 s). Con personas a la vista se repite cada 12 s aunque no cambie.
  if (changed ? now - lastNarratedAt < 4000 : !(people.length && now - lastNarratedAt > 12000)) return;
  narrate(lastSentence || $("#liveLocal").textContent);
}
async function maybeAskGeminiLive() {
  const now = Date.now();
  // Narrando con personas a la vista: cada 5 s (para describir lo que hacen). Si no, cada 8 s y solo si algo cambió.
  const interval = narrating && people.length ? 5000 : 8000;
  if (!geminiAvailable || geminiLiveBusy || now < geminiPausedUntil || now - lastGeminiAt < interval) return;
  if (!(narrating && people.length) && stableKey === lastGeminiKey && now - lastGeminiAt < 25000) return; // nada cambió: no gastamos el límite gratis
  geminiLiveBusy = true;
  lastGeminiAt = now;
  lastGeminiKey = stableKey;
  const W = video.videoWidth;
  const H = video.videoHeight;
  try {
    const scale = Math.min(1, 640 / Math.max(W, H));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const response = await apiFetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: canvas.toDataURL("image/jpeg", 0.75) })
    });
    const data = await response.json().catch(() => ({}));
    if (!live) return;
    if (response.ok && (data.caption || data.objects)) {
      // Cajas de Gemini: [ymin, xmin, ymax, xmax] de 0 a 1000 → píxeles [x, y, ancho, alto]
      geminiObjects = (data.objects || []).map((o) => ({
        name: o.name,
        bbox: [o.box[1] / 1000 * W, o.box[0] / 1000 * H, (o.box[3] - o.box[1]) / 1000 * W, (o.box[2] - o.box[0]) / 1000 * H]
      })).filter((o) => o.bbox[2] > 4 && o.bbox[3] > 4);
      geminiObjectsAt = Date.now();
      if (data.alert) handleAlerts([{ type: `gemini-${data.alert}`, level: 3, text: `¡Alerta! ${data.alert}` }]);
      if (data.caption) {
        $("#liveGemini").hidden = false;
        $("#liveGemini").textContent = data.caption;
        // Lo que hace cada persona: se dice aunque la escena no haya cambiado.
        if (narrating && (stableKey !== lastNarratedKey || people.length) && Date.now() - lastNarratedAt > 6000) maybeNarrate(data.caption);
      }
    } else if (data.skip) {
      geminiAvailable = false;
    } else {
      geminiPausedUntil = Date.now() + 60000; // límite de Gemini: descansamos un minuto
      $("#liveGemini").hidden = false;
      $("#liveGemini").textContent = "Gemini descansa un minuto; sigo con el reconocimiento sin IA.";
    }
  } catch {
    geminiPausedUntil = Date.now() + 60000;
  } finally {
    geminiLiveBusy = false;
  }
}

/* ---------------- Micrófono que se mueve con la voz ---------------- */
// Escucha el micrófono con Web Audio y dibuja barras alrededor del botón:
// - el largo de las barras sigue el volumen de cada frecuencia (tu tono de voz),
// - el color cambia de violeta (voz grave) a cian (voz aguda),
// - el botón crece con el volumen.
// Cuando Wendy habla o piensa, las barras se animan solas.
const micViz = $("#micViz");
const vizCtx = micViz.getContext("2d");
let audioCtx = null;
let analyser = null;
let freqData = null;
let meterStarting = false;
let vizLevel = 0;
let vizHue = 255;
const BARS = 96;
const barValues = new Array(BARS).fill(0);

async function startMeter() {
  if (IS_TOUCH_DEVICE) return; // en tablet/celular el anillo se anima con el reconocimiento de voz
  if (analyser || meterStarting || !navigator.mediaDevices?.getUserMedia) return;
  meterStarting = true;
  try {
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    freqData = new Uint8Array(analyser.frequencyBinCount);
  } catch (error) {
    console.warn("Sin medidor de micrófono:", error.name); // se usa una animación suave en su lugar
  } finally {
    meterStarting = false;
  }
}
// El navegador pide un toque antes de activar el audio: lo aprovechamos.
document.addEventListener("pointerdown", (event) => {
  if (audioCtx?.state === "suspended") audioCtx.resume();
  startMeter();
  // Algunos navegadores (sobre todo en tablet) no dejan escuchar hasta que tocas la página: con el primer toque se activa «Ey Wendy».
  if (!wakeMode && wakePref() && SpeechRec && !navigator.brave && !event.target.closest?.("#wakeToggle, #micButton")) setWake(true, { quiet: true });
}, { passive: true });

// Lee el micrófono y reparte la voz en todo el círculo (no solo arriba).
let voicePeak = 0.25;
function readVoice() {
  if (!analyser || audioCtx.state !== "running") return null;
  analyser.getByteFrequencyData(freqData);
  // La voz está entre ~80 Hz y ~4 kHz: usamos solo esa parte y la repartimos de forma logarítmica.
  const lo = 2;
  const hi = Math.floor(freqData.length * 0.45);
  const half = BARS / 2;
  const bands = new Array(half);
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < half; i++) {
    const a = Math.floor(lo * Math.pow(hi / lo, i / half));
    const b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / half)));
    let m = 0;
    for (let j = a; j < b; j++) m = Math.max(m, freqData[j]);
    bands[i] = m / 255;
    sum += bands[i];
    weighted += bands[i] * i;
  }
  const level = sum / half;
  // Ganancia automática: así el anillo se llena parejo aunque hables bajito.
  voicePeak = Math.max(voicePeak * 0.995, level, 0.08);
  const gain = 0.55 / voicePeak;
  const values = new Array(BARS);
  for (let i = 0; i < half; i++) {
    // Mezcla con las bandas vecinas para que no haya huecos.
    const v = (bands[i] * 0.6 + (bands[i - 1] ?? bands[i]) * 0.2 + (bands[i + 1] ?? bands[i]) * 0.2) * gain;
    values[i] = v;
    values[BARS - 1 - i] = v; // espejo: izquierda y derecha iguales
  }
  return { values, level: Math.min(1, level * gain), pitch: sum > 0.01 ? weighted / sum / half : 0.3 };
}

let lastVizAt = 0;
function drawMicViz(time) {
  // 30 cuadros por segundo (20 con el modo en vivo) son suficientes y gastan mucho menos.
  if (time - lastVizAt < (live ? 48 : 32)) { requestAnimationFrame(drawMicViz); return; }
  lastVizAt = time;
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(micViz.clientWidth, micViz.clientHeight) || micViz.clientWidth;
  if (size && micViz.width !== Math.round(size * dpr)) { micViz.width = micViz.height = Math.round(size * dpr); }
  const W = micViz.width;
  const c = W / 2;
  vizCtx.clearRect(0, 0, W, W);

  let target = new Array(BARS).fill(0);
  let level = 0;
  let hue = 300;
  if (speaking) {
    // Wendy habla: ondas que recorren el anillo
    for (let i = 0; i < BARS; i++) target[i] = 0.3 + 0.45 * Math.abs(Math.sin(time / 160 + i * 0.35) * Math.sin(time / 270 + i * 0.17));
    level = 0.3 + 0.12 * Math.sin(time / 140);
    hue = 320;
  } else if (busy) {
    // Pensando: una luz que da vueltas
    for (let i = 0; i < BARS; i++) target[i] = 0.12 + 0.6 * Math.pow(Math.max(0, Math.cos((i / BARS) * Math.PI * 2 - time / 240)), 6);
    level = 0.1;
    hue = 275;
  } else {
    const voice = readVoice();
    if (voice) {
      target = voice.values;
      level = voice.level;
      hue = 290 + Math.min(1, voice.pitch * 1.6) * 40; // grave = morado, agudo = rosa
    } else if (Date.now() < userVoiceUntil) {
      // Sin medidor (tablet/celular): el reconocimiento oyó tu voz → el anillo se mueve
      for (let i = 0; i < BARS; i++) target[i] = 0.3 + 0.5 * Math.abs(Math.sin(time / 120 + i * 0.5) * Math.cos(time / 230 + i * 0.13));
      level = 0.4 + 0.15 * Math.sin(time / 110);
      hue = 305;
    } else {
      level = 0.04;
    }
  }
  // Siempre hay un anillo base que «respira», así nunca se ve vacío.
  for (let i = 0; i < BARS; i++) {
    const base = 0.1 + 0.05 * Math.sin(time / 500 + i * 0.4);
    const t = Math.min(1, Math.max(base, target[i]));
    barValues[i] += (t - barValues[i]) * (t > barValues[i] ? 0.5 : 0.18); // sube rápido, baja suave
  }
  vizLevel += (level - vizLevel) * 0.25;
  vizHue += (hue - vizHue) * 0.08;

  // Las barras nacen justo en el borde del botón (también cuando crece).
  const scale = 1 + Math.min(vizLevel, 1) * 0.1;
  const buttonR = (micButton.offsetWidth / 2) * scale * dpr;
  const r0 = buttonR + W * 0.018;
  const maxLen = Math.max(4, c - r0 - W * 0.015);

  // Halo suave detrás de las barras
  const glow = vizCtx.createRadialGradient(c, c, buttonR * 0.9, c, c, c);
  glow.addColorStop(0, `hsla(${vizHue}, 90%, 65%, ${0.18 + vizLevel * 0.25})`);
  glow.addColorStop(1, "hsla(280, 90%, 60%, 0)");
  vizCtx.fillStyle = glow;
  vizCtx.beginPath();
  vizCtx.arc(c, c, c, 0, Math.PI * 2);
  vizCtx.fill();

  vizCtx.lineCap = "round";
  vizCtx.lineWidth = Math.max(1.5, (2 * Math.PI * r0) / BARS * 0.42);
  for (let i = 0; i < BARS; i++) {
    const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
    const v = barValues[i];
    const len = maxLen * (0.08 + v * 0.92);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Degradado rosa → morado a lo largo de cada barra
    const x1 = c + cos * r0, y1 = c + sin * r0;
    const x2 = c + cos * (r0 + len), y2 = c + sin * (r0 + len);
    const g = vizCtx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, `hsla(${vizHue - 25}, 85%, 68%, ${0.55 + v * 0.45})`);
    g.addColorStop(1, `hsla(${vizHue + 15}, 95%, ${66 + v * 12}%, ${0.35 + v * 0.65})`);
    vizCtx.strokeStyle = g;
    vizCtx.beginPath();
    vizCtx.moveTo(x1, y1);
    vizCtx.lineTo(x2, y2);
    vizCtx.stroke();
  }

  // El botón crece un poco y brilla con el volumen
  micButton.style.transform = `scale(${scale})`;
  micButton.style.boxShadow = `0 10px 30px rgba(104,104,255,.4), 0 0 ${16 + vizLevel * 50}px hsla(${vizHue}, 90%, 65%, ${0.35 + vizLevel * 0.45})`;
  requestAnimationFrame(drawMicViz);
}
requestAnimationFrame(drawMicViz);

/* ---------------- Eventos ---------------- */
form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleCommand(input.value);
});
input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault(); form.requestSubmit();
  }
});
micButton.addEventListener("click", () => {
  if (recMode === "push") { stopRecognition(); return; }
  stopSpeaking();
  startRecognition("push");
});
cameraButton.addEventListener("click", () => (stream ? closeCamera() : openCamera()));
$("#captureButton").addEventListener("click", () => {
  const question = input.value.trim() || "¿Qué estás viendo?";
  input.value = "";
  askAboutCamera(question);
});
$("#switchCamera").addEventListener("click", switchCamera);
$("#liveButton").addEventListener("click", () => (live ? stopLive() : startLive()));
$("#narrateButton").addEventListener("click", () => {
  if (!live) { startLive({ narrate: true }); return; }
  setNarrate(!narrating);
  if (!narrating) stopSpeaking();
});
$("#closeCamera").addEventListener("click", closeCamera);
$("#voiceToggle").addEventListener("click", () => {
  voiceOn = !voiceOn;
  localStorage.setItem(VOICE_KEY, voiceOn ? "on" : "off");
  if (!voiceOn) stopSpeaking();
  updateVoiceToggle();
});
$("#wakeToggle").addEventListener("click", () => setWake(!wakeMode));
$("#newChat")?.addEventListener("click", () => {
  createChat();
  toast("Empezamos una conversación nueva.");
});
$("#liveQuick").addEventListener("click", () => (live ? stopLive() : startLive()));
$("#codeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = $("#codeInput").value.trim();
  if (!pin) return;
  // Se comprueba con el servidor antes de dejar pasar.
  const response = await fetch("/api/verificar", { headers: { "x-wendy-codigo": pin } }).catch(() => null);
  if (response?.ok) {
    accessCode = pin;
    localStorage.setItem(CODE_KEY, accessCode);
    $("#codeOverlay").hidden = true;
    $("#codeError").hidden = true;
    $("#codeInput").value = "";
    checkStatus();
    toast("¡Bienvenida! Ya puedes hablar con Wendy.");
    speak("¡Hola! Ya estoy lista. Di «Ey Wendy» cuando me necesites.");
  } else {
    $("#codeError").textContent = response?.status === 429 ? "Demasiados intentos. Espera un minuto." : "PIN incorrecto. Inténtalo de nuevo.";
    $("#codeError").hidden = false;
    $("#codeInput").select();
  }
});
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.vision) askAboutCamera(button.dataset.vision);
    else handleCommand(button.dataset.prompt);
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") stopSpeaking();
});

async function checkStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    geminiAvailable = Boolean(data.gemini);
    if (data.needsCode) {
      // Si hay PIN guardado se comprueba (por si lo cambiaste); si no, se pide.
      const valid = accessCode && (await fetch("/api/verificar", { headers: { "x-wendy-codigo": accessCode } }).catch(() => null))?.ok;
      if (!valid) { accessCode = ""; localStorage.removeItem(CODE_KEY); askForCode(); }
    }
    $("#connectionText").textContent = data.gemini ? "Conectada · base de datos + Gemini" : "Conectada · modo sin IA";
    document.querySelector(".status-dot").style.background = data.gemini ? "#5ef2c2" : "#7cc8ff";
    window.WendyVision?.preload(); // deja listo el reconocimiento de objetos por si Gemini falla
  } catch {
    $("#connectionText").textContent = "Servidor desconectado";
    document.querySelector(".status-dot").style.background = "#f27991";
  }
}

/* ---------------- Inicio ---------------- */
if (!SpeechRec) micButton.title = "Tu navegador no reconoce voz. Usa Chrome o Edge.";
updateVoiceToggle();
render();
updateOrbState();
checkStatus();
if (navigator.brave) {
  micButton.title = "Brave bloquea el reconocimiento de voz: usa Chrome o Edge para hablarle.";
  setTimeout(() => toast("Estás usando Brave: para que Wendy te escuche usa Chrome o Edge (o el archivo «Iniciar Wendy»)."), 800);
} else if (SpeechRec && wakePref()) {
  // Al abrir la página Wendy ya queda escuchando «Ey Wendy».
  setWake(true, { quiet: true });
}
startMeter(); // el micrófono se mueve con tu voz
