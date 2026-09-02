/* 操縦操作の練習シミュレーター（three.js）。
   世界座標: x=東 y=北 z=上（単位 m）。機体の向きは方位 h（北 0°、時計回り）、ピッチ p（機首上げ正）、バンク b（右バンク正）で
   R = Rz(−h)·Rx(p)·Ry(b)。出題と同じ向きの約束（操縦桿右 → 右バンク → 景色は左に傾く、右方向舵 → 右を向く → 景色は左へ流れる）。
   ±LIMIT m の四角い空間の中を一定速度で飛び、壁と地面で止まる。 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const D = Math.PI / 180;
export const LIMIT = 1500;                       // 壁までの距離（原点から、m）
export const SPEED = 60;                         // 速度（m/s、固定）
const RATE = { roll: 60, pitch: 25, yaw: 20 };   // 入力 1 のときの角速度（°/s）
const START = { x: 0, y: -450, z: 80, h: 0 };    // 開始位置: 滑走路の南端上空、北向き

/* CSS 変数（昼／夜の配色）を色として読む。最初に見つかった変数を使う */
function cssColor(names, fallback) {
  const cs = getComputedStyle(document.body);
  for (const n of names) { const v = cs.getPropertyValue(n).trim(); if (v) return new THREE.Color(v); }
  return new THREE.Color(fallback);
}
const hex = c => '#' + c.getHexString();
let seed = 12345; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;   // 配置を毎回同じにする

/* 地面の格子テクスチャ: 1 タイル = 500 m、細線 100 m ごと、外周は太線 */
function gridTexture(base, line, alpha = 1, fill = true) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  if (fill) { g.fillStyle = base; g.fillRect(0, 0, S, S); } else g.clearRect(0, 0, S, S);
  g.globalAlpha = alpha; g.strokeStyle = line;
  for (let i = 1; i < 5; i++) { g.lineWidth = 2; g.beginPath(); g.moveTo(i * S / 5, 0); g.lineTo(i * S / 5, S); g.moveTo(0, i * S / 5); g.lineTo(S, i * S / 5); g.stroke(); }
  g.lineWidth = 6; g.strokeRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function mount(container, { onState, view = 'first' } = {}) {
  const scene = document.body.dataset.scene || 'day', night = scene === 'night', dim = scene === 'dawn' || scene === 'dusk';
  const col = {
    skyTop: cssColor(['--ck-sky-top', '--ck-sky', '--sky'], '#2f86e0'), skyHz: cssColor(['--ck-sky-hz', '--ck-sky', '--sky'], '#b4dcf7'),
    earth: cssColor(['--ck-earth', '--earth'], '#9a6535'), mtn: cssColor(['--ck-mtn'], '#6b8199'), snow: cssColor(['--ck-snow'], '#f6f9fc'),
  };

  /* ---- 描画器 ---- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cv = renderer.domElement; cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
  container.appendChild(cv);
  const world = new THREE.Scene();
  world.fog = new THREE.Fog(col.skyHz, 1200, 5200);

  /* 空: 上から水平線への縦グラデーションの大きな球（霧の影響を受けない） */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: col.skyTop }, hz: { value: col.skyHz } },
    vertexShader: 'varying float vz; void main(){ vz = normalize(position).z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hz; varying float vz; void main(){ float k = smoothstep(0.0, 0.45, vz); gl_FragColor = vec4(mix(hz, top, k), 1.0); }'
  }));
  world.add(sky);
  if (night) {   // 星
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, e = Math.asin(0.05 + rnd() * 0.95), r = 5500; pos.set([r * Math.cos(e) * Math.cos(a), r * Math.cos(e) * Math.sin(a), r * Math.sin(e)], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    world.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe3eaf5, size: 2.2, sizeAttenuation: false, fog: false })));
  }

  /* 光: 昼は明るく、朝夕はやや弱く、夜は暗く */
  /* 夜は月明かりとして青白い光を十分に当てる（暗すぎると見え方の練習にならない） */
  if (night) { col.earth = col.earth.clone().lerp(new THREE.Color(0x4a5566), 0.5); col.mtn = col.mtn.clone().lerp(new THREE.Color(0x6b7a90), 0.45); }
  const li = night ? 1.2 : dim ? 1.3 : 2.0;
  world.add(new THREE.HemisphereLight(night ? new THREE.Color(0x9fb4d8) : col.skyTop, col.earth, li));
  world.add(new THREE.AmbientLight(night ? 0xb8c4dc : 0xffffff, night ? 0.6 : 0.45));
  const sun = new THREE.DirectionalLight(night ? 0xc9d6f0 : 0xffffff, night ? 0.9 : dim ? 0.9 : 1.2); sun.position.set(dim ? 1 : 0.4, dim ? -0.3 : -0.6, dim ? 0.25 : 1).multiplyScalar(1000); world.add(sun);

  /* 地面（格子つき）と滑走路 */
  const lineCol = hex(col.earth.clone().lerp(new THREE.Color(night ? 0xc0ccdd : 0xffffff), night ? 0.6 : 0.45));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), new THREE.MeshLambertMaterial({ map: gridTexture(hex(col.earth), lineCol) }));
  ground.material.map.repeat.set(14, 14); ground.material.map.offset.set(0.5, 0.5);   // 原点が格子の交点に来る
  world.add(ground);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(48, 1100), new THREE.MeshLambertMaterial({ color: night ? 0x3a3f46 : 0x5d6470 })); runway.position.z = 0.3; world.add(runway);
  const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }), 22), m4 = new THREE.Matrix4();
  for (let i = 0; i < 22; i++) { m4.makeTranslation(0, -525 + i * 50, 0.6); dash.setMatrixAt(i, m4); } world.add(dash);
  [[0, -560], [0, 560]].forEach(([x, y], i) => { const th = new THREE.Mesh(new THREE.PlaneGeometry(48, 14), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 })); th.position.set(x, y, 0.6); world.add(th); });

  /* 壁: 半透明の格子の板。ここまでは自由に飛べる */
  const wallTex = gridTexture('', night ? '#ff8f7a' : '#ff6b57', 0.9, false); wallTex.repeat.set(6, 1);
  const wallMat = new THREE.MeshBasicMaterial({ map: wallTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const wallGeo = new THREE.PlaneGeometry(LIMIT * 2, 500);
  const walls = [];
  [[0, LIMIT, 'x'], [0, -LIMIT, 'x'], [LIMIT, 0, 'y'], [-LIMIT, 0, 'y']].forEach(([x, y, ax]) => {
    const w = new THREE.Mesh(wallGeo, wallMat); w.position.set(x, y, 250);
    if (ax === 'x') w.rotation.x = Math.PI / 2; else { w.rotation.x = Math.PI / 2; w.rotation.y = Math.PI / 2; }
    world.add(w); walls.push(w);
  });

  /* 山: 見え方を学ぶのが目的なので、空間の中の近くに置く。出題の絵と同じく、開始位置の正面やや左に雪山、やや右に塔。
     さらに空間の中に中くらいの山を散らし、壁の外にも遠景の環を置く */
  const mtnMat = new THREE.MeshLambertMaterial({ color: col.mtn }), snowMat = new THREE.MeshLambertMaterial({ color: col.snow });
  const mountain = (x, y, hgt, rad, snow) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, hgt, 8), mtnMat); m.rotation.x = Math.PI / 2; m.position.set(x, y, hgt / 2); world.add(m);
    if (snow) { const s = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.28, hgt * 0.28, 8), snowMat); s.rotation.x = Math.PI / 2; s.position.set(x, y, hgt - hgt * 0.14); world.add(s); }
  };
  mountain(-260, 320, 420, 260, true);                     // 正面左の雪山（開始位置から約 800 m）
  mountain(-520, 700, 300, 220, false); mountain(120, 900, 340, 240, true); mountain(560, 520, 260, 200, false);
  [[-900, -300], [900, -100], [-700, 1100], [800, 1150], [-1100, 600], [1100, 800], [-500, -1000], [700, -900], [-1150, -1000], [1150, -1150], [300, 1300], [-1250, 100]]
    .forEach(([x, y], i) => mountain(x, y, 180 + (i % 4) * 60, 140 + (i % 3) * 50, i % 4 === 3));
  for (let i = 0; i < 24; i++) {                            // 遠景の環（壁の外）
    const a = i / 24 * Math.PI * 2 + rnd() * 0.2, r = 2200 + rnd() * 500, hgt = 400 + rnd() * 500;
    mountain(r * Math.cos(a), r * Math.sin(a), hgt, 300 + rnd() * 300, hgt > 650);
  }

  /* 民家・木・塔（インスタンス描画）。滑走路の帯は空ける */
  const free = (x, y) => !(Math.abs(x) < 90 && Math.abs(y) < 640);
  const pick = () => { for (;;) { const x = -LIMIT + 60 + rnd() * (LIMIT * 2 - 120), y = -LIMIT + 60 + rnd() * (LIMIT * 2 - 120); if (free(x, y)) return [x, y]; } };
  const NH = 260, houses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), NH);
  const roofGeo = new THREE.ConeGeometry(1, 1, 4); roofGeo.rotateX(Math.PI / 2); roofGeo.rotateZ(Math.PI / 4);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial(), NH);
  const wallCols = [0xf1e9d6, 0xe8dcc4, 0xd9d3c7, 0xf5f1e8, 0xcfd6dd], roofCols = [0xb5443a, 0x3f5f8f, 0x6b4a36, 0x4d6b45, 0x8a3b3b];
  const c3 = new THREE.Color(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  for (let i = 0; i < NH; i++) {
    const [x, y] = pick(), w = 8 + rnd() * 8, d = 8 + rnd() * 8, h = 4.5 + rnd() * 4, rot = Math.floor(rnd() * 4) * Math.PI / 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rot);
    m4.compose(v3.set(x, y, h / 2), q, s3.set(w, d, h)); houses.setMatrixAt(i, m4); houses.setColorAt(i, c3.setHex(wallCols[i % wallCols.length]));
    m4.compose(v3.set(x, y, h + 1.6), q, s3.set(w * 0.62, d * 0.62, 3.2)); roofs.setMatrixAt(i, m4); roofs.setColorAt(i, c3.setHex(roofCols[(i * 7) % roofCols.length]));
  }
  world.add(houses, roofs);
  const NT = 320, treeGeo = new THREE.ConeGeometry(1, 1, 6); treeGeo.rotateX(Math.PI / 2);
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial(), NT), trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a4030 }), NT);
  const treeCols = [0x3f7a3a, 0x4f8a44, 0x2f6b3c, 0x5d8f3f];
  q.identity();
  for (let i = 0; i < NT; i++) {
    const [x, y] = pick(), h = 7 + rnd() * 7, r = 2.5 + rnd() * 2;
    m4.compose(v3.set(x, y, 2 + h / 2), q, s3.set(r, r, h)); trees.setMatrixAt(i, m4); trees.setColorAt(i, c3.setHex(treeCols[i % treeCols.length]));
    m4.compose(v3.set(x, y, 1), q, s3.set(1.4, 1.4, 2.2)); trunks.setMatrixAt(i, m4);
  }
  world.add(trees, trunks);
  for (let i = 0; i < 6; i++) {   // 塔（先端は赤）。最初の 1 本は正面右の目印
    const [x, y] = i === 0 ? [230, 260] : pick(), h = i === 0 ? 120 : 60 + rnd() * 70;
    const t = new THREE.Mesh(new THREE.BoxGeometry(4, 4, h), new THREE.MeshLambertMaterial({ color: 0x8a949e })); t.position.set(x, y, h / 2); world.add(t);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 6), new THREE.MeshBasicMaterial({ color: 0xff5a4a })); tip.position.set(x, y, h + 3); world.add(tip);
  }

  /* 機体（三人称のときだけ表示）と、高度の手がかり（地面の影と垂線） */
  const plane = new THREE.Group(); world.add(plane); plane.visible = false;
  new GLTFLoader().load('model/t4.glb', g => {
    g.scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.metalness = 0; m.roughness = 0.85; m.side = THREE.DoubleSide; }); } });
    const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), k = 13 / Math.max(size.y, 1e-3);   // 全長 13 m
    g.scene.scale.setScalar(k); const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k); g.scene.position.set(-c.x, -c.y, -c.z);
    plane.add(g.scene);
  }, undefined, () => {});
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(7, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })); shadow.position.z = 0.8; world.add(shadow);
  const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
  const drop = new THREE.Line(dropGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })); world.add(drop);

  /* ---- 状態と入力 ---- */
  const st = { x: START.x, y: START.y, z: START.z, h: START.h, p: 0, b: 0, wall: false, ground: false };
  const input = { x: 0, y: 0, r: 0 };   // x: 操縦桿 左右（右 +）、y: 操縦桿 前後（奥 +）、r: 方向舵（右 +）
  let curView = view;
  const cam = new THREE.PerspectiveCamera(70, 1, 0.5, 9000);
  const camPos = new THREE.Vector3(), tmp = new THREE.Vector3(), R = new THREE.Matrix4(), Rh = new THREE.Matrix4(), RX90 = new THREE.Matrix4().makeRotationX(Math.PI / 2), qc = new THREE.Quaternion();
  function rotation() { return R.makeRotationZ(-st.h * D).multiply(new THREE.Matrix4().makeRotationX(st.p * D)).multiply(new THREE.Matrix4().makeRotationY(st.b * D)); }

  function resize() { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  function step(dt) {
    st.b = clamp(st.b + RATE.roll * input.x * dt, -80, 80);
    st.p = clamp(st.p - RATE.pitch * input.y * dt, -60, 60);
    const turn = clamp((9.81 / SPEED) * Math.tan(st.b * D) / D, -30, 30);   // バンクによる旋回（協調旋回）
    st.h = ((st.h + (RATE.yaw * input.r + turn) * dt) % 360 + 360) % 360;
    const cp = Math.cos(st.p * D);
    st.x += Math.sin(st.h * D) * cp * SPEED * dt; st.y += Math.cos(st.h * D) * cp * SPEED * dt; st.z += Math.sin(st.p * D) * SPEED * dt;
    const L = LIMIT - 4; st.wall = Math.abs(st.x) > L || Math.abs(st.y) > L || st.z > 1400;
    st.x = clamp(st.x, -L, L); st.y = clamp(st.y, -L, L); st.z = Math.min(st.z, 1400);
    st.ground = st.z <= 3; if (st.ground) { st.z = 3; if (st.p < 0) st.p = 0; }
  }
  function place() {
    rotation();
    plane.position.set(st.x, st.y, st.z); plane.quaternion.setFromRotationMatrix(R);
    shadow.position.set(st.x, st.y, 0.8); shadow.material.opacity = 0.4 * Math.max(0.15, 1 - st.z / 500);
    drop.position.set(st.x, st.y, 0); drop.scale.z = Math.max(0.1, st.z - 1);
    if (curView === 'third') {
      Rh.makeRotationZ(-st.h * D);
      tmp.set(0, -32, 10).applyMatrix4(Rh).add(plane.position);
      if (camPos.lengthSq() === 0) camPos.copy(tmp); else camPos.lerp(tmp, 0.12);
      cam.position.copy(camPos); cam.up.set(0, 0, 1); cam.lookAt(tmp.set(0, 20, 2).applyMatrix4(Rh).add(plane.position));
    } else {
      cam.position.copy(tmp.set(0, 3.5, 1.0).applyMatrix4(R).add(plane.position));
      cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(R, RX90));
    }
    sky.position.copy(cam.position);
  }

  let running = true, raf = 0, last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt); place(); renderer.render(world, cam);
    if (onState) onState(st);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function setView(v) { curView = v; plane.visible = v === 'third'; cam.fov = v === 'third' ? 55 : 72; cam.updateProjectionMatrix(); camPos.set(0, 0, 0); }
  setView(view);

  return {
    input, state: st, setView,
    level() { st.b = 0; st.p = 0; },
    home() { Object.assign(st, { x: START.x, y: START.y, z: START.z, h: START.h, p: 0, b: 0 }); camPos.set(0, 0, 0); },
    dispose() { running = false; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); cv.remove(); }
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
