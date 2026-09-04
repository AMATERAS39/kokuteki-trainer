/* 操縦操作の練習シミュレーター（three.js）。
   世界座標: x=東 y=北 z=上（単位 m）。機体の向きは方位 h（北 0°、時計回り）、ピッチ p（機首上げ正）、バンク b（右バンク正）で
   R = Rz(−h)·Rx(p)·Ry(b)。出題と同じ向きの約束（操縦桿右 → 右バンク → 景色は左に傾く、右方向舵 → 右を向く → 景色は左へ流れる）。
   ±LIMIT m の四角い空間の中を一定速度で飛び、壁と地面で止まる。 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const D = Math.PI / 180;
export const LIMIT = 1800;                       // 壁までの距離（原点から、m）。壁は近づくまで見えない（place で薄くする）
const WALL_FADE = 400;                           // 壁が見えはじめる距離（m）。これより遠いと透明
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
  tree:    { ja: 'クリスマスツリー', n: 6, offs: [[-14, -22, -6], [14, -22, -6], [-28, -44, -12], [0, -44, -12], [28, -44, -12]] },
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
const SMOKE_MAX = 1400;                          // 1 機あたりの粒の数（0.04 秒ごとに 1 つ。濃い煙のときは 3 つ）
const SMOKE_DT = 0.04;
/* 編隊に入るとき・抜けるときの位置（先頭機から見て後ろの遠く）。ここから所定の位置へ 4 秒かけて寄る */
const ENTRY = [[-170, -620, 40], [170, -620, 40], [-250, -800, -30], [250, -800, -30], [0, -960, 60]];
const JOIN_TIME = 14;                             // 隊形を変えるときにかける時間（秒）。ゆっくり出て ゆっくり入る
/* 自動操縦（地上から見るための演技）。観覧位置のまわりを回り、正面を通過し、宙返りをする。
   距離と高さは、地上から見て機体の姿勢が読み取れる近さにする（2026-09-04 に一段近く・低くした）。
   ALT_MIN より低い課目（クリスマスツリー・ローパスなど）は、そのままの高さで行う */
const SHOW = { R: 240, ALT: 120, ORBIT: 22, PASS: 15, LOOPMAX: 18, GATE: 220, SIDE: 165, ALT_IN: 170 };
const ALT_K = 0.78, ALT_MIN = 110;               // 課目ごとの高さにかける係数と、下げない下限（m）
const FRONT_FAR = 650, FRONT_SIDE = 320;         // 正面から向かってくる課目の、進入の門までの距離と横のずらし（m）
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

export function mount(container, opt = {}) {
  const { onState, view = 'first' } = opt;   /* opt そのものも使う（onPanel は tellPanel が読む） */
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

  /* 壁: 半透明の格子の板。ここまでは自由に飛べる。
     いつも出ていると景色が枠に囲まれて見えるので、近づいた壁だけを濃くする（WALL_FADE より遠いと透明）。
     壁ごとに濃さが違うので、材料は 1 枚ずつ持たせる */
  const wallTex = gridTexture('', night ? '#ff8f7a' : '#ff6b57', 0.9, false); wallTex.repeat.set(7, 1);
  const wallMat = new THREE.MeshBasicMaterial({ map: wallTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const wallGeo = new THREE.PlaneGeometry(LIMIT * 2, 500);
  const walls = [];
  [[0, LIMIT, 'x'], [0, -LIMIT, 'x'], [LIMIT, 0, 'y'], [-LIMIT, 0, 'y']].forEach(([x, y, ax]) => {
    const w = new THREE.Mesh(wallGeo, wallMat.clone()); w.position.set(x, y, 250);
    w.userData.n = ax === 'x' ? 'y' : 'x';        // この壁が立っている軸（x の壁は y = ±LIMIT にある）
    w.userData.v = ax === 'x' ? y : x;            // その軸での位置
    if (ax === 'x') w.rotation.x = Math.PI / 2; else { w.rotation.x = Math.PI / 2; w.rotation.y = Math.PI / 2; }
    world.add(w); walls.push(w);
  });

  /* オブジェクト（山・民家・木・塔）。まとめて消せるように 1 つの入れ物に入れる（設定で切り替え） */
  const props = new THREE.Group(); world.add(props);
  /* 山: 見え方を学ぶのが目的なので、空間の中の近くに置く。出題の絵と同じく、開始位置の正面やや左に雪山、やや右に塔。
     さらに空間の中に中くらいの山を散らし、壁の外にも遠景の環を置く */
  const mtnMat = new THREE.MeshLambertMaterial({ color: col.mtn }), snowMat = new THREE.MeshLambertMaterial({ color: col.snow });
  /* 障害物: 山と塔。飛ぶ高さに届くものだけを覚えておき、当たらないように使う。
     家と木は 15 m ほどなので入れない（滑走路の帯にも置かれない） */
  const obst = [];
  const mountain = (x, y, hgt, rad, snow) => {
    obst.push({ x, y, r: rad, h: hgt, flat: false });
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
    obst.push({ x, y, r: 6, h, flat: true });
    const tip = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 6), new THREE.MeshBasicMaterial({ color: 0xff5a4a })); tip.position.set(x, y, h + 3); props.add(tip);
  }

  /* 機体（三人称のときだけ表示）と、高度の手がかり（地面の影と垂線） */
  const plane = new THREE.Group(); world.add(plane);
  /* 操縦席の部品。座標はモデル座標 ×k（k = 13/全長）で書き、読み込み後に GLB と同じ平行移動（eyeOff）を掛ける。
     目安（この座標系）: 風防の上端 z≈0.43、前席の背もたれ上端 z≈0.32、前席 y≈2.4〜3.5、風防の前端 y≈3.55、床 z≈-0.97。
     モデルには座席と風防しかないので、計器盤・グレアシールド・操縦桿・方向舵ペダルを自作する。目は前席の後ろ寄り・背もたれの少し上 */
  const EYE = new THREE.Vector3(0, 2.55, 0.30), eyeOff = new THREE.Vector3(), seatMeshes = [];   // 高さは背もたれ（ヘッドレスト）の上端あたり
  const cockpit = new THREE.Group(); plane.add(cockpit);
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b2027 }), mid = new THREE.MeshLambertMaterial({ color: 0x2e3640 }), grip_m = new THREE.MeshLambertMaterial({ color: 0x14171b }), metal = new THREE.MeshLambertMaterial({ color: 0x8a939e });
  const red_m = new THREE.MeshLambertMaterial({ color: 0xc0392b });
  /* 操縦席は GLB のモデルに本物（計器盤・風防・操縦桿）が入っているので、自作の部品は置かない。
     近くにある機体内部の部品（操縦桿など）が目の前に大きく映るため、一人称ではカメラの手前の面を 1.1 で切る（setView）。
     画面の入力は下に置いた操縦桿の絵とペダルのボタンで示す */
  const lamp = new THREE.PointLight(0xffe2b8, 0.9, 2.5); lamp.position.set(0, 2.9, 0.3); cockpit.add(lamp);   // 操縦席の灯り（夜でも部品が見える）
  /* 操縦桿。モデルには操縦桿の部品がないので自分で作り、画面の下のスティックに合わせて傾ける
     （一人称のときだけ見える。cockpit は setView で出し入れしている）。
     位置と大きさは、一人称の見え方を見ながら決めた値 */
  /* 一人称のカメラは手前 1.1 m を切っている（目の前の機体内部が画面を塞ぐのを防ぐため）。
     操縦桿は目から 0.7 m ほどの近さなので、そのままでは映らない。
     そこで操縦桿だけ別の場面に置き、近くまで写るカメラで本編の上に重ねて描く */
  const overlay = new THREE.Scene();
  overlay.add(new THREE.HemisphereLight(0xffffff, 0x5a6675, 2.2));
  const oDir = new THREE.DirectionalLight(0xffffff, 1.0); oDir.position.set(-0.4, 1, 0.9); overlay.add(oDir);
  const oCam = new THREE.PerspectiveCamera(68, 1, 0.03, 6);
  const stickHolder = new THREE.Group(); stickHolder.matrixAutoUpdate = false; overlay.add(stickHolder);
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, 2.92, -0.44);   // 目から少し前・下（画面の下の方に握りが来る）
  stickHolder.add(stickPivot);
  const oLamp = new THREE.PointLight(0xffe2b8, 1.1, 2.5); oLamp.position.set(0.2, 2.75, 0.1); stickHolder.add(oLamp);
  {
    const sMat = new THREE.MeshLambertMaterial({ color: 0x3a444f }), gMat = new THREE.MeshLambertMaterial({ color: 0x252c35 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.020, 0.26, 12), sMat);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.13;            // 円柱は既定で y 方向なので立てる
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.050, 0.050, 0.11), gMat);
    grip.position.z = 0.31;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.027, 12, 8), gMat);
    top.position.z = 0.37;
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.010, 0.016), red_m);
    btn.position.set(-0.012, -0.027, 0.33);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.062, 0.04, 14), dark);
    base.rotation.x = Math.PI / 2; base.position.z = 0.02;
    stickPivot.add(shaft, grip, top, btn, base);
  }
  const stickAim = { x: 0, y: 0 };        // 表示用になました入力（急に動かすと機械らしくない）
  /* 編隊の 2〜6 番機。先頭機の少し前の状態をたどって並ぶ（旋回でも隊形が崩れない） */
  const mates = [];                       // 2〜6 番機（入れ物）。join に合流の進み具合（0〜1）を持つ
  const hist = [];                        // 先頭機の軌跡 { t, p:Vector3, q:Quaternion }
  let histT = 0;
  let formation = 'solo', smokeOn = false, smokeColor = 'white', formScale = 1;   // formScale: 隊形の広がり（課目で変える）

  /* 垂直尾翼の番号。
     尾翼の「1」は機体とは別の白い部品（let1）で、左右の面にそれぞれ貼られている。
     編隊機ではその部品を隠し、同じ場所・同じ大きさの板を左右に 1 枚ずつ置いて数字を描く。
     絵柄（テクスチャ）を塗り替える方法は使えない: 尾翼の左右の面は同じ絵柄を左右反転して使っているので、
     片側を正しく描くと反対側が鏡文字になる（利用者「左翼側から見た時に反転している」）。 */
  /* 尾翼の箱を機体の頂点から測る。全体の箱も機体の座標に直してから比べ、脚は外す */
  function measureFin(root, frame) {
    const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
    const all = new THREE.Box3();
    root.traverse(o => { if (o.isMesh && o.geometry && !underGear(o)) all.expandByObject(o); });
    all.applyMatrix4(inv);
    const hz = all.max.z - all.min.z, ly = all.max.y - all.min.y;
    const v = new THREE.Vector3(), fin = new THREE.Box3(); let hit = 0;
    root.updateWorldMatrix(true, true);
    fin.makeEmpty();
    root.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || underGear(o)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        if (v.z > all.min.z + hz * 0.62 && v.y < all.min.y + ly * 0.42 && Math.abs(v.x) < ly * 0.06) { fin.expandByPoint(v); hit++; }
      }
    });
    return hit > 20 ? fin : null;
  }
  let finRect = null;                     // 尾翼の箱（読み込み時に測る）
  const numTex = new Map();               // 番号 → 数字の絵（全機で使い回す）
  const NUM_FILL = 0.8;                   // 板の高さに対する数字の高さ

  /* 数字の絵（白・斜体、背景は透明）。数字の高さが板の NUM_FILL 倍になるように合わせる */
  function numberTex(n) {
    const key = String(n);
    if (numTex.has(key)) return numTex.get(key);
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#ffffff';
    g2.font = 'italic bold 200px "Zen Kaku Gothic New", system-ui, sans-serif';
    g2.textAlign = 'center'; g2.textBaseline = 'alphabetic';
    const m = g2.measureText(key);
    const asc = m.actualBoundingBoxAscent || 145, desc = m.actualBoundingBoxDescent || 0;
    const k = S * NUM_FILL / Math.max(asc + desc, 1);
    g2.setTransform(k, 0, 0, k, S / 2, S / 2 + (asc - desc) / 2 * k);
    g2.fillText(key, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    numTex.set(key, tex);
    return tex;
  }

  /* 尾翼に貼られた番号の部品を探す（尾翼の箱の中にある、数字くらいの大きさのもの） */
  function findDecals(root, frame) {
    if (!finRect) return [];
    const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert(), bx = new THREE.Box3(), out = [];
    root.traverse(o => {
      if (!o.isMesh || !o.geometry || underGear(o)) return;
      o.geometry.computeBoundingBox();
      bx.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const sy = bx.max.y - bx.min.y, sz = bx.max.z - bx.min.z, sx = bx.max.x - bx.min.x;
      if (bx.min.y < finRect.min.y - 0.05 || bx.max.y > finRect.max.y + 0.05) return;
      if (bx.min.z < finRect.min.z - 0.05 || bx.max.z > finRect.max.z + 0.05) return;
      if (sy > 0.8 || sz > 1.2 || sz < 0.2 || sx > 0.6) return;      // 数字くらいの大きさ
      out.push(o);
    });
    return out;
  }

  /* 見つけた部品の頂点から、左右それぞれの「1」の箱を測る（1 つの部品に左右両面が入っている） */
  function decalBoxes(meshes, frame) {
    const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert(), v = new THREE.Vector3();
    const out = { 1: new THREE.Box3().makeEmpty(), '-1': new THREE.Box3().makeEmpty() };
    meshes.forEach(o => {
      const pos = o.geometry.attributes.position;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        out[v.x >= 0 ? 1 : '-1'].expandByPoint(v);
      }
    });
    return out;
  }

  /* 1 機ぶん、尾翼の番号を n にする。元の「1」を隠し、同じ場所に数字の板を左右 1 枚ずつ置く */
  function setFinNumber(holder, n) {
    const decals = findDecals(holder, holder);
    if (!decals.length) return 0;
    const boxes = decalBoxes(decals, holder);
    decals.forEach(o => { o.visible = false; });
    let made = 0;
    for (const side of [1, -1]) {
      const b = boxes[side];
      if (b.isEmpty()) continue;
      const size = (b.max.z - b.min.z) / NUM_FILL;                    // 板の大きさ（数字の高さは元の「1」と同じ）
      const cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
      const x = (side > 0 ? b.max.x : b.min.x) + side * 0.006;        // 尾翼の面のすぐ外側
      const mat = new THREE.MeshStandardMaterial({ map: numberTex(n), transparent: true, alphaTest: 0.25,
        roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      m.position.set(x, cy, cz);
      /* 板の向き: 右の面からは機首（+y）が右に、左の面からは機首が左に見える（鏡文字にならないように） */
      m.setRotationFromMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, side, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(side, 0, 0)));
      holder.add(m);
      made++;
    }
    return made;
  }

  /* スモーク: 粒の集まり。位置・色・生まれた時刻を持ち、時間が経つと薄れて広がる。
     出る場所は機体の後ろの端（全長 13 m の機体で、中心から後ろへ 6.9 m。少し下） */
  const SMOKE_N = SMOKE_MAX * 6;
  const smokeGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(SMOKE_N * 3), sCol = new Float32Array(SMOKE_N * 3), sBirth = new Float32Array(SMOKE_N), sSize = new Float32Array(SMOKE_N).fill(1);
  /* 消えるまでの時間は粒ごとに持つ。図を描く課目（キューピッド・スタークロス・レターエイト）は、
     描き終わるまで最初の線が消えないように、その課目のあいだだけ長い寿命で出す */
  const sLife = new Float32Array(SMOKE_N).fill(SMOKE_LIFE);
  let lifeNow = SMOKE_LIFE;
  sBirth.fill(-1e6);
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  smokeGeo.setAttribute('acolor', new THREE.BufferAttribute(sCol, 3));
  smokeGeo.setAttribute('birth', new THREE.BufferAttribute(sBirth, 1));
  smokeGeo.setAttribute('asize', new THREE.BufferAttribute(sSize, 1));
  smokeGeo.setAttribute('alife', new THREE.BufferAttribute(sLife, 1));
  const smokeMat = new THREE.ShaderMaterial({
    /* 遠くの煙は、そのままだと画面では細く薄くなって見えない（地上から見るキューピッドなど）。
       200 m より遠いところでは、離れるほど 太さと濃さを増す（uFarS / uFarA）。
       一人称では自分と僚機の煙がすぐ近くを通るので、増し方も上限も小さくする。
       粒ごとに焼き付けず毎コマ計算するので、視点を変えるとその場で太さが変わる。
       uMinPx / uMaxPx: 画面の中での太さの下限・上限（画素） */
    uniforms: { uTime: { value: 0 }, uLife: { value: SMOKE_LIFE }, uMinPx: { value: 10 }, uMaxPx: { value: 90 },
                uFarS: { value: 0.8 }, uFarA: { value: 1.2 } },
    transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 acolor; attribute float birth; attribute float asize; attribute float alife; uniform float uTime, uLife, uMinPx, uMaxPx, uFarS, uFarA;
      varying vec3 vC; varying float vA;
      void main(){ float age = (uTime - birth) / max(1.0, alife); vA = clamp(1.0 - age, 0.0, 1.0); vA *= sqrt(vA);
        vC = acolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float far = clamp((-mv.z - 200.0) / 800.0, 0.0, 1.0);      // 200 m から 1 km で 0 → 1
        vA = clamp(vA * (1.0 + uFarA * far), 0.0, 1.0);
        /* 太さ: 出た直後から少しずつ広がる。遠いほど画面では細くなるので、下限を決めて
           遠くの演目でも線が見えるようにする（下限・上限は視点で変える） */
        float sz = 6.0 + 60.0 * pow(clamp(age, 0.0, 1.0), 0.5);
        gl_PointSize = clamp(sz * asize * (1.0 + uFarS * far) * (240.0 / max(1.0, -mv.z)), uMinPx * asize, uMaxPx * asize);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ float d = length(gl_PointCoord - vec2(0.5)); if (d > 0.5) discard;
        float a = vA * smoothstep(0.5, 0.04, d) * 0.4; if (a <= 0.01) discard;
        gl_FragColor = vec4(vC, a); }`
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat); smoke.frustumCulled = false; world.add(smoke);
  let sHead = 0, smokeT = 0, clock = 0;
  const smokeCol = new THREE.Color(), emitPos = new THREE.Vector3();
  let smokeBoost = false;                          // 濃い煙（ローパス）。3 粒を少し散らして、大きめに出す
  function emit(pos, colorHex) {
    smokeCol.set(smokeBoost ? '#ffffff' : colorHex);   // ローパスの煙は白
    const n = smokeBoost ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const i = sHead % SMOKE_N; sHead++;
      const j = smokeBoost ? 2.5 : 0;
      sPos[i * 3] = pos.x + (Math.random() - 0.5) * j; sPos[i * 3 + 1] = pos.y + (Math.random() - 0.5) * j; sPos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * j;
      sCol[i * 3] = smokeCol.r; sCol[i * 3 + 1] = smokeCol.g; sCol[i * 3 + 2] = smokeCol.b;
      sBirth[i] = clock; sSize[i] = smokeBoost ? 2.4 : 1; sLife[i] = lifeNow;
    }
  }
  function clearSmoke() { sBirth.fill(-1e6); smokeGeo.attributes.birth.needsUpdate = true; }
  /* 同じ左右の位置に後続がいる機体は煙を出さない（後ろの機体が煙の中を飛ぶため）。単機なら先頭機が出す */
  function smokers() {
    const offs = [[0, 0, 0], ...FORMATIONS[formation].offs];
    return offs.map((o, i) => !!o && !offs.some((q, j) => q && j !== i && Math.abs(q[0] - o[0]) < 6 && q[1] < o[1] - 2 && Math.abs(q[2] - o[2]) < 4));
  }

  /* タイヤ（脚）はモデルに入っているもの（landing = 主脚、front_gear = 前脚）を出し入れする。
     ライトは 主脚の支柱の前に 1 つずつ（着陸灯）と、翼端に控えめな赤・緑（航法灯）。
     蜃気楼: 着陸灯の前の空気が揺らいで見えるのを、細かなモザイクの板で表す（ローパスのときだけ） */
  const gearSets = [], lightSets = [], shimmerSets = [];
  const GEAR_RE = /landing|front_gear/i;
  const vtx = new THREE.Vector3();
  /* 機体の部品の頂点を機体座標で集める（frame = 機体の入れ物） */
  function vertsOf(mesh, frame) {
    const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert(), out = [];
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { vtx.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv); out.push([vtx.x, vtx.y, vtx.z]); }
    return out;
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  let lampSpots = null, tipSpots = null;   // 着陸灯の位置（主脚 左右）と 翼端の位置。先頭機で測って全機に使う
  /* 名前が合う部品（Mesh か、Mesh をまとめた Group）を集める。親が合えば子は数えない */
  function gearParts(root) {
    const hit = [];
    root.traverse(o => { if (o !== root && GEAR_RE.test(o.name)) hit.push(o); });
    return hit.filter(o => { let q = o.parent; while (q && q !== root) { if (hit.includes(q)) return false; q = q.parent; } return true; });
  }
  const underGear = o => { let q = o; while (q) { if (GEAR_RE.test(q.name)) return true; q = q.parent; } return false; };
  function measureSpots(root, frame) {
    const allV = [], landV = [];
    root.traverse(o => { if (!o.isMesh || !o.geometry) return;
      let q = o, isLand = false; while (q && q !== root) { if (/landing/i.test(q.name)) isLand = true; q = q.parent; }
      const dst = isLand ? landV : (underGear(o) ? null : allV);
      if (dst) { const vs = vertsOf(o, frame); for (let i = 0; i < vs.length; i++) dst.push(vs[i]); } });
    if (landV.length) {
      /* 主脚だけを見る（前脚は中心線の近くにあるので、左右 0.6 m 以内は外す） */
      const v = landV, L = v.filter(q => q[0] < -0.6), Rr = v.filter(q => q[0] > 0.6);
      /* 頂点は何万もあるので、展開して Math.max に渡すと呼び出しの上限を超える → ループで求める */
      const spot = side => {
        if (!side.length) return null;
        let sx = 0, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
        for (const q of side) { sx += q[0]; if (q[1] > maxY) maxY = q[1]; if (q[2] < minZ) minZ = q[2]; if (q[2] > maxZ) maxZ = q[2]; }
        return [sx / side.length, maxY + 0.25, (minZ + maxZ) / 2 + 0.1];
      };
      lampSpots = [spot(L), spot(Rr)].filter(Boolean);
    }
    if (allV.length) {
      let lo = allV[0], hi = allV[0];
      for (const q of allV) { if (q[0] < lo[0]) lo = q; if (q[0] > hi[0]) hi = q; }
      tipSpots = [lo, hi];
    }
  }
  function glowTex(col) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g2 = c.getContext('2d');
    const gr = g2.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const texLamp = glowTex('rgba(255,250,220,0.95)'), texRed = glowTex('rgba(255,70,70,0.9)'), texGreen = glowTex('rgba(70,255,110,0.9)');
  /* 蜃気楼のモザイク（全機で 1 枚を共用し、ローパス中に描き替える） */
  const shimCv = document.createElement('canvas'); shimCv.width = shimCv.height = 16;
  const shimTex = new THREE.CanvasTexture(shimCv); shimTex.magFilter = THREE.NearestFilter;
  function drawShimmer() {
    const g2 = shimCv.getContext('2d'); g2.clearRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 8; if (d > 1) continue;
      const v = 150 + Math.floor(Math.random() * 105), a = (1 - d) * (0.18 + Math.random() * 0.22);
      g2.fillStyle = `rgba(${v},${v},${v},${a.toFixed(2)})`; g2.fillRect(x, y, 1, 1);
    }
    shimTex.needsUpdate = true;
  }
  drawShimmer();
  function addGear(grp, root) {
    const g = new THREE.Group(); g.visible = false;   // 脚（モデルの部品を移す。無ければ何もしない）
    const L = new THREE.Group(); L.visible = false;   // ライト
    const Sh = new THREE.Group(); Sh.visible = false; // 蜃気楼
    const parts = gearParts(root);
    parts.forEach(o => { o.traverse(x => { x.visible = true; }); });   // 入れ物の表示で出し入れするので、部品そのものは表示にしておく
    parts.forEach(o => { const par = o.parent; par.remove(o); g.add(o); o.applyMatrix4(par.matrixWorld.clone().premultiply(new THREE.Matrix4().copy(grp.matrixWorld).invert())); });
    const sprite = (tex, size, x, y, z, op) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op }));
      sp.scale.set(size, size, 1); sp.position.set(x, y, z); return sp; };
    (lampSpots || [[-1.5, 0.2, -1.0], [1.5, 0.2, -1.0]]).forEach(q => {
      L.add(sprite(texLamp, 2.4, q[0], q[1], q[2], 1));
      const sh = new THREE.Sprite(new THREE.SpriteMaterial({ map: shimTex, depthWrite: false, transparent: true, opacity: 0.55 }));
      sh.scale.set(2.6, 2.6, 1); sh.position.set(q[0], q[1] + 2.4, q[2] - 0.2); Sh.add(sh);
    });
    (tipSpots || [[-4.9, -1.2, -0.2], [4.9, -1.2, -0.2]]).forEach((q, i) => { L.add(sprite(i === 0 ? texRed : texGreen, 0.7, q[0], q[1], q[2], 0.55)); });
    grp.add(g); grp.add(L); grp.add(Sh); gearSets.push(g); lightSets.push(L); shimmerSets.push(Sh);
    return g;
  }
  /* 脚とライトは別々に出し入れできる。昼以外はライトを自動で点けておく（手で消せる）。
     ローパスのあいだは両方出し、終わったら手で決めていた状態に戻す */
  let gearOn = false, lightsOn = scene !== 'day', treeMode = false, treeLit = false;   // treeLit: ローパスのライトを点けたか（正面を向いてから）
  function applyGear() {
    gearSets.forEach(g => { g.visible = gearOn || treeMode; });
    lightSets.forEach(L => { L.visible = lightsOn || (treeMode && treeLit); });   // ローパスのライトは、正面を向いてから点ける
    shimmerSets.forEach(S => { S.visible = treeMode && curView === 'ground'; });   // 蜃気楼は地上から見たときだけ
  }
  /* 「一人称（計器）」の見せ方では、乗っている機体そのものを消す（風防の外がそのまま見える）。
     乗り換えているときに消すのは、乗っている機体。1 番機は編隊の一員として出したままにする。
     編隊機の表示は placeMates が毎コマ決め直すので、ここでは消すだけにする（毎コマ呼ぶ） */
  function applyBody() {
    const hide = curView === 'first' && !inCockpit;
    plane.visible = !(hide && seat === 0);
    if (hide && seat > 0 && mates[seat - 1]) mates[seat - 1].visible = false;
  }
  function setTreeMode(on) {
    treeMode = !!on;
    if (!treeMode) treeLit = false;
    smokeBoost = treeMode; spdWant = treeMode ? 0.6 : 1;
    applyGear();
  }
  new GLTFLoader().load('model/t4.glb?v=2', g => {
    g.scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.metalness = 0; m.roughness = 0.85; m.side = THREE.DoubleSide; }); } });
    const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), k = 13 / Math.max(size.y, 1e-3);   // 全長 13 m
    g.scene.scale.setScalar(k); const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k); g.scene.position.set(-c.x, -c.y, -c.z);
    plane.add(g.scene); plane.updateWorldMatrix(true, true); measureSpots(g.scene, plane);
    const clones = []; for (let n = 2; n <= 6; n++) clones.push(g.scene.clone(true));   // 脚を移す前に複製しておく
    addGear(plane, g.scene); applyGear();
    cockpit.position.copy(g.scene.position); eyeOff.copy(g.scene.position);   // 操縦席の部品と目の位置はモデル座標（×k）で書いてあるので、同じ平行移動を掛ける
    g.scene.traverse(o => { if (o.isMesh && (o.name === 'seat1' || /^mesh_2(_|$)/.test(o.name))) seatMeshes.push(o); });   // 自分が座る前席（一人称では隠す）
    seatMeshes.forEach(m => { m.visible = curView !== 'first'; });
    /* 2〜6 番機はモデルを複製して、尾翼に番号の板を貼る。板の位置は実測した尾翼の箱から決める */
    plane.updateWorldMatrix(true, true);
    finRect = measureFin(g.scene, plane);
    for (let n = 2; n <= 6; n++) {
      const holder = new THREE.Group(); holder.visible = false; world.add(holder);
      holder.add(clones[n - 2]);                                          // 複製は元と同じ平行移動を持っている
      holder.userData.seats = [];
      holder.traverse(o => { if (o.isMesh && (o.name === 'seat1' || /^mesh_2(_|$)/.test(o.name))) holder.userData.seats.push(o); });
      holder.updateWorldMatrix(true, true);
      setFinNumber(holder, n);                                           // 尾翼の「1」を隠して n の板を置く
      holder.updateWorldMatrix(true, true); addGear(holder, holder.children[0]); applyGear();
      holder.userData.cur = new THREE.Vector3(ENTRY[n - 2][0], ENTRY[n - 2][1], ENTRY[n - 2][2]);   // いまの位置（先頭機から見て）
      holder.userData.want = new THREE.Vector3();
      mates.push(holder);
    }
  }, undefined, () => {});
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(7, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })); shadow.position.z = 0.8; world.add(shadow);

  /* その場所にある障害物の高さ。山は円錐なので、中心から離れるほど低くなる。塔は上まで同じ太さ。
     オブジェクトを消しているとき（props.visible=false）は、当たり判定もしない */
  function terrainAt(x, y) {
    if (!props.visible) return 0;
    let z = 0;
    for (let i = 0; i < obst.length; i++) {
      const o = obst[i], dx = x - o.x, dy = y - o.y, d2 = dx * dx + dy * dy;
      if (d2 > o.r * o.r) continue;
      const t = o.flat ? o.h : o.h * (1 - Math.sqrt(d2) / o.r);
      if (t > z) z = t;
    }
    return z;
  }
  const OBST_CLEAR = 14;        // 障害物の上を通るときに空ける高さ（m）
  const OBST_LOOK = [3, 6, 9];  // 自動操縦が先を見る時間（秒）

  /* ---- 状態と入力 ---- */
  /* 姿勢はクォータニオンで持つ。オイラー角（方位・ピッチ・バンク）だと宙返りの真上・真下で破綻するため。
     h / p / b は表示と計器のために毎フレーム取り出す。機体の軸: 機首 +y、右翼 +x、機体上 +z */
  const st = { x: START.x, y: START.y, z: START.z, h: START.h, p: 0, b: 0, wall: false, ground: false, show: '', cue: '', desc: '', gh: 0, mode: 'fly' };
  let spdK = 1, spdWant = 1;                        // 速さの係数（1 がふつう。ローパスでは 0.6 まで落とす）
  /* 地上の様子。fly=飛行中、land=着陸して減速中、taxi=滑走路へ戻る、stand=待機、takeoff=加速中 */
  let gmode = 'fly', gv = 0;
  const RWY = { x: 0, y: -480, h: 0 };              // 滑走路の南寄り（機首は北）
  const att = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -START.h * D);
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1), WUP = new THREE.Vector3(0, 0, 1);
  const dq = new THREE.Quaternion(), fwd = new THREE.Vector3(), bup = new THREE.Vector3(), bright = new THREE.Vector3();
  const gdir = new THREE.Vector3(), gright = new THREE.Vector3(), focus = new THREE.Vector3(), bup2 = new THREE.Vector3();   // 地上視点の向きを作るのに使う
  const seatQ = new THREE.Quaternion(), seatR = new THREE.Matrix4();   // 乗っている機体の姿勢
  const panelPt = new THREE.Vector3();   // 計器盤の上端を画面へ写すのに使う
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
  const N_MAX = 4;                     // 旋回に使える荷重倍数の上限（4 G）。横倒しでも旋回が暴れないようにする
  const input = { x: 0, y: 0, r: 0 };   // x: 操縦桿 左右（右 +）、y: 操縦桿 前後（奥 +）、r: 方向舵（右 +）
  let curView = view, seat = 0;   // seat: 0=1 番機、1〜5=2〜6 番機（視点だけ移る）
  let inCockpit = true;           // 一人称の見せ方。true=機内（計器盤と操縦桿が見える）、false=計器だけ（外がそのまま見える）
  let paused = false;             // 演目の一時停止（画面を 2 回叩く）
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
    { id: 'orbit', ja: '旋回', t: 8, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'change', ja: 'チェンジオーバー・ターン', form: 'trail', alt: 200,
      desc: '縦隊で入り、旋回しながら隊形を組み替えます。傘が開くように見えます。' },
    { id: 'byover', ja: '頭上通過', form: 'delta', alt: 130, entry: 'front',
      desc: '正面から低く向かってきて、頭の上を通り抜けます。' },
    { id: 'loop', ja: 'デルタ・ループ', form: 'delta', alt: 240, entry: 'front',
      desc: '6 機がデルタ隊形のまま、崩さずに宙返りします。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'cupid', ja: 'キューピッド', form: 'diamond', alt: 260, entry: 'front', fig: 'cupid',
      desc: '3 機。2 機がハートを描き、描き終えたところへ、もう 1 機が矢になって飛び込みます。地上から見て貫いて見えるよう、ハートの内側ではスモークを切ります。' },
    { id: 'roll', ja: 'デルタ・ロール', form: 'delta', alt: 200,
      desc: '6 機がデルタ隊形のまま横転します。' },
    { id: 'pass', ja: '正面通過', t: 12, form: 'delta', alt: 190,
      desc: '隊形のまま、正面を低く通り抜けます。' },
    { id: 'wide', ja: 'ワイド・トゥ・デルタ・ループ', form: 'delta', alt: 240,
      desc: '間隔を広げて入り、宙返りの中でデルタ隊形に詰めます。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'eight', ja: 'レター・エイト', form: 'diamond', alt: 200,
      desc: '4 機で、空に数字の 8 を描きます。' },
    { id: 'byover', ja: '頭上通過', form: 'delta', alt: 120, entry: 'front',
      desc: '正面から低く向かってきて、頭の上を通り抜けます。' },
    { id: 'vert', ja: 'バーティカル・クライム・ロール', form: 'pair', alt: 190, entry: 'front',
      desc: '垂直に上昇しながら横転します。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'star', ja: 'スタークロス', form: 'delta', alt: 260, entry: 'front', fig: 'star',
      desc: '5 機。デルタ隊形で入って大きく開き、一斉に反転降下して星を描きます。' },
    { id: 'half', ja: 'ハーフ・スロー・ロール', form: 'diamond', alt: 300,
      desc: 'ゆっくり背面に入り、そのまま飛んでから戻します。' },
    { id: 'bloom', ja: '上向き空中開花（サンライズ）', form: 'delta', alt: 190, entry: 'front',
      desc: '5 機が上を向いたまま大きく開き、花が咲くように見せます。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'rain', ja: 'レインフォール', form: 'delta', alt: 260, entry: 'front',
      desc: '開花のあと、雨が降るように機体が降りてきます。' },
    { id: 'tree', ja: 'クリスマスツリー・ローパス', form: 'tree', alt: 110, entry: 'front', set: { smoke: true, gear: true, lights: true },
      desc: '6 機が木の形に組み、列ごとに少し低く並びます。速度を落とし、脚を出してライトを点け、濃いスモークを引きながら頭の上を通り抜けます。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'cork', ja: 'コーク・スクリュー', form: 'pair', alt: 200, entry: 'front',
      desc: '2 機。1 機がまっすぐ進み、その周りをもう 1 機が背中を内側に向けて回ります。実際の演技では、直進する 5 番機が背面で飛びます。' },
    { id: 'turnloop', ja: '360 度ターン & ループ', form: 'delta', alt: 240,
      desc: '1 周まわってから、続けて宙返りします。' }
  ];
  let allowIds = null;                     // 見せる課目を絞る（体験版）。null なら全部
  const okMan = m => !allowIds || allowIds.indexOf(m.id) >= 0;
  let auto = false, oneShot = false, step_i = 0, manT = 0, rollSum = 0, loopSum = 0, hdgSum = 0, prevH = 0, userForm = 'solo';
  let manPhase = 'do', phaseT = 0, aimX = 0, aimY = 0, planFace = 0, turnSign = 1;   // 進入の段階（in: 門へ、align: 正面の中心へ、do: 技）
  const GATE = { x: 0, y: 0, z: SHOW.ALT_IN };
  const autoIn = { x: 0, y: 0, r: 0 }, smIn = { x: 0, y: 0, r: 0 };   // smIn: なめらかにしたあとの舵
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
  /* 旋回半径（バンク 52 度で約 290 m）の内側にある点へは、いくら回り込んでも届かない。
     ぐるぐる回ったまま時間切れになり、課目が観覧位置から離れた場所で始まってしまう。
     目標が近くて大きく外れているときは、いったんまっすぐ飛んで離れ、届く形になってから向き直る */
  function approach(tx, ty, tz) {
    const d = Math.hypot(tx - st.x, ty - st.y);
    const wantH = ((Math.atan2(tx - st.x, ty - st.y) / D) % 360 + 360) % 360;
    if (d < 420 && Math.abs(wrap180(wantH - st.h)) > 65) {
      holdBank(0); holdPitch(clamp((tz - st.z) * 0.06, -8, 8)); autoIn.r = 0; return;
    }
    steerTo(tx, ty, tz);
  }
  /* 見ている正面の少し先を中心に回る。隊形が組めるまで待つあいだに使う。
     その場で旋回を続けると輪の中心が流れて演技が遠ざかるので、中心を決めて回る。
     中心を正面に置くので、待ち終わったその場所から始めても、演技は目の前で起きる */
  function orbitEye(z) {
    const e = eyeDir();
    const cx = e.ex + e.dx * SHOW.GATE, cy = e.ey + e.dy * SHOW.GATE;
    const a = Math.atan2(st.y - cy, st.x - cx) + 0.5;
    steerTo(cx + Math.cos(a) * SHOW.R, cy + Math.sin(a) * SHOW.R, z || SHOW.ALT);
  }
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
      GATE.x = clamp(e.ex + e.dx * (SHOW.GATE + FRONT_FAR) + sx * side * FRONT_SIDE, -W, W);
      GATE.y = clamp(e.ey + e.dy * (SHOW.GATE + FRONT_FAR) + sy * side * FRONT_SIDE, -W, W);
    } else {                            // 近いほうの横から入って、正面を横切る
      GATE.x = clamp(cx + sx * side * SHOW.SIDE, -W, W);
      GATE.y = clamp(cy + sy * side * SHOW.SIDE, -W, W);
    }
    GATE.z = Math.max(ALT_MIN, (m.alt || SHOW.ALT_IN) * ALT_K);   // 地上から見やすいように少し低くする（低い課目はそのまま）
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
  let retT = -1, retDur = 12;                      // 図のあと、隊形へ戻すのにかける時間（距離で決める）
  /* コークスクリューを終えるとき、2 番機を その場から隊形へ戻す */
  /* 図やコークスクリューの終わりの状態を覚える。混ぜ元は「そのまま飛び続けた位置」にする。
     止まった 1 点から隊形へ混ぜると、まわりが動いているぶん後ろへ下がって見える
     （利用者「キューピッドからハーフスローロールに切り替わるときバックしているように見える」）。
     下を向いたままだと地面へ向かうので、上下の速さは 3 秒ほどで抜く（placeMates 側） */
  function markReturn(h) {
    const fv = new THREE.Vector3(0, 1, 0).applyQuaternion(h.quaternion).multiplyScalar(SPEED * spdK);
    h.userData.ret = { p: h.position.clone(), q: h.quaternion.clone(), v: fv };
  }
  function endCork() {
    if (corkT < 0) return;
    corkT = -1;
    const h = mates[0];
    if (h && h.visible) {
      const inv = att.clone().invert();
      mo.copy(h.position).sub(plane.position).applyQuaternion(inv);
      h.userData.cur.set(mo.x, Math.min(-20, mo.y), mo.z);
      startJoin(h.userData);
      markReturn(h);
      retDur = 10; retT = 0;
    }
  }
  function endFigure() {
    if (!fig) return;
    retDur = 10;
    const inv = att.clone().invert();
    mates.forEach(h => {
      if (!h.visible) { h.userData.ret = null; return; }
      mo.copy(h.position).sub(plane.position).applyQuaternion(inv);
      h.userData.cur.set(mo.x, Math.min(-40, mo.y), mo.z);
      startJoin(h.userData);                                   // 図の位置から隊形へ、ゆっくり戻る
      markReturn(h);
      retDur = Math.max(retDur, clamp(h.position.distanceTo(plane.position) / 22, 10, 30));
    });
    retT = 0; fig = null;
  }
  function endEntry() {
    manPhase = 'do'; st.cue = ''; markOn = false;
    /* 回る課目は、まず観覧位置から遠ざかる側へ回る（近づく側へ回ると頭の上を越えて後ろへ抜ける） */
    turnSign = wrap180(planFace - st.h) >= 0 ? 1 : -1;
    manT = 0; rollSum = 0; loopSum = 0; hdgSum = 0; prevH = st.h;
  }
  /* 課目を始める。使う隊形をそろえてから（いまの機数によらず集まる）、進入に入る */
  /* その技で使う装備を自動で入れる（入れるだけ。外すのは手で） */
  /* 技ごとに決めてある初期設定（スモーク・タイヤ・ライト）を反映する。
     自分で技を選んだときは「入れるだけ」で外さない（外すのは手動、という利用者の決め）。
     通しの演目（自動）では課目ごとに設定どおりに入れ替える（その課目に要らない装備はしまう）。
     ライトは昼以外なら自動で点ける（夜間の飛行灯）。 */
  function applyPreset(m, full) {
    const set = m.set || { smoke: true };
    if (full) {
      smokeOn = !!set.smoke;
      gearOn = !!set.gear;
      lightsOn = !!set.lights || scene !== 'day';
    } else {
      if (set.smoke) smokeOn = true;
      if (set.gear) gearOn = true;
      if (set.lights) lightsOn = true;
    }
    applyGear();
  }
  function beginManeuver(i) {
    endCork(); endFigure(); if (treeMode) setTreeMode(false);
    step_i = i; manT = 0; rollSum = 0; loopSum = 0; hdgSum = 0; prevH = st.h; phaseT = 0; formScale = 1; figAim = null;
    const m = PROGRAM[i];
    formation = m.form || userForm;
    st.show = m.ja; st.desc = m.desc || '';
    e8 = null;
    lifeNow = FIG_LIFE[m.id] || SMOKE_LIFE;   // 図を描く課目のあいだだけ、消えるまでの時間を延ばす
    applyPreset(m, auto && !oneShot);        // 通しの演目では課目ごとに装備を入れ替える
    GATE.z = Math.max(ALT_MIN, (m.alt || SHOW.ALT_IN) * ALT_K);   // 地上から見やすいように少し低くする（低い課目はそのまま）
    /* 技をひとつだけ選んだときも、見ている正面へ回り込んでから行う（どの視点でも同じ）。
       演技は地上から見るためのものなので、目の前で行わないと課目の形が分からない */
    if (((FORMATIONS[formation] || {}).n || 1) > 1 && !matesReady()) {   // 隊形が要る課目は、組んでから進入する
      manPhase = 'gather'; phaseT = 0; st.cue = '隊形を組みます'; markOn = false;
    } else if (m.front !== false) { planEntry(m); manPhase = 'in'; }
    else if (st.z < GATE.z - 60) { manPhase = 'climb'; st.cue = '高度を取ります'; markOn = false; }
    else { manPhase = 'do'; st.cue = ''; markOn = false; }
  }
  function nextManeuver() {
    formScale = 1;
    if (oneShot) {   // 1 つだけの技なら、水平に戻してから操縦を返す
      manPhase = 'out'; phaseT = 0; st.cue = '水平に戻します'; markOn = false; endCork(); endFigure(); if (treeMode) setTreeMode(false); return;
    }
    let n = (step_i + 1) % PROGRAM.length;
    for (let k = 1; k <= PROGRAM.length; k++) {          // 見せない課目は飛ばす
      const j = (step_i + k) % PROGRAM.length;
      if (okMan(PROGRAM[j])) { n = j; break; }
    }
    beginManeuver(n);
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
    /* 進む先に山や塔があれば、届く前に機首を上げて越える（当たり判定を避ける） */
    for (let k = 0; k < OBST_LOOK.length; k++) {
      const s2 = OBST_LOOK[k];
      const px = st.x + fwd.x * SPEED * s2, py = st.y + fwd.y * SPEED * s2, pz = st.z + fwd.z * SPEED * s2;
      const need = terrainAt(px, py) + 70;
      if (pz < need) { autoIn.y = -clamp((need - pz) / 140, 0.35, 1); autoIn.x = clamp(-st.b / 20, -1, 1); return; }
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
      if (manPhase === 'gather') {         // 隊形が組めるまで待つ。観覧位置のまわりを回って待つので、遠くへ流れない
        orbitEye(GATE.z);
        /* 組めたら始める。正面から向かってくる課目だけ、門からの進入をやり直す。
           それ以外は、正面のまわりを回っているところから そのまま始める（回り込みで時間を使わない） */
        if (matesReady() || phaseT > 40) {
          if (m.entry === 'front') { planEntry(m); manPhase = 'in'; phaseT = 0; }
          else { manPhase = 'do'; st.cue = ''; markOn = false; phaseT = 0; }
        }
        safety();
        return autoIn;
      }
      if (manPhase === 'climb') {          // 技に要る高さまで、まっすぐ上げる
        steerTo(st.x + fwd.x * 500, st.y + fwd.y * 500, GATE.z);
        if (st.z > GATE.z - 40 || phaseT > 20) endEntry();
      } else if (manPhase === 'in') {
        const e2 = eyeDir(), f2 = ((Math.atan2(e2.dx, e2.dy) / D) % 360 + 360) % 360;
        if (Math.abs(wrap180(f2 - planFace)) > 35) planEntry(m);   // 見ている向きが変わったら、進入路を引き直す
        approach(GATE.x, GATE.y, GATE.z);
        if (Math.hypot(st.x - GATE.x, st.y - GATE.y) < 260 || phaseT > 45) { manPhase = 'align'; phaseT = 0; }
      } else {
        approach(aimX, aimY, GATE.z);
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
        away(520, SHOW.ALT - 30);
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
      case 'eight': {                            // レター・エイト: 3 機が片方の輪、離れた 1 機がもう片方の輪
        if (!e8) {
          if (!matesReady() && manT < 26) { orbitEye(GATE.z); break; }   // 集まるまで観覧位置のまわりを回って待つ
          const sg = turnSign, br = 56 * D;
          const nE = Math.min(N_MAX, 1 / Math.max(Math.abs(Math.cos(br)), 1 / N_MAX));
          const w = (9.81 / (SPEED * Math.max(.2, spdK))) * nE * Math.sin(br);      // 旋回の角速度（rad/s）
          const R = clamp(SPEED / Math.max(0.02, w), 120, 600);                     // 輪の半径（m）
          const a = (st.h - sg * 90) * D;
          e8 = { s: sg, R, h0: st.h, z: st.z, t0: hdgSum, solo: Math.min(2, mates.length - 1),
                 cx: st.x + R * Math.sin(a), cy: st.y + R * Math.cos(a), done: false };   // もう片方の輪の中心
        }
        holdBank(56 * turnSign); holdPitch(0);
        if (hdgSum - e8.t0 > 360 || manT > 55) nextManeuver();
        break;
      }
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
          if (!matesReady() && manT < 26) { orbitEye(GATE.z); break; }   // 集まるまで観覧位置のまわりを回って待つ
          beginFigure(m.fig);
        }
        fig.t += dt;
        /* 1 番機は図の下のあたりを ゆっくり回る。目で追う視点は 1 番機を追うので、図も画面に入る */
        const fa = Math.atan2(st.y - figO.y, st.x - figO.x) + 0.5;
        steerTo(figO.x + Math.cos(fa) * 160, figO.y + Math.sin(fa) * 160, Math.max(160, figO.z - 230));
        if (fig.t >= fig.dur + 1.2) nextManeuver();
        break;
      }
      case 'tree': {                             // クリスマスツリー・ローパス: 減速・脚出し・ライト・濃い煙で頭上を低く抜ける
        if (!treeMode) setTreeMode(true);
        const e6 = eyeDir();
        /* ライトは、観覧位置の正面を向いてから点ける（回り込んでいる途中で点けない） */
        if (!treeLit) {
          const bear6 = ((Math.atan2(e6.ex - st.x, e6.ey - st.y) / D) % 360 + 360) % 360;
          if (Math.abs(wrap180(bear6 - st.h)) < 30) { treeLit = true; applyGear(); }
        }
        steerTo(e6.ex - e6.dx * 700, e6.ey - e6.dy * 700, m.alt || 110);
        holdBank(clamp(st.b + autoIn.x * 22, -12, 12));                   // 隊形を保つため、傾きは小さく
        const past6 = (st.x - e6.ex) * e6.dx + (st.y - e6.ey) * e6.dy;
        if (past6 < -350 || manT > 60) nextManeuver();
        break;
      }
      case 'cork': {                             // コークスクリュー: 1 番機はまっすぐ、2 番機がその周りを回る
        if (corkT < 0 && !matesReady() && manT < 20) { orbitEye(GATE.z); break; }   // 2 番機が付くまで、観覧位置のまわりを回って待つ
        const e4 = eyeDir();
        steerTo(e4.ex - e4.dx * 700, e4.ey - e4.dy * 700, m.alt || 200);
        holdBank(clamp(st.b + autoIn.x * 22, -16, 16));   // 1 番機はほぼ水平のまま、向きだけ少し直す
        if (corkT < 0) {                         // 輪に乗るまでの時間は、いまの離れぐあいで決める
          corkT = 0;
          const h2 = mates[0];
          corkBlend = h2 && h2.visible ? clamp(h2.position.distanceTo(plane.position) / 30, 3, 12) : 3;
        } else corkT += dt;
        const past4 = (st.x - e4.ex) * e4.dx + (st.y - e4.ey) * e4.dy;   // 正なら手前、負なら越えた先
        if (past4 < -320 || manT > 34) nextManeuver();
        break;
      }
      case 'change':                             // チェンジオーバー・ターン: 縦隊で入り、正面で組み替えて大きく旋回
        if (manT < 4) { formation = 'trail'; away(460, SHOW.ALT); }
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

  /* 地上にいるあいだの動き。翼は水平、方向舵で向きを変える。高さは滑走路の上 */
  function groundStep(dt) {
    const turnRate = 26 * Math.min(1, gv / 12);                       // 止まりかけでは曲がらない
    if (gmode === 'land') {
      gv = Math.max(0, gv - 8 * dt);                                  // 減速
      st.h = (st.h + input.r * turnRate * dt + 360) % 360;
      if (gv <= 0.5) { gv = 0; gmode = 'taxi'; }
    } else if (gmode === 'taxi') {
      const dx = RWY.x - st.x, dy = RWY.y - st.y, d = Math.hypot(dx, dy);
      const want = d > 12 ? ((Math.atan2(dx, dy) / D) % 360 + 360) % 360 : RWY.h;
      const e = wrap180(want - st.h);
      st.h = (st.h + clamp(e, -20 * dt, 20 * dt) + 360) % 360;        // ゆっくり向き直る
      gv = d > 12 ? Math.min(d > 120 ? 26 : 10, gv + 6 * dt) : Math.max(0, gv - 6 * dt);   // 遠いうちは速めに戻る
      if (d <= 12 && gv === 0 && Math.abs(e) < 3) { gmode = 'stand'; st.cue = ''; }
    } else if (gmode === 'takeoff') {
      gv = Math.min(SPEED, gv + 6 * dt);
      st.h = (st.h + input.r * turnRate * 0.5 * dt + 360) % 360;
      if (gv >= SPEED * 0.9) {                                        // 浮く
        gmode = 'fly'; spdK = gv / SPEED; spdWant = 1;
        att.setFromAxisAngle(AZ, -st.h * D); att.multiply(dq.setFromAxisAngle(AX, 9 * D)); readAttitude();
        st.z = 4; return;
      }
    } else { gv = 0; }
    att.setFromAxisAngle(AZ, -st.h * D); readAttitude();              // 地上では翼は水平
    st.x += Math.sin(st.h * D) * gv * dt; st.y += Math.cos(st.h * D) * gv * dt;
    st.z = 3;
    const W = LIMIT - 30; st.x = clamp(st.x, -W, W); st.y = clamp(st.y, -W, W);
    st.cue = gmode === 'land' ? '着陸しました' : gmode === 'taxi' ? '滑走路へ戻ります' : gmode === 'stand' ? '「加速」で離陸できます' : '加速中';
  }
  function step(dt) {
    st.mode = gmode;
    if (gmode !== 'fly') { groundStep(dt); return; }
    /* 自動操縦の舵は、目標へ 0.55 秒の時定数で寄せる。
       実機は舵をいきなり一杯には切らないので、そのぶんの緩みを入れる */
    let inp = input;
    if (auto) {
      const want = autoInputs(dt), kk = 1 - Math.exp(-dt / 0.55);
      smIn.x += (want.x - smIn.x) * kk; smIn.y += (want.y - smIn.y) * kk; smIn.r += (want.r - smIn.r) * kk;
      inp = smIn;
    }
    const roll = RATE.roll * inp.x * dt * D;        // 機首軸(+y): 右に倒すと右バンク
    const pitch = -RATE.pitch * inp.y * dt * D;     // 翼軸(+x): 手前に引くと機首上げ
    const yaw = RATE.yaw * inp.r * dt * D;          // 上下軸(+z): 右方向舵で機首が右へ
    if (roll) att.multiply(dq.setFromAxisAngle(AY, roll));
    if (pitch) att.multiply(dq.setFromAxisAngle(AX, pitch));
    /* 方向舵は、進む向きに対して水平に向きを変える。機体の上下軸で回すと、
       傾いているときに機首が上下して「傾く動作」に見えるので、世界の上下軸まわりに回す（premultiply） */
    if (yaw) att.premultiply(dq.setFromAxisAngle(AZ, -yaw));
    /* バンクによる旋回（協調旋回）。世界の上下軸まわりに機体ごと回す。真上・真下付近では効かせない。
       tan(バンク) をそのまま使うと 90 度で符号が裏返り、横倒しの瞬間に方位が逆回りしてガクンとなる。
       実機と同じで、翼が出せる力（荷重倍数）には上限があるので、そこで頭打ちにする。
       浅いバンクでは 1/cos ＝ tan と同じ動き、90 度では最大のまま向きが変わらず、通り過ぎても連続する。
       **自分で操縦しているあいだは効かせない**。出題の約束は「操縦桿右 → 右バンク → 景色は左へ傾く」
       「方向舵右 → 右を向く → 景色は左へ流れる」で、操縦桿を倒しただけで景色が横へ流れると、
       方向舵の見え方と混ざって覚えられない。演技（自動操縦）は目標へ向かうのに旋回が要るので、そちらだけ残す */
    readAttitude();
    if (auto && Math.abs(st.p) < 70) {
      const br = st.b * D, nEff = Math.min(N_MAX, 1 / Math.max(Math.abs(Math.cos(br)), 1 / N_MAX));
      const turn = clamp((9.81 / (SPEED * spdK)) * nEff * Math.sin(br) / D, -30, 30) * dt * D;
      if (turn) att.premultiply(dq.setFromAxisAngle(AZ, -turn));
    }
    att.normalize(); readAttitude();
    spdK += (spdWant - spdK) * (1 - Math.exp(-dt / 2.5));          // 速さはゆっくり変える
    const v = SPEED * spdK;
    st.x += fwd.x * v * dt; st.y += fwd.y * v * dt; st.z += fwd.z * v * dt;
    /* 技の途中（自動操縦）は、壁を少し越えてもよい。警告も出さず、自然に飛びながら戻ってくる。
       自分で操縦しているときは これまでどおり壁で止める */
    const L = auto ? LIMIT + 420 : LIMIT - 4, C = auto ? CEIL + 300 : CEIL;
    st.wall = !auto && (Math.abs(st.x) > L || Math.abs(st.y) > L || st.z > CEIL);
    st.x = clamp(st.x, -L, L); st.y = clamp(st.y, -L, L); st.z = Math.min(st.z, C);
    if (auto && st.z < 45) { st.z = 45; levelAttitude(); }          // 自動操縦では墜落させない（最後の砦）
    if (!auto && st.z <= 3.2) {                                     // 接地: 着陸とみなして減速に入る
      st.z = 3; gmode = 'land'; gv = SPEED * spdK; spdK = 1; spdWant = 1;
      gearOn = true; applyGear();                                   // 着陸なのでタイヤは出ている
      att.setFromAxisAngle(AZ, -st.h * D); readAttitude();
    }
    if (st.z < 3) st.z = 3;
    /* 山や塔に触れそうなときは、その上へ逃がす。ぶつけて墜落にはしない（利用者の指示）。
       斜面に近づくにつれて少しずつ上がるので、山を越えていくように見える */
    const tzz = terrainAt(st.x, st.y) + OBST_CLEAR;
    if (st.z < tzz) { st.z = tzz; st.cue = '山を越えます'; }
    else if (st.cue === '山を越えます') st.cue = '';
    if (!Number.isFinite(st.x + st.y + st.z + st.h + st.p + st.b)) {   // 数でなくなったら開始位置へ戻す
      Object.assign(st, { x: START.x, y: START.y, z: START.z, h: START.h, ground: false, wall: false });
      levelAttitude(); hist.length = 0; auto = false; oneShot = false; formScale = 1;
      manPhase = 'do'; st.cue = ''; markOn = false;
    }
  }
  /* 先頭機の軌跡を残し、そこから編隊機の位置を決める */
  const mq = new THREE.Quaternion(), mp = new THREE.Vector3(), mo = new THREE.Vector3(), cq = new THREE.Quaternion(), fwant = new THREE.Vector3();
  const qFlat = new THREE.Quaternion(), qa = new THREE.Quaternion();
  let flatYaw = 0;                 // 「翼は水平」の置き方に使う方位。真上・真下では方位が決まらないので、そのときは前の値を使う
  /* 追従機の向きを入れ替える。1 コマで回れる角度に上限をつける（乗っている機体が一瞬で回らないように）。
     宙返りの頂点などで置き方が切り替わっても、画面は目で追える速さまでしか回らない */
  const MAX_TURN = 180 * D;        // [°/s]
  function turnMate(holder, q, dt) {
    if (!dt) { holder.quaternion.copy(q); return; }
    const a = holder.quaternion.angleTo(q), lim = MAX_TURN * dt;
    if (a > lim) holder.quaternion.slerp(q, lim / a); else holder.quaternion.copy(q);
  }
  const fwd2 = new THREE.Vector3(), moFlat = new THREE.Vector3();
  const basePos = new THREE.Vector3(), offNow = new THREE.Vector3(), retFrom = new THREE.Vector3();   // 追従機は「1 番機から見たずれ」で置く
  /* いまの位置から u.want へ向かう道を引き直す。外へ膨らませて、まっすぐ突っ込まないようにする */
  function startJoin(u) {
    if (!u.from) { u.from = new THREE.Vector3(); u.bow = new THREE.Vector3(); }
    u.from.copy(u.cur); u.k = 0;
    const d = u.from.distanceTo(u.want);
    u.dur = clamp(d / 18, 8, 34);                    // 近寄る速さが 30 m/s を超えないだけの時間をかける
    const amt = Math.min(90, d * 0.28);
    u.bow.set((u.from.x >= 0 ? 1 : -1) * amt, 0, amt * 0.3);
  }
  let corkT = -1;                                  // 0 以上ならコークスクリューの最中（2 番機が周りを回る）
  /* 描き物の課目（キューピッド・スタークロス）。編隊では描けない形なので、機体を式で置く。
     1 番機（操作する機体）は隠して、2 番機以降で描く。図は観覧位置の正面の空に立てた面の上に描く */
  /* 図の長さは「描き始めるまでに、機体が道すじへ乗り切っている」ように取る。
     道すじへ寄せるのに最大 8 秒（blend）かかるので、煙を出し始めるのはそのあと。
     乗り切らないうちに煙を出すと、寄せている途中の曲がった線が描かれ、形が崩れる
     （利用者「スタークロスの形が不完全」「ハートの形」） */
  /* 図を描く課目は、描き終わるまで最初の線が消えないようにする（秒）。
     粒の入れ物は 1 機あたり 1400 個・毎秒 25 個なので、56 秒までなら足りる */
  const FIG_LIFE = { cupid: 46, star: 30, eight: 44 };
  const FIGS = { cupid: { dur: 36, n: 3, s: 15, d: 640, z: 600 }, star: { dur: 18, n: 5, s: 15, d: 520, z: 560 } };
  const HEART_END = 0.64;                          // ハートを描く 2 機は、ここまでで道すじを飛び終える
  const STAR_IN = 0.47, STAR_OUT = 0.89, STAR_R = 16;   // スタークロス: 線を引く区間（この間に頂点から頂点へ飛ぶ）と、星の大きさ（単位）
  let fig = null;                                  // {id, t, dur, n, s}
  const figO = new THREE.Vector3(), figR = new THREE.Vector3(), figU = new THREE.Vector3(0, 0, 1), figF = new THREE.Vector3();
  let figAim = null;   // 図を描いているあいだ、地上からの視線を向ける先（絵の中心）
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
    figAim = figO.clone();     // 描き始めから課目の終わりまで、ここを見る（機体の平均だと絵から目が外れる）
    fig = { id, t: 0, dur: f.dur, n: f.n, s: f.s };
    /* 図の始点までの遠さで、寄せる時間を決める（速く飛びすぎないように） */
    mates.forEach((h, i) => {
      if (i >= f.n) return;
      figPoint(fp, figXY(id, i, 0), f.s);
      h.userData.blend = clamp(h.position.distanceTo(fp) / 45, 3, 8);   // 長すぎると、描き始めに間に合わない
      h.userData.prevP = null;
    });
  }
  /* 図の中の位置（a: 右、b: 上、単位）。u は 0〜1 の進み具合、i は何番目の機体か */
  /* ハートの輪郭そのもの（t: 0=上のくぼみ 〜 π=下の尖り） */
  function heartCurve(k, t) {
    return { a: k * 16 * Math.pow(Math.sin(t), 3),
             b: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) };
  }
  /* 1 機が飛ぶ道すじの点を作る。
     ハートの輪郭は 上のくぼみと下の尖りが「尖って」いて、そのままなぞると
     曲がりきれない（実機はそこを通らず、2 機の煙が交わって尖りを作る）。
     そこで両端を落とし、入りと出はまっすぐな線でつなぐ。
     下から上がってきて → 外側の葉を回り → 上のくぼみへ降りて 相手と交わる */
  const T1 = Math.PI - 0.38, T2 = 0.38;
  /* 上の交点（くぼみ）へ 内側の下から上がってきて → 外側の葉を回り → 下の交点へ降りて
     → そのまま まっすぐ抜ける。2 機は くぼみと尖りの 2 か所で交わる。
     煙を出すのは 交点から交点まで（table の smokeOn〜smokeOff） */
  function heartPath(k) {
    /* 曲線の始点・終点での「進む向き」（接線）。secant ではなく式の微分を使う */
    const tan = t => {
      const ct = Math.cos(t), st = Math.sin(t);
      const da = k * 48 * st * st * ct;
      const db = -13 * st + 10 * Math.sin(2 * t) + 6 * Math.sin(3 * t) + 4 * Math.sin(4 * t);
      const dl = Math.hypot(da, db);
      return { a: da / dl, b: db / dl };
    };
    const pts = [];
    const A = heartCurve(k, T2), u = tan(T2);                  // A から先へ進む向き
    const sIn = A.a / u.a;                                     // まっすぐ入ってくる線が中心線と交わるまでの距離
    const at = d => ({ a: A.a - u.a * d, b: A.b - u.b * d });   // A から d だけ手前の点
    const PRE = 36, nPre = 24;                                  // 交点の手前をこれだけ助走する（寄せ終わってから描き始めるため）
    for (let i = nPre; i >= 1; i--) pts.push(at(sIn + PRE * i / nPre));   // 交点の手前（ここは煙を出さない）
    pts.push({ a: 0, b: A.b - u.b * sIn });                     // 交点（くぼみ）をちょうど通る
    const iOn = pts.length - 1;                                 // ここから煙。2 機の線がここでつながる
    for (let i = 3; i >= 1; i--) pts.push(at(sIn * i / 4));     // 交点 → A
    for (let i = 0; i <= 140; i++) pts.push(heartCurve(k, T2 + (T1 - T2) * i / 140));
    const B = heartCurve(k, T1), v = tan(T1);                  // B から抜けていく向き
    const sOut = -B.a / v.a;                                   // 中心線と交わるまでの距離（尖り）
    const nOut = 8;
    for (let i = 1; i <= nOut; i++) {
      const d = sOut * i / nOut;
      pts.push({ a: B.a + v.a * d, b: B.b + v.b * d });
    }
    const iOff = pts.length - 1;                                // 下の交点（尖り）で煙を切る
    for (let i = 1; i <= 6; i++) pts.push({ a: B.a + v.a * (sOut + 2 * i), b: B.b + v.b * (sOut + 2 * i) });
    pts.iOn = iOn; pts.iOff = iOff;
    return pts;
  }
  /* 道の長さで測り直す（式のままだと、尖りのところで速さが落ちて 止まって見える）。
     0〜1 を「道のりの割合」として返すので、進む速さが一定になる */
  let heartTab = null;
  function heartPt(k, p) {
    if (!heartTab) {
      const pts = heartPath(1), N = pts.length - 1, cum = [0];
      for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].a - pts[i - 1].a, pts[i].b - pts[i - 1].b));
      heartTab = { pts, cum, total: cum[N], N, smokeOn: cum[pts.iOn] / cum[N], smokeOff: cum[pts.iOff] / cum[N] };
    }
    const t = heartTab, want = clamp(p, 0, 1) * t.total;
    let lo = 0, hi = t.N;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t.cum[mid] < want) lo = mid + 1; else hi = mid; }
    const i2 = Math.max(1, lo), seg = t.cum[i2] - t.cum[i2 - 1];
    const f = seg > 1e-6 ? (want - t.cum[i2 - 1]) / seg : 0;
    const A = t.pts[i2 - 1], B = t.pts[i2];
    return { a: k * (A.a + (B.a - A.a) * f), b: A.b + (B.b - A.b) * f };
  }
  function figXY(id, i, u) {
    if (id === 'cupid') {
      if (i < 2) {                                 // ハートを描く 2 機
        const k = i === 0 ? 1 : -1;
        if (u <= HEART_END) return heartPt(k, u / HEART_END);
        /* 抜けたあとは、降りる分をだんだん緩めながら まっすぐ離れていく（地面に向かわない） */
        const e1 = heartPt(k, 1), e0 = heartPt(k, 0.985);
        const dx = e1.a - e0.a, dy = e1.b - e0.b, dl = Math.max(1e-4, Math.hypot(dx, dy));
        const g2 = (u - HEART_END) / (1 - HEART_END);
        return { a: e1.a + dx / dl * 34 * g2, b: e1.b + dy / dl * 34 * g2 * (1 - 1.1 * g2) };   // 下がる量は 8 単位まで。あとは引き起こす
      }
      /* 矢: ハートを描いているあいだは、その左でひと回りして待つ（止まらず、遠くへも行かない）。
         回り終わりが ちょうど射る向きになるように輪を置いてあり、
         輪から直線へは 少しの区間をかけて混ぜる（折れ曲がらないように） */
      const circ = w => { const th = (-56.5 * D) + (w / 0.55 - 1) * Math.PI * 2;
        return { a: -37.7 + 14 * Math.cos(th), b: -8.4 + 14 * Math.sin(th) }; };
      const line = w => { const v = (w - 0.55) / 0.45; return { a: -30 + 60 * v, b: -20 + 40 * v }; };
      if (u < 0.46) return circ(u);
      if (u > 0.64) return line(u);
      const w2 = (u - 0.46) / 0.18, e3 = w2 * w2 * (3 - 2 * w2), A = circ(u), B = line(u);
      return { a: A.a + (B.a - A.a) * e3, b: A.b + (B.b - A.b) * e3 };
    }
    /* スタークロス: 5 機がそれぞれ「1 つ飛ばしの頂点を結ぶ 1 本の直線」を、
       曲がらずに飛び抜ける。5 本が重なって星（五芒星）になる。
       実機も、折れ曲がれないぶんを機数で補って角ばった形を描く */
    const RS = STAR_R, a1 = (90 + i * 72) * D, a2 = (90 + (i + 2) * 72) * D;
    const px = Math.cos(a1) * RS, py = Math.sin(a1) * RS;
    const qx = Math.cos(a2) * RS, qy = Math.sin(a2) * RS;
    const v = (u - STAR_IN) / (STAR_OUT - STAR_IN);         // 0 で始点、1 で終点。外は延長線
    return { a: px + (qx - px) * v, b: py + (qy - py) * v };
  }
  function figPoint(out, xy, sc) {
    return out.copy(figO).addScaledVector(figR, xy.a * sc).addScaledVector(figU, xy.b * sc);
  }
  /* ハートの輪郭の内側か。地上から見た形そのままなので、内側ではスモークを切ると
     矢がハートの向こう側を通って貫いているように見える */
  let heartPoly = null;
  function inHeart(a, b) {
    if (!heartPoly) {
      heartPoly = [];
      for (let i = 0; i <= 40; i++) { const q = heartCurve(1, Math.PI * i / 40); heartPoly.push([q.a, q.b]); }
      for (let i = 40; i >= 0; i--) { const q = heartCurve(-1, Math.PI * i / 40); heartPoly.push([q.a, q.b]); }
    }
    let inside = false;
    for (let i = 0, j = heartPoly.length - 1; i < heartPoly.length; j = i++) {
      const yi = heartPoly[i][1], yj = heartPoly[j][1];
      if ((yi > b) !== (yj > b) && a < (heartPoly[j][0] - heartPoly[i][0]) * (b - yi) / (yj - yi) + heartPoly[i][0]) inside = !inside;
    }
    return inside;
  }
  const CORK_R = 26, CORK_T = 3.6, CORK_LAG = 0.15;   // 回る半径（m）・1 周の時間（秒）・少し後ろ（秒）
  let corkBlend = 3;                               // 輪に乗るまでにかける時間（遠さで決める）
  /* レター・エイト: 3 機が片方の輪を描くあいだ、離れた 1 機がもう片方の輪を描く。
     離れる機体は式で置く（ねじらずに 8 の字を描かせるため）。E8_SPAN は、
     1 番機が何度まわるあいだに輪を描き終えるか。残りの旋回で隊形へ戻る */
  const E8_SPAN = 300, E8_EASE = 0.2;
  let e8 = null;
  function recordHistory(dt) {
    histT += dt;
    hist.push({ t: histT, p: plane.position.clone(), q: att.clone() });
    while (hist.length > 2 && hist[0].t < histT - 20) hist.shift();   // 後ろの遠く（合流位置）まで届く長さ
  }
  const exFwd = new THREE.Vector3(), exPos = new THREE.Vector3(), exSt = { p: exPos, q: null };
  const atSt = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  /* lag 秒前の 1 番機の状態。記録より前を求められたら、いちばん古い点から後ろへ まっすぐ延ばす。
     （その場に留めると、機体が空中で止まって待っているように見える）。
     記録は 1 コマごとなので、前後 2 点の間を割って返す。いちばん近い点をそのまま返すと、
     1 コマぶん（60 m/s なら 1 m）位置が飛び、その機体に乗った一人称視点がガタつく */
  function stateAt(lag) {
    const want = histT - lag;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].t > want) continue;
      const b = hist[i + 1];
      if (!b) return hist[i];
      const k = clamp((want - hist[i].t) / Math.max(1e-6, b.t - hist[i].t), 0, 1);
      atSt.p.lerpVectors(hist[i].p, b.p, k);
      atSt.q.copy(hist[i].q).slerp(b.q, k);
      return atSt;
    }
    const h0 = hist[0];
    if (!h0) return { p: plane.position, q: att };
    const extra = h0.t - want;
    if (extra <= 0.02) return h0;
    exFwd.set(0, 1, 0).applyQuaternion(h0.q);
    exPos.copy(h0.p).addScaledVector(exFwd, -extra * SPEED);
    exSt.q = h0.q;
    return exSt;
  }
  /* レター・エイトで離れる 1 機。1 番機の回った角 th に合わせて、反対側の輪の上を進ませる。
     速さは輪の上の進み方で決まる（sin で滑らかに増減させるので、急な変化にならない）。
     輪を描き終えたら、残りの旋回のあいだに隊形の位置へ寄せる */
  const e8p = new THREE.Vector3(), e8q = new THREE.Quaternion(), e8s = new THREE.Vector3();
  function placeEight(holder, u, i, dt, emitting, color) {
    const th = clamp(hdgSum - e8.t0, 0, 360), s = e8.s;
    const x = Math.min(1, th / E8_SPAN);
    const ph = 360 * (x - E8_EASE * Math.sin(2 * Math.PI * x) / (2 * Math.PI));   // 輪の上の位置（度）
    const rate = (360 / E8_SPAN) * (1 - E8_EASE * Math.cos(2 * Math.PI * x));     // 1 番機に対する進み方
    const hd = e8.h0 - s * ph;                                                    // 機首の向き
    const a = (hd - s * 90) * D;
    e8p.set(e8.cx - e8.R * Math.sin(a), e8.cy - e8.R * Math.cos(a), e8.z);
    const bk = -s * clamp(56 * rate, 25, 72);
    e8q.setFromAxisAngle(AZ, -hd * D);
    e8q.multiply(dq.setFromAxisAngle(AY, bk * D));
    const off0 = FORMATIONS[formation].offs[i] || [0, -32, 0];
    if (th < 24) {                                 // 出だし: 隊形の位置から輪の上へ、滑らかに離れる
      const k0 = th / 24, e0 = k0 * k0 * (3 - 2 * k0);
      e8s.set(off0[0], off0[1], off0[2]).applyQuaternion(att).add(plane.position);
      e8p.lerpVectors(e8s, e8p, e0);
      e8q.slerp(att, 1 - e0);
    }
    if (x >= 1) {                                  // 輪は描き終えた。隊形の位置へ寄せる
      const k = clamp((th - E8_SPAN) / Math.max(1, 360 - E8_SPAN), 0, 1), e = k * k * (3 - 2 * k);
      e8s.set(off0[0], off0[1], off0[2]).applyQuaternion(att).add(plane.position);
      e8p.lerp(e8s, e);
      e8q.slerp(att, e);
      if (k >= 1) {                                // 隊形に戻った。ここから先はふつうの置き方に返す
        e8.done = true;
        u.cur.set(off0[0], off0[1], off0[2]); u.from = null;
      }
    }
    holder.position.copy(e8p);
    turnMate(holder, e8q, dt);
    holder.visible = true; u.shown = true;
    if (emitting) { emitPos.set(0, -6.9, -0.3).applyQuaternion(e8q).add(e8p); emit(emitPos, color); }
  }
  function placeMates(dt) {
    if (gmode !== 'fly') { mates.forEach(h => { h.visible = false; h.userData.shown = false; }); return; }
    if (retT >= 0) { retT += dt; if (retT >= retDur) { retT = -1; mates.forEach(h => { h.userData.ret = null; }); } }
    const f = FORMATIONS[formation], on = smokers(), cols = SMOKE_COLORS[smokeColor].c;
    /* 演目の合間（進入・高度取り・水平に戻す）は煙を切る。旋回は演目の一部なので出す */
    const between = auto && manPhase !== 'do';
    const emitting = smokeOn && smokeT >= SMOKE_DT && !between;
    if (smokeOn && smokeT >= SMOKE_DT) smokeT = 0;
    if (on[0] && emitting && !fig) { emitPos.set(0, -6.9, -0.3).applyQuaternion(att).add(plane.position); emit(emitPos, cols[0 % cols.length]); }
    mates.forEach((holder, i) => {
      const target = f.offs[i], u = holder.userData, e = ENTRY[i];
      if (e8 && !e8.done && i === e8.solo) { placeEight(holder, u, i, dt, emitting, cols[(i + 1) % cols.length]); return; }
      /* 描き物の最中: 式のとおりに置く。始めの 2.5 秒は、いまの位置から図の始点へなめらかに移る */
      if (fig) {
        if (i >= fig.n) { holder.visible = false; u.shown = false; return; }
        const pu = Math.min(1.25, fig.t / fig.dur);                // 1 を超えても止めない（延長線上を飛び続ける）
        const xy = figXY(fig.id, i, pu), xy2 = figXY(fig.id, i, pu + 0.004);
        figPoint(fp, xy, fig.s);
        figPoint(fp2, xy2, fig.s);
        fFw.copy(fp2).sub(fp); if (fFw.lengthSq() < 1e-9) fFw.copy(figF); fFw.normalize();
        fUp.copy(figO).sub(fp);                                  // 図の中心の側を機体の上に向ける
        fUp.addScaledVector(fFw, -fUp.dot(fFw));
        if (fUp.lengthSq() < 1e-6) fUp.copy(figU);
        fUp.normalize(); fRt.crossVectors(fFw, fUp);
        fq.setFromRotationMatrix(fmat.makeBasis(fRt, fFw, fUp));
        const bl = u.blend || 8;
        if (fig.t < bl) {
          /* 隊形の位置から図の道へ寄せる。寄せ元は「編隊で飛び続けていたらいる位置」なので、
             止まって待っているようには見えない */
          const s3 = stateAt(Math.max(0, -u.cur.y / (SPEED * spdK)));
          mq.copy(s3.q); mp.copy(s3.p);
          mo.set(u.cur.x, 0, u.cur.z).applyQuaternion(mq); mp.add(mo);
          const k = fig.t / bl, e2 = k * k * (3 - 2 * k);
          holder.position.lerpVectors(mp, fp, e2);
        } else { holder.position.copy(fp); }
        /* 姿勢は「実際に動いた向き」から決める。道の接線から決めると、
           寄せているあいだに機首と進む向きがずれ、腹で滑るように見える。
           ただし 1 コマぶんの動きをそのまま向きにすると、動きが小さいコマで向きが暴れる
           （その機体に乗ると画面が振り回される）。向きをなましてから使う */
        if (!u.prevP) { u.prevP = holder.position.clone(); u.fwdS = null; }
        mo.copy(holder.position).sub(u.prevP);
        if (mo.lengthSq() > 1e-6) {
          mo.normalize();
          if (!u.fwdS) u.fwdS = mo.clone();
          else u.fwdS.lerp(mo, 1 - Math.exp(-dt / 0.20)).normalize();
        }
        u.prevP.copy(holder.position);
        if (u.fwdS) {
          fFw.copy(u.fwdS);
          fUp.copy(figO).sub(holder.position); fUp.addScaledVector(fFw, -fUp.dot(fFw));
          if (fUp.lengthSq() < 1e-6) fUp.copy(figU);
          fUp.normalize(); fRt.crossVectors(fFw, fUp);
          fq.setFromRotationMatrix(fmat.makeBasis(fRt, fFw, fUp));
          /* 向きも少しずつ寄せる（急に向きが変わる機体には乗っていられない）。
             まだ進む向きが分からないうちは、いまの向きのままにする */
          if (u.shown) { fq.slerp(holder.quaternion, Math.exp(-dt / 0.12)); turnMate(holder, fq, dt); }
          else holder.quaternion.copy(fq);
        }
        holder.visible = true; u.shown = true;
        /* スモーク: 矢はハートの内側で切る。色は「カラフル」を選んでいるときだけ図に合わせる */
        let ok = fig.t > bl * 0.25;
        if (fig.id === 'cupid' && i < 2) {                                  // ハート組: 上の交点から下の交点まで
          const ph = pu / HEART_END; heartPt(1, 0);                          // （表を作っておく）
          ok = ok && ph >= heartTab.smokeOn && ph <= heartTab.smokeOff;
        }
        if (fig.id === 'cupid' && i === 2) ok = ok && pu >= 0.55 && (!inHeart(xy.a, xy.b) || xy.a < -3);   // 矢: 射る位置から。中央の少し手前まで引く
        if (fig.id === 'star') ok = ok && pu > STAR_IN && pu < STAR_OUT;                     // 星の線を引く区間だけ
        if (emitting && ok) {
          let fc = cols[(i + 1) % cols.length];
          if (smokeColor === 'rainbow') fc = fig.id === 'star' ? '#ffd84d' : (i < 2 ? '#ff7fb6' : '#ffffff');
          emitPos.set(0, -6.9, -0.3).applyQuaternion(holder.quaternion).add(holder.position); emit(emitPos, fc);
        }
        return;
      }
      /* コークスクリューの 2 番機: 1 番機のまわりを回る。背中（機体の上）を輪の中心へ向ける。
         機体の軸まわりに θ+180° 回すと、上が中心を向く */
      if (corkT >= 0 && i === 0) {
        const th = corkT / CORK_T * Math.PI * 2, s2 = stateAt(CORK_LAG);
        mq.copy(s2.q).multiply(cq.setFromAxisAngle(AY, th + Math.PI));
        mo.set(Math.sin(th) * CORK_R, 0, Math.cos(th) * CORK_R).applyQuaternion(s2.q);
        mp.copy(s2.p).add(mo);
        if (corkT < corkBlend) {               // 編隊の位置から 輪の上へ、離れぐあいに応じた時間で移る
          const s4 = stateAt(Math.max(0, -u.cur.y / (SPEED * spdK)));
          moFlat.set(u.cur.x, 0, u.cur.z).applyQuaternion(s4.q);
          fp2.copy(s4.p).add(moFlat);
          const kc = corkT / corkBlend, ec = kc * kc * (3 - 2 * kc);
          holder.position.lerpVectors(fp2, mp, ec);
        } else {
          holder.position.copy(mp);
          /* 輪に乗り切ってから、編隊での位置も輪のものに移す
             （移すのが早いと、寄せ元の位置が飛んでしまう） */
          u.cur.set(Math.sin(th) * CORK_R, -CORK_LAG * SPEED, Math.cos(th) * CORK_R);
        }
        turnMate(holder, mq, dt); holder.visible = true; u.shown = true;
        if (emitting) { emitPos.set(0, -6.9, -0.3).applyQuaternion(mq).add(holder.position); emit(emitPos, cols[1 % cols.length]); }
        return;
      }
      /* どの編隊の変更でも、いまの位置から新しい位置へなめらかに移る。
         隊形から外れる機体は後ろの遠く（ENTRY）へ離れていき、届いたら消える */
      fwant.set(target ? target[0] * formScale : e[0], target ? target[1] * formScale : e[1], target ? target[2] * formScale : e[2]);
      if (!u.from || u.want.distanceTo(fwant) > 6) { u.want.copy(fwant); startJoin(u); }   // 行き先が変わったら道を引き直す
      else u.want.copy(fwant);
      u.k = Math.min(1, (u.k || 0) + dt / (u.dur || JOIN_TIME));
      const ek = u.k * u.k * (3 - 2 * u.k);                    // ゆっくり出て ゆっくり入る
      u.cur.lerpVectors(u.from, u.want, ek).addScaledVector(u.bow, Math.sin(Math.PI * u.k));
      const settled = u.k > 0.97;
      /* 離れていく機体は、十分に離れて小さくなってから消す */
      if (!target && (settled || u.cur.length() > 520)) { holder.visible = false; u.shown = false; return; }
      holder.visible = true;
      const st2 = stateAt(Math.max(0, -u.cur.y / (SPEED * spdK)));
      mq.copy(st2.q); mp.copy(st2.p);
      /* 離れている機体は、先頭機の傾きに巻き込まない。巻き込むと、横転のたびに
         「腕の長さ × 回る速さ」で振り回され、あり得ない速さで飛んでしまう。
         近いうちは編隊どおり、離れるほど「機首の向きだけ・翼は水平」の置き方に混ぜる。
         角度ではなく位置そのものを混ぜるので、背面のときも飛びはしない */
      const far = clamp((u.cur.length() - 70) / 130, 0, 1);
      mo.set(u.cur.x, 0, u.cur.z).applyQuaternion(mq);
      if (far > 0.001) {
        fwd2.set(0, 1, 0).applyQuaternion(st2.q);
        /* 真上・真下を向いているときは方位が決まらない（atan2 が暴れる）ので、直前の方位を使う。
           これをしないと、宙返りの頂点で 180° 向きが飛び、その機体に乗っていると画面が一瞬で回る */
        if (Math.abs(fwd2.z) < 0.95) flatYaw = -Math.atan2(fwd2.x, fwd2.y);
        qFlat.setFromAxisAngle(AZ, flatYaw)
             .multiply(qa.setFromAxisAngle(AX, Math.asin(clamp(fwd2.z, -1, 1))));
        moFlat.set(u.cur.x, 0, u.cur.z).applyQuaternion(qFlat);
        mo.lerp(moFlat, far);
        /* 遠くの機体は水平に飛んでいるように見せる。切り替えると姿勢が飛ぶので、少しずつ寄せる
           （切り替えだと、その機体に乗っているときに画面が一瞬で回ってしまう） */
        const kf = far * far * (3 - 2 * far);
        if (kf > 0.001) mq.slerp(qFlat, kf);
      }
      basePos.copy(mp);                  // 遅らせた 1 番機の位置（ここからのずれで置く）
      mp.add(mo);
      if (retT >= 0 && u.ret) {          // 図の終わりの位置から、隊形の位置へ なめらかに戻す
        const k2 = retT / retDur, e2 = k2 * k2 * (3 - 2 * k2);
        /* 混ぜ元は「そのまま飛び続けた位置」。上下の速さは 3 秒で抜き、低くなりすぎないようにする */
        const tz = 3 * (1 - Math.exp(-retT / 3));
        retFrom.set(u.ret.p.x + u.ret.v.x * retT, u.ret.p.y + u.ret.v.y * retT,
                    Math.max(80, u.ret.p.z + u.ret.v.z * tz));
        holder.position.lerpVectors(retFrom, mp, e2);
        turnMate(holder, qa.copy(u.ret.q).slerp(mq, e2), dt);
      } else if (u.shown) {
        /* なますのは「世界の中での位置」ではなく「1 番機から見たずれ」。
           位置そのものをなますと、編隊ごと 60 m/s で進むぶんまで毎コマ引きずられ、
           コマの長さのばらつきがそのまま速さのばらつきになる（その機体に乗るとガタつく）。
           ずれをなませば、進むぶんは遅らせた 1 番機の位置がそのまま持つのでなめらか。
           離れているほど強くなます（先頭機の向きの変化が、離れた機体では大きな動きに化けるため） */
        offNow.copy(holder.position).sub(basePos);
        offNow.lerp(mo, 1 - Math.exp(-dt / (0.06 + far * 0.8)));
        holder.position.copy(basePos).add(offNow);
        turnMate(holder, mq, dt);
      } else { holder.position.copy(mp); holder.quaternion.copy(mq); }
      u.shown = true;
      /* 隊形の中にいるあいだは、位置を移している最中でもスモークを切らない（チェンジオーバー・ターン）。
         遠くから合流してくる機体（離れている）は、これまでどおり出さない */
      if (target && (settled || u.cur.length() < 90) && on[i + 1] && emitting) { emitPos.set(0, -6.9, -0.3).applyQuaternion(mq).add(holder.position); emit(emitPos, cols[(i + 1) % cols.length]); }
    });
    if (emitting) { smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.acolor.needsUpdate = true; smokeGeo.attributes.birth.needsUpdate = true; smokeGeo.attributes.asize.needsUpdate = true; smokeGeo.attributes.alife.needsUpdate = true; }
    smokeMat.uniforms.uTime.value = clock;
  }

  let lastDt = 0.016, shimN = 0;
  function place(dt) {
    if (dt) lastDt = dt;
    if (treeMode && (++shimN % 3) === 0) drawShimmer();
    shimmerSets.forEach(S => { S.visible = treeMode && curView === 'ground'; });
    rotation();
    /* 壁は、近づいた面だけを濃くする（遠い壁は出さない）。技の途中はどの壁も出さない */
    walls.forEach(w => {
      const d = Math.abs((w.userData.n === 'x' ? cam.position.x : cam.position.y) - w.userData.v);
      const a = 0.55 * clamp(1 - d / WALL_FADE, 0, 1);
      w.material.opacity = a;
      w.visible = !auto && a > 0.01;
    });
    marker.visible = markOn && curView === 'ground' && !follow;   // 進入の目印は、地上から自分で向きを決めているときだけ
    plane.position.set(st.x, st.y, st.z); plane.quaternion.setFromRotationMatrix(R);
    /* 操縦桿を入力に合わせて傾ける（自動操縦のときは入力が 0 なので中立のまま） */
    const sk = dt ? 1 - Math.exp(-dt / 0.09) : 1;
    stickAim.x += (input.x - stickAim.x) * sk;
    stickAim.y += (input.y - stickAim.y) * sk;
    stickPivot.rotation.set(-stickAim.y * 0.22, stickAim.x * 0.24, 0);   // 引くと視界から外れないよう、傾きは控えめ
    shadow.position.set(st.x, st.y, 0.8); shadow.material.opacity = 0.4 * Math.max(0.15, 1 - st.z / 500);
  }

  /* カメラを置く。追従機を置いたあとに呼ぶこと。
     先に呼ぶと、乗っている追従機の位置は 1 コマ前のままなのに 機体の絵は今の位置に描かれ、
     一人称で操縦席が目の前でがたついて見える（利用者「2 番機以降の一人称視点が非常に不安定」の元） */
  function aimCamera(dt) {
    /* 自動追従: 地上から見るとき、飛んでいる機体の真ん中へ ゆっくり首を回す。
       図を描く課目では機体が広がるので、見えている機体の平均を見る（急に動くと見づらいので少しずつ） */
    if (follow && curView === 'ground') {
      /* 絵を描く課目（キューピッド・スタークロス）では、描き始めから課目が終わるまで絵の中心を見る。
         機体の平均を見ると、機体が散らばるにつれて絵の外へ目が動いてしまう */
      if (figAim) focus.copy(figAim);
      else {
        focus.copy(plane.position); let fn = 1;
        mates.forEach(mt => { if (mt.visible) { focus.add(mt.position); fn++; } });
        focus.multiplyScalar(1 / fn);
      }
      tmp.copy(focus).sub(gEye);
      const wy = Math.atan2(tmp.x, tmp.y), wp = Math.asin(clamp(tmp.z / Math.max(1, tmp.length()), -1, 1));
      const k = 1 - Math.exp(-(dt || 0.016) / 0.45);
      gYaw += ((wy - gYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * k;
      gPitch += (wp - gPitch) * k;
    }
    /* 乗っている機体（視点の元）。編隊機が出ていなければ 1 番機に戻す。
       出ているかどうかは userData.shown で見る（「計器」の見せ方では、乗っている機体を消すため） */
    const seatObj = (seat > 0 && mates[seat - 1] && mates[seat - 1].userData.shown) ? mates[seat - 1] : plane;
    if (seatObj === plane && seat > 0) seat = 0;
    /* 計器盤と操縦桿の位置は、乗っている機体のものを使う。
       cockpit を 1 番機に付けたままだと、乗り換えたときに計器が 1 番機の上に出てしまう */
    if (cockpit.parent !== seatObj) seatObj.add(cockpit);
    applyBody();
    seatQ.copy(seatObj.quaternion); seatR.makeRotationFromQuaternion(seatQ);
    seatMeshes.forEach(m => { m.visible = !(curView === 'first' && seatObj === plane); });
    mates.forEach((h, i) => { const sm = h.userData.seats; if (sm) sm.forEach(m => { m.visible = !(curView === 'first' && seatObj === h); }); });
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
      tmp.applyAxisAngle(AX, look.p).applyAxisAngle(AZ, -look.y).applyQuaternion(seatQ).add(seatObj.position);
      if (camPos.lengthSq() === 0) camPos.copy(tmp); else camPos.lerp(tmp, 0.18);
      cam.position.copy(camPos); cam.up.copy(bup2.set(0, 0, 1).applyQuaternion(seatQ)); cam.lookAt(seatObj.position);
    } else {
      cam.position.copy(tmp.copy(EYE).add(eyeOff).applyMatrix4(seatR).add(seatObj.position));
      /* 一人称は少し下向き（計器盤と操縦桿が視界に入る）。そこからドラッグで首を振る */
      cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(seatR, RX90).multiply(TILT));
      cam.quaternion.multiply(qc.setFromAxisAngle(AY, look.y)).multiply(qc.setFromAxisAngle(AX, look.p));
    }
    sky.position.copy(cam.position);
  }

  let running = true, raf = 0, last = performance.now();
  /* 1 フレームの中で何かに失敗しても、次のフレームを必ず要求する（要求をやめると画面が固まって見える）。
     続けて失敗するときは自動操縦を切って水平に戻す */
  function frame(now) {
    if (!running) return;
    let dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (paused) dt = 0;                       // 一時停止: 時間を進めない（見回しと描き直しは続ける）
    try {
      clock += dt; smokeT += dt;
      step(dt); place(dt); if (dt) recordHistory(dt); placeMates(dt); aimCamera(dt);
      renderer.render(world, cam);
      drawStick();
      tellPanel();
      st.err = 0;
    } catch (e) {
      st.err = (st.err || 0) + 1;
      if (st.err <= 2) console.error('sim frame error', e);
      if (st.err === 3) { endCork(); endFigure(); if (treeMode) setTreeMode(false); auto = false; oneShot = false; formation = userForm; formScale = 1; levelAttitude(); manPhase = 'do'; st.cue = ''; markOn = false; }
    }
    if (onState) onState(st);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  /* 計器盤の上端が画面のどこに来るかを、描いたその場で知らせる（画面に置く計器の位置決め用）。
     onState（1 コマ遅れ）で渡すと、見回したときに計器が遅れてついてくる */
  function tellPanel() {
    if (!opt.onPanel) return;
    if (curView !== 'first' || !inCockpit) { opt.onPanel(null); return; }
    cockpit.updateWorldMatrix(true, false);
    panelPt.set(0, 3.32, -0.29).applyMatrix4(cockpit.matrixWorld).project(cam);
    opt.onPanel(panelPt.z > 1 ? null : { x: (panelPt.x + 1) / 2, y: (1 - panelPt.y) / 2 });
  }

  /* 操縦桿を本編の上に重ねて描く（一人称のときだけ） */
  function drawStick() {
    if (curView !== 'first' || !inCockpit) return;
    cockpit.updateWorldMatrix(true, false);
    stickHolder.matrix.copy(cockpit.matrixWorld);
    oCam.fov = cam.fov; oCam.aspect = cam.aspect; oCam.updateProjectionMatrix();
    oCam.position.copy(cam.position); oCam.quaternion.copy(cam.quaternion);
    renderer.autoClear = false; renderer.clearDepth();
    renderer.render(overlay, oCam);
    renderer.autoClear = true;
  }

  /* 一人称はカメラの手前の面を 1.1 で切る（目のすぐ前にある機体内部の部品が画面を塞ぐのを防ぐ）。三人称は 0.5 */
  function setView(v) {
    curView = v; look.y = 0; look.p = 0; const out = v !== 'first';
    seatMeshes.forEach(m => { m.visible = out; });
    cockpit.visible = !out && inCockpit;
    applyBody();   /* 計器だけの見せ方では、乗っている機体そのものも消す（外がそのまま見える） */
    baseFov = v === 'ground' ? 42 : out ? 55 : 68; cam.near = out ? 0.5 : 1.1; applyFov(); camPos.set(0, 0, 0);
    /* 煙の太さ: 一人称はすぐ近くを通るので控えめに、それ以外（特に地上）は遠くでも見えるように */
    const near1 = v === 'first';
    smokeMat.uniforms.uMinPx.value = near1 ? 4 : 10;
    smokeMat.uniforms.uMaxPx.value = near1 ? 60 : 90;
    smokeMat.uniforms.uFarS.value = near1 ? 0.3 : 0.8;
    smokeMat.uniforms.uFarA.value = near1 ? 0.6 : 1.2;
    if (v === 'ground') gAim();   // 入ったときだけ機体の方を向く。以後は自分で向ける
  }
  setView(view);

  return {
    input, state: st, setView,
    /* 一人称の見せ方を変える。切ると機内が消えて、外の景色がそのまま見える（縦画面はいつもこちら） */
    setCockpit(on) { inCockpit = !!on; const first = curView === 'first';
      cockpit.visible = first && inCockpit; applyBody(); }, cockpitOn() { return inCockpit; },
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
        gmode = 'fly'; gv = 0; spdK = 1; spdWant = 1;
        userForm = formation;
        Object.assign(st, { x: GROUND_EYE.x - 280, y: GROUND_EYE.y - 460, z: SHOW.ALT, h: 25, ground: false, wall: false });
        levelAttitude(); camPos.set(0, 0, 0); hist.length = 0; clearSmoke();
        let f0 = 0;
        for (let k = 0; k < PROGRAM.length; k++) if (okMan(PROGRAM[k])) { f0 = k; break; }
        beginManeuver(f0);
      } else { formation = userForm; formScale = 1; st.show = ''; st.cue = ''; markOn = false; step_i = 0; manPhase = 'do'; endCork(); endFigure(); if (treeMode) setTreeMode(false); }
    },
    autoState() { return auto; },
    setZoom(z) { zoom = clamp(z, 1, 6); applyFov(); return zoom; },   // 1〜6 倍
    setGear(on) { gearOn = !!on; applyGear(); }, gearState() { return gearOn; },
    /* 一人称のとき、機内の計器盤の上端が画面のどこに来るか（0〜1 の割合）。
       端末の縦横比や画角に関係なく計器を計器盤の上へ置けるようにするための値 */
    panelSpot() {
      if (curView !== 'first') return null;
      cockpit.updateWorldMatrix(true, false);
      panelPt.set(0, 3.32, -0.29).applyMatrix4(cockpit.matrixWorld).project(cam);
      if (panelPt.z > 1) return null;                       // カメラの後ろ
      return { x: (panelPt.x + 1) / 2, y: (1 - panelPt.y) / 2 };
    },
    /* 演目の最中か（通しの自動操縦か、ひとつだけの技） */
    showing() { return auto || oneShot; },
    /* 一時停止（演目を止めて眺める）。止めていても見回し・拡大・視点の切り替えはできる */
    setPaused(on) { paused = !!on; last = performance.now(); return paused; },
    togglePause() { paused = !paused; last = performance.now(); return paused; },
    pausedState() { return paused; },
    /* いまの景色を絵にする（操作ボタンは 3D の外にあるので写らない）。
       描いた直後に読み出す（そうしないと空の絵になる） */
    snapshot() { renderer.render(world, cam); return renderer.domElement.toDataURL('image/png'); },
    /* 乗り換え: 押すたびに 1 番機 → 2 番機 → … → 出ている機体の中で順に回る */
    nextSeat() {
      for (let k = 1; k <= mates.length + 1; k++) {
        const n = (seat + k) % (mates.length + 1);
        if (n === 0 || (mates[n - 1] && mates[n - 1].userData.shown)) { seat = n; camPos.set(0, 0, 0); return seat + 1; }
      }
      return seat + 1;
    },
    seatNo() { return seat + 1; },
    /* 待機中に押すと加速して離陸する。飛行中は何もしない */
    throttle() { if (gmode === 'stand') { gmode = 'takeoff'; return true; } return false; },
    groundMode() { return gmode; },
    setLights(on) { lightsOn = !!on; applyGear(); }, lightState() { return lightsOn; },
    setFollow(on) { follow = !!on; if (follow && curView === 'ground') { look.y = 0; look.p = 0; } },
    /* 自動操縦で地上から見るときは、機体を目で追う（演目を見失わないように） */
    autoGroundFollow() { if (auto && curView === 'ground' && !follow) { follow = true; look.y = 0; look.p = 0; return true; } return false; },
    followState() { return follow; },
    zoomVal() { return zoom; },
    /* 技の一覧（移動のための旋回と正面通過を除く）と、1 つだけ行わせる呼び出し。
       自分で操縦しているときに技を選ぶと、その技の間だけ自動で飛び、終わると操縦が戻る */
    maneuvers() { const seen = new Set();   // 同じ技が演技の中に何度も出るので、一覧では 1 つにまとめる
      return PROGRAM.map((m, i) => ({ i, id: m.id, ja: m.ja, desc: m.desc || '', lock: !okMan(m) })).filter(m => m.id !== 'orbit' && m.id !== 'pass' && !seen.has(m.id) && seen.add(m.id)); },
    /* 見せる課目を絞る（体験版）。ids を渡すとその id だけ、null で全部に戻す */
    setAllowed(ids) { allowIds = (ids && ids.length) ? ids.slice() : null; },
    runManeuver(i) {
      if (!PROGRAM[i] || !okMan(PROGRAM[i])) return false;
      if (gmode !== 'fly') { gmode = 'fly'; st.z = Math.max(st.z, 120); spdK = 1; spdWant = 1; levelAttitude(); }
      if (!auto) { userForm = formation; oneShot = true; }   // 自分で操縦しているときは、その技だけ行って操縦を返す
      auto = true; beginManeuver(i); return true;
    },
    setProps(on) { props.visible = !!on; },   // オブジェクト（山・民家・木・塔）の出し入れ
    setFormation(f) { if (FORMATIONS[f]) { formation = f; userForm = f; } },   // 飛びながら変えられる。合流は placeMates がなめらかにする
    formation() { return formation; },
    setSmoke(on) { smokeOn = !!on; },
    smokeState() { return smokeOn; },
    setSmokeColor(c) { if (SMOKE_COLORS[c]) { smokeColor = c; clearSmoke(); } },
    level() { levelAttitude(); st.ground = false; if (gmode !== 'fly') { gmode = 'fly'; st.z = Math.max(st.z, 60); spdK = 1; } },
    home() { gmode = 'fly'; gv = 0; spdK = 1; spdWant = 1; Object.assign(st, { x: START.x, y: START.y, z: START.z, h: START.h, ground: false, wall: false }); levelAttitude(); camPos.set(0, 0, 0); hist.length = 0; clearSmoke(); },
    dispose() { running = false; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); cv.remove(); }
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
