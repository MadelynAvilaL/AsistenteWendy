/* =========================================================
   Visión sin IA: reconoce objetos dentro del navegador
   con TensorFlow.js + COCO-SSD (80 tipos de objetos).
   Se usa cuando Gemini no está disponible.
   ========================================================= */
(function () {
  // [singular, plural, género]
  const OBJETOS = {
    person: ["persona", "personas", "f"], bicycle: ["bicicleta", "bicicletas", "f"], car: ["carro", "carros", "m"],
    motorcycle: ["moto", "motos", "f"], airplane: ["avión", "aviones", "m"], bus: ["bus", "buses", "m"],
    train: ["tren", "trenes", "m"], truck: ["camión", "camiones", "m"], boat: ["barco", "barcos", "m"],
    "traffic light": ["semáforo", "semáforos", "m"], "fire hydrant": ["hidrante", "hidrantes", "m"],
    "stop sign": ["señal de alto", "señales de alto", "f"], "parking meter": ["parquímetro", "parquímetros", "m"],
    bench: ["banca", "bancas", "f"], bird: ["pájaro", "pájaros", "m"], cat: ["gato", "gatos", "m"],
    dog: ["perro", "perros", "m"], horse: ["caballo", "caballos", "m"], sheep: ["oveja", "ovejas", "f"],
    cow: ["vaca", "vacas", "f"], elephant: ["elefante", "elefantes", "m"], bear: ["oso", "osos", "m"],
    zebra: ["cebra", "cebras", "f"], giraffe: ["jirafa", "jirafas", "f"], backpack: ["mochila", "mochilas", "f"],
    umbrella: ["paraguas", "paraguas", "m"], handbag: ["bolsa", "bolsas", "f"], tie: ["corbata", "corbatas", "f"],
    suitcase: ["maleta", "maletas", "f"], frisbee: ["frisbee", "frisbees", "m"], skis: ["par de esquís", "pares de esquís", "m"],
    snowboard: ["tabla de snowboard", "tablas de snowboard", "f"], "sports ball": ["pelota", "pelotas", "f"],
    kite: ["barrilete", "barriletes", "m"], "baseball bat": ["bate", "bates", "m"],
    "baseball glove": ["guante de béisbol", "guantes de béisbol", "m"], skateboard: ["patineta", "patinetas", "f"],
    surfboard: ["tabla de surf", "tablas de surf", "f"], "tennis racket": ["raqueta", "raquetas", "f"],
    bottle: ["botella", "botellas", "f"], "wine glass": ["copa", "copas", "f"], cup: ["taza", "tazas", "f"],
    fork: ["tenedor", "tenedores", "m"], knife: ["cuchillo", "cuchillos", "m"], spoon: ["cuchara", "cucharas", "f"],
    bowl: ["tazón", "tazones", "m"], banana: ["banano", "bananos", "m"], apple: ["manzana", "manzanas", "f"],
    sandwich: ["sándwich", "sándwiches", "m"], orange: ["naranja", "naranjas", "f"], broccoli: ["brócoli", "brócolis", "m"],
    carrot: ["zanahoria", "zanahorias", "f"], "hot dog": ["hot dog", "hot dogs", "m"], pizza: ["pizza", "pizzas", "f"],
    donut: ["dona", "donas", "f"], cake: ["pastel", "pasteles", "m"], chair: ["silla", "sillas", "f"],
    couch: ["sillón", "sillones", "m"], "potted plant": ["planta en maceta", "plantas en maceta", "f"],
    bed: ["cama", "camas", "f"], "dining table": ["mesa", "mesas", "f"], toilet: ["inodoro", "inodoros", "m"],
    tv: ["televisor", "televisores", "m"], laptop: ["computadora portátil", "computadoras portátiles", "f"],
    mouse: ["mouse", "mouses", "m"], remote: ["control remoto", "controles remotos", "m"],
    keyboard: ["teclado", "teclados", "m"], "cell phone": ["celular", "celulares", "m"],
    microwave: ["microondas", "microondas", "m"], oven: ["horno", "hornos", "m"], toaster: ["tostadora", "tostadoras", "f"],
    sink: ["lavamanos", "lavamanos", "m"], refrigerator: ["refrigeradora", "refrigeradoras", "f"],
    book: ["libro", "libros", "m"], clock: ["reloj", "relojes", "m"], vase: ["florero", "floreros", "m"],
    scissors: ["tijera", "tijeras", "f"], "teddy bear": ["oso de peluche", "osos de peluche", "m"],
    "hair drier": ["secadora de pelo", "secadoras de pelo", "f"], toothbrush: ["cepillo de dientes", "cepillos de dientes", "m"]
  };
  const NUMEROS = ["", "", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];

  const modelPromises = {}; // un modelo por tipo: «lite» (en vivo, liviano) y «full» (fotos, más preciso)

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });
  }

  // «lite_mobilenet_v2»: varias veces más liviano, ideal para el modo en vivo (no calienta la laptop).
  // «mobilenet_v2»: más preciso, solo para describir una foto cuando no hay Gemini.
  function loadModel(kind = "lite") {
    if (!modelPromises[kind]) {
      modelPromises[kind] = (async () => {
        if (!window.tf) await loadScript("/vendor/tfjs/tf.min.js");
        if (!window.cocoSsd) await loadScript("/vendor/coco-ssd/coco-ssd.min.js");
        try { await window.tf.setBackend("webgl"); await window.tf.ready(); } catch { /* usa el que haya */ }
        return window.cocoSsd.load({ base: kind === "full" ? "mobilenet_v2" : "lite_mobilenet_v2" });
      })().catch((error) => {
        delete modelPromises[kind]; // permite reintentar
        throw error;
      });
    }
    return modelPromises[kind];
  }

  function nombre(clase, cantidad) {
    const [singular, plural, genero] = OBJETOS[clase] || [clase, clase + "s", "m"];
    if (cantidad === 1) return `${genero === "f" ? "una" : "un"} ${singular}`;
    return `${NUMEROS[cantidad] || cantidad} ${plural}`;
  }
  function unirLista(items) {
    if (items.length <= 1) return items[0] || "";
    return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
  }
  function posicion(box, width, mirrored = false) {
    let centro = (box[0] + box[2] / 2) / width;
    if (mirrored) centro = 1 - centro; // en la cámara frontal la imagen se ve como espejo
    return centro < 0.35 ? "a la izquierda" : centro > 0.65 ? "a la derecha" : "al centro";
  }

  function imageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo leer la foto."));
      img.src = dataUrl;
    });
  }

  // Detecta objetos en una imagen, video o canvas.
  async function detect(source, minScore = 0.5, kind = "full") {
    const model = await loadModel(kind);
    return (await model.detect(source, 20)).filter((d) => d.score >= minScore);
  }
  // Para el modo en vivo: modelo liviano sobre una imagen pequeña.
  function detectLive(source, minScore = 0.45) {
    return detect(source, minScore, "lite");
  }

  // Convierte las detecciones en una frase en español.
  function describe(detections, width, mirrored = false) {
    if (!detections.length) return "No reconozco ningún objeto con claridad.";
    const grupos = new Map();
    for (const d of detections) {
      const area = d.bbox[2] * d.bbox[3];
      const g = grupos.get(d.class) || { cantidad: 0, area: 0, box: d.bbox };
      g.cantidad++;
      if (area > g.area) { g.area = area; g.box = d.bbox; }
      grupos.set(d.class, g);
    }
    const ordenados = [...grupos.entries()].sort((a, b) => b[1].area - a[1].area);
    const partes = ordenados.map(([clase, g]) => nombre(clase, g.cantidad));
    const [claseMayor, mayor] = ordenados[0];
    let frase = `Veo ${unirLista(partes)}.`;
    if (mayor.cantidad === 1) {
      const [singular, , genero] = OBJETOS[claseMayor] || [claseMayor, "", "m"];
      frase += ` ${genero === "f" ? "La" : "El"} ${singular} está ${posicion(mayor.box, width, mirrored)}.`;
    }
    return frase;
  }

  // Resumen estable para saber si la escena cambió (ej. «person:2|cup:1»).
  function summaryKey(detections) {
    const counts = {};
    for (const d of detections) counts[d.class] = (counts[d.class] || 0) + 1;
    return Object.keys(counts).sort().map((k) => `${k}:${counts[k]}`).join("|");
  }

  function label(clase) {
    return (OBJETOS[clase] || [clase])[0];
  }

  // Describe una foto (data URL).
  async function describeLocally(dataUrl) {
    const img = await imageFromDataUrl(dataUrl);
    const detections = await detect(img);
    if (!detections.length) return "No reconozco ningún objeto con claridad. Intenta acercar la cámara o poner más luz.";
    return describe(detections, img.naturalWidth);
  }

  window.WendyVision = {
    describeLocally, detect, detectLive, describe, summaryKey, label,
    ready: () => loadModel("lite"),
    preload: () => loadModel("lite").catch(() => {})
  };
})();
