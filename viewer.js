/* 説明ページの 3D ビューア。世界座標: x=東(右) y=北(奥) z=上。視点は南から原点を見る。
   機体の向きは方位 h（北 0° 時計回り）とピッチ p（機首上げ正）で R = Rz(−h)·Rx(p)。 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const D = Math.PI / 180;
export const DIRS = [
  { id: 'north', ja: '北', h: 0, p: 0 }, { id: 'south', ja: '南', h: 180, p: 0 }, { id: 'east', ja: '東', h: 90, p: 0 }, { id: 'west', ja: '西', h: 270, p: 0 },
  { id: 'up', ja: '真上', h: 0, p: 90 }, { id: 'down', ja: '真下', h: 0, p: -90 },
  { id: 'ne_up', ja: '北東上', h: 45, p: 30 }, { id: 'nw_up', ja: '北西上', h: 315, p: 30 }, { id: 'se_up', ja: '南東上', h: 135, p: 30 }, { id: 'sw_up', ja: '南西上', h: 225, p: 30 },
  { id: 'ne_down', ja: '北東下', h: 45, p: -30 }, { id: 'nw_down', ja: '北西下', h: 315, p: -30 }, { id: 'se_down', ja: '南東下', h: 135, p: -30 }, { id: 'sw_down', ja: '南西下', h: 225, p: -30 }
];

export async function mount(container, { modelUrl = 'model/t4.glb', onProgress } = {}) {
  const W = () => container.clientWidth, H = () => Math.round(container.clientWidth * 3 / 4);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), H()); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block'; renderer.domElement.style.width = '100%'; renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b8c4, 2.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-3, -4, 6); scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.6); dl2.position.set(4, -2, -3); scene.add(dl2);

  const cam = new THREE.PerspectiveCamera(30, W() / H(), 0.1, 500);
  cam.up.set(0, 0, 1);
  const HOME = new THREE.Vector3(0, -24, 0);
  cam.position.copy(HOME); cam.lookAt(0, 0, 0);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 9; controls.maxDistance = 80; controls.enablePan = false;

  /* 地面の格子（z = −6 の水平面）と方位の矢印 */
  const grid = new THREE.GridHelper(40, 20, 0x66788a, 0x3a4656); grid.rotation.x = Math.PI / 2; grid.position.z = -6; scene.add(grid);
  /* 方位の札（北・東・南・西）。板ではなく常に正面を向くスプライトなので、視点を回しても読める */
  function dirLabel(text, color) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.font = 'bold 92px "Zen Kaku Gothic New", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(text, 64, 70);
    g.fillStyle = color; g.fillText(text, 64, 70);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(4.2, 4.2, 1); return sp;
  }
  const marks = new THREE.Group();
  for (const [t, x, y, col, s] of [['北', 0, 17, '#1f8f5a', 1.35], ['東', 17, 0, '#c0392b', 1], ['南', 0, -17, '#3c4b5c', 1], ['西', -17, 0, '#3c4b5c', 1]]) {
    const sp = dirLabel(t, col); sp.position.set(x, y, -5); sp.scale.multiplyScalar(s); marks.add(sp);
  }
  scene.add(marks);

  const axes = new THREE.Group();
  axes.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -6), 12, 0xff6b6b, 1.6, 0.9));
  axes.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -6), 12, 0x3ed48a, 1.6, 0.9));
  axes.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -6), 10, 0x5ab0ff, 1.6, 0.9));
  scene.add(axes);

  const pivot = new THREE.Group(); scene.add(pivot);
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => loader.load(modelUrl, res, e => { if (onProgress && e.total) onProgress(e.loaded / e.total); }, rej));
  gltf.scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.metalness = 0; m.roughness = 0.85; m.side = THREE.DoubleSide; }); } });
  pivot.add(gltf.scene);

  /* 向きの切り替え（短いアニメーション付き） */
  let qFrom = new THREE.Quaternion(), qTo = new THREE.Quaternion(), t0 = 0, animating = false;
  function targetQuat(h, p) { return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeRotationZ(-h * D).multiply(new THREE.Matrix4().makeRotationX(p * D))); }
  function setDir(h, p, animate = true) {
    qFrom.copy(pivot.quaternion); qTo = targetQuat(h, p);
    if (!animate) { pivot.quaternion.copy(qTo); return; }
    t0 = performance.now(); animating = true;
  }
  function resetCamera() { cam.position.copy(HOME); controls.target.set(0, 0, 0); controls.update(); }

  let running = true, raf = 0;
  function frame(now) {
    if (!running) return;
    if (animating) { const k = Math.min(1, (now - t0) / 450), e = k < .5 ? 2 * k * k : -1 + (4 - 2 * k) * k; pivot.quaternion.slerpQuaternions(qFrom, qTo, e); if (k >= 1) animating = false; }
    controls.update(); renderer.render(scene, cam); raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  const onResize = () => { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); };
  window.addEventListener('resize', onResize);

  return {
    setDir, resetCamera,
    pause() { running = false; cancelAnimationFrame(raf); },
    resume() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    dispose() { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); }
  };
}
