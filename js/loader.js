/* Carga de modelos .glb + texturas.
   - Las PNG viajan dentro de cada .glb: las extraigo y decodifico yo (sin fetch/blob: del cargador de Three.js).
   - normalize(): ignora la posición de Blender, centra el modelo y lo escala a un tamaño de juego.
   - Para las paredes se baja la pared frontal (caja abierta) y se devuelve el modelo ya colocado. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { P, TILE, CFG } from './config.js';

const gltfLoader = new GLTFLoader();
const parseGLB = buf => new Promise((res, rej) => gltfLoader.parse(buf, '', res, rej));

/* ---- Texturas: las PNG viajan dentro de cada .glb. Las extraigo yo y las decodifico sin fetch/blob: del cargador
        (algunos visores/sandboxes lo bloquean y los modelos salían lisos). ---- */
export const TEX = { n: 0, expected: 0, errors: [] };
function splitGLB(buf) {
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binLen = dv.getUint32(20 + jsonLen, true);
  const bin = new Uint8Array(buf, 20 + jsonLen + 8, binLen);
  const images = (json.images || []).map(im => {
    const bv = json.bufferViews[im.bufferView], o = bv.byteOffset || 0;
    return { bytes: bin.slice(o, o + bv.byteLength), mime: im.mimeType || 'image/png' };
  });
  const matTex = {};                                  // nombre de material → índice de imagen
  (json.materials || []).forEach(m => {
    const pbr = m.pbrMetallicRoughness;
    if (pbr && pbr.baseColorTexture) { matTex[m.name] = json.textures[pbr.baseColorTexture.index].source; delete pbr.baseColorTexture; }
  });
  delete json.textures; delete json.images; delete json.samplers;
  const js = new TextEncoder().encode(JSON.stringify(json)), pad = (4 - js.length % 4) % 4;
  const jb = new Uint8Array(js.length + pad).fill(0x20); jb.set(js);
  const total = 12 + 8 + jb.length + 8 + binLen, out = new ArrayBuffer(total), o = new DataView(out), ob = new Uint8Array(out);
  o.setUint32(0, 0x46546C67, true); o.setUint32(4, 2, true); o.setUint32(8, total, true);
  o.setUint32(12, jb.length, true); o.setUint32(16, 0x4E4F534A, true); ob.set(jb, 20);
  const p = 20 + jb.length; o.setUint32(p, binLen, true); o.setUint32(p + 4, 0x004E4942, true); ob.set(bin, p + 8);
  return { glb: out, images, matTex };
}
const u8ToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function makeTexture(img) {
  let src;
  try { src = await createImageBitmap(new Blob([img.bytes], { type: img.mime })); }
  catch (e) {
    src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('no se pudo decodificar la imagen')); im.src = 'data:' + img.mime + ';base64,' + u8ToB64(img.bytes); });
  }
  const tex = new THREE.Texture(src);
  tex.flipY = false;                                   // convención glTF
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = R.capabilities.getMaxAnisotropy();
  if (CFG.texturePixelated) tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
async function applyTextures(root, info, name) {
  TEX.expected += Object.keys(info.matTex).length;
  const cache = {};
  const mats = new Set(); root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); });
  for (const m of mats) {
    const idx = info.matTex[m.name]; if (idx === undefined) continue;
    try {
      cache[idx] = cache[idx] || await makeTexture(info.images[idx]);
      m.map = cache[idx]; m.color.set(0xffffff); m.needsUpdate = true; TEX.n++;
    } catch (e) { TEX.errors.push(name + ': ' + e.message); console.error('Textura', name, e); }
  }
}


// Brillo propio de los materiales “mágicos” (por nombre de material de tu Blender)
const GLOW = { 'Material.002': 2.4, 'Material.012': 2.4, 'Material.007': 1.3, 'Material.015': 1.6, 'Material.016': 0.35 };

/** Normaliza un modelo: ignora la posición del Blender, lo centra en XZ, apoya su base en y=0
 *  y lo escala para que su huella (max X/Z) mida `footprint` (o conserva escala nativa si es null). */
function normalize(scene3d, footprint) {
  scene3d.children.forEach(n => n.position.set(0, 0, 0));
  scene3d.updateMatrixWorld(true);
  const b0 = new THREE.Box3().setFromObject(scene3d, true), s0 = b0.getSize(new THREE.Vector3());
  const s = footprint ? footprint / Math.max(s0.x, s0.z) : 1;
  const holder = new THREE.Group(); holder.add(scene3d); scene3d.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(holder, true), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
  scene3d.position.set(-c.x, -b.min.y, -c.z);
  holder.userData = { w: sz.x, h: sz.y, d: sz.z };
  scene3d.traverse(o => {
    if (o.isMesh) {
      o.frustumCulled = false;
      const maxAniso = R.capabilities.getMaxAnisotropy();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { for (const k of ['map', 'emissiveMap']) if (m[k]) m[k].anisotropy = maxAniso; });
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { const k = GLOW[m.name]; if (k && m.color) { m.emissive = m.color.clone(); m.emissiveIntensity = k; } });
    }
  });
  return holder;
}

const MODEL_NAMES = ['Baldosa', 'Trampa', 'Paredes', 'Lumen', 'Dash', 'Escudo', 'Diamante', 'Guardian'];   // archivos en assets/models/
let R = null;                                   // renderer (para el filtro anisotrópico)
/** Carga todos los .glb, aplica sus texturas y devuelve los prototipos listos para clonar. */
export async function loadAll(renderer, onProgress) {
  R = renderer;
  const PROTO = {};
  const names = MODEL_NAMES; let done = 0;
  const res = await Promise.all(names.map(async n => {
    const url = CFG.paths.models + n + '.glb';
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se encontró ${url} (¿abriste el proyecto con Live Server / servidor local?)`);
    const info = splitGLB(await r.arrayBuffer());
    const g = await parseGLB(info.glb);
    await applyTextures(g.scene, info, n);
    if (onProgress) onProgress(++done, names.length);
    return [n, g];
  }));
  const G = Object.fromEntries(res);

  PROTO.tile  = normalize(G.Baldosa.scene, TILE);
  PROTO.trap  = normalize(G.Trampa.scene, TILE);
  PROTO.lumen = normalize(G.Lumen.scene, CFG.lumenSize);
  PROTO.dash  = normalize(G.Dash.scene, 0.34);
  PROTO.shield= normalize(G.Escudo.scene, 0.42);
  PROTO.crystal = normalize(G.Diamante.scene, 0.36);   // Diamante.glb → cristal láser
  PROTO.guardian = normalize(G.Guardian.scene, 2 * P - 0.04);  // Guardian.glb → ocupa 2×2 baldosas

  // Orbe de velocidad: procedural (no tenías modelo para él)
  const sp = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), new THREE.MeshStandardMaterial({ color: 0x1b6b3a, emissive: 0x2dff8f, emissiveIntensity: 1.6, roughness: .3 }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2dff8f, transparent: true, opacity: .18, depthWrite: false }));
  sp.add(core, halo); core.position.y = halo.position.y = 0.15;
  PROTO.speed = sp;

  // Paredes: se conserva tu escala; la pared frontal se baja para que la cámara vea la sala (caja abierta)
  const wallsHolder = normalize(G.Paredes.scene, null);
  wallsHolder.traverse(o => {
    if (!o.isMesh) return;
    o.geometry = o.geometry.clone();
    o.updateWorldMatrix(true, false);
    const pa = o.geometry.attributes.position, v = new THREE.Vector3(), m = o.matrixWorld;
    const ymin = new THREE.Box3().setFromObject(o, true).min.y;
    const inv = m.clone().invert();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      const t = THREE.MathUtils.smoothstep(v.z, 1.3, 2.4);
      v.y = ymin + (v.y - ymin) * (1 - 0.78 * t);
      v.applyMatrix4(inv); pa.setXYZ(i, v.x, v.y, v.z);
    }
    pa.needsUpdate = true; o.geometry.computeVertexNormals();
  });
  // el modelo normalizado queda con la base en y=0 → lo bajamos para que su centro quede en y=0 (suelo = tope de baldosas)
  wallsHolder.position.y = -wallsHolder.userData.h / 2;
  wallsHolder.updateMatrixWorld(true);
  return { PROTO, walls: wallsHolder };
}

