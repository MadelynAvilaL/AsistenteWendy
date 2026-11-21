// =========================================================
// Servicios gratuitos de Wendy (no necesitan clave):
// - Clima: Open-Meteo (https://open-meteo.com)
// - Nombre del lugar: OpenStreetMap / Nominatim
// - Imágenes: Pollinations (https://pollinations.ai)
// =========================================================
const USER_AGENT = "WendyAsistente/1.0 (asistente de voz escolar)";

async function getJSON(url, { timeout = 12000, headers = {} } = {}) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) {
    const error = new Error(`El servicio respondió ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
const unique = (list) => [...new Set(list.filter(Boolean))];

/* ---------------- Ubicación ---------------- */
const placeCache = new Map();

// Coordenadas → nombre del lugar
export async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const data = await getJSON(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1&accept-language=es`
  );
  const a = data.address || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || "";
  const zone = a.suburb || a.neighbourhood || a.quarter || a.city_district || "";
  const place = {
    city: city || a.state || "tu zona",
    label: unique([zone, city, a.state !== city ? a.state : "", a.country]).join(", ") || data.display_name || "un lugar desconocido"
  };
  placeCache.set(key, place);
  return place;
}

// Nombre de ciudad → coordenadas
export async function geocodeCity(name) {
  const data = await getJSON(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=es&format=json`
  );
  const r = data.results?.[0];
  if (!r) return null;
  return { lat: r.latitude, lon: r.longitude, city: r.name, label: unique([r.name, r.admin1, r.country]).join(", ") };
}

/* ---------------- Clima ---------------- */
const WMO = {
  0: "cielo despejado", 1: "cielo mayormente despejado", 2: "cielo parcialmente nublado", 3: "cielo nublado",
  45: "neblina", 48: "neblina", 51: "llovizna ligera", 53: "llovizna", 55: "llovizna intensa",
  56: "llovizna helada", 57: "llovizna helada", 61: "lluvia ligera", 63: "lluvia moderada", 65: "lluvia fuerte",
  66: "lluvia helada", 67: "lluvia helada", 71: "nevada ligera", 73: "nevada", 75: "nevada fuerte", 77: "granizo fino",
  80: "chubascos ligeros", 81: "chubascos", 82: "chubascos fuertes", 85: "chubascos de nieve", 86: "chubascos de nieve",
  95: "tormenta eléctrica", 96: "tormenta con granizo", 99: "tormenta con granizo"
};
const r0 = (n) => Math.round(Number(n));

export async function getWeather({ lat, lon, place, day = 0 }) {
  const url = "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=auto&forecast_days=3";
  const data = await getJSON(url);
  const d = data.daily || {};
  const i = Math.min(day, (d.time?.length || 1) - 1);
  const max = r0(d.temperature_2m_max?.[i]);
  const min = r0(d.temperature_2m_min?.[i]);
  const rain = d.precipitation_probability_max?.[i];
  const dayDesc = WMO[d.weather_code?.[i]] || "clima variable";
  const rainText = Number.isFinite(rain) ? `${rain} por ciento de probabilidad de lluvia` : "";
  const umbrella = Number(rain) >= 60 ? " Te recomiendo llevar paraguas." : "";

  if (day === 0 && data.current) {
    const c = data.current;
    const now = WMO[c.weather_code] || "clima variable";
    return `Ahora en ${place} hay ${r0(c.temperature_2m)} grados, con ${now}. ` +
      `Se siente como ${r0(c.apparent_temperature)} grados y la humedad es de ${r0(c.relative_humidity_2m)} por ciento. ` +
      `Hoy la máxima será de ${max} y la mínima de ${min} grados${rainText ? `, con ${rainText}` : ""}.${umbrella}`;
  }
  const when = day === 1 ? "Mañana" : "Pasado mañana";
  return `${when} en ${place} se espera ${dayDesc}, con máxima de ${max} y mínima de ${min} grados${rainText ? ` y ${rainText}` : ""}.${umbrella}`;
}

/* ---------------- Imágenes ---------------- */
// Pedidos que no se dibujan.
export const BLOCKED_IMAGE = /\b(desnud\w*|porn\w*|sexo|sexual\w*|nsfw|hentai|er[oó]tic\w*|naked|nude\w*|lencer[ií]a|gore|sangrient\w*|desmembr\w*|decapit\w*|cad[aá]ver\w*|suicid\w*|violaci[oó]n|rape|tortur\w*|nazi\w*|esv[aá]stica)\b/i;

// Arma el enlace de la imagen. El navegador la descarga directamente de Pollinations
// (así no hay que esperar en el servidor y funciona igual en Netlify).
// - Sin clave: se usa el servicio gratuito sin registro (image.pollinations.ai), que acepta ~1 pedido cada 15 s.
// - Con POLLINATIONS_KEY (clave pública «pk_…» gratis en https://enter.pollinations.ai): más rápido y estable.
export function imageUrl(prompt, { width = 1024, height = 768, seed, key = "" } = {}) {
  if (!Number.isInteger(seed)) seed = Math.floor(Math.random() * 1e9);
  const text = encodeURIComponent(prompt);
  const common = `width=${width}&height=${height}&seed=${seed}&nologo=true&safe=true&model=flux&referrer=wendy-ia`;
  const free = `https://image.pollinations.ai/prompt/${text}?${common}`;
  const urls = key ? [`https://gen.pollinations.ai/image/${text}?${common}&key=${encodeURIComponent(key)}`, free] : [free];
  // Copia de respaldo más pequeña (sale más rápido cuando el servicio está saturado).
  urls.push(`https://image.pollinations.ai/prompt/${text}?width=768&height=576&seed=${seed + 1}&nologo=true&safe=true&referrer=wendy-ia`);
  return { seed, url: urls[0], backups: urls.slice(1) };
}
