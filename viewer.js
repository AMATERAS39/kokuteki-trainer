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
  { id: 'ne_down', ja: '北東下', h: 45, p: -30 }, { id: 'nw_down', ja: '北西下', h: 315, p: -30 }, { id: 'se_down', ja: '南東下', h: 135, p: -30 }, { id: 'sw_down', ja: '南西下', h: 225, p: -30 },
  /* v05.74: 26 方向に */
  { id: 'north_up', ja: '北上', h: 0, p: 30 },
  { id: 'north_down', ja: '北下', h: 0, p: -30 },
  { id: 'east_up', ja: '東上', h: 90, p: 30 },
  { id: 'east_down', ja: '東下', h: 90, p: -30 },
  { id: 'south_up', ja: '南上', h: 180, p: 30 },
  { id: 'south_down', ja: '南下', h: 180, p: -30 },
  { id: 'west_up', ja: '西上', h: 270, p: 30 },
  { id: 'west_down', ja: '西下', h: 270, p: -30 },
  { id: 'ne', ja: '北東', h: 45, p: 0 },
  { id: 'nw', ja: '北西', h: 315, p: 0 },
  { id: 'se', ja: '南東', h: 135, p: 0 },
  { id: 'sw', ja: '南西', h: 225, p: 0 }
];

/* bare: 格子と軸を出さない（記録の「姿勢のレーダー」用。方位の札は出す）。onMarker: 頂点をタップしたときに id を渡す */
/* plain（v06.11、空間認識の解説）: 格子・東西南北の札・軸・羅針盤を出さず、視点は南から固定（回せない）。機体は常に中央
   free（v06.35、アプリ説明の「機体を見る」）: 同じく飾りは出さないが、視点は自由に回せる。機体を眺めるだけの画面 */
export async function mount(container, { modelUrl = 'model/t4.glb?v=2', onProgress, bare = false, plain = false, free = false, onMarker = null, onReset = null } = {}) {
  const noDeco = plain || free;   /* 格子・札・軸を出さない */
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
  const HOME = bare ? new THREE.Vector3(0, -32, 16) : plain ? new THREE.Vector3(0, -23.6, 4.2) : free ? new THREE.Vector3(0, -26, 7) : new THREE.Vector3(0, -24, 0);   /* plain: 南から、少しだけ上（仰角 10°）。真横だと機体の上下軸まわりの弧が線に見えて回る向きが分からない */   /* bare（レーダー）は多面体の全体と羅針盤が見えるよう、離れた少し高い位置から（v05.89） */
  cam.position.copy(HOME); cam.lookAt(0, 0, 0);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 9; controls.maxDistance = 80; controls.enablePan = false;
  if (plain) { controls.enabled = false; controls.enableDamping = false; }

  /* 地面の格子（z = −6 の水平面）と方位の矢印 */
  const grid = new THREE.GridHelper(40, 20, 0x66788a, 0x3a4656); grid.rotation.x = Math.PI / 2; grid.position.z = -6; if (!bare && !noDeco) scene.add(grid);
  /* 方位の札（北・東・南・西）。板ではなく常に正面を向くスプライトなので、視点を回しても読める */
  function dirLabel(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;   /* 2 文字（北東 など）も入る幅 */
    const g = c.getContext('2d');
    g.font = 'bold 92px "Zen Kaku Gothic New", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(text, 128, 70);
    g.fillStyle = color; g.fillText(text, 128, 70);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true })); sp.userData.aspect = 2; return sp;
  }
  /* 水平面の四方に置く。画面上での大きさが一定になるよう、毎フレーム カメラとの距離で拡大率を直す（機体に重ならない大きさ） */
  const marks = new THREE.Group();
  /* bare（レーダー）は羅針盤を機体の中心に置く（v05.89、利用者の指示 2026-09-18「東西南北ではなく羅針盤で 8 方位を示す」）:
     水平面（z = 0）に半径 9.6 の輪と 16 の目盛り、南北・東西の細い線、輪のすぐ外に小さな 8 方位の名前。通常は四方の遠くに大きな札 */
  const R8 = 11.4, D = Math.PI / 180;
  const LAB = bare ? [['北', 0, 0, '#1f8f5a', 1.25], ['北東', 45, 0, '#3c4b5c', 0.9], ['東', 90, 0, '#c0392b', 1.05], ['南東', 135, 0, '#3c4b5c', 0.9], ['南', 180, 0, '#3c4b5c', 1.05], ['南西', 225, 0, '#3c4b5c', 0.9], ['西', 270, 0, '#3c4b5c', 1.05], ['北西', 315, 0, '#3c4b5c', 0.9]].map(([t, a, _, c, b]) => [t, Math.sin(a * D) * R8, Math.cos(a * D) * R8, c, b])
                   : [['北', 0, 12, '#1f8f5a', 2.6], ['東', 11, 0, '#c0392b', 2.2], ['南', 0, -12, '#3c4b5c', 2.2], ['西', -11, 0, '#3c4b5c', 2.2]];
  for (const [t, x, y, col, base] of LAB) {
    const sp = dirLabel(t, col); sp.position.set(x, y, bare ? 0 : -5.6); sp.userData.base = base; marks.add(sp);
  }
  if (!noDeco) scene.add(marks);
  const rose = new THREE.Group();
  if (bare) {
    const RR = 9.6, ring = [];
    for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; ring.push(new THREE.Vector3(Math.sin(a) * RR, Math.cos(a) * RR, 0)); }
    const lm = new THREE.LineBasicMaterial({ color: 0x8592a1, transparent: true, opacity: 0.55 }), lm2 = new THREE.LineBasicMaterial({ color: 0x8592a1, transparent: true, opacity: 0.28 });
    rose.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), lm));
    const seg = [];
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r0 = i % 4 === 0 ? RR - 1.3 : i % 2 === 0 ? RR - 0.8 : RR - 0.45; seg.push(new THREE.Vector3(Math.sin(a) * r0, Math.cos(a) * r0, 0), new THREE.Vector3(Math.sin(a) * RR, Math.cos(a) * RR, 0)); }
    rose.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), lm));
    rose.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -RR, 0), new THREE.Vector3(0, RR, 0), new THREE.Vector3(-RR, 0, 0), new THREE.Vector3(RR, 0, 0)]), lm2));
    scene.add(rose);
  }

  const axes = new THREE.Group();
  axes.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -6), 12, 0xff6b6b, 1.6, 0.9));
  axes.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -6), 12, 0x3ed48a, 1.6, 0.9));
  axes.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -6), 10, 0x5ab0ff, 1.6, 0.9));
  if (!bare && !noDeco) scene.add(axes);

  const pivot = new THREE.Group(); scene.add(pivot);
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => loader.load(modelUrl, res, e => { if (onProgress && e.total) onProgress(e.loaded / e.total); }, rej));
  /* 脚は飛行中の姿なので隠す。脚は材質ごとに分かれた入れ物（Group）なので、名前は親までたどって見る */
  const underGear = o => { let q = o; while (q) { if (/landing|front_gear/i.test(q.name)) return true; q = q.parent; } return false; };
  gltf.scene.traverse(o => { if (o.isMesh) { if (underGear(o)) o.visible = false;
    const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.metalness = 0; m.roughness = 0.85; m.side = THREE.DoubleSide; }); } });
  pivot.add(gltf.scene);
  /* タイヤ（脚）の出し入れ。飛んでいる姿が既定なので、最初は隠したまま（v06.36） */
  const gearMeshes = [];
  gltf.scene.traverse(o => { if (o.isMesh && underGear(o)) gearMeshes.push(o); });
  function setGear(on) { for (const m of gearMeshes) m.visible = !!on; }
  /* ライト: 左翼端に赤、右翼端に緑、尾部に白（航法灯）。翼端と尾の位置は、機体の頂点から実際に測って置く（v06.38） */
  let lightGroup = null;
  function lampSpots() {
    let lx = 1e9, rx = -1e9, ty = 1e9, L = null, R = null, T = null;
    const v = new THREE.Vector3();
    gltf.scene.traverse(o => {
      if (!o.isMesh || !o.geometry || underGear(o)) return;
      const pos = o.geometry.attributes.position; o.updateWorldMatrix(true, false);
      for (let k = 0; k < pos.count; k += 3) {
        v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
        if (v.x < lx) { lx = v.x; L = v.clone(); }
        if (v.x > rx) { rx = v.x; R = v.clone(); }
      }
    });
    /* 尾部の白は機体の中心線上のいちばん後ろ（尾端）。以前は全頂点でいちばん後ろを取っていたため、左の水平尾翼の端に付き「白は左後方だけ」に見えた（利用者の指摘 2026-09-26） */
    const cx = (lx + rx) / 2, tol = (rx - lx) * 0.04;
    gltf.scene.traverse(o => {
      if (!o.isMesh || !o.geometry || underGear(o)) return;
      const pos = o.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
        if (Math.abs(v.x - cx) < tol && v.y < ty) { ty = v.y; T = v.clone(); }
      }
    });
    return { L, R, T };
  }
  function setLights(on) {
    if (on && !lightGroup) {
      const { L, R, T } = lampSpots();
      const span = (R && L) ? R.x - L.x : 20, r = span * 0.012;
      lightGroup = new THREE.Group();
      const lamp = (p, col) => { if (!p) return;
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), new THREE.MeshBasicMaterial({ color: col }));
        m.position.copy(p);
        const halo = new THREE.Mesh(new THREE.SphereGeometry(r * 2.6, 12, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false }));
        halo.position.copy(p); lightGroup.add(m, halo); };
      lamp(L, 0xff3b30);   // 左翼端 赤
      lamp(R, 0x34c759);   // 右翼端 緑
      lamp(T, 0xfff6e0);   // 尾部 白
      pivot.add(lightGroup);
    }
    if (lightGroup) lightGroup.visible = !!on;
  }
  /* 機首の先（機体の座標で +y の端）。回転の矢印・札・カメラの寄りに使う（v06.38 で誤って消し、空間認識の解説の 3D が止まった） */
  const NOSE_Y = new THREE.Box3().setFromObject(gltf.scene).max.y;

  /* 向きの切り替え（短いアニメーション付き）。バンク b は機首の軸まわり: R = Rz(−h)·Rx(p)·Ry(b) */
  let qFrom = new THREE.Quaternion(), qTo = new THREE.Quaternion(), t0 = 0, animating = false;
  function targetQuat(h, p, b = 0) {
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeRotationZ(-h * D)
      .multiply(new THREE.Matrix4().makeRotationX(p * D)).multiply(new THREE.Matrix4().makeRotationY(b * D)));
  }
  function setDir(h, p, animate = true) {
    qFrom.copy(pivot.quaternion); qTo = targetQuat(h, p);
    if (!animate) { pivot.quaternion.copy(qTo); return; }
    t0 = performance.now(); animating = true;
  }
  /* 空間認識の解説の矢印（v06.13）: 回す軸のまわりに弧の矢印を機体に付けて描く。axis: 'yaw'（機体の上下軸）/'roll'（機首の軸）/'pitch'（翼の軸）、sign: 回る向き（+1 が右・上げ）。
     機体の軸で回るので、矢印は pivot の子にして機体と一緒に回す。何も言わずに「機体を中心に球で動く」ことに気づけるようにする（利用者の意図。説明の文には書かない） */
  let spinArrow = null;
  function setSpinArrow(axis, sign = 1, deg = 270) {
    if (spinArrow) { pivot.remove(spinArrow); spinArrow = null; }
    if (!axis) return null;
    /* 弧は「機体のある点が、その命令で実際に動く道」として作る（v06.14）。
       engine.js の applyCmd と同じ行列（旋回 Rz(−a)、横転 Ry(a)、機首 Rx(a)。a は右・上げが正）を角度 0→270° で掛けて点を並べるので、
       回る向きが命令と食い違わない（v06.13 は xy 平面の弧を回して当てはめていて、三つとも逆向きだった。利用者の指摘 2026-09-22） */
    /* 色と置き場所は操縦操作の「動きで見る」の力の矢印と同じ（sim3d.js の ARC。利用者の指示 2026-09-22「動きで見ると同じように矢印を表示する。機体後方に矢印を表示しない。横転のみ機体上部で、残りは機首前方」）:
       旋回＝ヨー 水色・横転＝ロール 橙・機首＝ピッチ 緑。横転の弧は機体の上を越える弧（半径は機首までの長さ、少し後ろ寄り）、旋回と機首上げ下げの弧は機首の前（機首までの 1.4 倍の先）。
       弧は中心（真上／機首の正面）をはさんで −span/2 〜 +span/2。動きで見るの弧が中心をはさんで対称なのと同じで、後ろへは伸びない */
    const SPIN_COL = { yaw: 0x4fc3f7, roll: 0xff8a3d, pitch: 0x7cf59a };
    const L = NOSE_Y || 6.5, col = SPIN_COL[axis] || 0xffb020, g = new THREE.Group(), N = 48, pts = [];
    const p0 = axis === 'roll' ? new THREE.Vector3(0, -0.23 * L, L) : new THREE.Vector3(0, 1.38 * L, 0);
    const rot = a => axis === 'yaw' ? new THREE.Matrix4().makeRotationZ(-a) : axis === 'roll' ? new THREE.Matrix4().makeRotationY(a) : new THREE.Matrix4().makeRotationX(a);
    /* 弧の長さは命令の角度そのもの（45° なら 45°、180° なら半周。利用者の指示 2026-09-22「そんなに曲がらない。角度に応じて長さを変えて」） */
    const span = Math.max(15, Math.min(180, Math.abs(deg))) * Math.PI / 180;
    for (let i = 0; i <= N; i++) { const a = (i / N - 0.5) * span * sign; pts.push(p0.clone().applyMatrix4(rot(a))); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.18 * L / 6.5, 8, false), new THREE.MeshBasicMaterial({ color: col }));
    g.add(tube);
    const last = pts[N], prev = pts[N - 2], dir = last.clone().sub(prev).normalize();
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.6 * L / 6.5, 1.6 * L / 6.5, 12), new THREE.MeshBasicMaterial({ color: col }));
    head.position.copy(last); head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(head);
    spinArrow = g; pivot.add(g);
    return pts.map(p => [p.x, p.y, p.z]);
  }
  /* 姿勢をそのまま入れる（動かして見せるとき。毎コマ呼ぶ） */
  function setAttitude(h, p, b) { animating = false; pivot.quaternion.copy(targetQuat(h, p, b)); }
  /* 向きと傾きへ、短いアニメーションで */
  function setDirBank(h, p, b = 0) { qFrom.copy(pivot.quaternion); qTo = targetQuat(h, p, b); t0 = performance.now(); animating = true; }
  /* ===== 姿勢のレーダー（記録）: 5 角形チャートの立体版。shapes: [{id,color,opacity,points:[{id,x,y,z}],tris:[[a,b,c],...]}]。
     面は半透明の多面体、頂点には小さな球（タップ用）。3 枚（水平・右バンク・左バンク）を重ねる ===== */
  const markerGroup = new THREE.Group(); scene.add(markerGroup);
  function setShapes(shapes) {
    while (markerGroup.children.length) { const c = markerGroup.children.pop(); c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); }
    for (const sh of shapes) {
      const pos = new Float32Array(sh.points.length * 3); sh.points.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(sh.tris.flat()); g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: sh.color, transparent: true, opacity: sh.opacity == null ? 0.16 : sh.opacity, side: THREE.DoubleSide, flatShading: true, roughness: 0.7, metalness: 0, depthWrite: false });
      mat.userData.base = mat.opacity;
      const mesh = new THREE.Mesh(g, mat); mesh.userData.shape = sh.id; markerGroup.add(mesh);
      if (sh.wire !== false) { const line = new THREE.LineSegments(new THREE.WireframeGeometry(g), new THREE.LineBasicMaterial({ color: sh.color, transparent: true, opacity: 0.3 })); line.material.userData.base = 0.3; markerGroup.add(line); }
      /* lines: 面が作れないとき（点が 1 つ）の線（v05.90） */
      if (sh.lines && sh.lines.length) { const lp = []; for (const [a, b] of sh.lines) { lp.push(new THREE.Vector3(sh.points[a].x, sh.points[a].y, sh.points[a].z), new THREE.Vector3(sh.points[b].x, sh.points[b].y, sh.points[b].z)); } const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lp), new THREE.LineBasicMaterial({ color: sh.color, transparent: true, opacity: 0.8 })); ls.material.userData.base = 0.8; markerGroup.add(ls); }
      /* 印の球は id のある点だけ（v05.87: 面の網の点には付けない） */
      for (const p of sh.points) { if (!p.id) continue; const sp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: sh.color, roughness: 0.5, transparent: true, opacity: 0.95 })); sp.material.userData.base = 0.95; sp.position.set(p.x, p.y, p.z); sp.userData.id = p.id; sp.userData.pick = true; markerGroup.add(sp); }
    }
  }
  function highlight(id) { for (const c of markerGroup.children) { if (!c.userData.pick) continue; const on = c.userData.id === id; c.material.emissive = new THREE.Color(on ? 0xffffff : 0x000000); c.material.emissiveIntensity = on ? 0.6 : 0; c.scale.setScalar(on ? 1.9 : 1); } }
  /* チャートの見せ方: fadeTo(1) で見せる、fadeTo(0) で消す（毎コマ少しずつ）。カメラは flyTo で滑らかに動かす */
  let chartK = 1, chartTarget = 1;
  function fadeTo(t) { chartTarget = t; }
  let fly = null;   // {from, to, look0, look1, t0, dur}
  function flyTo(pos, look, dur = 800) { fly = { from: cam.position.clone(), to: pos.clone(), look0: controls.target.clone(), look1: look.clone(), t0: performance.now(), dur }; }
  /* 数値を選んだとき: チャートを消し、機首の先（目標の姿勢で計算）へ寄る。札は機首の先に出る */
  function focusNose() {
    const tip = new THREE.Vector3(0, NOSE_Y, 0).applyQuaternion(qTo), dir = new THREE.Vector3(0, 1, 0).applyQuaternion(qTo);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(qTo), up = new THREE.Vector3(0, 0, 1).applyQuaternion(qTo);
    const pos = tip.clone().add(dir.clone().multiplyScalar(9)).add(side.multiplyScalar(8)).add(up.clone().multiplyScalar(3.5));
    fadeTo(0); flyTo(pos, tip.clone().add(dir.multiplyScalar(-0.8)).add(up.multiplyScalar(0.6)), 900);   /* 機首と札のあいだを見る（両方が中央に来る） */
  }
  /* 元の位置へ（ダブルタップ）。チャートを戻し、札を消す */
  function resetView() { fadeTo(1); flyTo(HOME, new THREE.Vector3(0, 0, 0), 800); setNoseLabel(null); highlight(null); if (onReset) onReset(); }
  /* 頂点のタップ（なぞりと区別するため、押してから 6px 以上動いたら無視）。ダブルタップで元の位置へ */
  const ray = new THREE.Raycaster(); let pdown = null, lastTap = 0, lastXY = [0, 0];
  renderer.domElement.addEventListener('pointerdown', e => { pdown = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!pdown) return; const moved = Math.hypot(e.clientX - pdown[0], e.clientY - pdown[1]); pdown = null; if (moved > 6) return;
    const now = performance.now();
    if (bare && now - lastTap < 350 && Math.hypot(e.clientX - lastXY[0], e.clientY - lastXY[1]) < 14) { lastTap = 0; resetView(); return; }
    lastTap = now; lastXY = [e.clientX, e.clientY];
    if (!onMarker) return;
    const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v, cam); const hit = ray.intersectObjects(markerGroup.children.filter(c => c.userData.pick), false)[0]; if (hit) onMarker(hit.object.userData.id);
  });
  /* 機首の先の札（記録の文）。機体と一緒に回る */
  let nose = null;
  function setNoseLabel(text) {
    if (nose) { pivot.remove(nose); nose.material.map.dispose(); nose.material.dispose(); nose = null; }
    if (!text) return;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d');
    g.fillStyle = 'rgba(11,16,23,.82)'; g.beginPath(); g.roundRect(4, 4, 1016, 152, 28); g.fill();
    g.font = 'bold 52px "Zen Kaku Gothic New", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(text, 512, 82);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    nose = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); nose.position.set(0, NOSE_Y + 0.5, 1.0); nose.scale.set(4.2, 0.66, 1); nose.renderOrder = 9; pivot.add(nose);
  }
  function resetCamera() { cam.position.copy(HOME); controls.target.set(0, 0, 0); controls.update(); }

  let running = true, raf = 0;
  function frame(now) {
    if (!running) return;
    if (animating) { const k = Math.min(1, (now - t0) / 450), e = k < .5 ? 2 * k * k : -1 + (4 - 2 * k) * k; pivot.quaternion.slerpQuaternions(qFrom, qTo, e); if (k >= 1) animating = false; }
    if (chartK !== chartTarget) { chartK += Math.sign(chartTarget - chartK) * Math.min(Math.abs(chartTarget - chartK), 0.06); for (const c of markerGroup.children) { c.material.opacity = (c.material.userData.base == null ? 1 : c.material.userData.base) * chartK; c.visible = chartK > 0.02; } if (bare) { marks.visible = chartK > 0.02; rose.visible = marks.visible; } }   /* 寄っているあいだは方位の札と羅針盤も消す */
    if (fly) { const k = Math.min(1, (now - fly.t0) / fly.dur), e = 1 - Math.pow(1 - k, 3); cam.position.lerpVectors(fly.from, fly.to, e); controls.target.lerpVectors(fly.look0, fly.look1, e); if (k >= 1) fly = null; }
    for (const sp of marks.children) { const k = sp.userData.base * cam.position.distanceTo(sp.position) / 24; sp.scale.set(k * (sp.userData.aspect || 1), k, 1); }
    controls.update(); renderer.render(scene, cam); raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  const onResize = () => { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); };
  window.addEventListener('resize', onResize);

  return {
    setDir, setAttitude, setDirBank, setShapes, highlight, setNoseLabel, focusNose, resetView, fadeTo, resetCamera, setSpinArrow, setGear, setLights, noseLen: () => NOSE_Y,
    pause() { running = false; cancelAnimationFrame(raf); },
    resume() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    dispose() { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); }
  };
}
