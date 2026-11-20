/* =========================================================
   Alertas de Wendy (sin IA, en el navegador y muy rápidas)
   Usa MoveNet (detección de posturas, hasta 6 personas) para saber:
   - a qué distancia está cada persona (estimado)
   - si tiene las manos o una mano levantada, o está saludando
   - si se está acercando
   - si parece estar en el suelo (posible caída)
   ========================================================= */
(function () {
  let detectorPromise = null;
  const history = new Map(); // id de persona → datos recientes
  const MIN_SCORE = 0.3;

  // Ajuste de distancia: ancho promedio de hombros (m) y ángulo de visión típico de una webcam.
  const SHOULDER_WIDTH_M = 0.40;
  const EYE_DISTANCE_M = 0.063;
  const HFOV_DEG = 65;
  const FOCAL_FACTOR = 0.5 / Math.tan((HFOV_DEG * Math.PI) / 360); // focal en píxeles = ancho × este factor
  const calibration = () => Number(localStorage.getItem("wendy_calibracion_distancia")) || 1;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });
  }

  function ready() {
    if (!detectorPromise) {
      detectorPromise = (async () => {
        await window.WendyVision.ready(); // carga TensorFlow.js
        if (!window.poseDetection) await loadScript("/vendor/pose-detection/pose-detection.min.js");
        const pd = window.poseDetection;
        return pd.createDetector(pd.SupportedModels.MoveNet, {
          modelType: pd.movenet.modelType.MULTIPOSE_LIGHTNING,
          enableTracking: true,
          trackerType: pd.TrackerType.BoundingBox
        });
      })().catch((error) => { detectorPromise = null; throw error; });
    }
    return detectorPromise;
  }

  const kp = (pose, name) => {
    const p = pose.keypoints.find((k) => k.name === name);
    return p && p.score >= MIN_SCORE ? p : null;
  };
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function estimateDistance(pose, width) {
    const focal = width * FOCAL_FACTOR;
    const ls = kp(pose, "left_shoulder");
    const rs = kp(pose, "right_shoulder");
    const lh = kp(pose, "left_hip");
    const rh = kp(pose, "right_hip");
    if (ls && rs) {
      // Si la persona está de lado o acostada, los hombros se ven juntos: usamos también el torso (~50 cm).
      let px = dist2(ls, rs);
      if (lh || rh) {
        const s = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        const h = lh && rh ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } : lh || rh;
        px = Math.max(px, dist2(s, h) * (SHOULDER_WIDTH_M / 0.5));
      }
      if (px > 8) return ((SHOULDER_WIDTH_M * focal) / px) * calibration();
    }
    const le = kp(pose, "left_eye");
    const re = kp(pose, "right_eye");
    if (le && re) {
      const px = dist2(le, re);
      if (px > 3) return ((EYE_DISTANCE_M * focal) / px) * calibration();
    }
    return null;
  }

  function analyzePose(pose, width, now) {
    const nose = kp(pose, "nose");
    const ls = kp(pose, "left_shoulder");
    const rs = kp(pose, "right_shoulder");
    const lw = kp(pose, "left_wrist");
    const rw = kp(pose, "right_wrist");
    const lh = kp(pose, "left_hip");
    const rh = kp(pose, "right_hip");
    const shoulderY = ls && rs ? Math.min(ls.y, rs.y) : (ls || rs)?.y;
    const shoulderW = ls && rs ? dist2(ls, rs) : 60;
    // Una mano está «levantada» si la muñeca está claramente por encima del hombro (o de la nariz).
    const above = (w) => w && shoulderY != null && w.y < shoulderY - shoulderW * 0.35 && (!nose || w.y < nose.y + shoulderW * 0.2);
    const leftUp = above(lw);
    const rightUp = above(rw);

    // Torso acostado: hombros y caderas casi a la misma altura y separados de lado → posible caída.
    let lying = false;
    if ((ls || rs) && (lh || rh)) {
      const s = ls && rs ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 } : ls || rs;
      const h = lh && rh ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } : lh || rh;
      lying = Math.abs(s.x - h.x) > Math.abs(s.y - h.y) * 1.4 && Math.hypot(s.x - h.x, s.y - h.y) > 25;
    }

    const id = pose.id ?? `${Math.round((nose?.x || 0) / 50)}`;
    const distance = estimateDistance(pose, width);
    const h = history.get(id) || { distances: [], wrists: [], lyingSince: 0, firstSeen: now };
    h.lastSeen = now;
    if (distance) h.distances.push({ t: now, d: distance });
    h.distances = h.distances.filter((x) => now - x.t < 2500);
    const upWrist = leftUp ? lw : rightUp ? rw : null;
    if (upWrist) h.wrists.push({ t: now, x: upWrist.x });
    h.wrists = h.wrists.filter((x) => now - x.t < 1600);
    h.lyingSince = lying ? h.lyingSince || now : 0;
    history.set(id, h);

    // ¿Se acerca? La distancia bajó más de 60 cm en los últimos 2.5 s.
    const approaching = h.distances.length > 3 && h.distances[0].d - h.distances[h.distances.length - 1].d > 0.6;
    // ¿Saluda? La mano levantada va y viene de lado varias veces.
    let waving = false;
    if (h.wrists.length > 5) {
      let changes = 0;
      let lastDir = 0;
      for (let i = 1; i < h.wrists.length; i++) {
        const dx = h.wrists[i].x - h.wrists[i - 1].x;
        if (Math.abs(dx) < shoulderW * 0.08) continue;
        const dir = Math.sign(dx);
        if (lastDir && dir !== lastDir) changes++;
        lastDir = dir;
      }
      waving = changes >= 2;
    }
    return {
      id,
      pose,
      distance,
      handsUp: leftUp && rightUp,
      oneHandUp: (leftUp || rightUp) && !(leftUp && rightUp),
      waving,
      approaching,
      fallen: Boolean(h.lyingSince && now - h.lyingSince > 700),
      isNew: now - h.firstSeen < 400
    };
  }

  function distanceText(d) {
    if (d == null) return "";
    if (d < 1) return "a menos de 1 metro";
    const rounded = Math.round(d * 2) / 2;
    return `a unos ${String(rounded).replace(".", ",")} metros`;
  }

  // Frase corta con lo que hace una persona.
  function describePerson(p) {
    const parts = [];
    if (p.fallen) parts.push("en el suelo");
    else if (p.handsUp) parts.push("con las manos levantadas");
    else if (p.waving) parts.push("saludando");
    else if (p.oneHandUp) parts.push("con una mano levantada");
    if (p.approaching) parts.push("acercándose");
    const where = distanceText(p.distance);
    return `Persona${where ? " " + where : ""}${parts.length ? ", " + parts.join(", ") : ""}`;
  }

  // Analiza un cuadro del video. Devuelve personas y alertas.
  async function analyze(video) {
    const detector = await ready();
    const now = performance.now();
    const poses = await detector.estimatePoses(video, { maxPoses: 6, flipHorizontal: false });
    const people = poses.filter((p) => (p.score ?? 1) > 0.25).map((p) => analyzePose(p, video.videoWidth, now));
    for (const [id, h] of history) if (now - h.lastSeen > 3000) history.delete(id);

    const alerts = [];
    for (const p of people) {
      const who = people.length > 1 ? "Una persona" : "Persona";
      if (p.fallen) alerts.push({ type: `caida-${p.id}`, level: 3, text: `¡Alerta! ${who} en el suelo, posible caída.` });
      if (p.distance != null && p.distance < 1) alerts.push({ type: `cerca-${p.id}`, level: 2, text: `¡Alerta! ${who} a menos de 1 metro.` });
      if (p.handsUp) alerts.push({ type: `manos-${p.id}`, level: 2, text: `${who} con las manos levantadas.` });
      else if (p.waving) alerts.push({ type: `saluda-${p.id}`, level: 1, text: `${who} saludando.` });
      else if (p.oneHandUp) alerts.push({ type: `mano-${p.id}`, level: 1, text: `${who} con una mano levantada.` });
      if (p.approaching && !(p.distance != null && p.distance < 1)) alerts.push({ type: `acerca-${p.id}`, level: 1, text: `${who} acercándose.` });
    }
    return { people, alerts, describePerson };
  }

  // Esqueleto para dibujar sobre el video.
  const BONES = [
    ["left_shoulder", "right_shoulder"], ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"], ["left_shoulder", "left_hip"],
    ["right_shoulder", "right_hip"], ["left_hip", "right_hip"], ["left_hip", "left_knee"], ["left_knee", "left_ankle"],
    ["right_hip", "right_knee"], ["right_knee", "right_ankle"]
  ];

  window.WendyAlerts = { ready, analyze, describePerson, distanceText, BONES, keypoint: kp };
})();
