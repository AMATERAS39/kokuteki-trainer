/* 機体の絵をその場で描く（空間認識 A と、複合の Max「計器 → 機体の絵」）。
   26 方向の絵（img/bi-*.webp）は描画ページ dev/render/render.html で 3D モデルから作った固定の絵で、
   バンク 90°・背面・30°/60° の微妙な角度・16 方位は描けない。ここでは同じモデル（model/t4.glb）を同じ視点・同じ光で
   小さな WebGL の画布に描き、data URL にして <img> に入れる。描く向きの決め方（R = Rz(−h)·Rx(p)·Ry(b)）は
   viewer.js・render.html・engine.js の attMat と同じ。視点は南（−y）から原点、上は +z。 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const D = Math.PI / 180;
let inst = null;

export function ready() { return inst ? inst.ready : null; }

/* 一度だけ作る。size: 画布の一辺（px）。絵は正方形で、機体がどの向きでも枠に入る大きさ（描画ページの dist 36・fov 28 に合わせ、
   視野を少し狭めて機体を大きく写す） */
export function shooter(opts = {}) {
  if (inst) return inst;
  const size = opts.size || 512;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }); }
  catch (e) { inst = { ready: Promise.reject(e), shot: () => null, ok: false }; return inst; }
  renderer.setPixelRatio(1); renderer.setSize(size, size, false); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  /* 光は描画ページと同じ配置（hemi 2.2・amb 0.6・dir 0.9 (−3,−4,6)・dir2 0.4 (4,−2,−3)）。viewer.js より少し暗めで、固定の絵に近い */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b8c4, 2.2));
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(-3, -4, 6); scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.4); dl2.position.set(4, -2, -3); scene.add(dl2);
  const cam = new THREE.PerspectiveCamera(20, 1, 0.1, 500);   /* dist 36 で一辺 12.7 単位。機体（長さ 10・幅 7.6）はどの向きでも枠に入る */
  cam.up.set(0, 0, 1); cam.position.set(0, -36, 0); cam.lookAt(0, 0, 0);
  const pivot = new THREE.Group(); scene.add(pivot);
  const loader = new GLTFLoader();
  const ready = new Promise((res, rej) => loader.load(opts.modelUrl || 'model/t4.glb?v=2', g => {
    const underGear = o => { let q = o; while (q) { if (/landing|front_gear/i.test(q.name)) return true; q = q.parent; } return false; };
    g.scene.traverse(o => { if (o.isMesh) { if (underGear(o)) o.visible = false;
      const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.metalness = 0; m.roughness = 0.85; m.side = THREE.DoubleSide; }); } });
    pivot.add(g.scene); res(true);
  }, undefined, rej));
  const quat = (h, p, b) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeRotationZ(-h * D)
    .multiply(new THREE.Matrix4().makeRotationX(p * D)).multiply(new THREE.Matrix4().makeRotationY(b * D)));
  const cache = new Map();
  /* 姿勢 (heading, pitch, bank) の絵を data URL で返す。同じ姿勢は控えから。型は webp（対応しない環境は png） */
  function shot(h, p, b) {
    const key = `${Math.round(h * 100)}|${Math.round(p * 100)}|${Math.round(b * 100)}`;
    const hit = cache.get(key); if (hit) return hit;
    pivot.quaternion.copy(quat(h, p, b));
    renderer.render(scene, cam);
    let url = canvas.toDataURL('image/webp', 0.9);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
    cache.set(key, url); if (cache.size > 240) cache.delete(cache.keys().next().value);
    return url;
  }
  inst = { ready, shot, ok: true, canvas };
  return inst;
}
