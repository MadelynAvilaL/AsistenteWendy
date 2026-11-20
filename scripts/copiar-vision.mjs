// Copia las librerías de visión (TensorFlow.js y COCO-SSD) a public/vendor
// para que funcionen también en Netlify. Se ejecuta solo con «npm install» y «npm run build».
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["node_modules/@tensorflow/tfjs/dist/tf.min.js", "public/vendor/tfjs/tf.min.js"],
  ["node_modules/@tensorflow-models/coco-ssd/dist/coco-ssd.min.js", "public/vendor/coco-ssd/coco-ssd.min.js"],
  ["node_modules/@tensorflow-models/pose-detection/dist/pose-detection.min.js", "public/vendor/pose-detection/pose-detection.min.js"]
];
for (const [from, to] of files) {
  const source = path.join(root, from);
  if (!fs.existsSync(source)) { console.warn(`No encontré ${from}. Ejecuta «npm install».`); continue; }
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  fs.copyFileSync(source, path.join(root, to));
  console.log(`Copiado ${to}`);
}
