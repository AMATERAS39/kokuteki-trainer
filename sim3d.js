/* 操縦操作の練習シミュレーター（three.js）。
   世界座標: x=東 y=北 z=上（単位 m）。機体の向きは方位 h（北 0°、時計回り）、ピッチ p（機首上げ正）、バンク b（右バンク正）で
   R = Rz(−h)·Rx(p)·Ry(b)。出題と同じ向きの約束（操縦桿右 → 右バンク → 景色は左に傾く、右方向舵 → 右を向く → 景色は左へ流れる）。
   ±LIMIT m の四角い空間の中を一定速度で飛び、壁と地面で止まる。 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const D = Math.PI / 180;
export const LIMIT = 1500;                       // 壁までの距離（原点から、m）
export const CEIL = 3000;                        // 天井（m）。宙返りができる高さを取る
export const SPEED = 60;                         // 速度（m/s、固定）
const RATE = { roll: 60, pitch: 25, yaw: 20 };   // 入力 1 のときの角速度（°/s）
const START = { x: 0, y: -450, z: 80, h: 0 };    // 開始位置: 滑走路の南端上空、北向き
const GROUND_EYE = { x: 90, y: -120, z: 0 };     // 地上から見るときの立ち位置（滑走路の東側）
const EYE_H = 1.6;                               // 目の高さ（人の背丈）

/* 編隊。ブルーインパルスの隊形にならう（名前と並びの出典: wporep.com のブルーインパルス編隊飛行の一覧）。
   offs は先頭機（操作する機体）から見た 2 番機以降の位置 [右, 前後, 上]（m）。前後が負なら後ろ。
   要素の数が機数 −1。少ない隊形では余った機体を隠す。
   同じ左右の位置に後続がいる機体はスモークを出さない（後ろの機体が煙の中を飛ぶため） */
export const FORMATIONS = {
  solo:    { ja: '単機', n: 1, offs: [] },
  pair:    { ja: '2 機', n: 2, offs: [[14, -12, 0]] },
  trail:   { ja: 'トレイル（縦隊）', n: 6, offs: [[0, -16, 0], [0, -32, 0], [0, -48, 0], [0, -64, 0], [0, -80, 0]] },
  delta:   { ja: 'デルタ', n: 6, offs: [[-14, -14, 0], [14, -14, 0], [-28, -28, 0], [28, -28, 0], [0, -34, 0]] },
  pyramid: { ja: 'ピラミッド', n: 6, offs: [[-13, -12, -7], [13, -12, -7], [-26, -24, -14], [0, -24, -14], [26, -24, -14]] },
  phoenix: { ja: 'フェニックス', n: 6, offs: [[-16, -10, 0], [16, -10, 0], [0, -36, 0], [-30, -22, 0], [30, -22, 0]] },
  cross:   { ja: 'グランドクロス', n: 6, offs: [[-24, -16, 0], [24, -16, 0], [0, -16, 14], [0, -16, -14], [0, -32, 0]] },
  dline:   { ja: 'ダブルライン', n: 6, offs: [[16, 0, 0], [0, -16, 0], [16, -16, 0], [0, -32, 0], [16, -32, 0]] },
  leaders: { ja: 'リーダーズ・ベネフィット', n: 6, offs: [[-36, -20, 0], [-18, -20, 0], [0, -20, 0], [18, -20, 0], [36, -20, 0]] },
  umbrella:{ ja: '傘型', n: 5, offs: [[-11, -8, -3], [11, -8, -3], [-22, -16, -9], [22, -16, -9]] },
  cassiop: { ja: 'カシオペア', n: 5, offs: [[-28, -16, 0], [-14, -16, -12], [14, -16, -12], [28, -16, 0]] },
  diamond: { ja: 'ダイヤモンド', n: 4, offs: [[-16, -16, 0], [16, -16, 0], [0, -32, 0]] },
  arrow:   { ja: 'アローヘッド', n: 4, offs: [[0, -12, 0], [-20, -24, 0], [20, -24, 0]] },
  finger:  { ja: 'フィンガーチップ', n: 4, offs: [[14, -12, 0], [-14, -12, 0], [28, -24, 0]] }
};
/* スモークの色。1 色なら全機同じ、6 色なら 1〜6 番機に順に割り当てる */
export const SMOKE_COLORS = {
  white:  { ja: '白', c: ['#ffffff'] },
  pink:   { ja: 'ピンク', c: ['#ff7fb6'] },
  green:  { ja: '緑', c: ['#6ee7a0'] },
  yellow: { ja: '黄', c: ['#ffd84d'] },
  blue:   { ja: '青', c: ['#6ec1ff'] },
  rainbow:{ ja: 'カラフル', c: ['#ffffff', '#ff7fb6', '#6ee7a0', '#ffd84d', '#6ec1ff', '#c79bff'] }
};
export const SMOKE_LIFE = 29;                    // 煙が消えるまで（秒）。宙返り 2 周ぶん（25°/s で 1 周 14.4 秒）
const SMOKE_MAX = 780;                           // 1 機あたりの粒の数（0.04 秒ごとに 1 つ）
const SMOKE_DT = 0.04;
/* 編隊に入るとき・抜けるときの位置（先頭機から見て後ろの遠く）。ここから所定の位置へ 4 秒かけて寄る */
const ENTRY = [[-170, -620, 40], [170, -620, 40], [-250, -800, -30], [250, -800, -30], [0, -960, 60]];
const JOIN_TIME = 14;                             // 隊形を変えるときにかける時間（秒）。ゆっくり出て ゆっくり入る
/* 自動操縦（地上から見るための演技）。観覧位置のまわりを回り、正面を通過し、宙返りをする */
const SHOW = { R: 330, ALT: 150, ORBIT: 22, PASS: 15, LOOPMAX: 18, GATE: 300, SIDE: 220, ALT_IN: 220 };
const DIRJA = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

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

  /* オブジェクト（山・民家・木・塔）。まとめて消せるように 1 つの入れ物に入れる（設定で切り替え） */
  const props = new THREE.Group(); world.add(props);
  /* 山: 見え方を学ぶのが目的なので、空間の中の近くに置く。出題の絵と同じく、開始位置の正面やや左に雪山、やや右に塔。
     さらに空間の中に中くらいの山を散らし、壁の外にも遠景の環を置く */
  const mtnMat = new THREE.MeshLambertMaterial({ color: col.mtn }), snowMat = new THREE.MeshLambertMaterial({ color: col.snow });
  const mountain = (x, y, hgt, rad, snow) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, hgt, 8), mtnMat); m.rotation.x = Math.PI / 2; m.position.set(x, y, hgt / 2); props.add(m);
    if (snow) { const s = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.28, hgt * 0.28, 8), snowMat); s.rotation.x = Math.PI / 2; s.position.set(x, y, hgt - hgt * 0.14); props.add(s); }
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
  props.add(houses, roofs);
  const NT = 320, treeGeo = new THREE.ConeGeometry(1, 1, 6); treeGeo.rotateX(Math.PI / 2);
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial(), NT), trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a4030 }), NT);
  const treeCols = [0x3f7a3a, 0x4f8a44, 0x2f6b3c, 0x5d8f3f];
  q.identity();
  for (let i = 0; i < NT; i++) {
    const [x, y] = pick(), h = 7 + rnd() * 7, r = 2.5 + rnd() * 2;
    m4.compose(v3.set(x, y, 2 + h / 2), q, s3.set(r, r, h)); trees.setMatrixAt(i, m4); trees.setColorAt(i, c3.setHex(treeCols[i % treeCols.length]));
    m4.compose(v3.set(x, y, 1), q, s3.set(1.4, 1.4, 2.2)); trunks.setMatrixAt(i, m4);
  }
  props.add(trees, trunks);
  for (let i = 0; i < 6; i++) {   // 塔（先端は赤）。最初の 1 本は正面右の目印
    const [x, y] = i === 0 ? [230, 260] : pick(), h = i === 0 ? 120 : 60 + rnd() * 70;
    const t = new THREE.Mesh(new THREE.BoxGeometry(4, 4, h), new THREE.MeshLambertMaterial({ color: 0x8a949e })); t.position.set(x, y, h / 2); props.add(t);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 6), new THREE.MeshBasicMaterial({ color: 0xff5a4a })); tip.position.set(x, y, h + 3); props.add(tip);
  }

  /* 機体（三人称のときだけ表示）と、高度の手がかり（地面の影と垂線） */
  const plane = new THREE.Group(); world.add(plane);
  /* 操縦席の部品。座標はモデル座標 ×k（k = 13/全長）で書き、読み込み後に GLB と同じ平行移動（eyeOff）を掛ける。
     目安（この座標系）: 風防の上端 z≈0.43、前席の背もたれ上端 z≈0.32、前席 y≈2.4〜3.5、風防の前端 y≈3.55、床 z≈-0.97。
     モデルには座席と風防しかないので、計器盤・グレアシールド・操縦桿・方向舵ペダルを自作する。目は前席の後ろ寄り・背もたれの少し上 */
  const EYE = new THREE.Vector3(0, 2.55, 0.40), eyeOff = new THREE.Vector3(), seatMeshes = [];
  const cockpit = new THREE.Group(); plane.add(cockpit);
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b2027 }), mid = new THREE.MeshLambertMaterial({ color: 0x2e3640 }), grip = new THREE.MeshLambertMaterial({ color: 0x14171b }), metal = new THREE.MeshLambertMaterial({ color: 0x8a939e });
  /* 操縦席は GLB のモデルに本物（計器盤・風防・操縦桿）が入っているので、自作の部品は置かない。
     近くにある機体内部の部品（操縦桿など）が目の前に大きく映るため、一人称ではカメラの手前の面を 1.1 で切る（setView）。
     画面の入力は下に置いた操縦桿の絵とペダルのボタンで示す */
  const lamp = new THREE.PointLight(0xffe2b8, 0.9, 2.5); lamp.position.set(0, 2.9, 0.3); cockpit.add(lamp);   // 操縦席の灯り（夜でも部品が見える）
  /* 編隊の 2〜6 番機。先頭機の少し前の状態をたどって並ぶ（旋回でも隊形が崩れない） */
  const mates = [];                       // 2〜6 番機（入れ物）。join に合流の進み具合（0〜1）を持つ
  const hist = [];                        // 先頭機の軌跡 { t, p:Vector3, q:Quaternion }
  let histT = 0;
  let formation = 'solo', smokeOn = false, smokeColor = 'white', formScale = 1;   // formScale: 隊形の広がり（課目で変える）

  /* 垂直尾翼の番号。モデルの「1」の上に貼る小さな板（左右 2 枚） */
  function numberPlate(n) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g2 = c.getContext('2d');
    g2.fillStyle = '#0a6ab4'; g2.fillRect(0, 0, 128, 128);
    g2.fillStyle = '#fff'; g2.font = 'bold 104px "Zen Kaku Gothic New", system-ui, sans-serif';
    g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(String(n), 64, 68);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  }
  /* 垂直尾翼の場所をモデルから実測する（機体の内側の座標）。
     尾翼は「後ろ寄り・高い・左右に薄い」ので、その条件に合う頂点を集めて囲む箱を作る */
  function measureFin(root, frame) {
    const all = new THREE.Box3().setFromObject(root);
    const hz = all.max.z - all.min.z, ly = all.max.y - all.min.y;
    const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
    const v = new THREE.Vector3(), fin = new THREE.Box3(); let hit = 0;
    root.updateWorldMatrix(true, true);
    root.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        if (v.z > all.min.z + hz * 0.62 && v.y < all.min.y + ly * 0.42 && Math.abs(v.x) < ly * 0.06) { fin.expandByPoint(v); hit++; }
      }
    });
    return hit > 20 ? fin : null;
  }
  let finRect = null;
  function addPlates(grp, n) {
    if (!finRect) return [];
    const ly = finRect.max.y - finRect.min.y, lz = finRect.max.z - finRect.min.z;
    const h = Math.min(lz, ly) * 0.42;                                  // 尾翼からはみ出さない大きさ
    const cy = finRect.min.y + ly * 0.85, cz = finRect.min.z + lz * 0.40;   // モデルの「1」が書かれているあたり（実物で合わせた値）
    const gap = (finRect.max.x - finRect.min.x) / 2 + 0.015;
    const geo = new THREE.PlaneGeometry(h, h), mat = numberPlate(n), out = [];
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(gap * sx, cy, cz);
      m.up.set(0, 0, 1); m.lookAt(m.position.x + sx, m.position.y, m.position.z);   // 板の面を左右の外側に向ける（数字は上向き）
      grp.add(m); out.push(m);
    }
    return out;
  }

  /* スモーク: 粒の集まり。位置・色・生まれた時刻を持ち、時間が経つと薄れて広がる。
     出る場所は機体の後ろの端（全長 13 m の機体で、中心から後ろへ 6.9 m。少し下） */
  const SMOKE_N = SMOKE_MAX * 6;
  const smokeGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(SMOKE_N * 3), sCol = new Float32Array(SMOKE_N * 3), sBirth = new Float32Array(SMOKE_N);
  sBirth.fill(-1e6);
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  smokeGeo.setAttribute('acolor', new THREE.BufferAttribute(sCol, 3));
  smokeGeo.setAttribute('birth', new THREE.BufferAttribute(sBirth, 1));
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLife: { value: SMOKE_LIFE } },
    transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 acolor; attribute float birth; uniform float uTime, uLife;
      varying vec3 vC; varying float vA;
      void main(){ float age = (uTime - birth) / uLife; vA = clamp(1.0 - age, 0.0, 1.0); vA *= sqrt(vA);
        vC = acolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        /* 太さ: 出た直後から少しずつ広がる。遠くても見えるように最小 3 画素、
           近くで画面を覆わないように最大 90 画素にする */
        float sz = 6.0 + 60.0 * pow(clamp(age, 0.0, 1.0), 0.5);
        gl_PointSize = clamp(sz * (240.0 / max(1.0, -mv.z)), 3.0, 90.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ float d = length(gl_PointCoord - vec2(0.5)); if (d > 0.5) discard;
        float a = vA * smoothstep(0.5, 0.04, d) * 0.4; if (a <= 0.01) discard;
        gl_FragColor = vec4(vC, a); }`
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat); smoke.frustumCulled = false; world.add(smoke);
  let sHead = 0, smokeT = 0, clock = 0;
  const smokeCol = new THREE.Color(), emitPos = new THREE.Vector3();
  function emit(pos, colorHex) {
    const i = sHead % SMOKE_N; sHead++;
    sPos[i * 3] = pos.x; sPos[i * 3 + 1] = pos.y; sPos[i * 3 + 2] = pos.z;
    smokeCol.set(colorHex); sCol[i * 3] = smokeCol.r; sCol[i * 3 + 1] = smokeCol.g; sCol[i * 3 + 2] = smokeCol.b;
    sBirth[i] = clock;
  }
  function clearSmoke() { sBirth.fill(-1e6); smokeGeo.attributes.birth.needsUpdate = true; }
  /* 同じ左右の位置に後続がいる機体は煙を出さない（後ろの機体が煙の中を飛ぶため）。単機なら先頭機が出す */
  function smokers() {
    const offs = [[0, 0, 0], ...FORMATIONS[formation].offs];
    return offs.map((o, i) => !!o && !offs.some((q, j) => q && j !== i && Math.abs(q[0] - o[0]) < 6 && q[1] < o[1] - 2));
  }

  new GLTFLoader().load('model/t4.glb', g => {
    g.scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.metalness = 0; m.roughness = 0.85; m.side = THREE.DoubleSide; }); } });
    const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), k = 13 / Math.max(size.y, 1e-3);   // 全長 13 m
    g.scene.scale.setScalar(k); const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k); g.scene.position.set(-c.x, -c.y, -c.z);
    plane.add(g.scene);
    cockpit.position.copy(g.scene.position); eyeOff.copy(g.scene.position);   // 操縦席の部品と目の位置はモデル座標（×k）で書いてあるので、同じ平行移動を掛ける
    g.scene.traverse(o => { if (o.isMesh && (o.name === 'seat1' || /^mesh_2(_|$)/.test(o.name))) seatMeshes.push(o); });   // 自分が座る前席（一人称では隠す）
    seatMeshes.forEach(m => { m.visible = curView !== 'first'; });
    /* 2〜6 番機はモデルを複製して、尾翼に番号の板を貼る。板の位置は実測した尾翼の箱から決める */
    plane.updateWorldMatrix(true, true);
    finRect = measureFin(g.scene, plane);
    for (let n = 2; n <= 6; n++) {
      const holder = new THREE.Group(); holder.visible = false; world.add(holder);
      holder.add(g.scene.clone(true));                                   // 複製は元と同じ平行移動を持っている
      addPlates(holder, n);                                              // 実測した位置は機体の座標そのままなので、入れ物に直接置く
      holder.userData.cur = new THREE.Vector3(ENTRY[n - 2][0], ENTRY[n - 2][1], ENTRY[n - 2][2]);   // いまの位置（先頭機から見て）
      holder.userData.want = new THREE.Vector3();
      mates.push(holder);
    }
  }, undefined, () => {});
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(7, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })); shadow.position.z = 0.8; world.add(shadow);
  const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
  const drop = new THREE.Line(dropGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })); world.add(drop);

  /* ---- 状態と入力 ---- */
  /* 姿勢はクォータニオンで持つ。オイラー角（方位・ピッチ・バンク）だと宙返りの真上・真下で破綻するため。
     h / p / b は表示と計器のために毎フレーム取り出す。機体の軸: 機首 +y、右翼 +x、機体上 +z */
  const st = { x: START.x, y: START.y, z: START.z, h: START.h, p: 0, b: 0, wall: false, ground: false, show: '', cue: '', desc: '', gh: 0 };
  const att = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -START.h * D);
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1), WUP = new THREE.Vector3(0, 0, 1);
  const dq = new THREE.Quaternion(), fwd = new THREE.Vector3(), bup = new THREE.Vector3(), bright = new THREE.Vector3();
  const gdir = new THREE.Vector3(), gright = new THREE.Vector3(), focus = new THREE.Vector3();   // 地上視点の向きを作るのに使う
  const gEye = new THREE.Vector3(GROUND_EYE.x, GROUND_EYE.y, GROUND_EYE.z + EYE_H);   // 地上の立ち位置（目の高さ）
  let gYaw = 0, gPitch = 0.06;                                     // 地上視点の向き（自分で決めた方向）
  let follow = false;                                              // 機体を目で追うか（切ってあれば向けた方向のまま）
  const gRay = new THREE.Raycaster(), down = new THREE.Vector3(0, 0, -1);
  function gAim() {   // いまの立ち位置から機体の方へ向ける
    tmp.copy(plane.position).sub(gEye);
    gYaw = Math.atan2(tmp.x, tmp.y); gPitch = Math.asin(clamp(tmp.z / Math.max(1, tmp.length()), -1, 1));
    look.y = 0; look.p = 0;
  }
  function readAttitude() {
    fwd.copy(AY).applyQuaternion(att); bup.copy(AZ).applyQuaternion(att); bright.copy(AX).applyQuaternion(att);
    st.h = ((Math.atan2(fwd.x, fwd.y) / D) % 360 + 360) % 360;
    st.p = Math.asin(clamp(fwd.z, -1, 1)) / D;
    st.b = Math.atan2(-bright.dot(WUP), bup.dot(WUP)) / D;
  }
  function levelAttitude() { att.setFromAxisAngle(AZ, -st.h * D); readAttitude(); }
  readAttitude();
  const input = { x: 0, y: 0, r: 0 };   // x: 操縦桿 左右（右 +）、y: 操縦桿 前後（奥 +）、r: 方向舵（右 +）
  let curView = view;
  /* 見回し（ドラッグ量）。一人称は首の向き、三人称は機体のまわりの位置。視点を変えると中央に戻す */
  const look = { y: 0, p: 0 };
  const LOOK_MAX_P = 75 * D;
  const cam = new THREE.PerspectiveCamera(70, 1, 0.08, 9000);
  let zoom = 1, baseFov = 70;                      // 画面の拡大（望遠）。画角 = 元の画角 ÷ 倍率
  const applyFov = () => { cam.fov = clamp(baseFov / zoom, 7, 100); cam.updateProjectionMatrix(); };
  const camPos = new THREE.Vector3(), tmp = new THREE.Vector3(), R = new THREE.Matrix4(), Rh = new THREE.Matrix4(), RX90 = new THREE.Matrix4().makeRotationX(Math.PI / 2), TILT = new THREE.Matrix4().makeRotationX(-16 * D), qc = new THREE.Quaternion();
  function rotation() { return R.makeRotationFromQuaternion(att); }

  function resize() { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  /* 操縦は機体の軸まわりの回転で扱う（機首軸のロール・翼軸のピッチ・上下軸のヨー）。
     左右に倒し続ければ何回でも回り、前後に倒し続ければ宙返りができる。角度の上限は設けない */
  /* 自動操縦: 演目（課目）を順に行う。目標へ向かうときは、方位のずれをバンクに、高さのずれをピッチに直して操縦桿を動かす。
     機体は 1 機を操縦して編隊が付いてくる作りなので、機体ごとに別々に動く課目（交差など）は隊形の変化で表す。
     演目の名前の出典: ブルーインパルスの課目一覧（masdf.com のプログラム紹介） */
  /* form: その課目で使う隊形（いまの機数によらず、その数だけ集まる）。
     front: 見ている前方で行う（旋回だけは前方に限らない）。alt: 入る高さ（m） */
  const PROGRAM = [
    { id: 'orbit', ja: '旋回', t: 8, front: false, form: 'solo', desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'change', ja: 'チェンジオーバー・ターン', form: 'trail', alt: 200,
      desc: '縦隊で入り、旋回しながら隊形を組み替えます。傘が開くように見えます。' },
    { id: 'byover', ja: '頭上通過', form: 'delta', alt: 130, entry: 'front',
      desc: '正面から低く向かってきて、頭の上を通り抜けます。' },
    { id: 'loop', ja: 'デルタ・ループ', form: 'delta', alt: 240, entry: 'front',
      desc: '6 機がデルタ隊形のまま、崩さずに宙返りします。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'cupid', ja: 'キューピッド', form: 'diamond', alt: 260, entry: 'front', fig: 'cupid',
      desc: '3 機。2 機がハートを描き、もう 1 機が矢のように貫きます。実際の演技では、矢の機体がスモークを一度切って、貫いて見せます。' },
    { id: 'roll', ja: 'デルタ・ロール', form: 'delta', alt: 200,
      desc: '6 機がデルタ隊形のまま横転します。' },
    { id: 'pass', ja: '正面通過', t: 12, form: 'delta', alt: 190,
      desc: '隊形のまま、正面を低く通り抜けます。' },
    { id: 'wide', ja: 'ワイド・トゥ・デルタ・ループ', form: 'delta', alt: 240,
      desc: '間隔を広げて入り、宙返りの中でデルタ隊形に詰めます。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'eight', ja: 'レター・エイト', form: 'diamond', alt: 200,
      desc: '4 機で、空に数字の 8 を描きます。' },
    { id: 'byover', ja: '頭上通過', form: 'delta', alt: 120, entry: 'front',
      desc: '正面から低く向かってきて、頭の上を通り抜けます。' },
    { id: 'vert', ja: 'バーティカル・クライム・ロール', form: 'pair', alt: 190, entry: 'front',
      desc: '垂直に上昇しながら横転します。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'star', ja: 'スタークロス', form: 'delta', alt: 260, entry: 'front', fig: 'star',
      desc: '5 機。デルタ隊形で入って大きく開き、一斉に反転降下して星を描きます。' },
    { id: 'half', ja: 'ハーフ・スロー・ロール', form: 'diamond', alt: 300,
      desc: 'ゆっくり背面に入り、そのまま飛んでから戻します。' },
    { id: 'bloom', ja: '上向き空中開花（サンライズ）', form: 'delta', alt: 190, entry: 'front',
      desc: '5 機が上を向いたまま大きく開き、花が咲くように見せます。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'rain', ja: 'レインフォール', form: 'delta', alt: 260, entry: 'front',
      desc: '開花のあと、雨が降るように機体が降りてきます。' },
    { id: 'cork', ja: 'コーク・スクリュー', form: 'pair', alt: 200, entry: 'front',
      desc: '2 機。1 機がまっすぐ進み、その周りをもう 1 機が背中を内側に向けて回ります。実際の演技では、直進する 5 番機が背面で飛びます。' },
    { id: 'turnloop', ja: '360 度ターン & ループ', form: 'delta', alt: 240,
      desc: '1 周まわってから、続けて宙返りします。' }
  ];
  let auto = false, oneShot = false, step_i = 0, manT = 0, rollSum = 0, loopSum = 0, hdgSum = 0, prevH = 0, userForm = 'solo';
  let manPhase = 'do', phaseT = 0, aimX = 0, aimY = 0, planFace = 0, turnSign = 1;   // 進入の段階（in: 門へ、align: 正面の中心へ、do: 技）
  const GATE = { x: 0, y: 0, z: SHOW.ALT_IN };
  const autoIn = { x: 0, y: 0, r: 0 };
  /* どこから機体が来るかの目印。門の位置に立てる細い柱（自動操縦で進入しているあいだだけ出す） */
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 320, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  marker.rotation.x = Math.PI / 2; marker.visible = false; world.add(marker);
  let markOn = false;   // 進入の目印を出すか（実際に見せるのは地上視点のときだけ）
  const wrap180 = a => ((a + 180) % 360 + 360) % 360 - 180;
  const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
  /* 目標の点へ向く（方位のずれ → バンク、高さのずれ → ピッチ） */
  function steerTo(tx, ty, tz) {
    const wantH = ((Math.atan2(tx - st.x, ty - st.y) / D) % 360 + 360) % 360;
    const wantB = clamp(wrap180(wantH - st.h) * 1.4, -52, 52);
    autoIn.x = clamp((wantB - st.b) / 22, -1, 1);
    const wantP = clamp((tz - st.z) * 0.12, -20, 20);
    autoIn.y = -clamp((wantP - st.p) / 10, -1, 1);
    autoIn.r = 0;
  }
  const holdBank = b => { autoIn.x = clamp((b - st.b) / 18, -1, 1); };
  const holdPitch = p2 => { autoIn.y = -clamp((p2 - st.p) / 10, -1, 1); };
  /* いま見ている向き（地上視点なら自分で向けた方向、それ以外は観覧位置から北） */
  function eyeDir() {
    if (curView === 'ground') { const a = gYaw - look.y; return { ex: gEye.x, ey: gEye.y, dx: Math.sin(a), dy: Math.cos(a) }; }
    return { ex: GROUND_EYE.x, ey: GROUND_EYE.y, dx: 0, dy: 1 };
  }
  /* 技に入る前の進入路を決める。見ている正面の少し先を中心に、近いほうの横から入って正面を横切る。
     入る場所は文（st.cue）と地上の柱で知らせる */
  function planEntry(m) {
    const e = eyeDir(), W = LIMIT - 220;
    const cx = clamp(e.ex + e.dx * SHOW.GATE, -W, W), cy = clamp(e.ey + e.dy * SHOW.GATE, -W, W);
    const sx = e.dy, sy = -e.dx;                                          // 正面から見て右向き
    const side = ((st.x - cx) * sx + (st.y - cy) * sy) >= 0 ? 1 : -1;     // 機体に近いほうの横から
    if (m.entry === 'front') {
      /* 正面の遠くから向かってくる課目。門は正面の線から少し横に置く。
         そこから正面の線に乗り直してくるので、まっすぐ向かってくる形になる
         （線の上に門を置くと、門で 180 度 向き直すことになり、正面から外れる） */
      GATE.x = clamp(e.ex + e.dx * (SHOW.GATE + 900) + sx * side * 420, -W, W);
      GATE.y = clamp(e.ey + e.dy * (SHOW.GATE + 900) + sy * side * 420, -W, W);
    } else {                            // 近いほうの横から入って、正面を横切る
      GATE.x = clamp(cx + sx * side * SHOW.SIDE, -W, W);
      GATE.y = clamp(cy + sy * side * SHOW.SIDE, -W, W);
    }
    GATE.z = m.alt || SHOW.ALT_IN;
    aimX = cx; aimY = cy;
    const bear = ((Math.atan2(GATE.x - e.ex, GATE.y - e.ey) / D) % 360 + 360) % 360;
    const face = ((Math.atan2(e.dx, e.dy) / D) % 360 + 360) % 360;
    planFace = face;
    const rel = wrap180(bear - face);
    const hand = Math.abs(rel) < 22 ? '正面' : (rel > 0 ? '右手' : '左手');
    st.cue = `${hand}（${DIRJA[Math.round(bear / 45) % 8]}）から進入`;
    marker.position.set(GATE.x, GATE.y, 160); markOn = true;
  }
  /* 図を終える。機体は散らばった位置にいるので、そこからの相対位置を覚えて、隊形へ寄り直させる */
  function endFigure() {
    if (!fig) return;
    const inv = att.clone().invert();
    mates.forEach(h => {
      if (!h.visible) return;
      mo.copy(h.position).sub(plane.position).applyQuaternion(inv);
      h.userData.cur.set(mo.x, Math.min(-20, mo.y), mo.z);
      startJoin(h.userData);                                   // 図の位置から隊形へ、ゆっくり戻る
    });
    fig = null;
  }
  function endEntry() {
    manPhase = 'do'; st.cue = ''; markOn = false;
    /* 回る課目は、まず観覧位置から遠ざかる側へ回る（近づく側へ回ると頭の上を越えて後ろへ抜ける） */
    turnSign = wrap180(planFace - st.h) >= 0 ? 1 : -1;
    manT = 0; rollSum = 0; loopSum = 0; hdgSum = 0; prevH = st.h;
  }
  /* 課目を始める。使う隊形をそろえてから（いまの機数によらず集まる）、進入に入る */
  function beginManeuver(i) {
    corkT = -1; endFigure();
    step_i = i; manT = 0; rollSum = 0; loopSum = 0; hdgSum = 0; prevH = st.h; phaseT = 0; formScale = 1;
    const m = PROGRAM[i];
    formation = m.form || userForm;
    st.show = m.ja; st.desc = m.desc || '';
    GATE.z = m.alt || SHOW.ALT_IN;
    if (m.front !== false && (curView === 'ground' || !oneShot)) { planEntry(m); manPhase = 'in'; }
    else if (st.z < GATE.z - 60) { manPhase = 'climb'; st.cue = '高度を取ります'; markOn = false; }
    else { manPhase = 'do'; st.cue = ''; markOn = false; }
  }
  function nextManeuver() {
    formScale = 1;
    if (oneShot) {   // 1 つだけの技なら、水平に戻してから操縦を返す
      manPhase = 'out'; phaseT = 0; st.cue = '水平に戻します'; markOn = false; corkT = -1; endFigure(); return;
    }
    beginManeuver((step_i + 1) % PROGRAM.length);
  }
  /* 墜落しないための備え。低いときは、まず翼を水平に戻してから引き起こす
     （背面のまま引くと地面へ向かうので、順番が要る） */
  function safety() {
    if (st.z > 1500 && st.p > -10) { autoIn.y = 0.8; return; }        // 高すぎるときは下げる
    /* 壁の外へ出たら、中へ向き直る（急がず、傾きは 45 度まで） */
    const outX = Math.abs(st.x) > LIMIT - 120, outY = Math.abs(st.y) > LIMIT - 120;
    if (outX || outY) {
      const wantH = ((Math.atan2(-st.x, -st.y) / D) % 360 + 360) % 360;
      const e = wrap180(wantH - st.h);
      if (Math.abs(e) > 25) { autoIn.x = clamp(clamp(e * 1.2, -45, 45) - st.b, -22, 22) / 22; }
    }
    const ahead = st.z + fwd.z * SPEED * 6;                           // このまま 6 秒進んだときの高さ
    if (Math.abs(st.b) > 60 && st.z < 180 && fwd.z < 0.15) {          // 低くて背面気味: まず翼を水平に戻す
      autoIn.x = clamp(-wrap180(st.b) / 25, -1, 1); autoIn.y = clamp(st.p / 25, -0.2, 0.2); return;
    }
    if (ahead < 90 || st.z < 70) {                                    // 地面に着きそう: 水平にして引き起こす
      autoIn.x = clamp(-st.b / 20, -1, 1);
      autoIn.y = -clamp(0.4 + (90 - Math.min(ahead, st.z)) / 90, 0, 1);
    }
  }
  function autoInputs(dt) {
    manT += dt;
    hdgSum += Math.abs(wrap180(st.h - prevH)); prevH = st.h;
    rollSum += Math.abs(RATE.roll * autoIn.x) * dt;
    const m = PROGRAM[step_i], ox = GROUND_EYE.x, oy = GROUND_EYE.y;
    if (manPhase !== 'do') {                     // 見ている前方へ回り込んでから技に入る
      phaseT += dt;
      if (manPhase === 'out') {          // 技のあと、翼を水平・機首を水平に戻してから操縦を返す
        autoIn.x = clamp(-wrap180(st.b) / 18, -1, 1); autoIn.y = -clamp(-st.p / 10, -1, 1); autoIn.r = 0;
        safety();
        if ((Math.abs(st.b) < 12 && Math.abs(st.p) < 8 && st.z > 120) || phaseT > 10) {
          auto = false; oneShot = false; manPhase = 'do'; st.show = ''; st.cue = ''; st.desc = ''; formation = userForm; formScale = 1;
        }
        return autoIn;
      }
      if (manPhase === 'climb') {          // 技に要る高さまで、まっすぐ上げる
        steerTo(st.x + fwd.x * 500, st.y + fwd.y * 500, GATE.z);
        if (st.z > GATE.z - 40 || phaseT > 20) endEntry();
      } else if (manPhase === 'in') {
        const e2 = eyeDir(), f2 = ((Math.atan2(e2.dx, e2.dy) / D) % 360 + 360) % 360;
        if (Math.abs(wrap180(f2 - planFace)) > 35) planEntry(m);   // 見ている向きが変わったら、進入路を引き直す
        steerTo(GATE.x, GATE.y, GATE.z);
        if (Math.hypot(st.x - GATE.x, st.y - GATE.y) < 260 || phaseT > 45) { manPhase = 'align'; phaseT = 0; }
      } else {
        steerTo(aimX, aimY, GATE.z);
        const wantH = ((Math.atan2(aimX - st.x, aimY - st.y) / D) % 360 + 360) % 360;
        if (m.entry === 'front') {
          /* 正面から入る課目は、観覧位置の正面の線に乗ってから始める（横にずれたまま始めると、
             まっすぐ進む課目が正面から外れる）。まだ 780 m 手前のうちに始めて、見ごたえを取る */
          const e5 = eyeDir();
          const along = (st.x - e5.ex) * e5.dx + (st.y - e5.ey) * e5.dy;
          const side = Math.abs((st.x - e5.ex) * e5.dy - (st.y - e5.ey) * e5.dx);
          if ((along < 780 && side < 90 && Math.abs(wrap180(wantH - st.h)) < 10 && Math.abs(st.z - GATE.z) < 90) || phaseT > 26) endEntry();
        } else {
          const near = Math.hypot(st.x - aimX, st.y - aimY) < 280 && Math.abs(st.z - GATE.z) < 80;
          if ((near && Math.abs(wrap180(wantH - st.h)) < 50) || phaseT > 22) endEntry();
        }
      }
      safety();
      return autoIn;
    }
    const rx = st.x - ox, ry = st.y - oy, r = Math.max(1, Math.hypot(rx, ry));
    const away = (d, z) => steerTo(ox - rx / r * d, oy - ry / r * d, z);   // 観覧位置の向こうへ抜ける
    switch (m.id) {
      case 'orbit': {                            // 観覧位置のまわりを回る（次の課目への移動）
        const a = Math.atan2(ry, rx) + 0.55;
        steerTo(ox + Math.cos(a) * SHOW.R, oy + Math.sin(a) * SHOW.R, SHOW.ALT);
        if (manT > m.t) nextManeuver();
        break;
      }
      case 'pass':                               // 観覧位置の正面を低めに通り抜ける
        away(700, SHOW.ALT - 40);
        if (manT > m.t) nextManeuver();
        break;
      case 'loop':                               // デルタ・ループ: 正面で引き起こし、輪を描く
        loopSum += RATE.pitch * dt; autoIn.x = 0; autoIn.y = -1; autoIn.r = 0;
        if (loopSum > 360 || manT > 20) nextManeuver();
        break;
      case 'roll':                               // デルタ・ロール: 隊形のまま横転（機首は少し上げ気味）
        autoIn.x = 1; holdPitch(6); autoIn.r = 0;
        if (rollSum > 360 || manT > 12) nextManeuver();
        break;
      case 'wide':                               // ワイド・トゥ・デルタ・ループ: 間隔を広げて入り、輪の中で詰める
        loopSum += RATE.pitch * dt; autoIn.x = 0; autoIn.y = -1; autoIn.r = 0;
        formation = 'delta'; formScale = lerp(2.4, 1, loopSum / 320);
        if (loopSum > 360 || manT > 20) nextManeuver();
        break;
      case 'eight':                              // レター・エイト: 右へ 1 周、左へ 1 周で 8 の字
        holdBank((hdgSum < 360 ? 56 : -56) * turnSign); holdPitch(0);
        if (hdgSum > 720 || manT > 60) nextManeuver();
        break;
      case 'vert':                               // バーティカル・クライム・ロール: 垂直に上げながら横転
        if (st.p < 70 && manT < 8) { autoIn.x = 0; autoIn.y = -1; }
        else if (rollSum < 360 && st.z < 1200) { autoIn.x = 1; autoIn.y = 0; }
        else { autoIn.x = clamp(-st.b / 20, -1, 1); autoIn.y = 0.6; }
        autoIn.r = 0;
        if ((st.p < 10 && manT > 10) || manT > 26) nextManeuver();
        break;
      case 'half':                               // ハーフ・スロー・ロール: 背面にして少し飛び、戻す
        if (manT < 3) { autoIn.x = 1; holdPitch(3); }
        else if (manT < 6) { autoIn.x = 0; autoIn.y = -0.25; }
        else { autoIn.x = 1; holdPitch(3); }
        autoIn.r = 0;
        if (manT > 9) nextManeuver();
        break;
      case 'bloom':                              // 上向き空中開花: 正面で垂直上昇し、隊形を大きく開く
        if (st.p < 72 && manT < 7) { autoIn.x = 0; autoIn.y = -1; }
        else { autoIn.x = clamp(-st.b / 20, -1, 1); autoIn.y = 0.5;
          formation = 'leaders'; formScale = lerp(1, 3.2, (manT - 7) / 4); }
        autoIn.r = 0;
        if (manT > 15) nextManeuver();
        break;
      case 'rain':                               // レインフォール: 輪に入り、真下を向いたところで大きく散開
        loopSum += RATE.pitch * dt; autoIn.x = 0; autoIn.y = -1; autoIn.r = 0;
        if (st.p < -50) { formation = 'pyramid'; formScale = lerp(1, 2.6, (loopSum - 200) / 90); }
        if (loopSum > 360 || manT > 22) nextManeuver();
        break;
      case 'byover': {                           // 頭上通過: 見ている人の真上を低く通り抜ける
        const e3 = eyeDir();
        steerTo(e3.ex - e3.dx * 600, e3.ey - e3.dy * 600, m.alt || 130);
        const past = (st.x - e3.ex) * e3.dx + (st.y - e3.ey) * e3.dy;   // 正なら観覧位置の手前、負なら越えた先
        if (past < -300 || manT > 30) nextManeuver();
        break;
      }
      case 'cupid': case 'star': {               // 描き物: 2 番機以降が図を描き、1 番機は図のそばを回る
        if (!fig) {
          if (!matesReady() && manT < 26) { holdBank(28); holdPitch(0); break; }   // 集まるまで ゆっくり回って待つ
          beginFigure(m.fig);
        }
        fig.t += dt;
        /* 1 番機は図の下のあたりを ゆっくり回る。目で追う視点は 1 番機を追うので、図も画面に入る */
        const fa = Math.atan2(st.y - figO.y, st.x - figO.x) + 0.5;
        steerTo(figO.x + Math.cos(fa) * 160, figO.y + Math.sin(fa) * 160, Math.max(160, figO.z - 230));
        if (fig.t >= fig.dur + 1.2) nextManeuver();
        break;
      }
      case 'cork': {                             // コークスクリュー: 1 番機はまっすぐ、2 番機がその周りを回る
        const e4 = eyeDir();
        steerTo(e4.ex - e4.dx * 700, e4.ey - e4.dy * 700, m.alt || 200);
        holdBank(clamp(st.b + autoIn.x * 22, -16, 16));   // 1 番機はほぼ水平のまま、向きだけ少し直す
        corkT = corkT < 0 ? 0 : corkT + dt;
        const past4 = (st.x - e4.ex) * e4.dx + (st.y - e4.ey) * e4.dy;   // 正なら手前、負なら越えた先
        if (past4 < -320 || manT > 34) nextManeuver();
        break;
      }
      case 'change':                             // チェンジオーバー・ターン: 縦隊で入り、正面で組み替えて大きく旋回
        if (manT < 4) { formation = 'trail'; away(600, SHOW.ALT); }
        else { formation = userForm === 'solo' ? 'delta' : userForm; formScale = lerp(1.9, 1, (manT - 4) / 8); holdBank(52 * turnSign); holdPitch(2); }
        if (hdgSum > 300 || manT > 20) nextManeuver();
        break;
      case 'turnloop':                           // 360 度ターン & ループ: 1 周旋回してから宙返り
        if (hdgSum < 350) { holdBank(54 * turnSign); holdPitch(0); }
        else { loopSum += RATE.pitch * dt; autoIn.x = 0; autoIn.y = -1; }
        autoIn.r = 0;
        if (loopSum > 360 || manT > 40) nextManeuver();
        break;
    }
    safety();   // 墜落と天井の備え（どの課目でも最後に効かせる）
    return autoIn;
  }

  function step(dt) {
    if (st.ground) return;   // 着地したら止まったまま。「水平に戻す」か「初期位置」で再開する
    const inp = auto ? autoInputs(dt) : input;
    const roll = RATE.roll * inp.x * dt * D;        // 機首軸(+y): 右に倒すと右バンク
    const pitch = -RATE.pitch * inp.y * dt * D;     // 翼軸(+x): 手前に引くと機首上げ
    const yaw = RATE.yaw * inp.r * dt * D;          // 上下軸(+z): 右方向舵で機首が右へ
    if (roll) att.multiply(dq.setFromAxisAngle(AY, roll));
    if (pitch) att.multiply(dq.setFromAxisAngle(AX, pitch));
    if (yaw) att.multiply(dq.setFromAxisAngle(AZ, -yaw));
    /* バンクによる旋回（協調旋回）。世界の上下軸まわりに機体ごと回す。真上・真下付近では効かせない */
    readAttitude();
    if (Math.abs(st.p) < 70) {
      const turn = clamp((9.81 / SPEED) * Math.tan(st.b * D) / D, -30, 30) * dt * D;
      if (turn) att.premultiply(dq.setFromAxisAngle(AZ, -turn));
    }
    att.normalize(); readAttitude();
    st.x += fwd.x * SPEED * dt; st.y += fwd.y * SPEED * dt; st.z += fwd.z * SPEED * dt;
    /* 技の途中（自動操縦）は、壁を少し越えてもよい。警告も出さず、自然に飛びながら戻ってくる。
       自分で操縦しているときは これまでどおり壁で止める */
    const L = auto ? LIMIT + 420 : LIMIT - 4, C = auto ? CEIL + 300 : CEIL;
    st.wall = !auto && (Math.abs(st.x) > L || Math.abs(st.y) > L || st.z > CEIL);
    st.x = clamp(st.x, -L, L); st.y = clamp(st.y, -L, L); st.z = Math.min(st.z, C);
    if (auto && st.z < 45) { st.z = 45; levelAttitude(); }          // 自動操縦では墜落させない（最後の砦）
    if (!auto && st.z <= 3) { st.z = 3; st.ground = true; }         // 自分で操縦して地面に着いたら、その姿勢のまま止める
    if (!Number.isFinite(st.x + st.y + st.z + st.h + st.p + st.b)) {   // 数でなくなったら開始位置へ戻す
      Object.assign(st, { x: START.x, y: START.y, z: START.z, h: START.h, ground: false, wall: false });
      levelAttitude(); hist.length = 0; auto = false; oneShot = false; formScale = 1;
      manPhase = 'do'; st.cue = ''; markOn = false;
    }
  }
  /* 先頭機の軌跡を残し、そこから編隊機の位置を決める */
  const mq = new THREE.Quaternion(), mp = new THREE.Vector3(), mo = new THREE.Vector3(), cq = new THREE.Quaternion(), fwant = new THREE.Vector3();
  /* いまの位置から u.want へ向かう道を引き直す。外へ膨らませて、まっすぐ突っ込まないようにする */
  function startJoin(u) {
    if (!u.from) { u.from = new THREE.Vector3(); u.bow = new THREE.Vector3(); }
    u.from.copy(u.cur); u.k = 0;
    const amt = Math.min(90, u.from.distanceTo(u.want) * 0.28);
    u.bow.set((u.from.x >= 0 ? 1 : -1) * amt, 0, amt * 0.3);
  }
  let corkT = -1;                                  // 0 以上ならコークスクリューの最中（2 番機が周りを回る）
  /* 描き物の課目（キューピッド・スタークロス）。編隊では描けない形なので、機体を式で置く。
     1 番機（操作する機体）は隠して、2 番機以降で描く。図は観覧位置の正面の空に立てた面の上に描く */
  const FIGS = { cupid: { dur: 26, n: 3, s: 15, d: 780, z: 500 }, star: { dur: 20, n: 5, s: 17, d: 820, z: 430 } };
  let fig = null;                                  // {id, t, dur, n, s}
  const figO = new THREE.Vector3(), figR = new THREE.Vector3(), figU = new THREE.Vector3(0, 0, 1), figF = new THREE.Vector3();
  const fp = new THREE.Vector3(), fp2 = new THREE.Vector3(), fUp = new THREE.Vector3(), fRt = new THREE.Vector3(), fFw = new THREE.Vector3();
  const fmat = new THREE.Matrix4(), fq = new THREE.Quaternion();
  /* 図を描く前に、編隊が組み終わっているか（合流の途中で始めると、機体が飛んで移動してしまう） */
  function matesReady() {
    const f = FORMATIONS[formation];
    return mates.every((h, i) => !f.offs[i] || (h.userData.k || 0) > 0.9);
  }
  function beginFigure(id) {
    const e = eyeDir(), f = FIGS[id];
    figO.set(e.ex + e.dx * f.d, e.ey + e.dy * f.d, f.z);
    figR.set(e.dy, -e.dx, 0); figF.set(e.dx, e.dy, 0);
    fig = { id, t: 0, dur: f.dur, n: f.n, s: f.s };
  }
  /* 図の中の位置（a: 右、b: 上、単位）。u は 0〜1 の進み具合、i は何番目の機体か */
  function figXY(id, i, u) {
    if (id === 'cupid') {
      if (i < 2) {                                 // ハートを描く 2 機（左右に分かれて回り込む）
        const k = i === 0 ? 1 : -1;
        if (u < 0.22) { const v = u / 0.22; return { a: k * 1.2 * (1 - v), b: -24 + 29 * v }; }
        const t = Math.PI * (u - 0.22) / 0.78;
        return { a: k * 16 * Math.pow(Math.sin(t), 3),
                 b: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) };
      }
      return { a: -40 + 80 * u, b: -26 + 52 * u };   // 矢（左下から右上へ貫く）
    }
    const RS = 18, ang = (90 + i * 72) * D;         // スタークロス: 開いてから、1 つ飛ばしの頂点へ渡る
    const ax = Math.cos(ang) * RS, ay = Math.sin(ang) * RS;
    if (u < 0.4) { const v = u / 0.4; return { a: ax * v, b: ay * v }; }
    const a2 = (90 + (i + 2) * 72) * D, v = (u - 0.4) / 0.6;
    return { a: ax + (Math.cos(a2) * RS - ax) * v, b: ay + (Math.sin(a2) * RS - ay) * v };
  }
  function figPoint(out, id, i, u, sc) {
    const q = figXY(id, i, clamp(u, 0, 1));
    return out.copy(figO).addScaledVector(figR, q.a * sc).addScaledVector(figU, q.b * sc);
  }
  const CORK_R = 26, CORK_T = 3.6, CORK_LAG = 0.15;   // 回る半径（m）・1 周の時間（秒）・少し後ろ（秒）
  function recordHistory(dt) {
    histT += dt;
    hist.push({ t: histT, p: plane.position.clone(), q: att.clone() });
    while (hist.length > 2 && hist[0].t < histT - 20) hist.shift();   // 後ろの遠く（合流位置）まで届く長さ
  }
  const exFwd = new THREE.Vector3(), exPos = new THREE.Vector3(), exSt = { p: exPos, q: null };
  /* lag 秒前の 1 番機の状態。記録より前を求められたら、いちばん古い点から後ろへ まっすぐ延ばす。
     （その場に留めると、機体が空中で止まって待っているように見える） */
  function stateAt(lag) {
    const want = histT - lag;
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t <= want) return hist[i];
    const h0 = hist[0];
    if (!h0) return { p: plane.position, q: att };
    const extra = h0.t - want;
    if (extra <= 0.02) return h0;
    exFwd.set(0, 1, 0).applyQuaternion(h0.q);
    exPos.copy(h0.p).addScaledVector(exFwd, -extra * SPEED);
    exSt.q = h0.q;
    return exSt;
  }
  function placeMates(dt) {
    const f = FORMATIONS[formation], on = smokers(), cols = SMOKE_COLORS[smokeColor].c;
    const emitting = smokeOn && smokeT >= SMOKE_DT;
    if (emitting) smokeT = 0;
    if (on[0] && emitting && !fig) { emitPos.set(0, -6.9, -0.3).applyQuaternion(att).add(plane.position); emit(emitPos, cols[0 % cols.length]); }
    mates.forEach((holder, i) => {
      const target = f.offs[i], u = holder.userData, e = ENTRY[i];
      /* 描き物の最中: 式のとおりに置く。始めの 2.5 秒は、いまの位置から図の始点へなめらかに移る */
      if (fig) {
        if (i >= fig.n) { holder.visible = false; return; }
        const pu = clamp(fig.t / fig.dur, 0, 1);
        figPoint(fp, fig.id, i, pu, fig.s);
        figPoint(fp2, fig.id, i, pu + 0.004, fig.s);
        fFw.copy(fp2).sub(fp); if (fFw.lengthSq() < 1e-9) fFw.copy(figF); fFw.normalize();
        fUp.copy(figO).sub(fp);                                  // 図の中心の側を機体の上に向ける
        fUp.addScaledVector(fFw, -fUp.dot(fFw));
        if (fUp.lengthSq() < 1e-6) fUp.copy(figU);
        fUp.normalize(); fRt.crossVectors(fFw, fUp);
        fq.setFromRotationMatrix(fmat.makeBasis(fRt, fFw, fUp));
        if (fig.t < 6) {
          /* 隊形の位置から図の道へ寄せる。寄せ元は「編隊で飛び続けていたらいる位置」なので、
             止まって待っているようには見えない */
          const s3 = stateAt(Math.max(0, -u.cur.y / SPEED));
          mq.copy(s3.q); mp.copy(s3.p);
          mo.set(u.cur.x, 0, u.cur.z).applyQuaternion(mq); mp.add(mo);
          const k = fig.t / 6, e2 = k * k * (3 - 2 * k);
          holder.position.lerpVectors(mp, fp, e2);
          holder.quaternion.copy(mq).slerp(fq, e2);
        } else { holder.position.copy(fp); holder.quaternion.copy(fq); }
        holder.visible = true;
        if (emitting && fig.t > 1.2) { emitPos.set(0, -6.9, -0.3).applyQuaternion(holder.quaternion).add(holder.position); emit(emitPos, cols[(i + 1) % cols.length]); }
        return;
      }
      /* コークスクリューの 2 番機: 1 番機のまわりを回る。背中（機体の上）を輪の中心へ向ける。
         機体の軸まわりに θ+180° 回すと、上が中心を向く */
      if (corkT >= 0 && i === 0) {
        const th = corkT / CORK_T * Math.PI * 2, s2 = stateAt(CORK_LAG);
        u.cur.set(Math.sin(th) * CORK_R, -CORK_LAG * SPEED, Math.cos(th) * CORK_R);
        mq.copy(s2.q).multiply(cq.setFromAxisAngle(AY, th + Math.PI));
        mo.set(u.cur.x, 0, u.cur.z).applyQuaternion(s2.q);
        holder.position.copy(s2.p).add(mo); holder.quaternion.copy(mq); holder.visible = true;
        if (emitting) { emitPos.set(0, -6.9, -0.3).applyQuaternion(mq).add(holder.position); emit(emitPos, cols[1 % cols.length]); }
        return;
      }
      /* どの編隊の変更でも、いまの位置から新しい位置へなめらかに移る。
         隊形から外れる機体は後ろの遠く（ENTRY）へ離れていき、届いたら消える */
      fwant.set(target ? target[0] * formScale : e[0], target ? target[1] * formScale : e[1], target ? target[2] * formScale : e[2]);
      if (!u.from || u.want.distanceTo(fwant) > 6) { u.want.copy(fwant); startJoin(u); }   // 行き先が変わったら道を引き直す
      else u.want.copy(fwant);
      const py = u.cur.y;
      u.k = Math.min(1, (u.k || 0) + dt / JOIN_TIME);
      const ek = u.k * u.k * (3 - 2 * u.k);                    // ゆっくり出て ゆっくり入る
      u.cur.lerpVectors(u.from, u.want, ek).addScaledVector(u.bow, Math.sin(Math.PI * u.k));
      /* 前後のずれが 1 秒に 30 m を超えると、下がる速さと飛ぶ速さが釣り合って、
         機体が空中で止まっているように見える。前後だけ速さに上限をかける */
      const lim = 30 * dt;
      u.cur.y = clamp(u.cur.y, py - lim, py + lim);
      const settled = u.k > 0.97 && Math.abs(u.cur.y - u.want.y) < 20;
      /* 離れていく機体は、十分に離れて小さくなってから消す */
      if (!target && (settled || u.cur.length() > 520)) { holder.visible = false; return; }
      holder.visible = true;
      const st2 = stateAt(Math.max(0, -u.cur.y / SPEED));
      mq.copy(st2.q); mp.copy(st2.p);
      mo.set(u.cur.x, 0, u.cur.z).applyQuaternion(mq);
      holder.position.copy(mp).add(mo); holder.quaternion.copy(mq);
      if (target && settled && on[i + 1] && emitting) { emitPos.set(0, -6.9, -0.3).applyQuaternion(mq).add(holder.position); emit(emitPos, cols[(i + 1) % cols.length]); }
    });
    if (emitting) { smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.acolor.needsUpdate = true; smokeGeo.attributes.birth.needsUpdate = true; }
    smokeMat.uniforms.uTime.value = clock;
  }

  let lastDt = 0.016;
  function place(dt) {
    if (dt) lastDt = dt;
    rotation();
    walls.forEach(w => { w.visible = !auto; });   // 技の途中は壁の枠を出さない
    /* 自動追従: 地上から見るとき、飛んでいる機体の真ん中へ ゆっくり首を回す。
       図を描く課目では機体が広がるので、見えている機体の平均を見る（急に動くと見づらいので少しずつ） */
    if (follow && curView === 'ground') {
      focus.copy(plane.position); let fn = 1;
      mates.forEach(mt => { if (mt.visible) { focus.add(mt.position); fn++; } });
      focus.multiplyScalar(1 / fn);
      tmp.copy(focus).sub(gEye);
      const wy = Math.atan2(tmp.x, tmp.y), wp = Math.asin(clamp(tmp.z / Math.max(1, tmp.length()), -1, 1));
      const k = 1 - Math.exp(-(dt || 0.016) / 0.45);
      gYaw += ((wy - gYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * k;
      gPitch += (wp - gPitch) * k;
    }
    marker.visible = markOn && curView === 'ground' && !follow;   // 進入の目印は、地上から自分で向きを決めているときだけ
    plane.position.set(st.x, st.y, st.z); plane.quaternion.setFromRotationMatrix(R);
    shadow.position.set(st.x, st.y, 0.8); shadow.material.opacity = 0.4 * Math.max(0.15, 1 - st.z / 500);
    drop.position.set(st.x, st.y, 0); drop.scale.z = Math.max(0.1, st.z - 1);
    if (curView === 'ground') {
      /* 地上から見る。機体は追いかけない（自分で向けた方向のまま）。
         向きは 見回し（ドラッグ）だけで変わり、立ち位置は 2 回叩いた場所へ移る */
      cam.position.copy(gEye); cam.up.set(0, 0, 1);
      const yaw = gYaw - look.y, pit = clamp(gPitch + look.p, -1.35, 1.35);
      st.gh = ((yaw / D) % 360 + 360) % 360;   // 地上で見ている方位（右上の方位計に出す）
      gdir.set(Math.sin(yaw) * Math.cos(pit), Math.cos(yaw) * Math.cos(pit), Math.sin(pit));
      cam.lookAt(tmp.copy(gdir).multiplyScalar(200).add(cam.position));
    } else if (curView === 'third' || curView === 'front') {
      /* 三人称は機体の後ろ上（前方視点は機首の前）から。ドラッグで機体のまわりを回れる */
      const back = curView === 'front' ? 36 : -32, up = curView === 'front' ? 5 : 10;
      tmp.set(0, back, up);
      tmp.applyAxisAngle(AX, look.p).applyAxisAngle(AZ, -look.y).applyQuaternion(att).add(plane.position);
      if (camPos.lengthSq() === 0) camPos.copy(tmp); else camPos.lerp(tmp, 0.18);
      cam.position.copy(camPos); cam.up.copy(bup); cam.lookAt(plane.position);
    } else {
      cam.position.copy(tmp.copy(EYE).add(eyeOff).applyMatrix4(R).add(plane.position));
      /* 一人称は少し下向き（計器盤と操縦桿が視界に入る）。そこからドラッグで首を振る */
      cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(R, RX90).multiply(TILT));
      cam.quaternion.multiply(qc.setFromAxisAngle(AY, look.y)).multiply(qc.setFromAxisAngle(AX, look.p));
    }
    sky.position.copy(cam.position);
  }

  let running = true, raf = 0, last = performance.now();
  /* 1 フレームの中で何かに失敗しても、次のフレームを必ず要求する（要求をやめると画面が固まって見える）。
     続けて失敗するときは自動操縦を切って水平に戻す */
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    try {
      clock += dt; smokeT += dt;
      step(dt); place(dt); recordHistory(dt); placeMates(dt); renderer.render(world, cam);
      st.err = 0;
    } catch (e) {
      st.err = (st.err || 0) + 1;
      if (st.err <= 2) console.error('sim frame error', e);
      if (st.err === 3) { auto = false; oneShot = false; formation = userForm; formScale = 1; levelAttitude(); manPhase = 'do'; st.cue = ''; markOn = false; }
    }
    if (onState) onState(st);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  /* 一人称はカメラの手前の面を 1.1 で切る（目のすぐ前にある機体内部の部品が画面を塞ぐのを防ぐ）。三人称は 0.5 */
  function setView(v) {
    curView = v; look.y = 0; look.p = 0; const out = v !== 'first';
    seatMeshes.forEach(m => { m.visible = out; });
    cockpit.visible = !out;
    baseFov = v === 'ground' ? 42 : out ? 55 : 68; cam.near = out ? 0.5 : 1.1; applyFov(); camPos.set(0, 0, 0);
    if (v === 'ground') gAim();   // 入ったときだけ機体の方を向く。以後は自分で向ける
  }
  setView(view);

  return {
    input, state: st, setView,
    /* 画面のドラッグで視点を動かす（度）。一人称は首、三人称は機体のまわり */
    addLook(dy, dp) { look.y = ((look.y + dy * D + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      look.p = clamp(look.p + dp * D, -LOOK_MAX_P, LOOK_MAX_P); },
    resetLook() { if (curView === 'ground') gAim(); else { look.y = 0; look.p = 0; } },
    /* 地上視点で 2 回叩いた場所へ立ち位置を移す。画面の座標は −1〜1（中央が 0）。
       地面・滑走路・オブジェクト（山や家や木）の上に立てる */
    groundMoveTo(nx, ny) {
      if (curView !== 'ground') return false;
      gRay.setFromCamera({ x: nx, y: ny }, cam);
      const hit = gRay.intersectObjects([ground, runway, props], true)[0];
      if (!hit) return false;
      gEye.set(hit.point.x, hit.point.y, hit.point.z + EYE_H);
      gAim();
      return true;
    },
    /* 地上視点で立ち位置を歩かせる（自動操縦のときのスティック）。
       見ている向きを前として、前後左右に動く。地面・滑走路・オブジェクトの上に立つ */
    groundWalk(dx, dy) {
      if (curView !== 'ground') return false;
      const a = gYaw - look.y, v = 34 * lastDt, W = LIMIT - 30;
      const fx = Math.sin(a), fy = Math.cos(a);
      const nx = clamp(gEye.x + (fx * dy + Math.cos(a) * dx) * v, -W, W);
      const ny = clamp(gEye.y + (fy * dy - Math.sin(a) * dx) * v, -W, W);
      gRay.set(tmp.set(nx, ny, 900), down);
      const hit = gRay.intersectObjects([ground, runway], true)[0];   // 歩くのは地面と滑走路の上（山や家には登らない）
      gEye.set(nx, ny, (hit ? hit.point.z : 0) + EYE_H);
      return true;
    },
    /* 自動操縦の入り切り。入れたときは観覧位置の南の空から演技を始める */
    setAuto(on) {
      auto = !!on; oneShot = false;
      if (auto) {
        userForm = formation;
        Object.assign(st, { x: GROUND_EYE.x - 380, y: GROUND_EYE.y - 620, z: SHOW.ALT, h: 25, ground: false, wall: false });
        levelAttitude(); camPos.set(0, 0, 0); hist.length = 0; clearSmoke();
        beginManeuver(0);
      } else { formation = userForm; formScale = 1; st.show = ''; st.cue = ''; markOn = false; step_i = 0; manPhase = 'do'; corkT = -1; endFigure(); }
    },
    autoState() { return auto; },
    setZoom(z) { zoom = clamp(z, 1, 6); applyFov(); return zoom; },   // 1〜6 倍
    setFollow(on) { follow = !!on; if (follow && curView === 'ground') { look.y = 0; look.p = 0; } },
    followState() { return follow; },
    zoomVal() { return zoom; },
    /* 技の一覧（移動のための旋回と正面通過を除く）と、1 つだけ行わせる呼び出し。
       自分で操縦しているときに技を選ぶと、その技の間だけ自動で飛び、終わると操縦が戻る */
    maneuvers() { const seen = new Set();   // 同じ技が演技の中に何度も出るので、一覧では 1 つにまとめる
      return PROGRAM.map((m, i) => ({ i, id: m.id, ja: m.ja, desc: m.desc || '' })).filter(m => m.id !== 'orbit' && m.id !== 'pass' && !seen.has(m.id) && seen.add(m.id)); },
    runManeuver(i) {
      if (!PROGRAM[i] || st.ground) return false;
      if (!auto) { userForm = formation; oneShot = true; }   // 自分で操縦しているときは、その技だけ行って操縦を返す
      auto = true; beginManeuver(i); return true;
    },
    setProps(on) { props.visible = !!on; },   // オブジェクト（山・民家・木・塔）の出し入れ
    setFormation(f) { if (FORMATIONS[f]) { formation = f; userForm = f; } },   // 飛びながら変えられる。合流は placeMates がなめらかにする
    formation() { return formation; },
    setSmoke(on) { smokeOn = !!on; },
    smokeState() { return smokeOn; },
    setSmokeColor(c) { if (SMOKE_COLORS[c]) { smokeColor = c; clearSmoke(); } },
    level() { levelAttitude(); st.ground = false; },
    home() { Object.assign(st, { x: START.x, y: START.y, z: START.z, h: START.h, ground: false, wall: false }); levelAttitude(); camPos.set(0, 0, 0); hist.length = 0; clearSmoke(); },
    dispose() { running = false; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); cv.remove(); }
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
