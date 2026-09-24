/* 操縦操作の練習シミュレーター（three.js）。
   世界座標: x=東 y=北 z=上（単位 m）。機体の向きは方位 h（北 0°、時計回り）、ピッチ p（機首上げ正）、バンク b（右バンク正）で
   R = Rz(−h)·Rx(p)·Ry(b)。出題と同じ向きの約束（操縦桿右 → 右バンク → 景色は左に傾く、右方向舵 → 右を向く → 景色は左へ流れる）。
   ±LIMIT m の四角い空間の中を一定速度で飛び、壁と地面で止まる。 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './flight.js?v=6';   // 飛行モデルと試験の景色の世界（globalThis.AAT_FLIGHT）

const D = Math.PI / 180;
export const LIMIT = 3300;                       // 壁までの距離（原点から、m）。壁は近づくまで見えない（place で薄くする）。1800 → 3300（利用者の指示 2026-09-13「制限範囲を拡大」。地面 8 km 角の内側）
const WALL_FADE = 400;                           // 壁が見えはじめる距離（m）。これより遠いと透明
export const CEIL = 4000;                        // 天井（m）。宙返りができる高さを取る（3000 → 4000、2026-09-13）
/* 展示飛行（自動操縦）の座標の基準。演目の開始位置・無限遠・進入の門・自動の天井・民家と木を置く範囲は、壁が 1,800 m・天井が 3,000 m だったときに合わせてある。
   v05.05 で手動操縦の壁（LIMIT）と天井（CEIL）を広げたとき、これらも LIMIT・CEIL から計算していたので一緒に動いてしまい、
   正面から入る課目の開始位置が 1,920 → 3,420 m、無限遠が 1.5 km 遠くなり、民家と木が 3.4 倍の広さに薄まっていた（2026-09-13 に発見、v05.14 で戻した）。
   壁を広げたのは手動操縦の飛べる範囲のためなので、展示飛行はもとの基準のまま */
const SHOW_LIMIT = 1800, SHOW_CEIL = 3000;
export const SPEED = 60;                         // 速度（m/s、固定）
const RATE = { roll: 60, pitch: 25, yaw: 20 };   // 入力 1 のときの角速度（°/s）
/* 試験の世界（「動きで見る」）: 機体は 200 m/s で 2 秒に 400 m 進むので、目印が 2.5〜4 km 先だと近づいた分だけ最大 100 px ずれた（実測）。
   実機の写真の景色は遠いので、目印を 15 倍遠くに（見える角度は同じ）、機体は 1,000 m の高さに（奥へ 2 回で 105 m 沈んでも地面に届かない） */
const EXAM_H = 1000, EXAM_K = 15;
const START = { x: 0, y: -450, z: 80, h: 0 };    // 開始位置: 滑走路の南端上空、北向き
const GROUND_EYE = { x: 90, y: -120, z: 0 };     // 地上から見るときの立ち位置（滑走路の東側）
const EYE_H = 1.6;                               // 目の高さ（人の背丈）
/* 滑走路は 2 本。2 機ずつ並んで離陸するため。1 本目は原点（x=0）、2 本目は西側。
   地上では 1〜6 番機が 2 本に 2 機ずつ、3 列で並ぶ（GRID は 1 番機の位置からのずれ） */
const RWY2 = -100;
const RWY_X = [0, RWY2];
const GRID = [[0, 0], [RWY2, 0], [0, -46], [RWY2, -46], [0, -92], [RWY2, -92]];
/* 航空基地。原点（見る人の立ち位置）まで基地の中。
   駐機（初期位置）: 原点の東側、半径 STAND_R の弧の上に 6 機。機首は原点へ向き、扇状に囲む。
   誘導路: 駐機の東（x = TAXI_X）を南北に。南の取り付け（y = TAXI_S）で滑走路 1・2 の南端へ、北の出口（y = TAXI_N）で滑走路 1 の北端から。
   離陸前: 駐機 → 外へ出て（origin と反対側）→ 誘導路を南へ → 取り付けを西へ → 滑走路の南端に北向きで並ぶ。
   着陸後: 滑走路を北端まで → 出口を東へ → 誘導路を南へ → 駐機の外の点 → 駐機（機首は原点へ）。
   機体ごとに別の道を、時間をずらして走るので、重ならず、ぶつからない */
const STAND_R = 110;
const STANDS = [45, 63, 81, 99, 117, 135].map(b => ({ b, x: GROUND_EYE.x + Math.sin(b * D) * STAND_R, y: GROUND_EYE.y + Math.cos(b * D) * STAND_R, h: (b + 180) % 360 }));
const standOut = k => ({ x: STANDS[k].x + Math.sin(STANDS[k].b * D) * 50, y: STANDS[k].y + Math.cos(STANDS[k].b * D) * 50 });   // 駐機の外の点（原点と反対側）
const TAXI_X = 270, TAXI_N = 590, TAXI_S = -600, TAXI_END = -640;
const EXIT_Y = 240;                              // 着陸後の出口（減速して止まる y = +70〜+170 のすぐ先）。ここから誘導路へ出て、滑走路を早く空ける
const LAND_FAR = 3600;                           // 着陸の最終進入を始める距離（滑走路の南、延長線上）
/* 着陸へ回り込むときの待ちの位置（滑走路の東 LAND_DW_X、進入の入口よりさらに南 LAND_DW_Y）。
   瞬間移動をやめたので（v04.76）、ここを回ってから延長線に乗る */
const LAND_DW_X = 1400, LAND_DW_Y = 1600;
const TAXI_V = 12, TAXI_TURN = 24;               // 地上の速さ（m/s）と曲がる速さ（度/秒）
const TK_GAP = 7;                                // 2 機ずつの離陸の間隔（秒）
const TK_ANG = 9;                                // 浮いたあとの上昇角（度）
const TK_UP = 70;                                // この高さまで上がったら編隊へ寄せる（m）

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
  finger:  { ja: 'フィンガーチップ', n: 4, offs: [[14, -12, 0], [-14, -12, 0], [28, -24, 0]] },
  /* 扇（サンライズ・レインフォールで開くときに使う）。1 番機を要にして、左右と上へ放射状に並ぶ。
     隊形の倍率を上げると、そのまま扇のように広がる */
  fan:     { ja: '扇', n: 5, offs: [[-16, -16, 0], [16, -16, 0], [-32, -32, 0], [32, -32, 0]] },
  /* 階段（チェンジオーバー・ターンの進入）。1 番機がいちばん上で、後ろへ行くほど下がる */
  steps:   { ja: '階段', n: 5, offs: [[0, -16, -10], [0, -32, -20], [0, -48, -30], [0, -64, -40]] },
  /* 交互開き（チェンジオーバー・ターンの開き）。1 番機以外が左右へ交互に開く */
  split:   { ja: '交互開き', n: 5, offs: [[-24, -16, -8], [24, -32, -16], [-40, -48, -24], [40, -64, -32]] }
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
const SMOKE_MAX = 4200;                          // 1 機あたりの粒の数（濃い煙のときは 1 か所に 3 つ）。
                                                 // v04.83: 粒の間を 1/2.5 にしたぶん増やした（利用者の指示 第 3 便 8）
const SMOKE_DT = 0.04;
/* 編隊に入るとき・抜けるときの位置（先頭機から見て後ろの遠く）。ここから所定の位置へ 4 秒かけて寄る */
const ENTRY = [[-170, -620, 40], [170, -620, 40], [-250, -800, -30], [250, -800, -30], [0, -960, 60]];
const JOIN_TIME = 14;                             // 隊形を変えるときにかける時間（秒）。ゆっくり出て ゆっくり入る
/* 自動操縦（地上から見るための演技）。観覧位置のまわりを回り、正面を通過し、宙返りをする。
   距離と高さは、地上から見て機体の姿勢が読み取れる近さにする（2026-09-04 に一段近く・低くした）。
   ALT_MIN より低い課目（クリスマスツリー・ローパスなど）は、そのままの高さで行う */
const SHOW = { R: 205, ALT: 120, ORBIT: 22, PASS: 15, LOOPMAX: 18, GATE: 185, SIDE: 140, ALT_IN: 170 };   // v04.19: R 240→205、GATE 220→185、SIDE 165→140（演目を近くに）
const ALT_K = 0.78, ALT_MIN = 110;               // 課目ごとの高さにかける係数と、下げない下限（m）
/* ===== 演目の位置の決まり =====
   原点 = 立ち位置（GROUND_EYE）、北 = 正面。
   ・開始位置: 正面から原点へ向かってくる課目は 北 FRONT_START に固定する。
     それ以外の課目は固定しない（そこまで行く時間がかかる。自然な経路なら変わってよい）
   ・散開位置: 北 SPREAD_D。サンライズ・レインフォールが開き、タック・クロスが交差する点
   ・中間位置: 開始位置と散開位置の真ん中（タック・クロスで外へ回し始める点）
   ・終了位置: 原点を過ぎた 南 END_D、または方角の点 keyPt(方位, 距離) */
const SPREAD_D = 600, END_D = 300, KEY_R = 850;   // v04.19: KEY_R 1000→850（進入点を近くに）
/* 「無限遠」として使う距離。もとの壁があったところ（原点から南の壁まで）にそろえる。
   ここまで来たら、演目は終わり・スモークは一斉に切る・次の課目へ位置を移す。
   本当に遠くまで飛ばすと、着くまでの時間が長すぎる */
const REAR_END = SHOW_LIMIT + GROUND_EYE.y;      // 原点から、もとの壁のあった位置まで（m）
/* 曲の折り返しと頭（秒）。演目の長さを「曲 2 周ぶん」に合わせるのに使う */
const MUS_LOOP_END_S = 238, MUS_LEAD_S = 13, LAND_TIME = 130;
const STRIP_END = 650;                           // 滑走路の帯の端（y = ±650）。南の取り付け（-600）と北の出口（590）が側面に付く
const LAND_TD_Y = -STRIP_END + 450;              // 接地する点（y = -100）。帯の入口から 450 m 入ったところ、止まるまで 650 m ある
const LAND_SLOPE = 0.052;                        // 進入の勾配（約 3 度）
/* JUMP_FAR: ここまで離れたら位置を移してよい。1000 m にすると、離陸して上がりきった直後（原点から 1 km ほど）に
   目の前で移ってしまい、瞬間移動が見える（実測）。壁のあった距離まで離れてからにする */
const JUMP_FAR = REAR_END, JUMP_FRONT = 2600, JUMP_AT = 700, JUMP_RWY = 1800;   // v04.24: JUMP_FRONT 3200 → 2600（無駄な直進を減らす）
/* ===== 演目の正面 =====
   正面は北に固定しない。課目ごとに、いまの機体がいる方角に最も近い東西南北を正面に選ぶ
   （そちらから入ってくれば、無限遠への回り込みが短い）。
   演目の形は正面に対して同じなので、位置はすべて「前へ何 m・右へ何 m」で表し、ここで世界の座標に直す */
let showFr = 0;                                  // 演目の正面（0 北・90 東・180 南・270 西）
function frU() { return { dx: Math.sin(showFr * D), dy: Math.cos(showFr * D) }; }
function showPt(fwd, right) {                    // 正面に対して 前へ fwd・右へ right の点
  const u = frU();
  return { x: GROUND_EYE.x + u.dx * fwd + u.dy * right, y: GROUND_EYE.y + u.dy * fwd - u.dx * right };
}
function showLocal(x, y) {                       // 世界の点を「前へ・右へ」に直す
  const u = frU(), vx = x - GROUND_EYE.x, vy = y - GROUND_EYE.y;
  return { along: vx * u.dx + vy * u.dy, side: vx * u.dy - vy * u.dx };
}
function keyPt(bearing, dist) {                  // 正面から見た方位（0 = 正面、90 = 右手）
  return showPt(Math.cos(bearing * D) * dist, Math.sin(bearing * D) * dist);
}
/* 正面から向かってくる課目は、遠くから見せ場を作る。
   始める（＝スモークを出す）のは、観覧位置から「もとの壁があったあたり」まで下がった位置。
   進入の門は、その手前でもう向きが合っているように、さらに 500 m 奥へ置く。
   横のずらしは「門で 180 度 向き直さない」ためのもの。大きいと斜めに入ってくるので、
   旋回半径（バンク 52 度で約 290 m）ぶんだけにとどめ、あとは観覧位置へまっすぐ向かわせる */
const FRONT_START = SHOW_LIMIT + 120;            // 課目を始める位置（観覧位置からの距離、m）
const FRONT_FAR = FRONT_START + 1000 - SHOW.GATE, FRONT_SIDE = 150;   // 門で向き直してから、開始位置までに線へ乗る
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
  /* scenery: 'exam' なら、空港・民家・木・空間の山を置かず、試験の絵（engine.js の svgCockpit）と同じ景色の世界を組む
     （「見え方」の「動きで見る」用。利用者の指示 2026-09-13「試験では見える景色のみで出題される。見える景色の世界そのままで再現する」） */
  const exam = opt.scenery === 'exam';
  const scene = document.body.dataset.scene || 'day', night = scene === 'night', dim = scene === 'dawn' || scene === 'dusk';
  const col = {
    skyTop: cssColor(['--ck-sky-top', '--ck-sky', '--sky'], '#2f86e0'), skyHz: cssColor(['--ck-sky-hz', '--ck-sky', '--sky'], '#b4dcf7'),
    earth: cssColor(['--ck-earth', '--earth'], '#9a6535'), mtn: cssColor(['--ck-mtn'], '#6b8199'), snow: cssColor(['--ck-snow'], '#f6f9fc'),
    mtn2: cssColor(['--ck-mtn2'], '#65788d'), sun: cssColor(['--ck-sun'], '#ffd36b'),
  };

  /* ---- 描画器 ---- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cv = renderer.domElement; cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
  container.appendChild(cv);
  const world = new THREE.Scene();
  world.fog = exam ? null : new THREE.Fog(col.skyHz, 1200, 5200);   // 試験の絵に霧は無い

  /* 空: 上から水平線への縦グラデーションの大きな球（霧の影響を受けない） */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(exam ? 150000 : 6000, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: col.skyTop }, hz: { value: col.skyHz }, earth: { value: col.earth }, below: { value: exam ? 1 : 0 } },
    vertexShader: 'varying float vz; void main(){ vz = normalize(position).z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hz; uniform vec3 earth; uniform float below; varying float vz; void main(){ float k = below > 0.5 ? clamp(degrees(asin(clamp(vz, -1.0, 1.0))) / 150.0, 0.0, 1.0) : smoothstep(0.0, 0.45, vz); vec3 c = mix(hz, top, k); if (below > 0.5 && vz < 0.0) c = earth; gl_FragColor = vec4(c, 1.0);' +
      /* 試験の世界は出力の色空間へ直す（地面・山の MeshBasicMaterial と同じ色になり、絵の CSS の色と一致する）。シミュレーター本体の空の見え方は変えない */
      ' vec4 raw = gl_FragColor;\n#include <colorspace_fragment>\n if (below < 0.5) gl_FragColor = raw; }'
  }));
  if (exam) sky.renderOrder = -10;   // 試験の世界: 空の球（水平線より下は地面の色）をいちばん先に描く。後だと地面の目印（不透明）を塗りつぶす
  world.add(sky);
  if (night && !exam) {   // 星（試験の世界は絵と同じ位置の星を下で置く）
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, e = Math.asin(0.05 + rnd() * 0.95), r = 5500; pos.set([r * Math.cos(e) * Math.cos(a), r * Math.cos(e) * Math.sin(a), r * Math.sin(e)], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    world.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe3eaf5, size: 2.2, sizeAttenuation: false, fog: false })));
  }

  /* 光: 昼は明るく、朝夕はやや弱く、夜は暗く */
  /* 夜は月明かりとして青白い光を十分に当てる（暗すぎると見え方の練習にならない）。試験の世界は絵と同じ CSS の色のまま */
  if (night && !exam) { col.earth = col.earth.clone().lerp(new THREE.Color(0x4a5566), 0.5); col.mtn = col.mtn.clone().lerp(new THREE.Color(0x6b7a90), 0.45); }
  const li = night ? 1.2 : dim ? 1.3 : 2.0;
  world.add(new THREE.HemisphereLight(night ? new THREE.Color(0x9fb4d8) : col.skyTop, col.earth, li));
  world.add(new THREE.AmbientLight(night ? 0xb8c4dc : 0xffffff, night ? 0.6 : 0.45));
  const sun = new THREE.DirectionalLight(night ? 0xc9d6f0 : 0xffffff, night ? 0.9 : dim ? 0.9 : 1.2); sun.position.set(dim ? 1 : 0.4, dim ? -0.3 : -0.6, dim ? 0.25 : 1).multiplyScalar(1000); world.add(sun);

  /* 地面（格子つき）と滑走路 */
  const lineCol = hex(col.earth.clone().lerp(new THREE.Color(night ? 0xc0ccdd : 0xffffff), night ? 0.6 : 0.45));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(exam ? 400000 : 10000, exam ? 400000 : 10000), exam ? new THREE.MeshBasicMaterial({ color: col.earth, fog: false, depthWrite: false }) : new THREE.MeshLambertMaterial({ map: gridTexture(hex(col.earth), lineCol) }));
  if (exam) ground.renderOrder = -2;   // 地面と地面の線は奥行きを書かず、いちばん先に描く（遠くで線と地面がちらつかない）
  if (!exam) { ground.material.map.repeat.set(20, 20); ground.material.map.offset.set(0.5, 0.5); }   // 原点が格子の交点に来る（1 枚 500 m。壁 3.3 km の外まで地面がある）
  world.add(ground);
  /* 滑走路は 2 本（2 機ずつ離陸するため）。地上視点の立ち位置あてのレイキャストで使うので、1 つの入れ物にまとめる */
  const runway = new THREE.Group(); world.add(runway);
  const m4 = new THREE.Matrix4();
  if (!exam) {
  const rwMat = new THREE.MeshLambertMaterial({ color: night ? 0x3a3f46 : 0x5d6470 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  RWY_X.forEach(rx => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(48, STRIP_END * 2), rwMat); strip.position.set(rx, 0, 0.3); runway.add(strip);
    const nd = Math.floor(STRIP_END * 2 / 50);
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 24), lineMat, nd);
    for (let i = 0; i < nd; i++) { m4.makeTranslation(rx, -STRIP_END + 25 + i * 50, 0.6); dash.setMatrixAt(i, m4); } runway.add(dash);
    [-STRIP_END - 10, STRIP_END + 10].forEach(y => { const th = new THREE.Mesh(new THREE.PlaneGeometry(48, 14), lineMat); th.position.set(rx, y, 0.6); runway.add(th); });
  });
  /* 誘導路と駐機場（滑走路より少し暗い。中心線は黄色）。駐機場は原点を含む */
  const twMat = new THREE.MeshLambertMaterial({ color: night ? 0x30353b : 0x4b525b });
  const twLine = new THREE.MeshBasicMaterial({ color: 0xe6c84a });
  const pad = (w, h, x, y) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), twMat); p.position.set(x, y, 0.25); runway.add(p); return p; };
  const cl = (w, h, x, y) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), twLine); p.position.set(x, y, 0.5); runway.add(p); };
  pad(24, TAXI_N - TAXI_END + 24, TAXI_X, (TAXI_N + TAXI_END) / 2); cl(0.8, TAXI_N - TAXI_END, TAXI_X, (TAXI_N + TAXI_END) / 2);
  pad(TAXI_X - RWY2 + 24, 24, (TAXI_X + RWY2) / 2, TAXI_S); cl(TAXI_X - RWY2, 0.8, (TAXI_X + RWY2) / 2, TAXI_S);
  pad(TAXI_X - RWY2 + 24, 24, (TAXI_X + RWY2) / 2, TAXI_N); cl(TAXI_X - RWY2, 0.8, (TAXI_X + RWY2) / 2, TAXI_N);   // 北の出口も滑走路 2 まで
  pad(TAXI_X - RWY2 + 24, 24, (TAXI_X + RWY2) / 2, EXIT_Y); cl(TAXI_X - RWY2, 0.8, (TAXI_X + RWY2) / 2, EXIT_Y);   // 中ほどの出口（着陸後はここから）
  pad(240, 300, GROUND_EYE.x + 110, GROUND_EYE.y);                                   // 駐機場（原点の東側、弧を含む）
  STANDS.forEach(sd => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 26), twLine); m.position.set(sd.x, sd.y, 0.5); m.rotation.z = -sd.h * D; runway.add(m); });
  /* 滑走路の標識（空港のもの）: 縁の線、しきい線（ピアノキー）、番号（36R / 36L と 18L / 18R）、接地帯の帯、目標点の太い帯 */
  const wm = (w, h, x, y, rot) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat); p.position.set(x, y, 0.62); if (rot) p.rotation.z = rot; runway.add(p); };
  const rwNumTex = txt => { const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256); g.fillStyle = '#f2f2f2'; g.font = 'bold 150px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const rwNum = (txt, x, y, flip) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: rwNumTex(txt), transparent: true }));
    p.position.set(x, y, 0.62); if (flip) p.rotation.z = Math.PI; runway.add(p); };
  RWY_X.forEach((rx, ri) => {
    wm(0.9, STRIP_END * 2, rx - 23.5, 0); wm(0.9, STRIP_END * 2, rx + 23.5, 0);      // 縁の線
    [-1, 1].forEach(sg => {                                                            // 両端
      const y0 = sg * (STRIP_END - 5);                                                 // しきい線: 4 本ずつ 2 組
      [-19, -14, -9, -4, 4, 9, 14, 19].forEach(dx => wm(1.8, 30, rx + dx, y0 - sg * 15));
      rwNum(sg < 0 ? (ri === 0 ? '36R' : '36L') : (ri === 0 ? '18L' : '18R'), rx, y0 - sg * 50, sg > 0);   // 番号（北向き 360 度 → 36。東が R）
      [150, 450].forEach(dd => { [-1, 1].forEach(sd => { wm(1.8, 22, rx + sd * 12, y0 - sg * dd); wm(1.8, 22, rx + sd * 16, y0 - sg * dd); }); });   // 接地帯
      [-1, 1].forEach(sd => wm(4, 45, rx + sd * 10, y0 - sg * 300));                   // 目標点（太い帯、しきいから 300 m）
    });
  });
  /* 誘導路の縁の線（黄の 2 本）と、滑走路の手前の停止線 */
  const ym = (w, h, x, y) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), twLine); p.position.set(x, y, 0.55); runway.add(p); };
  [-11, 11].forEach(dx => ym(0.5, TAXI_N - TAXI_END, TAXI_X + dx, (TAXI_N + TAXI_END) / 2));
  [-11, 11].forEach(dy => { ym(TAXI_X - RWY2 - 60, 0.5, (TAXI_X + RWY2) / 2 + 30, TAXI_S + dy); ym(TAXI_X - RWY2 - 60, 0.5, (TAXI_X + RWY2) / 2 + 30, TAXI_N + dy); ym(TAXI_X - RWY2 - 60, 0.5, (TAXI_X + RWY2) / 2 + 30, EXIT_Y + dy); });
  RWY_X.forEach(rx => { [TAXI_S, TAXI_N].forEach(yy => { ym(1.2, 24, rx + 34, yy); ym(1.2, 24, rx + 36.5, yy); }); });   // 停止線（滑走路の縁から 10 m 東）
  /* 灯火: 滑走路の縁（白）、しきい（緑）と末端（赤）、進入灯（南、白の列と横棒）、誘導路の縁（青）と中心線（緑）。
     夜は明るく、昼は控えめに。点（Points）で描く */
  {
    const pos = [], col = [];
    const L = (x, y, c, z = 0.6) => { pos.push(x, y, z); col.push(c[0], c[1], c[2]); };
    const W = [1, 0.95, 0.85], G = [0.2, 1, 0.4], R = [1, 0.25, 0.2], B = [0.35, 0.55, 1], Y = [1, 0.85, 0.3];
    RWY_X.forEach(rx => {
      for (let y = -STRIP_END; y <= STRIP_END; y += 60) { L(rx - 27, y, W); L(rx + 27, y, W); }   // 縁
      for (let x = -22; x <= 22; x += 4) { L(rx + x, -STRIP_END - 12, G); L(rx + x, STRIP_END + 12, R); }   // しきい（南）と末端（北）
      for (let y = -STRIP_END - 30; y >= -STRIP_END - 600; y -= 30) { L(rx, y, W); if ((y + STRIP_END) % 150 === 0) for (let x = -15; x <= 15; x += 5) if (x) L(rx + x, y, W); }   // 進入灯（中心の列と横棒）
    });
    for (let y = TAXI_END; y <= TAXI_N; y += 30) { L(TAXI_X - 14, y, B); L(TAXI_X + 14, y, B); }
    for (let y = TAXI_END; y <= TAXI_N; y += 15) L(TAXI_X, y, G);
    for (let x = RWY2 + 30; x < TAXI_X; x += 30) { L(x, TAXI_S - 14, B); L(x, TAXI_S + 14, B); L(x, TAXI_S, G); }
    for (let x = RWY2 + 30; x < TAXI_X; x += 30) { L(x, TAXI_N - 14, B); L(x, TAXI_N + 14, B); L(x, TAXI_N, G); L(x, EXIT_Y - 14, B); L(x, EXIT_Y + 14, B); L(x, EXIT_Y, G); }
    STANDS.forEach(sd => L(sd.x, sd.y + 14, Y));                                           // 駐機の目印
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lc = document.createElement('canvas'); lc.width = lc.height = 32; const lgc = lc.getContext('2d');
    const grd = lgc.createRadialGradient(16, 16, 0, 16, 16, 16); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    lgc.fillStyle = grd; lgc.fillRect(0, 0, 32, 32);
    const ltex = new THREE.CanvasTexture(lc);
    const lm = new THREE.PointsMaterial({ size: night ? 3.2 : 1.6, map: ltex, vertexColors: true, transparent: true, opacity: night ? 1 : 0.7, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending });
    const lights = new THREE.Points(lg, lm); lights.frustumCulled = false; world.add(lights);
  }
  }   // !exam（空港）

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
  /* 山は空港と、滑走路の延長線（離陸・着陸の通り道）には置かない。
     空港の箱: x −180〜420、y −720〜720（滑走路 1・2、誘導路、駐機場）。通り道: x −180〜60、y ±4500。
     以前は正面左の雪山（−260, 320, 半径 260）が滑走路 2 の北半分に掛かり、遠景の環の 1 つ（南、270 度）が
     着陸の延長線上（x ≒ 0、y ≒ −2500）にあって、進入中の機が「山を越えます」で 200 → 395 m へ持ち上がった（実測） */
  const hitsRect = (x, y, r, x0, y0, x1, y1) => { const cx = Math.max(x0, Math.min(x1, x)), cy = Math.max(y0, Math.min(y1, y)); return (x - cx) ** 2 + (y - cy) ** 2 < r * r; };
  const hitsAirport = (x, y, r) => hitsRect(x, y, r, -180, -720, 420, 720) || hitsRect(x, y, r, -180, -4500, 60, 4500);
  const mountain = (x, y, hgt, rad, snow) => {
    if (hitsAirport(x, y, rad)) return;
    obst.push({ x, y, r: rad, h: hgt, flat: false });
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, hgt, 8), mtnMat); m.rotation.x = Math.PI / 2; m.position.set(x, y, hgt / 2); props.add(m);
    if (snow) { const s = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.28, hgt * 0.28, 8), snowMat); s.rotation.x = Math.PI / 2; s.position.set(x, y, hgt - hgt * 0.14); props.add(s); }
  };
  const c3 = new THREE.Color(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  if (!exam) {
  mountain(-700, 420, 420, 260, true);                     // 正面左の雪山（v04.20: −260, 320 から西へ。滑走路 2 に掛かっていた）
  mountain(-520, 760, 300, 220, false); mountain(420, 1060, 340, 240, true); mountain(760, 560, 260, 200, false);   // v04.20: 北の雪山と東の山も通り道・空港から外へ
  /* 空間の中の山は 8 つ（12 から減らした。多すぎて見え方の目印が埋もれる、との利用者の指摘）。遠景の環も 24 → 16 */
  [[-900, -300], [900, -100], [-700, 1100], [800, 1150], [1100, 800], [-500, -1000], [1150, -1150], [-1250, 100]]
    .forEach(([x, y], i) => mountain(x, y, 180 + (i % 4) * 60, 140 + (i % 3) * 50, i % 4 === 3));
  for (let i = 0; i < 16; i++) {                            // 遠景の環（壁の外。壁を 3.3 km に広げたので 3.9〜4.4 km へ、2026-09-13）
    const a = i / 16 * Math.PI * 2 + rnd() * 0.2, r = 3900 + rnd() * 500, hgt = 400 + rnd() * 500;
    mountain(r * Math.cos(a), r * Math.sin(a), hgt, 300 + rnd() * 300, hgt > 650);
  }

  /* 民家・木・塔（インスタンス描画）。滑走路の帯は空ける */
  const free = (x, y) => !(Math.abs(y) < STRIP_END + 90 && RWY_X.some(rx => Math.abs(x - rx) < 90))
    && !(x > -30 && x < TAXI_X + 40 && y > TAXI_END - 40 && y < TAXI_N + 40)      // 基地（駐機場・誘導路・原点のまわり）
    && !(y > TAXI_S - 30 && y < TAXI_S + 30 && x > RWY2 - 30 && x < TAXI_X + 30);   // 南の取り付け
  const pick = () => { for (;;) { const x = -SHOW_LIMIT + 60 + rnd() * (SHOW_LIMIT * 2 - 120), y = -SHOW_LIMIT + 60 + rnd() * (SHOW_LIMIT * 2 - 120); if (free(x, y)) return [x, y]; } };   // 見え方を学ぶので近くに（もとの壁の内側）
  const NH = 260, houses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), NH);
  const roofGeo = new THREE.ConeGeometry(1, 1, 4); roofGeo.rotateX(Math.PI / 2); roofGeo.rotateZ(Math.PI / 4);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial(), NH);
  const wallCols = [0xf1e9d6, 0xe8dcc4, 0xd9d3c7, 0xf5f1e8, 0xcfd6dd], roofCols = [0xb5443a, 0x3f5f8f, 0x6b4a36, 0x4d6b45, 0x8a3b3b];
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
  } else {
    /* ===== 試験の絵の景色（engine.js の svgCockpit と同じ世界） =====
       絵は 1 度 = 6 px（CK.kp = CK.ky = 6）。方位 = x/6 度（機首の向きが 0）、高さ = px/6 度（水平線から）。
       **世界の中心は始めの位置（START の真下）**。方位と角度はそこの目（高度 EXAM_H = 1,000 m）から測る。距離は下の値の EXAM_K（15）倍。
       山・塔の根元と水平線は**目の高さ**に置く: 絵では根元が水平線（仰角 0°）にあるが、地面に置くと 3〜6 km 先で約 1° 沈む（実測 6 px 下）。
       v05.11 まで、環は原点（目から 450 m 北）を中心にしていて方位が最大 6° ずれ、根元と水平線も 1° 沈んでいた
       ・山並み: 絵の稜線（PEAKS 30 個を結んだ折れ線、方位 −150°〜+150°、高さ 3〜12°）をそのまま 4 km の円筒に（v05.11 は円錐の並びで谷が水平線まで落ちていた）
       ・雪山: 絵の三角（方位 −21.7°〜−8.3°、頂 −15° で 12°）と雪の四角形、3 km。色は --ck-mtn2 と --ck-snow
       ・塔: 絵の柱（方位 +38°〜+38.7°、高さ 6.7°）と赤い頭、2.5 km
       ・太陽: 方位 +18.3°（110 px）、仰角 16°（96 px）、半径 2.5°（15 px）。5.5 km 先（空の球の内側）
       ・地面の格子: 真上から見て正方形（WORLD.gap m おき）。遠近で消失点へ向かって見える
       ・水平線: 白い線（絵の opacity .8、太さ 1.5 px ＝ 0.25°）。目の高さの帯（円筒）。絵では山の根元の上に引くので、山より手前の 2.4 km に
       ・空: 絵と同じ縦のグラデーション（水平線の色 → 仰角 150° で上の色）。星は夜だけ、絵と同じ 70 個
       ・地面は光を当てない平らな色、水平線より下で地面の板の外は空の球が地面の色（絵は水平線から下が全部地面）
       滑走路・民家・木・空港の山・灯火は置かない（試験の絵に無い） */
    const WD = globalThis.AAT_FLIGHT.WORLD, H0 = WD.H, K = EXAM_K, PX = v => v / 6 * D;   // H0: 目の高さ（1,000 m）。K: 遠さの倍率。PX: px → ラジアン
    const ex = new THREE.Group(); ex.position.set(START.x, START.y, 0); props.add(ex);   // 世界の中心＝始めの位置の真下
    /* 絵の図形（px の多角形）を、目から R 離れた円筒に巻いて置く。x px → 方位 x/6°、y px → 仰角 −y/6°（高さ H0 + R·tan）。
       光を当てない平らな色（絵と同じ）。横に長い図形は 10 px ごとに縦に刻む（弦が円筒の内側を通って角度がずれないように） */
    const flat = c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
    const at = (R, x, y) => { const az = PX(x); return [R * Math.sin(az), R * Math.cos(az), H0 + R * Math.tan(PX(-y))]; };
    const wall = (R, pts, mat) => {   // pts: 絵の座標の多角形（凸でなくてよい）
      const tri = THREE.ShapeUtils.triangulateShape(pts.map(q => new THREE.Vector2(q[0], q[1])), []);
      const pos = []; tri.forEach(t => t.forEach(i => pos.push(...at(R, pts[i][0], pts[i][1]))));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ex.add(new THREE.Mesh(g, mat));
    };
    const ridge = (R, line, mat) => {   // line: 左から右への稜線（y ≤ 0）。下は水平線（y = 0）まで
      const yAt = x => { for (let i = 1; i < line.length; i++) if (x <= line[i][0]) { const a = line[i - 1], b = line[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return 0; };
      const pos = [];
      for (let x = line[0][0]; x < line[line.length - 1][0]; x += 10) { const x2 = x + 10, y1 = yAt(x), y2 = yAt(x2);
        pos.push(...at(R, x, 0), ...at(R, x2, 0), ...at(R, x2, y2), ...at(R, x, 0), ...at(R, x2, y2), ...at(R, x, y1)); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ex.add(new THREE.Mesh(g, mat));
    };
    /* 山並み（絵の mtn: M-900,0 → PEAKS → 900,0）。4 km */
    ridge(4000 * K, [[-900, 0], ...WD.peaks.map((v, i) => [-870 + i * 60, -v]), [900, 0]], flat(col.mtn));
    /* 雪山（絵: −130,0 / −90,−72 / −50,0、雪は −100,−54 / −90,−72 / −80,−54 / −90,−58）。3 km。雪は山のすぐ手前 */
    wall(3000 * K, WD.snow.tri, flat(col.mtn2));
    wall(2990 * K, WD.snow.cap, flat(col.snow));
    /* 塔（絵: 柱 228〜232 × −40〜0、頭 220〜240 × −46〜−38）。2.5 km。頭は柱のすぐ手前 */
    wall(2500 * K, WD.tower.post, flat(0x2b333c));
    wall(2490 * K, WD.tower.cap, flat(0xe2574f));
    { const [x, y, z] = at(2500 * K, 230, -46); obst.push({ x: START.x + x, y: START.y + y, r: 2500 * K * Math.tan(PX(10)), h: z, flat: true }); }
    /* 星（夜だけ。絵の STARS と同じ乱数で同じ 70 個: cx −600〜600、cy −40〜−340、半径 0.8〜2.2 px） */
    if (night) { const pos = [];
      for (const sIt of WD.stars) { const az = PX(sIt.x), el = PX(-sIt.y); pos.push(5400 * K * Math.sin(az) * Math.cos(el), 5400 * K * Math.cos(az) * Math.cos(el), H0 + 5400 * K * Math.sin(el)); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      ex.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe3eaf5, size: 2.4, sizeAttenuation: false, fog: false }))); }
    { const R = 5500 * K, az = PX(WD.sun.x), el = PX(-WD.sun.y);   // 太陽
      const sun = new THREE.Mesh(new THREE.SphereGeometry(R * Math.tan(PX(15)), 24, 12), new THREE.MeshBasicMaterial({ color: col.sun, fog: false }));
      sun.position.set(R * Math.sin(az) * Math.cos(el), R * Math.cos(az) * Math.cos(el), H0 + R * Math.sin(el)); ex.add(sun); }
    { /* 地面の格子: 真上から見て正方形（東西・南北の線を gap m おき）。出題の絵と同じ細い線（画面で 1 px） */
      const G = WD.gap, R = WD.gridR, pos = [];
      for (let v = -R; v <= R; v += G) { pos.push(v, -R, 0, v, R, 0, -R, v, 0, R, v, 0); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false, fog: false }));
      l.renderOrder = -1; ex.add(l); }
    /* 地面の目印（畑・湖・道・集落）: 出題の絵（svgCockpit）と同じ位置・同じ色の平らな多角形 */
    WD.ground.forEach(gd => { const sh = new THREE.Shape(gd.pts.map(p => new THREE.Vector2(p[0], p[1])));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: cssColor(['--ck-' + gd.c], WD.colors[gd.c]), fog: false, depthWrite: false }));
      m.position.z = 0.4; m.renderOrder = -1; ex.add(m); });
    { const R = 2400 * K, hz = new THREE.Mesh(new THREE.CylinderGeometry(R, R, R * Math.tan(PX(1.5)), 128, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, fog: false, side: THREE.DoubleSide }));   // 水平線
      hz.rotation.x = Math.PI / 2; hz.position.z = H0; ex.add(hz); }
  }

  /* 機体（三人称のときだけ表示）と、高度の手がかり（地面の影と垂線） */
  const plane = new THREE.Group(); world.add(plane);
  /* 舵で加わっている回転の向きの矢印（「動きで見る」の三人称。利用者の指示 2026-09-13）。機体の軸まわりの弧に矢じり。
     ロール（機首の軸まわり、橙）・ピッチ（翼の軸まわり、緑）・ヨー（上下軸まわり、青）。逆向きは弧を鏡に映す。
     機体の入れ物 plane の子なので、機体といっしょに動く。setForces({ roll, pitch, yaw }) で ±1／0 */
  const forceArrows = new THREE.Group(); forceArrows.visible = false; plane.add(forceArrows);
  /* 弧の長さは、その区間で実際に回る角度に合わせる（v06.14、利用者の指示 2026-09-22「そんなに曲がらない。角度に応じて長さを変えて。動きで見るも同じ」）。
     setForces({ roll, pitch, yaw }) の値は ±度（大きさが回る角度）。±1 だけなら従来の長さ。角度ごとの弧は作って控える（5° 刻み） */
  const arrows = {}, arrowCache = { roll: {}, pitch: {}, yaw: {} };
  const ARC = {   /* 中心の角度・従来の幅・座標の式・鏡の軸 */
    roll: { color: 0xff8a3d, c: 82.5, w: 135, dir: -1, f: a => [6.5 * Math.cos(a), -1.5, 6.5 * Math.sin(a)], mirror: 'x' },   // 右ロール: 上を越えて右翼が下がる向き（角度は減る向きに進む）
    pitch: { color: 0x7cf59a, c: 2.5, w: 75, dir: 1, f: a => [0, 9 * Math.cos(a), 9 * Math.sin(a)], mirror: 'z' },              // 機首上げ: 機首の先で上へ
    yaw: { color: 0x4fc3f7, c: 0, w: 70, dir: 1, f: a => [9 * Math.sin(a), 9 * Math.cos(a), 0], mirror: 'x' }                    // 右ヨー: 機首の先で右へ
  };
  const mkArrow = (color, pts, mirror) => {
    const g = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    const mat = new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.18, 8, false), mat));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 12), mat);
    const end = curve.getPoint(1), tan = curve.getTangent(1);
    cone.position.copy(end).addScaledVector(tan, 0.7);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
    g.add(cone);
    const pos = g, neg = g.clone(); neg.scale[mirror] = -1;   // 逆向きは鏡（回転では向きの意味が変わらない）
    pos.visible = neg.visible = false; forceArrows.add(pos, neg);
    return { pos, neg }; };
  const arrowFor = (k, span) => {
    const key = Math.round(Math.max(8, Math.min(180, span)) / 5) * 5;
    if (arrowCache[k][key]) return arrowCache[k][key];
    const A = ARC[k], a0 = A.c - A.dir * key / 2, a1 = A.c + A.dir * key / 2, pts = [];
    for (let i = 0; i <= 16; i++) pts.push(A.f((a0 + (a1 - a0) * i / 16) * D));
    return (arrowCache[k][key] = mkArrow(A.color, pts, A.mirror));
  };
  for (const k of ['roll', 'pitch', 'yaw']) arrows[k] = arrowFor(k, ARC[k].w);
  /* 操縦席の部品。座標はモデル座標 ×k（k = 13/全長）で書き、読み込み後に GLB と同じ平行移動（eyeOff）を掛ける。
     目安（この座標系）: 風防の上端 z≈0.43、前席の背もたれ上端 z≈0.32、前席 y≈2.4〜3.5、風防の前端 y≈3.55、床 z≈-0.97。
     モデルには座席と風防しかないので、計器盤・グレアシールド・操縦桿・方向舵ペダルを自作する。目は前席の後ろ寄り・背もたれの少し上 */
  /* 目の高さは HUD のガラス板（コンバイナ）の中心と同じにする（利用者の指示 2026-09-13:
     「頭の位置が高くキャノピーと重なっている。ちゃんと座っているように。現実の視点はもう少し低い」
     「適切な高さは、視点とガラス板の HUD の高さが同じになるくらい」）。以前の 0.30 は背もたれの上端で、
     計器盤とグレアシールドを上から見下ろす形だった */
  const EYE = new THREE.Vector3(0, 2.55, -0.03), eyeOff = new THREE.Vector3(), seatMeshes = [];
  const cockpit = new THREE.Group(); plane.add(cockpit);
  /* HUD はガラス板（コンバイナ）に映す（利用者の指示 2026-09-13「現実では、コックピット視点は、HUD はガラス板に反映される」）。
     グレアシールドの上、風防の手前に置いた板に、姿勢に合わせて描き直す絵（CanvasTexture）を貼る。
     記号の位置は「目からその方向を見たときのガラス上の点」= 距離 HUD_L × tan(角度)。目の位置が固定なので、
     水平線の記号は外の水平線と重なる（コリメート）。板は機体に付いているので、見回すと視界から外れる（実機と同じ）。
     一人称のカメラは手前 1.1 m で切っているため、板（目から 0.75 m）は世界の描画では消える。
     そこで世界を描いたあと、手前 0.05 m のカメラで板だけを重ねて描く（drawHud / render の 2 段目） */
  const HUD_POS = new THREE.Vector3(0, 3.40, -0.03), HUD_W = 0.21, HUD_H = 0.165, HUD_L = HUD_POS.y - EYE.y;
  const HUD_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);   // 板の面を操縦者（−y 側）へ向ける。板の上（+y）は機体の上（+z）
  const hudCanvas = document.createElement('canvas'); hudCanvas.width = 768; hudCanvas.height = Math.round(768 * HUD_H / HUD_W);   // 視認性のため大きく（利用者の指示 2026-09-13）
  const hudCtx = hudCanvas.getContext('2d'), hudTex = new THREE.CanvasTexture(hudCanvas);
  hudTex.colorSpace = THREE.SRGBColorSpace;
  const hudScene = new THREE.Scene(), hudCam = new THREE.PerspectiveCamera(68, 1, 0.05, 8);
  const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W * 1.06, HUD_H * 1.06),
    new THREE.MeshBasicMaterial({ color: 0x9ad7ff, transparent: true, opacity: 0.06, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  const hudFrame = new THREE.LineSegments(new THREE.EdgesGeometry(hudGlass.geometry), new THREE.LineBasicMaterial({ color: 0x20262e, transparent: true, opacity: 0.9, depthTest: false }));
  const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H),
    new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  hudGlass.renderOrder = 0; hudFrame.renderOrder = 1; hudMesh.renderOrder = 2;
  hudScene.add(hudGlass); hudScene.add(hudFrame); hudScene.add(hudMesh);
  let hudOn = false;
  const hudV1 = new THREE.Vector3(), hudV2 = new THREE.Vector3(), hudV3 = new THREE.Vector3(), hudTmp = new THREE.Vector3();
  /* 乗っている機体の姿勢（四元数から）。1 番機は st と同じ値になる。2 番機以降に乗ったとき、計器が 1 番機の姿勢を
     指していた（総点検 2026-09-13 の指摘）ので、HUD は乗っている機体の姿勢で描く */
  function attOfQ(q) {
    hudV1.copy(AY).applyQuaternion(q); hudV2.copy(AZ).applyQuaternion(q); hudV3.copy(AX).applyQuaternion(q);
    return { h: ((Math.atan2(hudV1.x, hudV1.y) / D) % 360 + 360) % 360, p: Math.asin(clamp(hudV1.z, -1, 1)) / D, b: Math.atan2(-hudV3.dot(WUP), hudV2.dot(WUP)) / D };
  }
  /* HUD の絵。実機の HUD にならう: 細い緑の線に淡いにじみ、ピッチの梯子（上は実線、下は点線、端は水平線側へ折れる）、
     機体マーク（水平線の基準）、上に方位の帯（目盛りと枡の数字）、左に速度（kt）・右に高度（m）の枡、下にバンクの弧と指標 */
  function drawHud(b, p, h, alt, kt) {
    const c = hudCtx, W = hudCanvas.width, H = hudCanvas.height, cx = W / 2, cy = H / 2;
    const pxDeg = (W / HUD_W) * HUD_L * Math.tan(D);        // 1 度ぶんの画素（ガラスの距離で見た角度）
    const G = '#c8ffb0', mono = 'ui-monospace, Menlo, Consolas, monospace';
    c.clearRect(0, 0, W, H);
    c.strokeStyle = c.fillStyle = G; c.lineWidth = 4.5; c.lineCap = 'round'; c.lineJoin = 'round'; c.textBaseline = 'middle';
    c.shadowColor = 'rgba(140,255,150,0.9)'; c.shadowBlur = 10;
    /* ピッチの梯子（世界に固定） */
    c.save(); c.beginPath(); c.rect(0, 90, W, H - 170); c.clip();
    c.translate(cx, cy); c.rotate(-b * D); c.translate(0, p * pxDeg);
    for (let deg = -40; deg <= 40; deg += 5) {
      const y = -deg * pxDeg; if (Math.abs(y + p * pxDeg) > H) continue;
      if (deg === 0) { c.setLineDash([]); c.beginPath(); c.moveTo(-W * 0.46, 0); c.lineTo(-70, 0); c.moveTo(70, 0); c.lineTo(W * 0.46, 0); c.stroke(); continue; }
      const w = deg % 10 === 0 ? 110 : 60, t = deg > 0 ? 14 : -14;          // 端の折れは水平線の側へ
      c.setLineDash(deg < 0 ? [12, 10] : []);
      c.beginPath(); c.moveTo(-w - 70, y + t); c.lineTo(-w - 70, y); c.lineTo(-70, y); c.moveTo(70, y); c.lineTo(w + 70, y); c.lineTo(w + 70, y + t); c.stroke();
      if (deg % 10 === 0) { c.setLineDash([]); c.font = `bold 40px ${mono}`; c.textAlign = 'right'; c.fillText(String(Math.abs(deg)), -w - 84, y); c.textAlign = 'left'; c.fillText(String(Math.abs(deg)), w + 80, y); }
    }
    c.restore();
    c.setLineDash([]);
    /* 機体マーク（ガラスに固定）: 中央の円と翼、上の小さな垂直尾翼 */
    c.beginPath(); c.arc(cx, cy, 9, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(cx - 50, cy); c.lineTo(cx - 12, cy); c.moveTo(cx + 12, cy); c.lineTo(cx + 50, cy); c.moveTo(cx, cy - 12); c.lineTo(cx, cy - 26); c.stroke();
    /* 方位の帯（上）: 5 度ごとの目盛り、10 度ごとに数字、中央に枡の方位 */
    { const y0 = 58, span = 32, k = 10;    // 帯の半分の幅（度）、1 度あたりの画素
      c.save(); c.beginPath(); c.rect(cx - span * k, 10, 2 * span * k, 90); c.clip();
      c.font = `bold 32px ${mono}`; c.textAlign = 'center';
      const h0 = Math.round(h / 5) * 5;
      for (let d = h0 - span - 5; d <= h0 + span + 5; d += 5) {
        const x = cx + (d - h) * k, big = d % 10 === 0;
        c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 - (big ? 18 : 9)); c.stroke();
        if (big) c.fillText(String(((d % 360) + 360) % 360 / 10).padStart(2, '0'), x, y0 - 40);
      }
      c.restore();
      c.beginPath(); c.moveTo(cx - span * k, y0); c.lineTo(cx + span * k, y0); c.stroke();
      c.beginPath(); c.moveTo(cx, y0 + 3); c.lineTo(cx - 10, y0 + 17); c.lineTo(cx + 10, y0 + 17); c.closePath(); c.stroke();
      c.font = `bold 40px ${mono}`; c.textAlign = 'center';
      c.strokeRect(cx - 62, y0 + 20, 124, 52); c.fillText(String(Math.round(h) % 360).padStart(3, '0'), cx, y0 + 46); }
    /* 速度（左）と高度（右）の枡 */
    c.font = `bold 44px ${mono}`;
    c.textAlign = 'right'; c.strokeRect(20, cy - 32, 150, 64); c.fillText(String(Math.round(kt)), 160, cy);
    c.font = `24px ${mono}`; c.textAlign = 'left'; c.fillText('KT', 24, cy - 50);
    c.font = `bold 44px ${mono}`; c.textAlign = 'right'; c.strokeRect(W - 190, cy - 32, 170, 64); c.fillText(String(Math.max(0, Math.round(alt))), W - 30, cy);
    c.font = `24px ${mono}`; c.textAlign = 'right'; c.fillText('ALT m', W - 26, cy - 50);
    /* バンクの弧（下）: 0・10・20・30・45・60 の目盛りと、傾きに合わせて回る指標 */
    { const r = H * 0.62, oy = cy + r * 0.28 + 14;
      for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const t = (90 + a) * D, l = a % 30 === 0 ? 18 : 10;
        c.beginPath(); c.moveTo(cx + Math.cos(t) * r, oy - 0 + Math.sin(t) * r - r); c.lineTo(cx + Math.cos(t) * (r + l), oy + Math.sin(t) * (r + l) - r); c.stroke(); }
      const t = (90 - b) * D; c.beginPath(); c.moveTo(cx + Math.cos(t) * (r - 6), oy + Math.sin(t) * (r - 6) - r); c.lineTo(cx + Math.cos(t) * (r - 24) - 9 * Math.sin(t), oy + Math.sin(t) * (r - 24) - r + 9 * Math.cos(t)); c.lineTo(cx + Math.cos(t) * (r - 24) + 9 * Math.sin(t), oy + Math.sin(t) * (r - 24) - r - 9 * Math.cos(t)); c.closePath(); c.stroke(); }
    c.shadowBlur = 0;
    hudTex.needsUpdate = true;
  }
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b2027 }), mid = new THREE.MeshLambertMaterial({ color: 0x2e3640 }), grip_m = new THREE.MeshLambertMaterial({ color: 0x14171b }), metal = new THREE.MeshLambertMaterial({ color: 0x8a939e });
  const red_m = new THREE.MeshLambertMaterial({ color: 0xc0392b });
  const lamp = new THREE.PointLight(0xffe2b8, 0.9, 2.5); lamp.position.set(0, 2.9, 0.3); cockpit.add(lamp);   // 操縦席の灯り（夜でも部品が見える）
  /* 一人称のカメラは手前 1.1 m を切っている（目の前の機体内部が画面を塞ぐのを防ぐため）。
     操縦桿や計器盤は目から 0.5〜0.9 m の近さなので、そのままでは映らない。
     そこで内装は別の場面（overlay）に置き、近くまで写るカメラ（oCam）で本編の上に重ねて描く */
  const overlay = new THREE.Scene();
  overlay.add(new THREE.HemisphereLight(0xffffff, 0x5a6675, 2.2));
  const oDir = new THREE.DirectionalLight(0xffffff, 1.0); oDir.position.set(-0.4, 1, 0.9); overlay.add(oDir);
  const oCam = new THREE.PerspectiveCamera(68, 1, 0.03, 6);
  const stickHolder = new THREE.Group(); stickHolder.matrixAutoUpdate = false; overlay.add(stickHolder);
  /* 操縦席の内装（利用者の指示 2026-09-13「視点の位置を変えたときに、とってつけたような計器や操縦桿に不自然さが生じる。
     コックピットの内装もリアリティを高める」。参考: 実機の前席の写真。比率・高さ・配置をそれに合わせる）。
     目の位置 EYE（z −0.03）を基準に、
       グレアシールドの上端 −0.13（目の 10 cm 下、目から 0.7〜0.9 m 前）、計器盤はその下に 15° 起こして置き、
       HUD のガラス板はグレアシールドの中央の上に立てて、中心を目の高さに合わせる、
       操縦桿は床（−0.97）から立ち、握りの上端は目の 22 cm 下（膝の上あたり）、
       方向舵のペダルは床の前方、左右のコンソール（左にスロットル）は腰の高さ。
     計器盤の絵は写真の配置にならって描く（左に速度計・姿勢指示器・高度計、その下に方位指示器、右にエンジン計器の列、
     中央上に警報灯の板）。姿勢指示器と方位指示器は毎コマ描き直す（本物の計器として動く）。
     ここに置くものは全部 stickHolder（overlay の場面。手前 0.03 m まで写るカメラで本編の上に重ねて描く）に入れる。
     一人称のカメラは手前 1.1 m で切るので、目から 0.6〜0.8 m の内装は本編では消えてしまうため */
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, 3.06, -0.90);   // 床の少し上。握りが膝の上に来る（目の 0.5 m 前、0.3 m 下）
  stickHolder.add(stickPivot);
  const oLamp = new THREE.PointLight(0xffe2b8, 1.1, 2.5); oLamp.position.set(0.2, 2.75, 0.1); stickHolder.add(oLamp);
  {
    const sMat = new THREE.MeshLambertMaterial({ color: 0x3a444f }), gMat = new THREE.MeshLambertMaterial({ color: 0x252c35 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.020, 0.40, 12), sMat);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.20;            // 円柱は既定で y 方向なので立てる
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.052, 0.13), gMat);
    grip.position.set(0, -0.006, 0.465);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), gMat);
    top.position.set(0, -0.006, 0.535);
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.010, 0.016), red_m);
    btn.position.set(-0.012, -0.033, 0.49);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.022, 0.03), gMat);   // 引き金（握りの前）
    trig.position.set(0, 0.026, 0.43);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.062, 0.04, 14), dark);
    base.rotation.x = Math.PI / 2; base.position.z = 0.02;
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.10, 14), grip_m);   // 根元の蛇腹カバー
    boot.rotation.x = Math.PI / 2; boot.position.z = 0.07;
    stickPivot.add(shaft, grip, top, btn, trig, base, boot);
  }
  const panelMat = { base: new THREE.MeshLambertMaterial({ color: 0x23272c }), hood: new THREE.MeshLambertMaterial({ color: 0x1c1f23 }), console: new THREE.MeshLambertMaterial({ color: 0x2a2e33 }) };
  const PANEL_W = 0.66, PANEL_H = 0.40, PANEL_TILT = 15 * D;   // 計器盤の幅・高さ・起こす角
  const panelCv = document.createElement('canvas'); panelCv.width = 1024; panelCv.height = Math.round(1024 * PANEL_H / PANEL_W);
  const panelTex = new THREE.CanvasTexture(panelCv); panelTex.colorSpace = THREE.SRGBColorSpace; panelTex.anisotropy = 8;
  /* 計器は「飛ぶのに要る情報」だけ（利用者の指示 2026-09-13「意味のあるものである必要がある。意味のないものは省き、シンプルに」）。
     基本 T 配置: 上段 左 速度計・中 姿勢指示器・右 高度計、下段 左 脚の灯・中 方位指示器・右 昇降計。
     全部が毎コマ、乗っている機体の値で動く。飾りの計器は置かない。
     u,v は計器盤の上の位置（0〜1、左上が原点）、r は計器盤の幅に対する半径 */
  const DIALS = [
    { id: 'asi', u: 0.20, v: 0.36, r: 0.105 }, { id: 'ai', u: 0.50, v: 0.36, r: 0.135 }, { id: 'alt', u: 0.80, v: 0.36, r: 0.105 },
    { id: 'gear', u: 0.20, v: 0.77, r: 0.085 }, { id: 'hi', u: 0.50, v: 0.77, r: 0.115 }, { id: 'vvi', u: 0.80, v: 0.77, r: 0.09 } ];
  const dialCv = {}, dialTex = {};
  DIALS.forEach(d => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; dialCv[d.id] = cv;
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; dialTex[d.id] = t; });
  /* 丸い計器の共通の顔: 黒い文字盤・暗いベゼル・目盛りと数字 */
  function dialFace(g, opt) {
    const S = 256, c = S / 2;
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#0a0b0d'; g.beginPath(); g.arc(c, c, c - 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e9ecef'; g.fillStyle = '#e9ecef'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = opt.n, a0 = opt.a0 * D, a1 = opt.a1 * D;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, big = i % opt.every === 0, l = big ? 22 : 12;
      g.lineWidth = big ? 3 : 1.5;
      g.beginPath(); g.moveTo(c + Math.cos(a) * (c - 16), c + Math.sin(a) * (c - 16)); g.lineTo(c + Math.cos(a) * (c - 16 - l), c + Math.sin(a) * (c - 16 - l)); g.stroke();
      if (big && opt.label) { g.font = 'bold 22px ui-monospace, Menlo, monospace'; g.fillText(opt.label(i), c + Math.cos(a) * (c - 62), c + Math.sin(a) * (c - 62)); }
    }
    if (opt.title) { g.font = '16px ui-monospace, Menlo, monospace'; g.fillStyle = '#aeb4bb'; g.fillText(opt.title, c, c + 58); }
  }
  function needle(g, frac, opt, len, w, color) {
    const S = 256, c = S / 2, a = (opt.a0 + (opt.a1 - opt.a0) * clamp(frac, 0, 1)) * D;
    g.strokeStyle = color || '#f6f6f6'; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(c - Math.cos(a) * 18, c - Math.sin(a) * 18); g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len); g.stroke();
    g.fillStyle = '#d0d3d7'; g.beginPath(); g.arc(c, c, 9, 0, Math.PI * 2); g.fill();
  }
  const bezel = g => { g.lineWidth = 10; g.strokeStyle = '#2b2f34'; g.beginPath(); g.arc(128, 128, 123, 0, Math.PI * 2); g.stroke(); };
  const ASI_OPT = { n: 30, a0: 120, a1: 420, every: 5, label: i => String(i * 10), title: 'KNOTS' };       // 0〜300 kt
  const ALT_OPT = { n: 50, a0: -90, a1: 270, every: 5, label: i => String(i / 5), title: 'ALT x100 m' };    // 1 周 1,000 m
  const VVI_OPT = { n: 20, a0: 180, a1: 520, every: 5, label: i => String(Math.abs(i - 10) * 2), title: 'm/s' }; // -20〜+20 m/s、0 が左
  function drawASI(kt) { const g = dialCv.asi.getContext('2d'); dialFace(g, ASI_OPT); needle(g, kt / 300, ASI_OPT, 96, 5); bezel(g); dialTex.asi.needsUpdate = true; }
  function drawALT(m) { const g = dialCv.alt.getContext('2d'); dialFace(g, ALT_OPT);
    g.fillStyle = '#15181c'; g.fillRect(84, 150, 88, 26); g.fillStyle = '#e9ecef'; g.font = 'bold 20px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${Math.max(0, Math.round(m))} m`, 128, 163);
    needle(g, (Math.max(0, m) % 1000) / 1000, ALT_OPT, 96, 5); needle(g, Math.max(0, m) / 10000, ALT_OPT, 60, 8, '#dfe3e8'); bezel(g); dialTex.alt.needsUpdate = true; }
  function drawVVI(vs) { const g = dialCv.vvi.getContext('2d'); dialFace(g, VVI_OPT); needle(g, (clamp(vs, -20, 20) + 20) / 40, VVI_OPT, 96, 5); bezel(g); dialTex.vvi.needsUpdate = true; }
  function drawGearLamps(down) { const g = dialCv.gear.getContext('2d'), S = 256; g.clearRect(0, 0, S, S);
    g.fillStyle = '#15181c'; g.fillRect(16, 16, S - 32, S - 32);
    g.fillStyle = '#aeb4bb'; g.font = 'bold 22px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GEAR', S / 2, 52);
    for (const [x, y] of [[S / 2, 118], [S / 2 - 62, 178], [S / 2 + 62, 178]]) {   // 前脚・左主脚・右主脚
      g.fillStyle = '#0a0b0d'; g.beginPath(); g.arc(x, y, 26, 0, Math.PI * 2); g.fill();
      g.fillStyle = down ? '#3ddc6a' : '#14301b'; g.beginPath(); g.arc(x, y, 19, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#aeb4bb'; g.font = '15px ui-monospace, Menlo, monospace'; g.fillText(down ? 'DOWN' : 'UP', S / 2, 226);
    g.lineWidth = 6; g.strokeStyle = '#2b2f34'; g.strokeRect(16, 16, S - 32, S - 32); dialTex.gear.needsUpdate = true; }
  /* 姿勢指示器と方位指示器は、出題・画面の計器と同じ絵（engine.js の svgAI / svgHI と同じ座標・同じ色）で描く
     （利用者の指示 2026-09-13「認識しにくいので、機内搭載の方位と姿勢指示器は他でも用いているものを用いる」）。
     SVG の座標系（−100〜100）を 256 px の面に写す。色はアプリの CSS 変数から読む（昼・夜で変わる） */
  const cssVar = (n, fb) => { try { const v = getComputedStyle(document.body).getPropertyValue(n).trim(); return v || fb; } catch (e) { return fb; } };
  const AI_LADDER = [-80, -70, -60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80], AI_SCALE = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
  const HI_PLANE = new Path2D('M0,-30 L4,-16 L4,-2 L22,8 L22,13 L4,7 L4,16 L11,21 L11,25 L0,22 L-11,25 L-11,21 L-4,16 L-4,7 L-22,13 L-22,8 L-4,-2 L-4,-16 Z');
  const AI_WINGS = new Path2D('M-44,0 H-16 L-8,8 L0,0 L8,8 L16,0 H44');
  const DISP = '"Zen Kaku Gothic New", system-ui, sans-serif', MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
  function drawAI(b, p) {
    const g = dialCv.ai.getContext('2d'), S = 256, u = S / 200, k = 2.4;
    const sky = cssVar('--sky', '#2f86e0'), earth = cssVar('--earth', '#9a6535'), accent = cssVar('--accent', '#ffb020'), bezelC = cssVar('--bezel', '#0a0d11'), line2 = cssVar('--line2', 'rgba(255,255,255,.16)');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    g.setTransform(u, 0, 0, u, S / 2, S / 2);                       // 以後は SVG の座標（中心 0,0、−100〜100）
    g.fillStyle = bezelC; g.beginPath(); g.arc(0, 0, 97, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(0, 0, 90, 0, Math.PI * 2); g.clip();
    g.save(); g.rotate(-b * D); g.translate(0, p * k);
    g.fillStyle = sky; g.fillRect(-400, -500, 800, 500); g.fillStyle = earth; g.fillRect(-400, 0, 800, 500);
    g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-400, 0); g.lineTo(400, 0); g.stroke();
    g.lineWidth = 2; g.fillStyle = '#fff'; g.font = `11px ${MONO}`; g.textBaseline = 'alphabetic';
    for (const pd of AI_LADDER) { const y = -pd * k, w = Math.abs(pd) % 20 === 0 ? 34 : 20;
      g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
      g.textAlign = 'left'; g.fillText(String(Math.abs(pd)), w + 5, y + 4); g.textAlign = 'right'; g.fillText(String(Math.abs(pd)), -w - 5, y + 4); }
    g.restore();
    g.save(); g.rotate(-b * D); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -90); g.lineTo(-7, -77); g.lineTo(7, -77); g.closePath(); g.fill(); g.restore();   // バンクの指標
    g.strokeStyle = '#fff';
    for (const a of AI_SCALE) { g.save(); g.rotate(a * D); g.lineWidth = a === 0 ? 3 : 2; g.beginPath(); g.moveTo(0, -90); g.lineTo(0, Math.abs(a) % 30 === 0 ? -78 : -83); g.stroke(); g.restore(); }
    g.restore();
    g.strokeStyle = accent; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(AI_WINGS);   // 機体マーク
    g.lineWidth = 6; g.strokeStyle = bezelC; g.beginPath(); g.arc(0, 0, 92, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.strokeStyle = line2; g.beginPath(); g.arc(0, 0, 96, 0, Math.PI * 2); g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0); dialTex.ai.needsUpdate = true;
  }
  function drawHI(h) {
    const g = dialCv.hi.getContext('2d'), S = 256, u = S / 200;
    const accent = cssVar('--accent', '#ffb020'), bezelC = cssVar('--bezel', '#0a0d11'), card = cssVar('--card', '#1a2027'), line2 = cssVar('--line2', 'rgba(255,255,255,.16)'), ink = cssVar('--inst-ink', '#fff');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    g.setTransform(u, 0, 0, u, S / 2, S / 2);
    g.fillStyle = bezelC; g.beginPath(); g.arc(0, 0, 97, 0, Math.PI * 2); g.fill();
    g.fillStyle = card; g.beginPath(); g.arc(0, 0, 90, 0, Math.PI * 2); g.fill();
    g.lineWidth = 1; g.strokeStyle = line2; g.beginPath(); g.arc(0, 0, 90, 0, Math.PI * 2); g.stroke();
    g.save(); g.rotate(-h * D);                                        // 方位の円盤（いまの方位が上）
    g.strokeStyle = ink;
    for (let i = 0; i < 8; i++) { const major = i % 2 === 0; g.save(); g.rotate(i * 45 * D); g.lineWidth = major ? 3 : 2; g.beginPath(); g.moveTo(0, -88); g.lineTo(0, major ? -72 : -78); g.stroke(); g.restore(); }
    g.fillStyle = accent; g.beginPath(); g.moveTo(0, -86); g.lineTo(-7, -68); g.lineTo(7, -68); g.closePath(); g.fill();   // 北の印（機内の計器は N に固定）
    g.font = `700 22px ${DISP}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('N', 0, -44);
    g.restore();
    g.globalAlpha = 0.9; g.fillStyle = accent; g.fill(HI_PLANE); g.globalAlpha = 1;   // 機体（固定）
    g.beginPath(); g.moveTo(0, -96); g.lineTo(-7, -84); g.lineTo(7, -84); g.closePath(); g.fill();   // 上の指標
    g.lineWidth = 6; g.strokeStyle = bezelC; g.beginPath(); g.arc(0, 0, 92, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.strokeStyle = line2; g.beginPath(); g.arc(0, 0, 96, 0, Math.PI * 2); g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0); dialTex.hi.needsUpdate = true;
  }
  /* 計器盤の地（一度だけ）: 暗い板、継ぎ目、ねじ、計器の穴 */
  function drawPanelStatic() {
    const g = panelCv.getContext('2d'), W = panelCv.width, H = panelCv.height;
    g.fillStyle = '#23272c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#181b1f'; g.lineWidth = 3; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#5a6066'; for (const [x, y] of [[0.03, 0.06], [0.97, 0.06], [0.03, 0.94], [0.97, 0.94]]) { g.beginPath(); g.arc(W * x, H * y, 5, 0, Math.PI * 2); g.fill(); }
    for (const d of DIALS) { g.fillStyle = '#0b0c0e'; if (d.id === 'gear') g.fillRect(W * (d.u - d.r), H * d.v - W * d.r, W * d.r * 2, W * d.r * 2); else { g.beginPath(); g.arc(W * d.u, H * d.v, W * d.r * 1.06, 0, Math.PI * 2); g.fill(); } }
    panelTex.needsUpdate = true;
  }
  /* 毎コマ: 乗っている機体の値で全部の計器を描く */
  function drawDials(a, alt, kt, vs, gear) { drawASI(kt); drawAI(a.b, a.p); drawALT(alt); drawGearLamps(gear); drawHI(a.h); drawVVI(vs); }
  /* スロットル（利用者の指示 2026-09-13「速度を変えられるスロットを操縦スティックの上に。実機と同じく縦。機内にも連動するレバー」）。
     0（アイドル）〜1（全開）。手動操縦の速さは 0.6〜1.5 倍（36〜90 m/s）。0.444 で 1 倍（60 m/s）。レバーは前に押すほど速い */
  let throttle = 0.444, thrLever = null, speedLock = false;   // speedLock: 縦画面の検証画面では速さを変えない（利用者の指示 2026-09-13）
  const pedals = [null, null], rudAim = { r: 0 };   // 機内のペダル（左・右）と、表示用になました方向舵の入力
  const THR_MIN = 0.6, THR_MAX = 1.5;
  const interior = new THREE.Group(); stickHolder.add(interior);
  {
    /* 計器盤: 上端 (y 3.17, z −0.19)、15° 起こして下へ */
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshLambertMaterial({ map: panelTex }));
    panel.rotation.x = Math.PI / 2 - PANEL_TILT;   // 面を操縦者（−y）へ向け、少し上向きに起こす
    const pc = new THREE.Vector3(0, 3.31 - Math.sin(PANEL_TILT) * PANEL_H / 2, -0.19 - Math.cos(PANEL_TILT) * PANEL_H / 2);
    panel.position.copy(pc); interior.add(panel);
    /* 計器を計器盤の面に置く（面のすぐ手前）。u,v → 面の上の位置 */
    for (const d of DIALS) {
      const lx = (d.u - 0.5) * PANEL_W, ly = (0.5 - d.v) * PANEL_H;   // 面の座標（右・上が正）
      const geo = d.id === 'gear' ? new THREE.PlaneGeometry(d.r * 2 * PANEL_W, d.r * 2 * PANEL_W) : new THREE.CircleGeometry(d.r * PANEL_W, 40);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: dialTex[d.id] }));
      m.rotation.x = panel.rotation.x;
      m.position.set(lx, pc.y - Math.cos(PANEL_TILT) * 0.004 + ly * Math.sin(PANEL_TILT), pc.z + ly * Math.cos(PANEL_TILT) + Math.sin(PANEL_TILT) * 0.004);
      interior.add(m);
    }
    /* グレアシールド（計器盤の上の日よけ）: 上端 −0.13、前へ 0.26 */
    const hood = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W + 0.06, 0.20, 0.045), panelMat.hood);
    hood.position.set(0, 3.34, -0.152); interior.add(hood);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, PANEL_W + 0.06, 12), panelMat.hood);
    lip.rotation.z = Math.PI / 2; lip.position.set(0, 3.24, -0.152); interior.add(lip);   // 手前の丸い縁
    /* HUD の支柱（ガラス板はガラス板の場面に。ここは台と支柱だけ） */
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.045, 10), panelMat.hood);
    post.rotation.x = Math.PI / 2; post.position.set(0, HUD_POS.y, -0.13 + 0.0225); interior.add(post);
    const pbase = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.02), panelMat.hood); pbase.position.set(0, HUD_POS.y, -0.125); interior.add(pbase);
    /* 左右のコンソール（左にスロットルの溝とレバー） */
    for (const s of [-1, 1]) {
      const con = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.80, 0.10), panelMat.console);
      con.position.set(s * 0.37, 2.95, -0.42); interior.add(con);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.60, 0.02), panelMat.hood); rail.position.set(s * 0.37, 2.95, -0.365); interior.add(rail);
    }
    thrLever = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.11), grip_m); thrLever.position.set(-0.37, 2.85, -0.31); thrLever.rotation.x = -0.35; interior.add(thrLever);
    /* 方向舵のペダル（床の前方） */
    for (const s of [-1, 1]) {
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.16), panelMat.console);
      ped.position.set(s * 0.16, 3.36, -0.82); ped.rotation.x = 0.45; interior.add(ped);
      pedals[s > 0 ? 1 : 0] = ped;   // 方向舵に連動して前後に動かす（drawStick）
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.30, 8), metal); arm.position.set(s * 0.16, 3.44, -0.90); arm.rotation.x = 1.2; interior.add(arm);
    }
    /* 床（腰から下の暗い内壁）。側壁の平板は置かない: 一人称で左に「板」として見えた（利用者の指摘 2026-09-13。pick() で PlaneGeometry と特定）。
       実機の内壁は胴体そのもので、GLB の機体がその役をする */
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(0.90, 1.2), panelMat.hood); floor.position.set(0, 3.0, -0.96); interior.add(floor);
    drawPanelStatic(); drawDials({ b: 0, p: 0, h: 0 }, 0, 0, 0, true);
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
  /* 粒ごとの流れる速さ（m/s）。ふつうの煙は 0 でその場に残る。
     地上での点検のときだけ、後ろへ流れて消えるように速さを持たせる */
  const sVel = new Float32Array(SMOKE_N * 3);
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
  smokeGeo.setAttribute('avel', new THREE.BufferAttribute(sVel, 3));
  const smokeMat = new THREE.ShaderMaterial({
    /* 太さは遠近だけで決める。**遠ざかるほど太くするのはやめた**（利用者の指示 10。v04.76）。
       煙の太さは実物のまま同じで、画面では遠いほど細くなる。細くなりすぎて線が消えないよう、
       画面の中での太さに下限を置く（uMinPx。これが「描画系では細くなりすぎないように」）。
       濃さだけは遠いところで足す（uFarA）。遠くの煙は空に溶けて見えなくなるため。
       一人称では自分と僚機の煙がすぐ近くを通るので、下限・上限とも小さくする。
       uMinPx / uMaxPx: 画面の中での太さの下限・上限（画素） */
    uniforms: { uTime: { value: 0 }, uLife: { value: SMOKE_LIFE }, uMinPx: { value: 10 }, uMaxPx: { value: 90 },
                uFarA: { value: 1.2 } },
    transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 acolor; attribute vec3 avel; attribute float birth; attribute float asize; attribute float alife; uniform float uTime, uLife, uMinPx, uMaxPx, uFarA;
      varying vec3 vC; varying float vA;
      void main(){ float age = (uTime - birth) / max(1.0, alife); vA = clamp(1.0 - age, 0.0, 1.0); vA *= sqrt(vA);
        vC = acolor;
        /* 流れる速さを持つ粒は、時間ぶんだけ動かす（地上の点検の煙が後ろへ流れる） */
        vec4 mv = modelViewMatrix * vec4(position + avel * max(0.0, uTime - birth), 1.0);
        float far = clamp((-mv.z - 200.0) / 800.0, 0.0, 1.0);      // 200 m から 1 km で 0 → 1
        vA = clamp(vA * (1.0 + uFarA * far), 0.0, 1.0);
        /* 太さ: 出た直後から少しずつ広がる。距離では太らせない（遠近で細くなるだけ）。
           細くなりすぎると線が点々に見えるので、画面の中での下限で止める（下限・上限は視点で変える） */
        /* 出たての太さ 6 は、画面では 1.2 m ほど（240 m 先で 6 画素）。粒の間は 2.4 m なので線が点々に見えた。
           出たてを 12（約 2.5 m）にして、粒どうしを重ねる。広がり方（age で太る）はそのまま */
        float sz = 12.0 + 54.0 * pow(clamp(age, 0.0, 1.0), 0.5);
        gl_PointSize = clamp(sz * asize * (240.0 / max(1.0, -mv.z)), uMinPx * asize, uMaxPx * asize);
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
  /* vel を渡すと、その粒は出たあと流れて消える（地上での点検）。life で消えるまでの時間を変える */
  /* 煙の粒は 0.04 秒ごとに 1 つ置くが、速い機（レター・エイトの単機 1.55 倍、描き物の寄せなど）や
     コマ落ちのときは粒の間が開いて点々に見える。機ごと（key: 0 = 1 番機、1〜 = 編隊機）に前の粒の位置を覚え、
     間が SMOKE_STEP（ふつうの速さの 0.04 秒ぶん = 2.4 m）を超えたら、そのあいだに粒を足して線にする。
     出し始め（前の粒から 0.6 秒以上・200 m 以上）はつながない（切っていた間を埋めてしまうため） */
  /* 粒どうしの間。ふつうの速さの 0.04 秒ぶん（2.4 m）では点々に見えたので、1/2.5（0.96 m）にする。
     太さ（下）と合わせて、どこから見ても線に見えるようにする（利用者の指示 第 3 便 8） */
  const SMOKE_STEP = SPEED * SMOKE_DT / 2.5;
  const lastEmit = [];                              // key → { x, y, z, t }
  const gapMax = [];                                // key → 前の粒との最大の間（m。確かめ用）
  function emit(pos, colorHex, vel, life, key, size) {
    smokeCol.set(smokeBoost ? '#ffffff' : colorHex);   // ローパスの煙は白
    /* sz は粒 1 つの太さの倍率。ローパス（smokeBoost）は 2.4 のまま。
       ほかは 1 → 3 にしたが、太すぎるという指摘で 2（v04.84）→ 1.33（v04.85）→ 1（2026-09-12「現在の 3/4」）へ下げた。
       size を渡すとそれを使う（離陸待機中の点検の煙） */
    const n = smokeBoost ? 3 : 1, j = smokeBoost ? 2.5 : 0, lf = life || lifeNow;
    const sz = smokeBoost ? 2.4 : (size || 1);
    const put = (x, y, z, birth) => {
      for (let k = 0; k < n; k++) {
        const i = sHead % SMOKE_N; sHead++;
        sPos[i * 3] = x + (Math.random() - 0.5) * j; sPos[i * 3 + 1] = y + (Math.random() - 0.5) * j; sPos[i * 3 + 2] = z + (Math.random() - 0.5) * j;
        sCol[i * 3] = smokeCol.r; sCol[i * 3 + 1] = smokeCol.g; sCol[i * 3 + 2] = smokeCol.b;
        sVel[i * 3] = vel ? vel.x : 0; sVel[i * 3 + 1] = vel ? vel.y : 0; sVel[i * 3 + 2] = vel ? vel.z : 0;
        sBirth[i] = birth; sSize[i] = sz; sLife[i] = lf;
      }
    };
    if (key !== undefined && !vel) {
      const L = lastEmit[key];
      if (L && clock - L.t < 0.6) {
        const d = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
        if (d < 200) {
          if (d > (gapMax[key] || 0)) gapMax[key] = d;
          const m = Math.ceil(d / SMOKE_STEP) - 1;             // 足す粒の数
          for (let q = 1; q <= m; q++) { const f = q / (m + 1); put(L.x + (pos.x - L.x) * f, L.y + (pos.y - L.y) * f, L.z + (pos.z - L.z) * f, L.t + (clock - L.t) * f); }
        }
      }
      lastEmit[key] = { x: pos.x, y: pos.y, z: pos.z, t: clock };
    }
    put(pos.x, pos.y, pos.z, clock);
  }
  function clearSmoke() { sBirth.fill(-1e6); smokeGeo.attributes.birth.needsUpdate = true; }
  /* 地上での点検: 機体の後ろへ吹き出して流れる煙。止まっていても、その場にとどまらない */
  const chkV = new THREE.Vector3(), chkP = new THREE.Vector3(), gfw = new THREE.Vector3();
  const cfw = new THREE.Vector3(), crt = new THREE.Vector3();   // 探針でカメラの向きを読むための入れ物
  function checkSmoke(pos, q, colorHex, dt) {
    /* 点々に見えないよう、粒を細かく多く出す（利用者の指示 第 3 便 8・9）。1 秒に 90 粒ほど */
    if (Math.random() > Math.min(1, dt * 90)) return;
    chkV.set((Math.random() - 0.5) * 3, -(16 + Math.random() * 8), 1.5 + Math.random() * 2).applyQuaternion(q);
    chkP.set(0, -6.9, -0.3).applyQuaternion(q).add(pos);
    /* 離陸待機中の煙は、ローパスと同じくらいの太さにする（利用者の指示 第 3 便 9） */
    emit(chkP, colorHex, chkV, 2.4, undefined, 2.4);
  }
  /* 誰が煙を出すか。表の隊形ではなく、**そのときの位置**で決める。
     自分の真後ろ（左右がそろい、高さもそろい、進む向きの後ろ）に他機がいる機体は出さない
     （後ろの機体が煙の中を飛ぶため）。合流してくる機体が真後ろに着く、その瞬間まではオンのまま。
     隊形が変わって最後の 1 機が入った瞬間に、条件を満たす機体が一斉にオンになる。
     0 = 1 番機、1〜 = 編隊機（隠れている機体は数えない） */
  const smokeOnArr = [], smWhyArr = [], smQ = new THREE.Quaternion(), smV = new THREE.Vector3();   // smWhyArr: 切った理由（確かめ用）
  const smList = [], smPool = [];                  // 判定に使う一覧（毎コマ作り直さず使い回す）
  const smSlot = (k, p, q) => { const o = smPool[smList.length] || (smPool[smList.length] = { k: 0, p: null, q: null }); o.k = k; o.p = p; o.q = q; return o; };
  const smBehindT = [];                    // 機ごと: 真後ろに他機がいる時間（+）／いない時間（−）。切り替えの遅れに使う
  let smDt = 0.05;                         // smokers を呼ぶコマの長さ（step で更新）
  const SM_SIDE = 7, SM_UP = 5, SM_BACK = 160;   // 左右・上下のそろい（m）と、後ろを見る距離（m）
  const ORIGIN0 = [0, 0, 0];                     // 1 番機の席（隊形の表の原点）
  const slotOcc = [];                     // 席の決まり（slotBehind）: 機ごとに、その席に着いているか
  function slotBehind(n, seated) {
    const f = FORMATIONS[formation]; if (!f) return;
    const pos = k => k === 0 ? ORIGIN0 : f.offs[k - 1];
    for (let k = 0; k < n; k++) { const u = k ? mates[k - 1].userData : null;
      slotOcc[k] = k === 0 || !!(f.offs[k - 1] && u.shown && (u.tk || u.tkJoin || seated(u))); }
    for (let k = 0; k < n; k++) {
      if (!slotOcc[k]) continue;
      const a = pos(k);
      for (let j = 0; j < n; j++) {
        if (j === k || !slotOcc[j]) continue;
        const b = pos(j), dy = (b[1] - a[1]) * formScale;
        if (Math.abs(b[0] - a[0]) * formScale < SM_SIDE && Math.abs(b[2] - a[2]) * formScale < SM_UP && dy < -2 && dy > -SM_BACK) {
          smokeOnArr[k] = false; smWhyArr[k] = 'behind'; break;
        }
      }
    }
  }
  function smokers() {
    const n = mates.length + 1;
    smokeOnArr.length = 0; smWhyArr.length = 0;
    for (let k = 0; k < n; k++) { smokeOnArr[k] = true; smWhyArr[k] = ''; }
    /* 毎コマ作り直すと、その数だけ細かな入れ物ができる。使い回す */
    smList.length = 0; smList.push(smSlot(0, plane.position, att));
    mates.forEach((h, i) => { if (h.userData.shown) smList.push(smSlot(i + 1, h.position, h.quaternion)); });
    const list = smList;
    /* 編隊で飛んでいるあいだは、「真後ろに他機」の**位置**の決まりを使わない（利用者の指示 第 2 便 5・10）。
       ダイヤモンドでは 4 番機が 1 番機の真後ろに入るため、毎コマの位置で判じると煙が途切れ途切れになっていた。
       代わりに下（slotBehind）で、表の隊形の**席**で判じる（2026-09-24）。
       自分で操縦しているとき（編隊を組んでいない）はこれまでどおり位置で判じる */
    const tkJoining = mates.some(h => h.userData.tkJoin);   // 離陸から隊形への寄せの途中
    const formFly = smokeAll || tkOn || tkJoining || gmode === 'stand'
                    || (((FORMATIONS[formation] ? FORMATIONS[formation].n : 1) > 1) && matesReady());
    for (const a of list) {
      smQ.copy(a.q).invert();
      let behind = false;
      for (const b of list) {
        if (a === b) continue;
        smV.copy(b.p).sub(a.p).applyQuaternion(smQ);        // 自分から見た相手の位置（機首が +y）
        if (Math.abs(smV.x) < SM_SIDE && Math.abs(smV.z) < SM_UP && smV.y < -2 && smV.y > -SM_BACK) { behind = true; break; }
      }
      /* 曲がりや速さの変化で一瞬だけ真後ろに入ると、そのたびに煙が切れて点々になった。
         後ろにいる状態が 1.0 秒続いてから切り、後ろにいない状態が 0.4 秒続いてから戻す（遅れ smBehindT） */
      const k = a.k;
      smBehindT[k] = behind ? Math.min(2, (smBehindT[k] || 0) + smDt) : Math.max(-2, Math.min(0, (smBehindT[k] || 0)) - smDt);
      if (!formFly && smBehindT[k] >= 1.0) { smokeOnArr[k] = false; smWhyArr[k] = 'behind'; }
    }
    /* 1 番機（操縦している機体）は、上の位置の判定だけで決める。
       ほかの機体は、隊形ができあがるまでは出さない。できあがったその瞬間に、条件を満たすものが一斉に出す。
       「できあがった」は、道引きが終わっているか、全機が 1 番機の近く（200 m 以内）にいるか。
       ワイド・トゥ・デルタ・ループのように間隔を毎コマ変える課目では、道を引き直し続けるので
       道引きの進み具合だけで見ると、ずっと未完成の扱いになってスモークが止まってしまう */
    /* 整列中（stand）と離陸中（tkOn）は、並びそのものが隊形なので出来上がっていると見る。
       これがないと、ダイヤモンド・テイクオフのあいだ従機が一度も煙を出さない
       （実測: 離陸から上昇中ずっと notready）。利用者の指示 第 1 便 6・第 2 便 5・10 */
    const ready = smokeAll || tkOn || tkJoining || gmode === 'stand' || matesReady()
                  || mates.every(h => !h.userData.shown || h.userData.cur.length() < 200);
    for (let k = 1; k < n; k++) if (!ready || !mates[k - 1].userData.shown) { smokeOnArr[k] = false; smWhyArr[k] = ready ? 'hidden' : 'notready'; }
    /* 編隊に入っていない機（合流の途中 k < 0.9）は出さない。入った瞬間から出せるようになる（出すかどうかは上の位置の決まり）。
       課目のあいだ全機で出すもの（smokeAll）は除く */
    /* 「席に着いている」= 道の進み k > 0.9、または席から 10 m 以内。
       課目の始まり（align → do）で道を引き直すと k が 0 に戻るが、機体は席から動いていない。
       k だけで見ると、その 2 秒間だけ僚機の煙が切れて 1 番機と揃わなかった（実測 2026-09-13） */
    const seated = u => (u.k === undefined ? 1 : u.k) > 0.9 || (u.want && u.cur.distanceTo(u.want) < 10);
    if (!smokeAll) for (let k = 1; k < n; k++) { const u = mates[k - 1].userData;
      /* 離陸からの寄せ（tkJoin）は除く。すでに隊形の形のまま上がっているので、
         ここで切るとダイヤモンド・テイクオフの直後に煙が途切れる（実測） */
      if (!u.tkJoin && !seated(u)) { smokeOnArr[k] = false; smWhyArr[k] = 'join'; } }
    /* 隊形に席のない機（例: チェンジオーバー・ターンのトレイルに入らない 6 番機）は出さない。smokeAll でも出さない */
    { const fo = FORMATIONS[formation] ? FORMATIONS[formation].offs : null; if (fo) for (let k = 1; k < n; k++) if (!fo[k - 1]) { smokeOnArr[k] = false; smWhyArr[k] = 'slot'; } }
    /* 席の決まり: 編隊で飛んでいるあいだ、自分の席の真後ろ（左右 SM_SIDE・上下 SM_UP 以内、後ろ 2〜SM_BACK m）の席に
       他機が着いている機は出さない（利用者の指示 2026-09-24「ダイヤモンドなど、後ろに機体がいる機は原則スモークオフ」。
       後ろの機が煙の中を飛ぶため）。ダイヤモンドは 1 番機だけ（4 番機が真後ろ）、デルタは 1 番機（6 番機）、トレイルは最後尾以外。
       位置ではなく表の席で決めるので、旋回や横転で位置が揺れても入り切りしない。
       「着いている」は席に着いた機（seated）と、離陸で隊形のまま上がっている機（tk・tkJoin）。合流してくる機が席に着いた瞬間に切れる。
       1 番機の道をたどる課目（pathLag: 間隔は数百 m）・描き物・散開・コークスクリュー・交差する課目は、席の形で飛んでいないので使わない */
    if (formFly && pathLag <= 0 && !fig && !bloomS && corkT < 0 && !mir) slotBehind(n, seated);
    /* レター・エイト: 合流するまで先頭機は出し続ける（追いつく 1 機が後ろに入ると「後ろに機体がいる」規則で
       先頭機が 3.6 秒早く切れ、煙のない間ができた。実測）。合流した瞬間に先頭機と入れ替える（戻った 1 機が円を仕上げる） */
    if (e8 && !e8.done && !e8.out) smokeOnArr[0] = true;
    if (e8 && e8.done && !e8.out) { smokeOnArr[0] = false; smokeOnArr[e8.solo + 1] = true; }
    /* 前の課目に入っていなかった機体は、合流するまで出さない（smokeAll より優先）。
       「合流した」は隊形の席に着いたこと（表示中で k > 0.9）。以前は開始位置に着く（endEntry）まで解かなかったので、
       技を単発で選んだとき、進入の始めから隊形を組んでいる（v04.91）のに 1 番機だけが煙を引き、
       僚機は開始位置まで 45 秒ほど出さなかった（利用者の指摘 2026-09-13「スモークオンが一番機とその他で揃ってない」。実測） */
    for (let k = 1; k < n; k++) { const u = mates[k - 1].userData;
      if (u.rejoin && u.shown && seated(u)) u.rejoin = false;
      if (u.rejoin) { smokeOnArr[k] = false; smWhyArr[k] = 'rejoin'; } }
    if (smokeNone) { smokeOnArr.fill(false); smWhyArr.fill('none'); }       // 課目の終わりに一斉に切る
    return smokeOnArr;
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
  /* 脚は機ごとに決める。地上にいる機（駐機・誘導路・順番待ち）と、自分の離陸がまだ済んでいない機（滑走・上昇の途中）は、
     全体の指示（gearOn）が「しまう」でも出したままにする。ダイヤモンド テイクオフでは 5・6 番機が後から滑走するので、
     先頭が脚をしまっても 5・6 番機は滑走が済むまで出している。ライトは自分の滑走・上昇のあいだだけ同じ扱い */
  const mateOnGround = u => !!(u.ground || u.parked || u.gp || (u.queue !== undefined && u.queue >= 0) || (u.tk && !u.tk.done));
  function refreshMateGear() {
    /* クリスマスツリー・ローパスでは、タイヤとライトをスモークと同じ瞬間に入り切りする（利用者の指示 第 3 便 5）。
       これまでは 脚が課目の始めから出て、ライトは正面を向いてから点いていて、時刻が別々だった。
       毎コマ呼ばれるこの関数で決めるので、1 番機ぶんもここで決める */
    const treeSm = k => treeMode && smokeOnArr[k] !== false;
    if (gearSets[0]) gearSets[0].visible = gearOn || treeSm(0);
    if (lightSets[0]) lightSets[0].visible = lightsOn || treeSm(0);
    mates.forEach((h, i) => {
      const g = gearSets[i + 1], L = lightSets[i + 1]; if (!g) return;
      const u = h.userData;
      const gv2 = gearOn || treeSm(i + 1) || mateOnGround(u);
      if (u.gearVis !== undefined && u.gearVis !== gv2 && seat === i + 1) gearSound(gv2);   // その機に乗っているときは、その機の脚の音
      u.gearVis = gv2;
      g.visible = gv2;
      /* ライト: 着陸のあいだは自分の進入で点ける（接地点の手前 1.8 km）。それ以外は全体の指示に従う（地上では消す） */
      if (landRun && !u.ground && !u.parked && h.position.z > 6 && (LAND_TD_Y - h.position.y) < 1800 && (LAND_TD_Y - h.position.y) > -50) u.lampOn = true;
      if (L) L.visible = (lightsOn && !landRun && !mateOnGround(u)) || treeSm(i + 1) || !!(u.tk && !u.tk.done) || !!u.lampOn;
    });
  }
  /* 脚とライトは別々に出し入れできる。ライトは標準で消えていて、離着陸とクリスマスツリー・ローパスだけ自動で点く（総点検 2026-09-13 に注釈を実装に合わせた）。
     ローパスのあいだは両方出し、終わったら手で決めていた状態に戻す */
  let gearOn = false, lightsOn = false, treeMode = false;   // ライトは標準でオフ（離着陸・ローパスだけ）
  let gearPrev = null, gearSndN = 0;
  let landCfg = false;                     // 着陸体制（タイヤ・ライトを出した）。このあいだはスモークを入れない       // タイヤの出し入れの音を鳴らすための、前の状態と鳴らした回数（確かめ用）
  function applyGear() {
    const gShow = gearOn || treeMode;
    if (gearPrev !== null && gShow !== gearPrev && seat === 0) gearSound(gShow);   // 出し入れが切り替わったときだけ鳴らす（1 番機に乗っているとき）
    gearPrev = gShow;
    /* 1 番機の脚とライトの出し入れは refreshMateGear が毎コマ決める（ローパスではスモークと同じ瞬間にするため） */
    refreshMateGear();
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
  let gmode = 'fly', gv = 0, rotP = 0;     // rotP: 滑走の終わりの機首上げ（度）
  const ROT_K = 0.75;                      // この速さ（SPEED の何割）で機首を上げ始める
  const RWY = { x: 0, y: -480, h: 0 };              // 滑走路の南寄り（機首は北）
  const att = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -START.h * D);
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1), WUP = new THREE.Vector3(0, 0, 1);
  const dq = new THREE.Quaternion(), fwd = new THREE.Vector3(), bup = new THREE.Vector3(), bright = new THREE.Vector3();
  const gdir = new THREE.Vector3(), gright = new THREE.Vector3(), focus = new THREE.Vector3(), bup2 = new THREE.Vector3();   // 地上視点の向きを作るのに使う
  const seatQ = new THREE.Quaternion(), seatR = new THREE.Matrix4();   // 乗っている機体の姿勢
  const panelPt = new THREE.Vector3();   // 計器盤の上端を画面へ写すのに使う
  const gEye = new THREE.Vector3(GROUND_EYE.x, GROUND_EYE.y, GROUND_EYE.z + EYE_H);   // 地上の立ち位置（目の高さ）
  let gYaw = 0, gPitch = 0.06;                                     // 地上視点の向き（自分で決めた方向）
  const SLOW_AIM = 7, SLOW_RATE = 14;      // 瞬間移動のあと、視線をゆっくり向け直す時間（秒）と速さ（度/秒）
  let slowAim = 0;
  const SWEEP_T = 1.8;                     // 見る先が大きく変わったときに、均一に振り向く時間（秒）
  let sweep = null;                        // 振り向きの途中 { vy, vp, t }
  /* 瞬間移動を隠す（利用者の指示 第 3 便 6）。機体が消えたり離れた場所に現れたりすると、
     見る先（機体の平均）が 1 コマで飛び、そこで首が振られて「いま移した」と分かってしまう。
     飛んだぶんを控えておき、見る先に足し戻してから、少しずつ 0 へ戻す。
     こうすると、消えた瞬間の首の動きが 0 になり、そのあと気付かないうちに新しい先へ向く */
  const AIM_JUMP = 60;                     // 1 コマでこれ以上飛んだら「移した」と見る（m。ふつうの動きは 1 コマ 5 m ほど）
  const AIM_EASE = 2.5;                    // 控えた飛びを返しきるまで（秒）
  const aimPrev = new THREE.Vector3(), aimOff = new THREE.Vector3(), aimTmp = new THREE.Vector3();
  let aimHas = false;
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
  function levelAttitude() { att.setFromAxisAngle(AZ, -st.h * D); readAttitude(); velOk = false; }   // 姿勢を直書きしたら速度も作り直す
  /* 開始位置（滑走路の南端上空 80 m、北向き、水平）へ戻す。数が壊れたときと、縦画面で墜落したとき */
  function resetToStart() {
    Object.assign(st, { x: START.x, y: START.y, z: START.z, h: START.h, ground: false, wall: false });
    levelAttitude(); auto = false; oneShot = false; formScale = 1;   // 軌跡は消さない（追従機が 1 番機の道をたどって降りてくる）
    manPhase = 'do'; st.cue = ''; markOn = false;
  }
  readAttitude();
  const N_MAX = 4;                     // 旋回に使える荷重倍数の上限（4 G）。横倒しでも旋回が暴れないようにする
  const input = { x: 0, y: 0, r: 0 };   // x: 操縦桿 左右（右 +）、y: 操縦桿 前後（奥 +）、r: 方向舵（右 +）
  let velOk = false;                    // 手動操縦の速度ベクトル vel が今の機首と合っているか（自動操縦・地上・姿勢の直書きのあとは false。physStep が作り直す）
  /* 姿勢の台本（「見え方」の「動きで見る」）。出題の絵と同じ姿勢 { bank, pitch, yaw } をそのまま機体に置き、位置は動かさない。
     出題の絵は「操作 1 つ＝機体の軸まわりの回転 1 つ」の約束で、前進や重力による流れを持たないので、その世界のまま再現する（利用者の指示 2026-09-13） */
  const poseQ = new THREE.Quaternion(); let posed = false;
  /* 航跡（試験の世界だけ）: 置いた位置をつないだ細い線。三人称ではカメラが機体に付いてくるので、前へ進んでいることがこの線で分かる。
     スモークは機体のすぐ後ろのカメラから見ると太い塊になって機体を隠した（2026-09-13） */
  const TRAIL_N = 4000, trailPos = new Float32Array(TRAIL_N * 3); let trailLen = 0;
  const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailGeo.setDrawRange(0, 0);
  { const tl = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false }));
    tl.frustumCulled = false; tl.visible = exam; world.add(tl); }
  let curView = view, seat = 0;   // seat: 0=1 番機、1〜5=2〜6 番機（視点だけ移る）
  let inCockpit = true;           // 一人称の見せ方。true=機内（計器盤と操縦桿が見える）、false=計器だけ（外がそのまま見える）
  let paused = false;             // 演目の一時停止（画面を 2 回叩く）
  /* 見回し（ドラッグ量）。一人称は首の向き、三人称は機体のまわりの位置。視点を変えると中央に戻す */
  const look = { y: 0, p: 0 };
  const LOOK_MAX_P = 75 * D;
  const TILT_A = 10 * D;           // 一人称の見下ろし角（計器盤が視界に入る。HUD を通して外を見る姿勢に近づけて 16° → 10°、2026-09-13）
  const cam = new THREE.PerspectiveCamera(70, 1, 0.08, exam ? 200000 : 9000);   // 試験の世界は目印が 37〜82 km 先
  let zoom = 1, baseFov = 70;                      // 画面の拡大（望遠）。画角 = 元の画角 ÷ 倍率
  const applyFov = () => {
    if (exam && curView === 'first') { examLens(); return; }
    cam.clearViewOffset(); cam.aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
    cam.fov = clamp(baseFov / zoom, 7, 100); cam.updateProjectionMatrix(); };
  /* 試験の絵（svgCockpit 360×240。出題では下を切った 360×188 = opt.examH）と同じレンズ: 1° = 6 px、視線の中心は (180, 108)。箱の中で絵と同じ大きさ・同じ位置に写る */
  function examLens() {
    const EH = opt.examH || 240, w = container.clientWidth || 1, h = container.clientHeight || 1, s = Math.min(w / 360, h / EH);
    const F = 6 * s / Math.tan(D), cy = h / 2 + (108 - EH / 2) * s, fullH = 2 * cy;
    cam.aspect = w / fullH; cam.fov = 2 * Math.atan(cy / F) / D;
    cam.setViewOffset(w, fullH, 0, 0, w, h); cam.updateProjectionMatrix();
  }
  const camPos = new THREE.Vector3(), tmp = new THREE.Vector3(), R = new THREE.Matrix4(), Rh = new THREE.Matrix4(), RX90 = new THREE.Matrix4().makeRotationX(Math.PI / 2), QX90 = new THREE.Quaternion().setFromRotationMatrix(RX90), qc = new THREE.Quaternion();
  function rotation() { return R.makeRotationFromQuaternion(att); }

  function resize() { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); applyFov(); }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  /* 操縦は機体の軸まわりの回転で扱う（機首軸のロール・翼軸のピッチ・上下軸のヨー）。
     左右に倒し続ければ何回でも回り、前後に倒し続ければ宙返りができる。角度の上限は設けない */
  /* 自動操縦: 演目（課目）を順に行う。目標へ向かうときは、方位のずれをバンクに、高さのずれをピッチに直して操縦桿を動かす。
     機体は 1 機を操縦して編隊が付いてくる作りなので、機体ごとに別々に動く課目（交差など）は隊形の変化で表す。
     演目の名前の出典: ブルーインパルスの課目一覧（masdf.com のプログラム紹介） */
  /* form: その課目で使う隊形（いまの機数によらず、その数だけ集まる）。
     front: 見ている前方で行う（旋回だけは前方に限らない）。alt: 入る高さ（m） */
  const PROGRAM = [
    { id: 'dtake', ja: 'ダイヤモンド・テイクオフ', form: 'diamond', front: false, alt: 200,
      desc: '4 機がひし形の隊形を組んだまま、一斉に滑走を始めて上がります。上がってからも隊形を崩しません。' },
    { id: 'byover', ja: '頭上通過', form: 'delta', alt: 130, entry: 'front',
      desc: '正面から低く向かってきて、頭の上を通り抜けます。' },
    { id: 'bloom', ja: 'サンライズ', form: 'fan', alt: 190, entry: 'front', far: 1700,
      desc: '5 機が扇隊形で正面から進入し、散開位置で一斉に開いて、日の出のように放射状に広がります。' },
    { id: 'touch', ja: 'タッチ・アンド・ゴー', form: 'trail', alt: 140, rwy: true, set: { gear: true },
      desc: '縦隊で間を空け、滑走路に平行に進入して、順にタイヤをつけ、そのまま上がります。' },
    { id: 'orbit', ja: '旋回', t: 8, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'opro', ja: 'オポジット・コンティニュアス・ロール', form: 'pair', alt: 220,
      at: 90, atR: FRONT_START, atN: SPREAD_D / 2, inH: 270, mirror: 'h',
      desc: '2 機が正面の左右から高速で近づき、会場の正面で至近距離をすれ違います。すれ違った直後に機首を上げ、回り続けながら抜けていきます。' },
    { id: 'tuck', ja: 'タック・クロス', form: 'pair', alt: 230,
      at: 90, atR: FRONT_START, atN: SPREAD_D / 2, inH: 270, mirror: 's',
      desc: '2 機が至近距離で真横に並んで横から進入し、そろって背面へロールします。会場の手前で外側へロールし、交差点の側へ 45 度傾いたところで機首を上げ、目の前で交差して、そのまま抜けていきます。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'loop', ja: 'デルタ・ループ', form: 'delta', alt: 240, entry: 'front',
      desc: '6 機がデルタ隊形のまま、崩さずに宙返りします。' },
    { id: 'wide', ja: 'ワイド・トゥ・デルタ・ループ', form: 'delta', alt: 240,
      desc: '間隔を広げて入り、宙返りの中でデルタ隊形に詰めます。' },
    { id: 'roll', ja: 'デルタ・ロール', form: 'delta', alt: 200,
      desc: '6 機がデルタ隊形のまま横転します。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'vert', ja: 'バーティカル・クライム・ロール', form: 'pair', alt: 190, entry: 'front',
      desc: '垂直に上昇しながら横転します。' },
    { id: 'half', ja: 'ハーフ・スロー・ロール', form: 'diamond', alt: 300,
      desc: 'ゆっくり背面に入り、そのまま飛んでから戻します。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    /* 隊形は進入の時点から「階段」にする（2026-09-12）。
       以前は 'trail'（一列）で進入させておきながら、本番の冒頭で毎コマ formation = 'steps' を要求していたため、
       開始と同時に全機の枠が動き、僚機が速度の上限（MATE_SPD_MAX × 60 = 150 m/s）で引きずられていた。
       実測: 本番の最初の 3 割で僚機が 150 m/s に張り付き、機首と進行方向のずれが平均 64.6 度（最大 71 度）。
       説明文の「高さの違う 5 機が一列で」も階段隊形のことなので、定義側の指定が実態と食い違っていた */
    { id: 'change', ja: 'チェンジオーバー・ターン', form: 'steps', alt: 200, at: 45, atR: 1300,
      desc: '高さの違う 5 機が階段状の一列で北東から進入し、頂点で先頭以外が一斉に左右へ開いて扇形に並び、そのまま まっすぐ抜けていきます。' },
    { id: 'rain', ja: 'レインフォール', form: 'fan', alt: 900, at: 180, atR: 1200,
      desc: '極めて高いところから 5 機が真下へ降り、正面の前方で一気に散らばって、煙の筋が五方向へ伸びます。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    /* v04.27: 始める位置は散開位置（正面 600 m）。以前は原点の上から始めていた */
    { id: 'eight', ja: 'レター・エイト', form: 'diamond', at: 0, atR: SPREAD_D, alt: 200,
      desc: '4 機で、空に数字の 8 を描きます。' },
    { id: 'cork', ja: 'コーク・スクリュー', form: 'pair', alt: 200, entry: 'front',
      desc: '2 機。1 機がまっすぐ進み、その周りをもう 1 機が背中を内側に向けて回ります。実際の演技では、直進する 5 番機が背面で飛びます。' },
    { id: 'orbit', ja: '旋回', t: 6, front: false, form: 'solo', set: {}, desc: '次の課目へ移るための旋回です。ここで隊形を解き、次の課目までに組み直します。' },
    { id: 'cupid', ja: 'キューピッド', form: 'diamond', alt: 260, entry: 'front', fig: 'cupid',
      desc: '3 機。2 機がハートを描き、描き終えたところへ、もう 1 機が矢になって飛び込みます。地上から見て貫いて見えるよう、ハートの内側ではスモークを切ります。1 番機は図の下を回って待ちます。' },
    { id: 'star', ja: 'スタークロス', form: 'delta', alt: 260, entry: 'front', fig: 'star',
      desc: '5 機。デルタ隊形で入って大きく開き、一斉に降下して星を描きます。1 番機は図の下を回って待ちます。' },
    { id: 'turnloop', ja: '360 度ターン & ループ', form: 'delta', alt: 240,
      desc: '1 周まわってから、続けて宙返りします。' },
    { id: 'pass', ja: '正面通過', t: 12, form: 'delta', alt: 190,
      desc: '隊形のまま、正面を低く通り抜けます。' },
    { id: 'tree', ja: 'クリスマスツリー・ローパス', form: 'tree', alt: 110, entry: 'front',
      set: { smoke: true, gear: true, lights: true },
      desc: '6 機が木の形に組み、列ごとに少し低く並びます。速度を落とし、脚を出してライトを点け、濃いスモークを引きながら頭の上を通り抜けます。' }
  ];
  /* 展示飛行モードの長さ（秒、離陸から着陸まで）。既定は曲 2 周ぶん:
     曲は「頭から 3 分 58 秒」まで流れ、そのあとは 0 分 13 秒へ戻って繰り返すので、
     1 周目 = 238 秒、2 周目 = 238 - 13 = 225 秒、合わせて 463 秒。設定で変えられる */
  const SHOW_LEN_DEFAULT = (MUS_LOOP_END_S - MUS_LEAD_S) + MUS_LOOP_END_S;
  let showLen = SHOW_LEN_DEFAULT;
  /* 課目の役割。序盤: 遠くから来て大きく開く（ファンファーレ）。中盤: 技。終盤: 締め。フィナーレ: 最後の一幕。
     おまかせの構成はここから組む。自分で選ぶときは、どの役割の課目もどの枠にも置ける */
  const ROLE = { bloom: 'open', touch: 'open', tuck: 'open', opro: 'open',
                 change: 'mid', rain: 'mid', eight: 'mid', loop: 'mid', wide: 'mid', roll: 'mid', vert: 'mid', half: 'mid', turnloop: 'mid',
                 tree: 'close', cupid: 'close', byover: 'close', pass: 'close',
                 cork: 'finale', star: 'finale' };
  const IDX = id => PROGRAM.findIndex(m => m.id === id);
  const ORBIT = 11;                        // 課目のあいだの旋回
  /* おまかせで抽選するのは、動きを実測して整えた課目だけ。ほかは「自分で選ぶ」でだけ置ける */
  const AUTO_OK = new Set(['bloom', 'touch', 'tuck', 'opro', 'change', 'rain', 'eight', 'tree', 'cupid', 'cork', 'star']);
  const POOL = role => PROGRAM.map((m, i) => i).filter(i => ROLE[PROGRAM[i].id] === role && AUTO_OK.has(PROGRAM[i].id) && okMan(PROGRAM[i]));
  let customProg = null;                   // 自分で選んだ並び（課目 id の配列）。null ならおまかせ
  let showT = 0;                           // 離陸してからの経過（秒）
  let chunk = null, chunkPos = 0;          // いま行っているまとまりと、その中の位置
  /* 演目の並びを組む。
     自分で選んであれば、その並び（離陸 → 旋回 → 課目 → 旋回 → 課目 …）。
     おまかせなら、長さに合わせて 序盤 → 中盤 × n → 終盤 → フィナーレ を役割ごとに抽選する。
     短め（曲 1 周）は中盤なし、標準（2 周）は中盤 1 つとフィナーレ、長め（3 周）は中盤 2 つとフィナーレ。
     足りなければ nextManeuver で中盤を足し、行き過ぎれば終盤へ飛ばす（おまかせのときだけ） */
  function pickChunk() {
    chunkPos = 0;
    if (customProg && customProg.length) {
      const seq = [0];
      customProg.forEach(id => { const i = IDX(id); if (i >= 0 && okMan(PROGRAM[i])) seq.push(ORBIT, i); });
      chunk = seq.length > 1 ? seq : null;
      return chunk;
    }
    const used = [], seq = [0];
    const take = role => { const c = POOL(role).filter(i => !used.includes(i)); if (!c.length) return; const i = c[Math.floor(Math.random() * c.length)]; used.push(i); seq.push(ORBIT, i); };
    take('open');
    const nMid = showLen < 350 ? 0 : showLen < 600 ? 1 : 2;
    for (let k = 0; k < nMid; k++) take('mid');
    take('close');
    if (showLen >= 400) take('finale');
    chunk = seq.length > 1 ? seq : null;
    return chunk;
  }
  /* 演目の見せ方。once: 地上にいれば離陸から始め、一通り終えたら着陸して終わる。
     loop: 離着陸を含まず、ずっと繰り返す（体験版の投影） */
  let showLoop = false;                    // ずっと繰り返す（体験版の投影だけ）
  let showThru = false;                    // 通し: 離陸から着陸まで、ひととおり行う（自動操縦を 2 回押したとき）
  let allowIds = null;                     // 見せる課目を絞る（体験版）。null なら全部
  const okMan = m => !allowIds || allowIds.indexOf(m.id) >= 0;
  let auto = false, oneShot = false, step_i = 0, manT = 0, rollSum = 0, loopSum = 0, hdgSum = 0, prevH = 0, userForm = 'solo';
  let manPhase = 'do', phaseT = 0, aimX = 0, aimY = 0, planFace = 0, turnSign = 1;
  let touchDone = false;                   // タッチ・アンド・ゴーで、滑走路に触れたか
  const TOUCH_RUN = 1.4;                   // タッチ・アンド・ゴーで、タイヤをつけているあいだ（秒）
  let touchT = 0, touchAge = 0;            // 接地しているあいだ／接地してからの時間（秒）
  /* 散開（サンライズ・レインフォール）。開き始めた点から放射状に広がるには、
     間隔を「時間に比例して」広げる。比例で広げると、各機はその点からまっすぐ離れていく。
     ゆっくり・速くと変えると線が曲がるので、比例のまま最後まで広げる */
  const SPREAD_RATE = 0.62;                // 1 秒あたり、もとの間隔の何倍ずつ広げるか
  /* サンライズで開き始める位置（散開位置）。観覧位置から、もとの壁があったあたりまでの距離。
     そこまでは平らな三角のまま、スモークを引いて直進する */
  const BLOOM_AT = SPREAD_D;
  let reIn = 0;                            // 進入をやり直した回数（近すぎるところで始めないため）
  let spreadOn = false, spreadT = 0, bloomOut = false;
  /* サンライズの散開（v04.34）: 横に開きながら、全機が同じ率で上げていく（利用者の指示: 上昇角は変化し続け、
     1 番機は最終的に 45 度。中間の機も上昇し、鉛直面でも円になる）。
     横の開き: 機体それぞれが 4 秒で短く旋回して放射の向きへ向き、あとはまっすぐ。水平に落として外側は右端から 30・150 度、
     1 番機はまっすぐ（90 度）。内側の 2 機は「地上から見て」外側と真ん中の間に見える向き（画面での角が外側と 90 度の間）。
     上昇: 開き始めの BLOOM_TURN_AT 秒後から、BLOOM_CLIMB_T 秒かけて一定の率で BLOOM_CLIMB 度まで上げる
     （率が一定なので、鉛直面では円弧の引き起こし）。全機同じ率で上げ、要からの距離は 3 次元でそろえる（機首先端が球の上に並ぶ）。
     向きの変化（開き）は全機同時。傾き（ロール）だけ外側が BLOOM_ROLL_LEAD 秒先に始める。
     曲がる角は、放射の線（要から機首先端への向き）が狙いの角になる値（旋回の弦のずれと 0.8 秒の遅れぶん、向きの角より大きい）:
     外側 82.2 度 → 水平で 30 度（画面 32.0 度）、内側 25.9 度 → 70.2 度（画面 61.0 度 = 外側と真ん中の間）。calib_v34b で数値的に求めた */
  const BLOOM_IN_ANG = 25.9, BLOOM_OUT_ANG = 82.2;
  /* 上昇角の終わり（度）と、そこまでの時間（秒）。10.2 秒だと、散開位置（正面 600 m）から原点の上まで 11.0 秒で、
     45 度に達するのがちょうど原点の通過と同時になる（利用者の指示。率 4.4 度/秒、約 1.5 G） */
  const BLOOM_CLIMB = 45, BLOOM_CLIMB_T = 10.2;
  const BLOOM_OUT = 45;                    // 散開から課目の終わりまで（秒）。終わりは位置ではなく時間で測る（利用者の指示）
  const bloomG = t => BLOOM_CLIMB * D * clamp((t - BLOOM_TURN_AT) / BLOOM_CLIMB_T, 0, 1);   // 開き始めからの時間 → 上昇角
  const BLOOM_TURN = 4;                    // 曲がりきるまで（秒）。短く曲がって、あとは直線の放射にする
  const BLOOM_TURN_AT = 0.8;               // 開き始め（向きの変化）は全機同時にこの秒数あと
  const BLOOM_ROLL_LEAD = 0.8;             // 外側の 2 機はこの秒数だけ先に傾き始める（ロールは時間差、散開は同時）
  const lfV = new THREE.Vector3(), lfUp = new THREE.Vector3(), lfRt = new THREE.Vector3();   // 1 番機の姿勢づくり
  const BLOOM_TURN_V = 6;                  // 鉛直下向きから水平へ（レインフォール）の引き起こし（秒）
  const RAIN_PULL_Z = 330;                 // レインフォールの散開位置の高さ（ここから引き起こす。終わりは 150 m ほど）
  let rainDive = false, rainT = 0;         // レインフォール: 押し下げに入ったか、その経過
  let bloomS = null;
  const bq = new THREE.Quaternion();
  /* vertical = true はレインフォール: 鉛直下向きから、それぞれの水平の向きへ曲がる */
  /* 曲がっているあいだに「進んだ距離」あたり、開いた点からどれだけ離れるか（0〜1）。
     向きは v0 と v1 を混ぜて決めているので、等速で回る円弧の式（sin(θ/2)÷(θ/2)）とは合わない。
     数で積むと 48 度で 0.957、90 度で 0.839（円弧の式では 0.971 と 0.900）。
     この逆数だけ速く飛べば、開いた点からの距離がどの機体でも同じになる＝機首の先端が弧に並ぶ */
  function chordFactor(ang) {
    if (!ang) return 1;
    const a = ang * D, n = 240; let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n, e = s * s * (3 - 2 * s);
      const dx = e * Math.sin(a), dy = (1 - e) + e * Math.cos(a), L = Math.hypot(dx, dy);
      sx += dx / L; sy += dy / L;
    }
    return Math.hypot(sx, sy) / n;
  }
  const NOSE_D = 6.9;                      // 機首の先端まで（尾のスモークを出す位置と対称）
  function startBloom(vertical, baseH) {
    bloomS = { t: 0, list: [], vert: !!vertical, climb: !vertical, c: plane.position.clone() };   // c: 開き始めた点（放射の要）
    const dur = vertical ? BLOOM_TURN_V : BLOOM_TURN;
    const hb = baseH === undefined ? st.h : baseH;         // 基準の向き（1 番機の向き）
    const f0 = new THREE.Vector3(Math.sin(hb * D), Math.cos(hb * D), 0);      // 1 番機の向き（水平）
    const rt = new THREE.Vector3(Math.cos(hb * D), -Math.sin(hb * D), 0);     // 1 番機の右
    bloomS.v0 = f0;
    mates.forEach((holder, i) => {
      if (i >= 4) return;
      const side = (i % 2 === 0) ? -1 : 1;                  // 0・2 が左、1・3 が右
      const outer = i >= 2;                                  // 外側の 2 機
      const ang = (outer ? BLOOM_OUT_ANG : BLOOM_IN_ANG) * side;
      const v0 = vertical ? new THREE.Vector3(0, 0, -1) : f0.clone();
      const v1 = f0.clone().multiplyScalar(Math.cos(ang * D)).addScaledVector(rt, Math.sin(ang * D)).normalize();   // 水平で前から ang（上昇は placeBloom で重ねる）
      /* 曲がる角ぶんだけ遠回りになるので、その比だけ速く飛ぶ（上昇は全機同じなので比に入らない）。
         鉛直下向きから水平へ（レインフォール）は、どの機体も 90 度曲がる */
      const turn = Math.acos(clamp(v0.dot(v1), -1, 1)) / D;
      const vk = 1 / chordFactor(turn);
      bloomS.list[i] = { p: holder.position.clone(), v0, v1, ang, dur, vk,
                         delay: vertical ? 0 : BLOOM_TURN_AT,                    // 開きは全機同時
                         lead: (!vertical && outer) ? BLOOM_ROLL_LEAD : 0 };    // 傾きは外側が先
    });
  }
  /* 散った機体を、いまの位置から隊形へ戻す（ふつうの合流にわたす） */
  function endBloomMates() {
    mates.forEach((h, i) => { if (i < 4 && bloomS && bloomS.list[i]) {
      const u = h.userData;
      mo.copy(h.position).sub(plane.position).applyQuaternion(qInv.copy(att).invert());
      /* 放射で遠くへ離れた機は、そこから隊形へ寄せると何十秒もかかり、途中で 1 番機の瞬間移動に引きずられる。
         見えない距離まで離れているので、いったん隠して「無限遠を飛んでいる」扱いにし、次の課目の進入で合流させる（v04.36） */
      /* 見えているときは、その場で消さずに放射の向きのまま飛び去らせ、視界から出てから隠す（departStart。利用者の指摘 2026-09-24） */
      if (mo.length() > 500) { if (h.visible && inCamView(h.position)) departStart(h, u, true); else departHide(h, u, i, true); }
      else u.cur.copy(mo);
      u.from = null; } });
    bloomS = null;
  }
  const bv = new THREE.Vector3(), bIn = new THREE.Vector3(), bUp = new THREE.Vector3(), bRt = new THREE.Vector3();
  const bNose = new THREE.Vector3(), bArm = new THREE.Vector3();
  function placeBloom(holder, u, i, dt, emitting, color) {
    const b = bloomS.list[i];
    if (!b) { holder.visible = false; u.shown = false; return; }
    const tt = Math.max(0, bloomS.t - b.delay), k = clamp(tt / b.dur, 0, 1);
    const e = k * k * (3 - 2 * k);                           // ゆるやかに曲がり始め、ゆるやかに止める
    /* 進む向きは、始めの向き（v0）から終わりの向き（v1）へ回していく。
       水平なら旋回、鉛直下向きからなら引き起こし。位置は前へ進めるだけ（実際に飛べる動き） */
    bv.copy(b.v0).lerp(b.v1, e); if (bv.lengthSq() < 1e-6) bv.copy(b.v1); bv.normalize();
    if (bloomS.climb) { const g = bloomG(bloomS.t); bv.multiplyScalar(Math.cos(g)).addScaledVector(AZ, Math.sin(g)).normalize(); }   // 全機同じ率で上げる
    const v = SPEED * spdK * (b.vk || 1);
    /* 進む距離は「機首の先端が、1 番機と同じ半径の弧に乗る」ように決める（＝扇の形）。
       曲がる角ぶんの速さ（vk）だけでは、中央の 2 機が弧の内側へ 6〜19 m 凹んだ（実測 v04.28。利用者の指摘）。
       開いた点の近くでは半径の向きが定まらないので、120 m から 250 m のあいだで少しずつ効かせる */
    let ds = v * dt;
    if (bloomS.c) {
      bNose.copy(plane.position).addScaledVector(fwd, NOSE_D).sub(bloomS.c);      // 1 番機の機首の先端
      bArm.copy(b.p).addScaledVector(bv, NOSE_D).sub(bloomS.c);                   // この機体の機首の先端
      if (!bloomS.vert && !bloomS.climb) { bNose.z = 0; bArm.z = 0; }        // 水平に開くときは水平面ではかる
      const want = bNose.length(), ad = bArm.dot(bv), disc = ad * ad + want * want - bArm.lengthSq();
      if (disc > 0) {
        const arc = clamp(-ad + Math.sqrt(disc), v * dt * 0.5, v * dt * 1.6);     // 速さは半分から 1.6 倍まで
        const w0 = clamp((want - 120) / 130, 0, 1), w = w0 * w0 * (3 - 2 * w0);
        ds = ds * (1 - w) + arc * w;
      }
    }
    b.p.addScaledVector(bv, ds);
    if (bloomS.vert) {
      /* 引き起こし: 機体の上（揚力の向き）は曲がる内側へ。終わりは上向き */
      bIn.copy(b.v1).addScaledVector(bv, -b.v1.dot(bv));
      if (bIn.lengthSq() < 1e-6) bIn.set(0, 0, 1); else bIn.normalize();
      bUp.copy(bIn).multiplyScalar(1 - e).addScaledVector(AZ, e).normalize();
    } else {
      /* 旋回: 傾きは旋回率に見合ったバンクにする。外側は lead 秒だけ先に傾き始める（ロールは時間差、開きは同時） */
      const kb = clamp((bloomS.t - b.delay + (b.lead || 0)) / b.dur, 0, 1);
      const om = (b.ang * D) * (6 * kb * (1 - kb)) / b.dur;    // 角速度（rad/s）
      const bank = clamp(Math.atan(v * om / 9.81), -1.05, 1.05);
      bRt.crossVectors(bv, AZ).normalize();                  // 右向き
      bUp.copy(AZ).multiplyScalar(Math.cos(bank)).addScaledVector(bRt, Math.sin(bank)).normalize();
    }
    bRt.crossVectors(bv, bUp).normalize(); bUp.crossVectors(bRt, bv).normalize();
    bq.setFromRotationMatrix(fmat.makeBasis(bRt, bv, bUp));
    holder.position.copy(b.p);
    if (holder.position.z < 3) holder.position.z = 3;
    turnMate(holder, bq, dt);
    holder.visible = true; u.shown = true;
    if (emitting && color) { emitPos.set(0, -6.9, -0.3).applyQuaternion(bq).add(b.p); emit(emitPos, color, null, 0, i + 1); }
  }
  let chgT = -1;                           // チェンジオーバー・ターン: 隊形が組めてからの時間（秒）。-1 は待っているあいだ
  /* 瞬間移動をしない進入（利用者の指示 13）。スタークロスの次の課目と、着陸で立てる。
     立っているあいだは、進入の入口まで実際に飛ぶ */
  let noJumpIn = false;
  let landLeg = 0;                         // 着陸の回り込み: 0 = 南東の待ちの位置へ、1 = 延長線へ
  let smokeAll = false;                    // この課目のあいだは、隊形を組み替えてもスモークを止めない
  let rainOn = false;                      // レインフォールで降りているあいだ（引き起こしを止める）   // 進入の段階（in: 門へ、align: 正面の中心へ、do: 技）
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
  /* 舵取りで倒せるバンクの上限（度）。ふつうは 52。
     旋回半径は速さの 2 乗で伸びるので、速い課目では上限を上げないと曲がりきれない
     （実測: 60 m/s・52 度で半径 287 m、81 m/s なら 525 m）。課目の始めに 52 へ戻す */
  let bankLim = 52;
  function steerTo(tx, ty, tz) {
    const wantH = ((Math.atan2(tx - st.x, ty - st.y) / D) % 360 + 360) % 360;
    const wantB = clamp(wrap180(wantH - st.h) * 1.4, -bankLim, bankLim);
    autoIn.x = clamp((wantB - st.b) / 22, -1, 1);
    /* 高さの合わせ方。差だけで機首の角度を決めると、行き過ぎて上下に揺れる（実測: 上昇中に
       機首が 29 度 → -18 度 → 24 度 と振れ、急上昇と急降下を繰り返して見えた）。
       いまの上下の速さぶんを差し引く（近づくほど機首を戻す）と、行き過ぎずに寄っていく。
       角度の上限も 16 度までにして、自然に上がれる範囲にとどめる */
    const climb = fwd.z * SPEED * Math.max(0.2, spdK);      // いまの上下の速さ（m/s）
    const wantP = clamp((tz - st.z) * 0.09 - climb * 0.45, -16, 16);
    autoIn.y = -clamp((wantP - st.p) / 10, -1, 1);
    autoIn.r = 0;
  }
  const holdBank = b => { autoIn.x = clamp(wrap180(b - st.b) / 18, -1, 1); };   // 背面（180 度）でも境目で暴れない
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
  /* 決めた中心のまわりを回る（dir = +1 で反時計回り、-1 で時計回り）。少し先の点を狙う */
  function orbitAround(cx, cy, R, z, dir) {
    const a = Math.atan2(st.y - cy, st.x - cx) + 0.45 * dir;
    steerTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R, z);
  }
  const bearO = () => ((Math.atan2(st.x - GROUND_EYE.x, st.y - GROUND_EYE.y) / D) % 360 + 360) % 360;   // 原点から見た方位
  const CHG_R = 850;                       // チェンジオーバー・ターンの弧の半径（m）
  const DTAKE_R = 330;                     // ダイヤモンド・テイクオフのあと、原点のまわりを回る輪の半径（m）。v04.24: 520 → 330（近くで見せる）
  let dtT = -1;                            // その一周の経過（秒）。-1 はまだ上がっている途中
  let halfT = -1;                          // ハーフ・スロー・ロール: 背面になってからの秒数。-1 はまだ背面に入る前、9 は終わり
  let tkWp = 0, tkT = 0, tkT2 = 0;         // タック・クロスの通過点の番号、背面へ回す経過、外側へ戻す経過（秒）
  let oproX = false, oproUp = false, oproZ = -1, oproBack = false;   // オポジット: 交差したか、機首を上げ終えたか、進入の高さ、視線を 1 番機に戻したか
  let rollBoost = 1;                       // 横転の速さの倍率（オポジットの連続ロールで上げる）
  const OPRO_ROLL = 3.2;                   // オポジットの連続ロールの速さ（ふつうの 3.2 倍 = 192 度/秒。利用者の指示 第 2 便 8）
  const OPRO_SPD = 1.8;                    // 進入と離脱の速さ（利用者の指示 第 2 便 6。1.4 → 1.8）
  const OPRO_DZ = 9;                       // 交差での上下の離れ（m）。横は鏡なので必ず 0 で交わり、この値がそのまま最接近距離になる
  let noTurn = false;                      // 連続ロールのあいだ、傾きで向きを変えない
  let smokeNone = false;                   // 課目の終わりに、全機いっせいにスモークを切る
  function orbitEye(z) {
    const e = eyeDir();
    const cx = e.ex + e.dx * SHOW.GATE, cy = e.ey + e.dy * SHOW.GATE;
    const a = Math.atan2(st.y - cy, st.x - cx) + 0.5;
    steerTo(cx + Math.cos(a) * SHOW.R, cy + Math.sin(a) * SHOW.R, z || SHOW.ALT);
  }
  const holdPitch = p2 => { autoIn.y = -clamp((p2 - st.p) / 10, -1, 1); };
  /* いま見ている向き（地上視点なら自分で向けた方向、それ以外は観覧位置から北） */
  function eyeDir() {
    if (curView === 'ground') {
      /* 演目を行う正面は、決まった向き（滑走路と同じ北）にする。
         見ている向きで決めると、機体を目で追っているあいだは
         「あちらを見る → そこで演目をする → もっとあちらを見る」と、演目がどんどん遠くへ流れていく
         （利用者「はるか彼方へ向かっている」「正面から突き進む系の経路がすべて怪しい」の元）。
         自分で向きを決めて見ているとき（追従なし・自動操縦なし）だけ、見ている向きを正面にする */
      /* 演目の場所は、決まった立ち位置（滑走路の東）と北向きで決める。
         歩いた先を基準にすると、開始位置・散開位置・終了位置が動いてしまう */
      if (follow || auto) { const u = frU(); return { ex: GROUND_EYE.x, ey: GROUND_EYE.y, dx: u.dx, dy: u.dy }; }
      /* 自分で向きを決めて見ているときも、演目の原点は立ち位置ではなく決まった座標（GROUND_EYE）。
         視点に合わせると、歩いた先で演目の位置が動いてしまう */
      const a = gYaw - look.y;
      return { ex: GROUND_EYE.x, ey: GROUND_EYE.y, dx: Math.sin(a), dy: Math.cos(a) };
    }
    const u0 = frU();
    return { ex: GROUND_EYE.x, ey: GROUND_EYE.y, dx: u0.dx, dy: u0.dy };
  }
  /* 技に入る前の進入路を決める。見ている正面の少し先を中心に、近いほうの横から入って正面を横切る。
     入る場所は文（st.cue）と地上の柱で知らせる */
  function planEntry(m) {
    const e = eyeDir(), W = auto ? SHOW_LIMIT + 900 : LIMIT - 220;   // 自動操縦では壁がないので、門を遠くに置ける（演目の基準の距離から）
    const cx = clamp(e.ex + e.dx * SHOW.GATE, -W, W), cy = clamp(e.ey + e.dy * SHOW.GATE, -W, W);
    const sx = e.dy, sy = -e.dx;                                          // 正面から見て右向き
    /* ふつうは機体に近いほうの横から。課目が入る側を決めているとき（side: -1 は左手）はそれに従う */
    const side = m.side || (((st.x - cx) * sx + (st.y - cy) * sy) >= 0 ? 1 : -1);
    GATE.z = Math.max(ALT_MIN, (m.alt || SHOW.ALT_IN) * ALT_K);
    planFace = ((Math.atan2(e.dx, e.dy) / D) % 360 + 360) % 360;
    if (m.rwy) {                        // 滑走路に平行に進入する（南から北向きに乗る）
      GATE.x = RWY.x + side * 140; GATE.y = RWY.y - 2400;   // 門は南のずっと遠く。向き直してから線に乗る距離をとる
      aimX = RWY.x; aimY = RWY.y - 500; planFace = RWY.h;
      formScale = 1;                                          // （追従は 1 番機の道をたどるので、間隔を広げない）
      st.cue = '滑走路に平行に進入'; marker.position.set(GATE.x, GATE.y, 160); markOn = true; return;
    }
    if (m.at !== undefined) {           // 決めた方角の点から入る（北西など）。atN で北へずらせる
      const k = keyPt(m.at, m.atR || KEY_R);
      if (m.atN) { const u = frU(); k.x += u.dx * m.atN; k.y += u.dy * m.atN; }   // 前へずらす
      GATE.x = k.x; GATE.y = k.y; aimX = k.x; aimY = k.y;
      st.cue = DIRJA[Math.round(m.at / 45) % 8] + 'から進入'; marker.position.set(GATE.x, GATE.y, 160); markOn = true; return;
    }
    if (m.entry === 'front') {
      /* 正面の遠くから向かってくる課目。門は正面の線から少し横に置く。
         そこから正面の線に乗り直してくるので、まっすぐ向かってくる形になる
         （線の上に門を置くと、門で 180 度 向き直すことになり、正面から外れる） */
      const ff = m.gate || FRONT_FAR;                                    // 課目ごとに、進入の門を遠くに置ける
      GATE.x = clamp(e.ex + e.dx * (SHOW.GATE + ff) + sx * side * FRONT_SIDE, -W, W);
      GATE.y = clamp(e.ey + e.dy * (SHOW.GATE + ff) + sy * side * FRONT_SIDE, -W, W);
    } else {                            // 近いほうの横から入って、正面を横切る
      GATE.x = clamp(cx + sx * side * SHOW.SIDE, -W, W);
      GATE.y = clamp(cy + sy * side * SHOW.SIDE, -W, W);
    }
    GATE.z = Math.max(ALT_MIN, (m.alt || SHOW.ALT_IN) * ALT_K);   // 地上から見やすいように少し低くする（低い課目はそのまま）
    aimX = cx; aimY = cy;
    const bear = ((Math.atan2(GATE.x - e.ex, GATE.y - e.ey) / D) % 360 + 360) % 360;
    const face = ((Math.atan2(e.dx, e.dy) / D) % 360 + 360) % 360;
    planFace = face;
    /* 進入の向きは方位だけで示す（「正面・右手・左手」は視点しだいで変わるので書かない） */
    st.cue = `${DIRJA[Math.round(bear / 45) % 8]}から進入`;
    marker.position.set(GATE.x, GATE.y, 160); markOn = true;
  }
  /* 演目の終わり: 縦隊に組み替えて滑走路へ降りる。
     滑走路の南 1100 m・高さ 160 m の点へ回り込んでから、接地点へ向かって降ろす。
     接地は step() のふつうの判定（z <= 3.2）に任せる（そこから減速・誘導路・待機まで既にある） */
  let landN = true;                        // 着陸の向き: true = 北向き（南から進入）
  let landStep = 0, landSide = 0;          // 着陸の道すじの段（0〜3）と、通る脇（+1 右 / -1 左）
  function beginLanding() {
    manPhase = 'land'; phaseT = 0; markOn = false;
    /* 進入はいつも南から北向き。向きを選ぶと、南向きのとき接地点が帯の外（y = -860）になり、
       僚機（いつも北向き）と逆向きに降りることにもなる（実測: 1 番機が (-16, -916) に接地） */
    landN = true;
    landStep = 0; landSide = 0; landLeg = 0;
    /* 着陸して滑走路へ戻るまでのあいだも、曲を頭から流す（無音の時間を作らない）。
       滑走路で待機に戻ったら、離陸に合わせてもう一度頭から流し直す */
    landRun = true; landDesc = -1; landMusOn = false;
    landCfg = true; smokeOn = false;                        // 着陸に入ったら全機スモークオフ（入れ直せない。次の出発で解ける）
    gearOn = false; lightsOn = false; applyGear();          // 滑走路の手前 1.8 km で着陸体制（タイヤ・ライト）に入る
    /* 曲: anthem がリストにあれば、ここでは流れている曲をそのまま続け、先頭の降下開始で頭から流し直す。
       なければ、これまでどおり頭から流して主旋律の直前で切る */
    if (musBuf && actx && auto && anthemIdx() < 0) { playMusic(); musCut = Math.max(0.5, musLead - 0.3); }
    formation = 'trail'; formScale = 1;
    /* 追従機は 1 番機の道を LAND_LAG 秒ずつ遅れてたどり、同じ位置に接地する（2 機ずつの着陸はやめた） */
    landClock = -1;
    startPath(LAND_LAG);
    /* 降りる滑走路を決め直す（2・4・6 番機は滑走路 2、3・5 番機は滑走路 1。同じ滑走路は 2 機おき = 36 秒おき）。
       以前は前のタッチ・アンド・ゴー（spreadOnLine）で決めた値が残り、タッチ・アンド・ゴーのない並びでは全機が滑走路 1 に、
       ある並びでもその時の割り当てのまま降りていた（利用者の指摘 2026-09-24） */
    mates.forEach((h, i) => { h.userData.rwx = ((i + 1) % 2) ? RWY2 : 0; });
    mates.forEach(h => { h.userData.ld = null; h.userData.mh = undefined; });
    /* 地上の視線は、視点が機内へ切り替わるまで先頭の着陸機（1 番機）だけを追う（利用者の指示 2026-09-24「視点が変わるまで先頭着陸機に注目」）。
       以前は全機の平均を見ていたので、18 秒ずつ遅れて道をたどる僚機（最後尾は 5 km 後ろ）に引かれ、
       視線が 1 番機から最大 113 度外れて空を見ていた（実測）。切り替えは一度の均一な振り向き（slowAim）で */
    aimN = 1; slowAim = SLOW_AIM;
    st.show = '着陸'; st.desc = '2 機ずつ、間をあけて滑走路へ降ります。';
    st.cue = '着陸へ入ります';
    if (treeMode) setTreeMode(false);
    gearOn = true; lightsOn = true; applyGear();
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
    mates.forEach(h => { h.userData.rejoin = false; });   // 開始位置に着いた。合流してきた機体もここからスモークを出せる
    /* 回る課目は、まず観覧位置から遠ざかる側へ回る（近づく側へ回ると頭の上を越えて後ろへ抜ける） */
    turnSign = wrap180(planFace - st.h) >= 0 ? 1 : -1;
    manT = 0; rollSum = 0; loopSum = 0; hdgSum = 0; prevH = st.h;
  }
  /* 課目を始める。使う隊形をそろえてから（いまの機数によらず集まる）、進入に入る */
  /* その技で使う装備を自動で入れる（入れるだけ。外すのは手で） */
  /* 技ごとに決めてある初期設定（スモーク・タイヤ・ライト）を反映する。
     自分で技を選んだときは「入れるだけ」で外さない（外すのは手動、という利用者の決め）。
     通しの演目（自動）では課目ごとに設定どおりに入れ替える（その課目に要らない装備はしまう）。
     ライトは技ごとの設定（set.lights）で入れる。時刻による自動点灯はしない。 */
  function applyPreset(m, full) {
    const set = m.set || { smoke: true };
    /* 滑走路に降りる課目（タッチ・アンド・ゴー）のタイヤとライトは、ここでは出さない。
       滑走路が見えていて、その延長線にまっすぐ乗ってから出す（進入の終わり、下の par のところ） */
    if (full) {
      smokeOn = !!set.smoke;
      gearOn = m.rwy ? false : !!set.gear;
      lightsOn = m.rwy ? false : !!set.lights;
      landCfg = false;
    } else {
      if (set.smoke) smokeOn = true;
      if (set.gear && !m.rwy) gearOn = true;
      if (set.lights && !m.rwy) lightsOn = true;
    }
    applyGear();
  }
  function beginManeuver(i) {
    endCork(); endFigure(); if (treeMode) setTreeMode(false);
    /* いまの課目に入っていなかった機体（隠れていた、または隊形に席がなかった）は、
       ここから合流する。合流して次の課目の開始位置に着くまでは、スモークを出さない（endEntry で解く） */
    { const pf = FORMATIONS[formation] || { offs: [] };
      mates.forEach((h, k) => { const u = h.userData; u.rejoin = !u.shown || !pf.offs[k]; }); }
    /* 次の課目の隊形に席のない機（例: レター・エイトの 5・6 番機、キューピッドの 4〜6 番機）は、始めから隠す。
       席がないまま見えていると、描いている最中にまわりをうろつく（利用者の指摘）。次に席のある課目で合流して現れる */
    { const nf = FORMATIONS[PROGRAM[i].form || userForm] || { offs: [] };
      if (auto && !oneShot && PROGRAM[i].id !== 'dtake' && !tkOn && gmode === 'fly')
        /* 見えている機は消さない（視界の中で突然消えた。実測: コークスクリューの始めに 3〜6 番機が 30〜56 m 先で消えた）。
           席がないので、そのまま隊形の後ろの遠く（ENTRY）へ離れていき、離れきったところで消える（placeMates） */
        mates.forEach((h, k) => { const u = h.userData; if (!nf.offs[k] && u.shown && !u.ground && !u.gp && !u.tk && !inCamView(h.position)) { h.visible = false; u.shown = false; u.rejoin = true; } }); }
    reIn = 0; if (PROGRAM[i].id !== 'takeoff') aimN = 0;   // 離陸ではアプリが「先頭機を追う」と指すので消さない
    /* スタークロスの次の課目は、瞬間移動せずに入口まで飛ぶ（利用者の指示 13）。
       ここではまだ step_i が「前の課目」なので、それで判じる */
    noJumpIn = !!(auto && !oneShot && PROGRAM[step_i] && PROGRAM[step_i].id === 'star');
    step_i = i; manT = 0; rollSum = 0; loopSum = 0; hdgSum = 0; prevH = st.h; phaseT = 0; formScale = 1; figAim = null; aimLeader = false;
    if (PROGRAM[i].id !== 'touch' && pathLag > 0) endPath();
    const m = PROGRAM[i];
    /* 正面を選ぶ: 機体がいる方角（進入の点の方角ぶんをずらして）に最も近い東西南北。
       そちらから入ってくれば回り込みが短い。滑走路を使う課目と離陸は選ばない（滑走路は北向き） */
    if (auto && !oneShot && !m.rwy && m.id !== 'dtake' && m.front !== false) {
      const b = ((Math.atan2(st.x - GROUND_EYE.x, st.y - GROUND_EYE.y) / D) % 360 + 360) % 360;
      const want = b - (m.at !== undefined ? m.at : 0);
      showFr = ((Math.round(want / 90) * 90) % 360 + 360) % 360;
    }
    formation = m.form || userForm;
    st.show = m.ja; st.desc = m.desc || '';
    e8 = null; touchDone = false; touchT = 0; touchAge = 0; mir = null; joinFast = false; chgT = -1; figClock = -1; smokeAll = false;
    spreadOn = false; spreadT = 0; bloomOut = false; bloomS = null; rainDive = false; rainT = 0; tkWp = 0; tkT = 0; tkT2 = 0; dtT = -1; halfT = -1; oproX = false; oproUp = false; oproZ = -1; oproBack = false; noTurn = false; smokeNone = false; rollBoost = 1;
    bankLim = 52;                            // 舵取りのバンクの上限は、課目ごとに決め直す
    lifeNow = FIG_LIFE[m.id] || SMOKE_LIFE;   // 図を描く課目のあいだだけ、消えるまでの時間を延ばす
    applyPreset(m, auto && !oneShot);        // 通しの演目では課目ごとに装備を入れ替える
    GATE.z = Math.max(ALT_MIN, (m.alt || SHOW.ALT_IN) * ALT_K);   // 地上から見やすいように少し低くする（低い課目はそのまま）
    /* 技をひとつだけ選んだときも、見ている正面へ回り込んでから行う（どの視点でも同じ）。
       演技は地上から見るためのものなので、目の前で行わないと課目の形が分からない */
    const gated = m.entry === 'front' || m.at !== undefined || m.rwy;
    if (((FORMATIONS[formation] || {}).n || 1) > 1 && !matesReady() && !gated) {   // 隊形が要る課目は、組んでから始める
      manPhase = 'gather'; phaseT = 0; st.cue = '隊形を組みます'; markOn = false;
    } else if (m.front !== false) {
      /* 進入の始めから、隊形を組み上がった形にする（利用者の指示 2026-09-12）。
         以前は「離れながら組む」で、僚機は進入のあいだずっと 1 番機を追いかけていた
         （実測: 平均 148 m/s・最大 150 m/s（上限）・1 番機から最大 867 m）。
         そのため反対側から超高速で来て急転回するように見えた。
         組み上がった形に置き直すのは、見えない距離で 1 番機を移す瞬間（snapForm は 'in' の移すところ）。
         ここ（課目の変わり目・見えているところ）で置き直すと、ダイヤモンドからサンライズへ移るときに
         3 機が扇の席へ跳び（速さの上限 150 m/s で 1 秒ほどで寄る）、隠れていた 5 番機が席に突然現れた
         （利用者の指摘 2026-09-24。実測: 5 番機が 1 番機から 45 m の席に、視界の中で現れた）。
         見えている機は、移すまでのあいだ ふつうの合流で席へ寄る。隠れている機は移す瞬間まで隠しておく（holdUnseen） */
      holdUnseen();
      planEntry(m); manPhase = 'in';
    }
    else if (st.z < GATE.z - 60) { manPhase = 'climb'; st.cue = '高度を取ります'; markOn = false; }
    else { manPhase = 'do'; st.cue = ''; markOn = false; }
  }
  /* 隠れている機で、次の隊形に席があるものは、移す瞬間（hold を 0 にする所）まで隠したままにする。
     置き場は隊形の後ろの遠く。移さないまま hold が切れたときは、そこから合流してくる */
  function holdUnseen() {
    const f = FORMATIONS[formation] || { offs: [] };
    mates.forEach((h, i) => { const u = h.userData;
      if (u.shown || !f.offs[i] || u.ground || u.gp || u.tk || u.parked || (u.queue !== undefined && u.queue >= 0)) return;
      const e = ENTRY[i]; u.cur.set(e[0], e[1], e[2]); u.hold = Math.max(u.hold || 0, 90); u.k = 1; u.from = null; u.rejoin = true; });
  }
  function nextManeuver() {
    formScale = 1;
    if (oneShot) {   // 1 つだけの技なら、水平に戻してから操縦を返す
      manPhase = 'out'; phaseT = 0; st.cue = '水平に戻します'; markOn = false; endCork(); endFigure(); if (treeMode) setTreeMode(false); return;
    }
    /* まとまり（チャンク）で行っているときは、その並びの次へ。終わったら着陸する */
    if (chunk && !oneShot) {
      chunkPos++;
      const last = chunk.length - 1;
      if (chunkPos >= chunk.length) {
        /* 並びを行い終えた。おまかせで、決めた長さにまだ間があるなら中盤の課目を 1 つ足す。
           着陸そのものに 2 分ほどかかるので、その手前で切り上げる */
        if (!customProg && showT < showLen - LAND_TIME - 60) {
          const pool = POOL('mid').filter(i => !chunk.includes(i));
          if (pool.length) { chunk = chunk.concat([ORBIT, pool[Math.floor(Math.random() * pool.length)]]); beginManeuver(chunk[chunkPos]); return; }
        }
        chunk = null; beginLanding(); return;
      }
      /* 行き過ぎているときは、最後の課目へ飛ばす（そこで締めて着陸に入る）。自分で選んだ並びは端折らない */
      if (!customProg && chunkPos < last && showT > showLen - LAND_TIME) chunkPos = last;
      beginManeuver(chunk[chunkPos]);
      return;
    }
    let n = (step_i + 1) % PROGRAM.length;
    for (let k = 1; k <= PROGRAM.length; k++) {          // 見せない課目は飛ばす
      const j = (step_i + k) % PROGRAM.length;
      if (okMan(PROGRAM[j])) { n = j; break; }
    }
    /* 通しの演目は、一周したら着陸して終わる（固定モードのときは、そのまま繰り返す） */
    if (!showLoop && auto && !oneShot && n <= step_i) { beginLanding(); return; }
    beginManeuver(n);
  }
  /* 墜落しないための備え。低いときは、まず翼を水平に戻してから引き起こす
     （背面のまま引くと地面へ向かうので、順番が要る） */
  function safety() {
    if (st.z > 1500 && st.p > -10) { autoIn.y = 0.8; return; }        // 高すぎるときは下げる
    /* 壁の外へ出たら、中へ向き直る（急がず、傾きは 45 度まで）。自動操縦では壁がないので見ない */
    const outX = !auto && Math.abs(st.x) > LIMIT - 120, outY = !auto && Math.abs(st.y) > LIMIT - 120;
    if (outX || outY) {
      const wantH = ((Math.atan2(-st.x, -st.y) / D) % 360 + 360) % 360;
      const e = wrap180(wantH - st.h);
      if (Math.abs(e) > 25) { autoIn.x = clamp(clamp(e * 1.2, -45, 45) - st.b, -22, 22) / 22; }
    }
    /* 進む先に山や塔があれば、届く前に機首を上げて越える（当たり判定を避ける） */
    for (let k = 0; k < OBST_LOOK.length; k++) {
      const s2 = OBST_LOOK[k];
      const px = st.x + fwd.x * SPEED * s2, py = st.y + fwd.y * SPEED * s2, pz = st.z + fwd.z * SPEED * s2;
      const ter2 = terrainAt(px, py);
      if (ter2 <= 0) continue;                   // 平地は地面の手当て（このあと）に任せる
      const need = ter2 + 70;
      if (pz < need) {
        /* 山を越える。舵をいっぱいに引くと機首が 28 度まで跳ね上がり、不自然な急上昇に見える（実測）。
           「上げたい角度」を決めて、そこへ寄せる形にする（越える急ぎぐあいで 8〜22 度）。
           翼は水平に戻しきらない。戻すと行き先へ向き直る舵まで打ち消され、山のほうへ飛び続ける */
        const urg = clamp((need - pz) / 140, 0, 1);
        autoIn.y = -clamp((8 + 14 * urg - st.p) / 10, -1, 1);
        autoIn.x = clamp(autoIn.x, -0.7, 0.7);
        return;
      }
    }
    const ahead = st.z + fwd.z * SPEED * 6;                           // このまま 6 秒進んだときの高さ
    if (Math.abs(st.b) > 60 && st.z < 180 && fwd.z < 0.15) {          // 低くて背面気味: まず翼を水平に戻す
      autoIn.x = clamp(-wrap180(st.b) / 25, -1, 1); autoIn.y = clamp(st.p / 25, -0.2, 0.2); return;
    }
    /* 地面に着きそう: 引き起こす（向き直しは残す）。
       ただし離陸で上がっている最中は効かせない。効かせると、浮いた直後に目いっぱい引いて
       50 度も機首が上がり、飛び上がるように見える */
    if ((ahead < 90 || st.z < 70) && !(tkOn && fwd.z > 0.05)) {
      autoIn.x = Math.abs(st.b) > 45 ? clamp(-st.b / 20, -1, 1) : clamp(autoIn.x, -0.5, 0.5);
      /* ここも「上げたい角度」で。急ぎぐあいで 8〜22 度 */
      const urg = clamp((90 - Math.min(ahead, st.z)) / 90, 0, 1);
      autoIn.y = -clamp((8 + 14 * urg - st.p) / 10, -1, 1);
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
          auto = false; oneShot = false; manPhase = 'do'; st.show = ''; st.cue = ''; st.desc = ''; formation = userForm; formScale = 1; landCfg = false;
        }
        return autoIn;
      }
      if (manPhase === 'land') {           // 着陸: 旋回はしない。遠くの延長線上へ移ってから、まっすぐ降りる
        const sgn = 1, tdY = LAND_TD_Y;
        if (landStep === 0) {
          /* 着陸の進入へ入る。**瞬間移動しない**（利用者の指示 13）。
             滑走路の南東の待ちの位置へ回り込んでから、延長線（南 LAND_FAR、北向き）に乗る。
             いきなり入口を狙うと、北から来て入口で 180 度回ることになるので、2 段に分ける。
             高さは、その位置での勾配の高さへ向けて下げていく。
             どうしても合わないとき（4 分）だけ、これまでどおり位置を移す */
          autoIn.r = 0;
          const exX = RWY.x, exY = RWY.y - LAND_FAR;
          const wz = 3 + (tdY - exY) * LAND_SLOPE;
          if (landLeg === 0) {
            const dwX = RWY.x + LAND_DW_X, dwY = exY - LAND_DW_Y;
            steerTo(dwX, dwY, Math.max(wz, 220));
            if (Math.hypot(dwX - st.x, dwY - st.y) < 600) landLeg = 1;
          } else {
            /* 延長線へは斜めに寄せて乗る（線の先の点を狙う。横のずれが大きいほど先を狙い、寄せる角はおおむね 45 度まで）。
               以前は延長線上の 1 点（南 3.6 km）そのものを狙い、そこから 450 m・35 度以内で最終へ移していたので、
               横に 120 m ずれたまま最終に入り、滑走路へ斜めに近づいていた（利用者の指摘 2026-09-24「滑走路に斜めに侵入している」。
               実測: 接地点の手前 3 km で東へ 120 m、しきい値で 40 m、接地は中心線から 24 m） */
            const xt = st.x - RWY.x;
            steerTo(RWY.x, Math.max(st.y, exY - LAND_DW_Y) + clamp(Math.abs(xt), 600, 1500), wz);
          }
          const xt0 = Math.abs(st.x - RWY.x), dHx = Math.abs(wrap180(RWY.h - st.h));
          /* 最終へ移すのは、延長線に乗って（横 60 m・向き 12 度以内）南 3.6 km の近くまで来たとき。
             乗り切れずに北へ行き過ぎたときも移す（最終の舵が中心線へ寄せる） */
          if (landLeg === 1 && st.y > exY - 400 && ((xt0 < 60 && dHx < 12) || st.y > exY + 500)) {
            landStep = 1; landDesc = 0; landSide = 0; landLeg = 0;
            gearOn = false; lightsOn = false; applyGear();
            st.cue = '進入';
          }
          const far0 = Math.hypot(st.x - GROUND_EYE.x, st.y - GROUND_EYE.y);
          if (landStep === 0 && phaseT > 240 && (far0 > JUMP_FAR || phaseT > 300)) {
            st.x = RWY.x; st.y = RWY.y - LAND_FAR; st.z = 3 + (tdY - st.y) * LAND_SLOPE; st.h = RWY.h;
            spdK = 1; spdWant = 1; levelAttitude();
            plane.position.set(st.x, st.y, st.z);                  // 道と並びは移した先から作る（plane はこのコマの終わりまで移す前の位置のまま）
            seedHistory(100); slowAim = SLOW_AIM; mates.forEach(h => { h.userData.hold = 0; }); if (opt.onJump) opt.onJump();
            landStep = 1; landDesc = 0; landSide = 0;
            gearOn = false; lightsOn = false; applyGear();         // 着陸体制は滑走路の手前 1.8 km で
            spreadOnLine(LAND_LAG);                                // 追従機は後ろに 16 秒ずつ、滑走路 1・2 に交互
            st.cue = '進入';
          }
        } else {
          /* 最終進入: 線に乗ったまま、接地点までの距離で高さを決めて 3 度で降りる。
             滑走路の手前で着陸体制（タイヤ・ライト）に入り、速度を落とす */
          const far = Math.max(0, (tdY - st.y) * sgn);
          if (far < 1800 && !gearOn) { gearOn = true; lightsOn = true; applyGear(); st.cue = '着陸態勢'; landCfg = true; smokeOn = false; }
          spdWant = far < 2400 ? 0.72 : 1;
          let wz = far > 80 ? Math.min(3 + far * LAND_SLOPE, 400) : -25;
          const inStrip = Math.abs(st.y) < STRIP_END - 30;
          if (!inStrip) wz = Math.max(wz, 6);
          /* 中心線に乗せる: 横のずれ 1 m につき 0.35 度 中心線へ向ける（30 度まで）。
             接地点の先の 1 点を狙うと、ずれが接地まで残って斜めに降りた（上の実測）。ずれに比例して向けると、
             ずれは約 3 秒ごとに 1/e へ縮み、最終の始めの 1 km ほどで中心線に乗り切る */
          const wantH = (RWY.h - clamp((st.x - RWY.x) * 0.35, -30, 30) + 360) % 360;
          const turnMax = 8 * dt;
          const newH = (st.h + clamp(wrap180(wantH - st.h), -turnMax, turnMax) + 360) % 360;
          const bankL = clamp(wrap180(wantH - st.h) * 1.5, -20, 20);
          const pitchL = clamp(Math.atan2(wz - st.z, Math.max(60, far || 200)) / D, -9, 5);
          att.setFromAxisAngle(AZ, -newH * D);
          att.multiply(dq.setFromAxisAngle(AX, pitchL * D));
          att.multiply(dq.setFromAxisAngle(AY, bankL * D));
          readAttitude();
          /* anthem: 最後尾の接地（先頭 + 追従 5 機 × LAND_LAG）の LAND_TOTAL 秒前に頭から流す */
          /* anthem は「最終機が初期位置（駐機場）に戻りきる」1 分 6.5 秒前から頭で流す（利用者の指示 15）。
             以前は最後尾の接地を基準にしていた（v04.75 まで）ので、102 秒ぶん早く鳴っていた */
          if (!landMusOn && anthemIdx() >= 0 && actx && landDesc >= LAND_LAST + LAND_PARK - LAND_TOTAL) {
            landMusOn = true; const ai = anthemIdx(); musIdx = ai; playTrack(ai); musCut = LAND_TOTAL;
          }
          autoIn.x = 0; autoIn.y = 0; autoIn.r = 0; smIn.x = 0; smIn.y = 0; smIn.r = 0;
          if (st.z <= 4.5 && inStrip) { st.z = 3; gmode = 'land'; gv = SPEED * spdK; spdK = 1; spdWant = 1;
            gearOn = true; applyGear(); att.setFromAxisAngle(AZ, -st.h * D); readAttitude();
            if (landClock < 0) landClock = 0; }
        }
        /* 降りる組を目で追えるよう、視線はいま降りている組へ向ける */
        const lp = mates.find(h => h.userData.ld && !h.userData.ld.done && h.userData.ld.on);
        figAim = lp ? lp.position.clone() : null;
        autoIn.r = 0;
        if (gmode !== 'fly') {               // 接地した。あとは減速して滑走路へ戻る
          auto = false; oneShot = false; manPhase = 'do'; st.show = ''; st.desc = '';
          /* まだ降りていない組がいるあいだは、隊形を戻さない。
             戻すと（単機のときなど）僚機が隠され、着陸の段取りごと止まってしまう */
          /* 追従機が道をたどって降りてくるあいだは縦隊のまま（戻すと単機のとき追従機が隠れ、空中で止まる。実測） */
          formation = (pathLag > 0 && mates.some(h => h.userData.shown && !h.userData.pfDone)) ? 'trail' : userForm;
          formScale = 1;
        /* 時間は「制限」ではなく「目安」（利用者の指示 13）。回り込んで延長線に乗り、
           3.6 km の最終進入を降りるので、瞬間移動をやめたぶん時間がかかる。
           ここは詰まったときの受け皿として置く（v04.75 までは 120 秒で、回り込みの途中で着陸をやめていた） */
        } else if (phaseT > 420) { auto = false; oneShot = false; manPhase = 'do'; st.show = ''; }
        return autoIn;                        // 地面回避（safety）は呼ばない。呼ぶと降りられない
      }
      if (manPhase === 'gather') {         // 隊形が組めるまで待つ。観覧位置のまわりを回って待つので、遠くへ流れない
        /* 離陸の最中: 100 m まではまっすぐ上がる（回ると離陸そのものが不自然に見える）。
           そこからは 5・6 番機が上がるのを待つあいだも、原点のまわり（DTAKE_R）を速さ 0.8 で回る。
           まっすぐ待つと 50 秒で 1 km 以上離れ、視点から見えなくなった（実測 v04.24） */
        if (tkOn) {
          if (st.z < 100) { holdBank(0); holdPitch(clamp(12 - st.z / 30, 3, 12)); }
          else { spdWant = 0.8; orbitAround(GROUND_EYE.x, GROUND_EYE.y, DTAKE_R, GATE.z, turnSign >= 0 ? 1 : -1); }
          autoIn.r = 0; safety(); return autoIn;
        }
        orbitEye(GATE.z);
        /* 組めたら始める。正面から向かってくる課目だけ、門からの進入をやり直す。
           それ以外は、正面のまわりを回っているところから そのまま始める（回り込みで時間を使わない） */
        /* 隊形が組めるまで待つ。時間で切り上げると、揃わないまま演目が始まってしまう
           （チェンジオーバー・ターンのスモークが出ない、コークスクリューが遠くへ行く、などの元） */
        if (matesReady() || phaseT > 150) {
          spdWant = 1;                                                  // 離陸待ちで落としていた速さを戻す
          if (m.entry === 'front' || m.at !== undefined || m.rwy) { holdUnseen(); planEntry(m); manPhase = 'in'; phaseT = 0; }   // 席へ置き直すのは移す瞬間（見えているここではしない）
          else {
            /* 課目の時計（manT）と角度の積算は、ここから数え直す。以前は隊形を組んでいた時間が manT に乗ったままで、
               ハーフ・スロー・ロール（manT > 15 で終了）などは、組むのに 36 秒かかると始まった 1 コマ後に終わっていた
               （実測 2026-09-13: do が 1 コマだけで out へ）。進入から入る課目は endEntry で同じことをしている */
            manPhase = 'do'; st.cue = ''; markOn = false; phaseT = 0;
            manT = 0; rollSum = 0; loopSum = 0; hdgSum = 0; prevH = st.h;
          }
        }
        safety();
        return autoIn;
      }
      if (manPhase === 'climb') {          // 技に要る高さまで、まっすぐ上げる
        steerTo(st.x + fwd.x * 500, st.y + fwd.y * 500, GATE.z);
        if (st.z > GATE.z - 40 || phaseT > 20) endEntry();
      } else if (manPhase === 'in') {
        /* 門まで実際に飛ぶと、そのぶん時間がかかる。見えない距離まで離れたら、向きを進入の向きに
           合わせてから、進入の線の無限遠へ「位置だけ」移す。向きと姿勢はそのままなので、
           コックピットから見ても景色は回らない（移す瞬間は一瞬白くして見せない） */
        const dO = Math.hypot(st.x - GROUND_EYE.x, st.y - GROUND_EYE.y);
        let inH, jx, jy;
        if (m.rwy) { inH = RWY.h; jx = RWY.x; jy = RWY.y - JUMP_RWY; }
        else if (m.at !== undefined) {
          inH = m.inH !== undefined ? (m.inH + showFr) % 360
                                    : ((Math.atan2(GROUND_EYE.x - GATE.x, GROUND_EYE.y - GATE.y) / D) % 360 + 360) % 360;
          jx = GATE.x - Math.sin(inH * D) * JUMP_AT; jy = GATE.y - Math.cos(inH * D) * JUMP_AT;
        } else {
          inH = (planFace + 180) % 360;
          jx = GROUND_EYE.x - Math.sin(inH * D) * JUMP_FRONT; jy = GROUND_EYE.y - Math.cos(inH * D) * JUMP_FRONT;
        }
        /* まず離れる。離れる向きは「これから現れる側」（移す先 jx, jy の方角）。機首の向きのまま離れると、
           東へ去って西から現れる、といった無駄な動線になった（実測: 離陸のあとのタック・クロス）。
           移す先へ向かって離れれば、去った側から戻ってくる形になり、移す瞬間も同じ線の上 */
        /* 機内から見ているとき（一人称）は移さない。移すと景色が跳ぶのが分かる（利用者の指示: 瞬間移動は使うが、機内で見ているときはバレないように）。
           その場合は移す先（jx, jy）まで実際に飛び、そこで向き直して入る。地上から見ているときは、見えない距離で移す（従来どおり） */
        /* v04.29: 視点によらず移す。移す瞬間はアプリ側（onJump）で地上視点に戻す（機内・三人称のまま移さない） */
        if (noJumpIn) {
          /* 瞬間移動しない進入（スタークロスのあと）。入口まで実際に飛んで、向きが合ったら始める。
             どうしても合わないときだけ、これまでどおり移す（演目が止まらないように） */
          steerTo(jx, jy, GATE.z);
          const dJ = Math.hypot(jx - st.x, jy - st.y), dH = Math.abs(wrap180(inH - st.h));
          if ((dJ < 260 && dH < 40) || phaseT > 150) {
            hist.length = 0; clearSmoke();
            launchQueued();
            mates.forEach(h => { h.userData.hold = 0; h.userData.qw = null; });
            snapForm = true;                     // 僚機も隊形の位置へ置き直す
            slowAim = SLOW_AIM; beginMirror(m, false);
            manPhase = 'align'; phaseT = 0;
          }
        }
        else if (dO < JUMP_FAR) { const bj = Math.atan2(jx - GROUND_EYE.x, jy - GROUND_EYE.y); steerTo(GROUND_EYE.x + Math.sin(bj) * (JUMP_FAR + 600), GROUND_EYE.y + Math.cos(bj) * (JUMP_FAR + 600), GATE.z); }
        /* 向きは 60 度以内まで合わせれば移す（移す先で向きは進入の向きに置き直す）。
           8 度まで待つと、遠くで 180 度回り切るのに 17 秒かかった（実測 v04.24）。
           隊形が組めるのは待たない（移す瞬間に全機を席へ置く snapForm。組み上がるのを遠くで待つ理由がない） */
        else if (Math.abs(wrap180(inH - st.h)) > 60) {                                    // 向きをおおむね合わせてから移す
          holdBank(clamp(wrap180(inH - st.h) * 1.4, -45, 45));
          holdPitch(clamp((GATE.z - st.z) * 0.12, -15, 15));
        } else {                                                                          // 位置だけ移す
          st.x = jx; st.y = jy; st.z = GATE.z;
          att.setFromAxisAngle(AZ, -inH * D); readAttitude();
          hist.length = 0; clearSmoke();
          launchQueued();                        // 取り付けで待たせたままの 5・6 番機も、ここで上がった扱いにする
          mates.forEach(h => { h.userData.hold = 0; h.userData.qw = null; });   // 無限遠で待たせていた機は、ここで現れる（移した先なので見えない）
          snapForm = true;                       // 僚機も隊形の位置へ置き直す（1 番機と同じところから進入する）
          /* タッチ・アンド・ゴーの縦隊（9 秒ずつの間隔）も、ここで並べる。以前は技の始め（滑走路の手前、見えているところ）で並べていて、
             僚機が 1 コマで 0.9〜2.9 km 後ろへ跳んで見えた（実測） */
          if (m.id === 'touch') { plane.position.set(st.x, st.y, st.z); seedHistory(60); spreadOnLine(TOUCH_LAG); }   // 絵の位置（plane）はまだ移す前なので、先に合わせてから並べる
          slowAim = SLOW_AIM;                    // 地上の視線は、均一に振り向く（追いかけて飛ばない）
          beginMirror(m, true);                  // 交差する課目の相手は、この瞬間に鏡の位置へ移す（跳びが見えない）
          if (opt.onJump) opt.onJump();
          manPhase = 'align'; phaseT = 0;
        }
        if (phaseT > 70) { manPhase = 'align'; phaseT = 0; }
      } else {
        /* 正面から入る課目は、観覧位置そのものへ向かってまっすぐ飛ぶ。
           少し先（演目の中心）を狙うと、正面の線から斜めにずれたまま突っ込むことになる */
        const eA = eyeDir();
        /* 正面から入る課目は、原点そのものではなく「正面の線の 450 m 先」を狙う。
           原点を狙うと、横にずれた位置からは斜めに向かうだけで線に乗らない（ずれの角度が残る）。
           線の先を狙えば、線に寄ってから線の上を進む形になる */
        const alongA = (st.x - eA.ex) * eA.dx + (st.y - eA.ey) * eA.dy;
        const aX = m.entry === 'front' ? eA.ex + eA.dx * Math.max(-END_D, alongA - 450) : aimX;
        const aY = m.entry === 'front' ? eA.ey + eA.dy * Math.max(-END_D, alongA - 450) : aimY;
        approach(aX, aY, GATE.z);
        const wantH = ((Math.atan2(aX - st.x, aY - st.y) / D) % 360 + 360) % 360;
        if (m.entry === 'front') {
          /* 正面から入る課目は、観覧位置の正面の線に乗ってから始める（横にずれたまま始めると、
             まっすぐ進む課目が正面から外れる）。まだ 780 m 手前のうちに始めて、見ごたえを取る */
          const e5 = eyeDir();
          const along = (st.x - e5.ex) * e5.dx + (st.y - e5.ey) * e5.dy;
          const side = Math.abs((st.x - e5.ex) * e5.dy - (st.y - e5.ey) * e5.dx);
          /* ここで課目が始まる（＝スモークを出し始める）。近すぎると、整った姿を見せる間もなく
             頭の上へ来てしまうので、課目によっては もっと手前から始める（m.far） */
          /* 観覧位置へまっすぐ向かっていれば、横のずれは近づくほど減っていく。
             「近づいたときに真ん中へ来る」形（円すいの中）なら、遠いうちから始めてよい。
             横のずれを一律に厳しくすると、いつまでも始められず、頭の上まで来てしまう */
          /* 始める位置より ずっと内側に居るときは、門まで戻って入り直す。
             近くから始めると、遠くから向かってくる見せ場がなくなる */
          if (along < (m.far || FRONT_START) * 0.35 && reIn < 1) {
            reIn++; planEntry(m); manPhase = 'in'; phaseT = 0; safety(); return autoIn;   // 席へ置き直すのは、入り直しで移す瞬間
          }
          const cone = along * 0.14 + 40;
          if ((along < (m.far || FRONT_START) && side < cone && Math.abs(wrap180(wantH - st.h)) < 25) || phaseT > 45) endEntry();
        } else {
          if (m.rwy) {                  // 滑走路に平行になった時点が開始位置
            /* 線の少し先を狙って線に乗せる（原点狙いと同じ理由）。平行になった時点が開始位置 */
            approach(RWY.x, Math.min(RWY.y - 200, st.y + 450), GATE.z);
            const par = Math.abs(st.x - RWY.x) < 80 && Math.abs(wrap180(RWY.h - st.h)) < 12 && st.y < RWY.y - 250;
            /* 滑走路の延長線にまっすぐ乗った（滑走路が正面に見えている）ところで着陸体制: タイヤを下ろし、ライトを点ける */
            if (par && m.set && m.set.gear && !gearOn) { gearOn = true; lightsOn = true; applyGear(); st.cue = '着陸態勢'; landCfg = true; smokeOn = false; }
            if (par || phaseT > 70) endEntry();
          } else {
          const near = Math.hypot(st.x - aimX, st.y - aimY) < 280 && (m.at !== undefined || Math.abs(st.z - GATE.z) < 80);
          if ((near && Math.abs(wrap180(wantH - st.h)) < 50) || phaseT > 30) endEntry();
          }
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
        spdWant = E8_SLOW;                       // 3 機はふつうより遅く回る
        if (!e8) {
          if (!matesReady() && manT < 60) { orbitEye(GATE.z); st.cue = '隊形を組みます'; break; }   // 集まるまで待つ
          if (Math.abs(spdK - E8_SLOW) > 0.04 && manT < 30) { holdBank(0); holdPitch(0); break; }   // 速さが落ち着いてから始める
          const sg = turnSign, br = E8_BANK * D;
          const v3 = SPEED * spdK;                                                   // 3 機の速さ
          const R = clamp(v3 * v3 / (9.81 * Math.tan(br)), 90, 600);                 // 3 機の輪の半径（m）
          const a = (st.h - sg * 90) * D;
          const soloI = Math.min(2, mates.length - 1);
          const sp = (mates[soloI] && mates[soloI].visible) ? mates[soloI].position : plane.position;
          /* 離れる 1 機の輪は 3 機の 1/1.5。中心は 3 機と反対側。
             3 機が E8_LEAD_AT まで回るあいだに 1 周するので、その速さで飛ぶ */
          const rS = R / E8_RAD, lap = (2 * Math.PI * R) / v3;
          e8 = { s: sg, R, rS, lap, h0: st.h, z: sp.z, t0: hdgSum, solo: soloI, ph: 0, t: 0,
                 chase: false, done: false, joinT: -1, out: false,
                 v1: (2 * Math.PI * rS) / (lap * E8_LEAD_AT / 360),
                 cx: sp.x + rS * Math.sin(a), cy: sp.y + rS * Math.cos(a) };
        }
        /* 視線は離れた 1 機を追う。合流し終えたら（done）、ふつうの編隊の真ん中へ */
        { const sh = mates[e8.solo]; figAim = (!e8.done && sh && sh.visible) ? sh.position.clone() : null; }
        const turned = hdgSum - e8.t0;
        if (!e8.out) {
          /* スモークは、合流するまで 3 機が出す。合流したら先頭機と入れ替える（1 機が円を仕上げる） */
          smokeAll = true;
          holdBank(E8_BANK * turnSign); holdPitch(0);
          if (turned > 360) { e8.out = true; e8.outT = 0; }
        } else {
          /* 円を描き終えた。x 軸を負の向き（南）へ進み、後方の点まで行って一斉にスモークを切る */
          e8.outT += dt;
          spdWant = 1;
          { const ep = showPt(-3000, 0); steerTo(ep.x, ep.y, GATE.z); }
          const farE = Math.hypot(st.x - GROUND_EYE.x, st.y - GROUND_EYE.y);
          if (!smokeNone && (farE > REAR_END || e8.outT > 40)) { smokeNone = true; e8.offT = e8.outT; }   // 壁のあった位置で一斉にスモークオフ
          if (smokeNone && e8.outT > e8.offT + 2) { spdWant = 1; nextManeuver(); }
        }
        if (manT > 150) { spdWant = 1; nextManeuver(); }
        break;
      }
      case 'vert':                               // バーティカル・クライム・ロール: 垂直に上げながら横転
        if (st.p < 70 && manT < 8) { autoIn.x = 0; autoIn.y = -1; }
        else if (rollSum < 360 && st.z < 1200) { autoIn.x = 1; autoIn.y = 0; }
        else { autoIn.x = clamp(-st.b / 20, -1, 1); autoIn.y = 0.6; }
        autoIn.r = 0;
        if ((st.p < 10 && manT > 10) || manT > 26) nextManeuver();
        break;
      case 'half': {                             // ハーフ・スロー・ロール: ゆっくり背面にして少し飛び、戻す
        /* 段階は角度で切る: 背面（バンク 180 ± 6°）になるまでロール → 背面を 3 秒 → 水平（± 6°）になるまでロール。
           ロールは操縦桿 0.5（30°/s）。以前は時間で切っていた（全速 60°/s を 3 秒）ので、
           隊形を組んだあとのバンク（−53°）から始まると 127° で止まり、背面にならずに「背面の押し」で機首が下がって
           125 m 落ち、向きが 200° 回っていた（実測 2026-09-13）。「ゆっくり背面に入り」の説明とも合わなかった */
        const inv = Math.abs(wrap180(st.b - 180)) < 6;
        /* 機首の保持は、昇降舵の効く向きが cos(バンク) の符号で反転することを入れる（背面では押して機首を保つ）。
           横倒しの近くでは昇降舵は向きを変えるだけなので中立。実測: 一定の押し（−0.25）では背面 3 秒で機首が 12° 下がり、
           戻しのロール中に upright 用の保持を使うと機首が −42° まで落ちて 130 m 失っていた */
        const holdAny = tp => { const c = Math.cos(st.b * D); autoIn.y = Math.abs(c) < 0.25 ? 0 : -clamp((tp - st.p) / 8, -0.6, 0.6) * Math.sign(c); };
        if (halfT < 0) { if (inv) halfT = 0; else { autoIn.x = 0.5; holdAny(1.5); } }
        else if (halfT < 3) { halfT += dt; autoIn.x = clamp(wrap180(180 - st.b) / 20, -0.3, 0.3); holdAny(1.5); }
        else if (Math.abs(st.b) > 6) { autoIn.x = 0.5; holdAny(1.5); }
        else halfT = 9;
        autoIn.r = 0;
        if (halfT >= 9 || manT > 30) nextManeuver();
        break;
      }
      case 'bloom': {                            // サンライズ: 扇隊形で正面から進入し、散開位置で水平に放射状に開く（日の出）
        holdBank(0); autoIn.r = 0;
        const eb = eyeDir();
        const alongB = (st.x - eb.ex) * eb.dx + (st.y - eb.ey) * eb.dy;      // 観覧位置からの距離（正が正面側）
        smokeAll = true;                           // 開始位置から終わりまで、ずっとスモークを出す
        if (!spreadOn) {                           // 開始位置から散開位置まで、扇隊形のまま直進する
          holdPitch(2); formScale = 1;
          steerTo(eb.ex, eb.ey, GATE.z);           // 観覧位置へまっすぐ近づく
          if (alongB < BLOOM_AT || manT > 26) { spreadOn = true; spreadT = 0; startBloom(); }
          break;
        }
        spreadT += dt; bloomS.t = spreadT;
        /* 1 番機: 放射の真ん中。まっすぐのまま、僚機と同じ率で上げていく（開き始めの 0.8 秒後から 12 秒で 45 度）。傾きは 0 */
        { const g = bloomG(spreadT);
          lfV.copy(bloomS.v0).multiplyScalar(Math.cos(g)).addScaledVector(AZ, Math.sin(g)).normalize();
          lfRt.crossVectors(lfV, AZ).normalize(); lfUp.crossVectors(lfRt, lfV).normalize();
          att.setFromRotationMatrix(fmat.makeBasis(lfRt, lfV, lfUp)); readAttitude();
          autoIn.x = 0; autoIn.y = 0; autoIn.r = 0; smIn.x = 0; smIn.y = 0; smIn.r = 0; }
        /* 終わりは時間で測る（利用者の指示）。散開から BLOOM_OUT 秒。どの機体もそのままの進路で直進し続ける。
           45 度で上げながらなので水平の進みは 42 m/s。45 秒では観覧位置の 1.4 km 先まで抜ける。
           開始位置から終わりまで、ずっとスモークを出したままにする */
        if (spreadT > BLOOM_OUT) { endBloomMates(); nextManeuver(); }
        break;
      }
      case 'rain': {                             // レインフォール: サンライズと同じ要領。開始位置が散開位置の真上（鉛直）
        const alongR = showLocal(st.x, st.y).along;
        autoIn.r = 0; smokeAll = true;
        if (!rainDive) {
          /* 南から北へ、高いところを水平に散開位置の真上まで。
             押し下げて降りると、引き起こしは来た向きへ戻る（押した側に背中が向くため）。
             南から来れば、引き起こしで南（原点の側）へ抜ける。北から来て捻らずに降りると北へ抜けてしまう */
          rainOn = false; formScale = 1;
          { const rp = showPt(SPREAD_D + 800, 0); steerTo(rp.x, rp.y, GATE.z); }
          if (alongR > SPREAD_D - 170 || manT > 60) { rainDive = true; rainT = 0; }
          break;
        }
        rainT += dt;
        if (!spreadOn) {                           // 押し下げて真下へ。散開位置の高さまで降りる
          rainOn = true;
          /* 立ってくると傾きの読みが定まらず、それを直そうとして捻れる。60 度より立ったら横の舵は打たない */
          autoIn.x = st.p > -60 ? clamp(-st.b / 20, -1, 1) : 0;
          const need = clamp((st.p + 90) / 30, -0.5, 1);          // 真下（-90 度）まであとどれだけか
          autoIn.y = need * clamp(rainT / 1.5, 0, 1);              // 入りもゆるやかに（カクンと折れない）
          if ((st.p < -80 && st.z < RAIN_PULL_Z) || st.z < RAIN_PULL_Z - 60 || manT > 80) { spreadOn = true; spreadT = 0; startBloom(true, (showFr + 180) % 360); }
          break;
        }
        /* 散開: 4 機はそれぞれの向きへ、1 番機は後ろへ。どの機体も鉛直下向きから水平へゆるやかに */
        spreadT += dt; bloomS.t = spreadT;
        const kr = clamp(spreadT / BLOOM_TURN_V, 0, 1), er = kr * kr * (3 - 2 * kr);
        { const rq = showPt(-2500, 0); steerTo(rq.x, rq.y, 150); }   // 引き起こしの向きは後ろ（原点の側へ抜ける）
        if (st.p < -60) autoIn.x = 0;                       // 立っているうちは横の舵を打たない（捻れない）
        holdPitch(-90 + 92 * er);
        rainOn = er < 0.7;
        /* 散開したあとは、1 番機も僚機も進路を保ったまま無限遠まで飛ぶ。
           見えない距離まで離れてから終える（そこで編隊に戻しても、遠すぎて見えない）。
           次の課目は進入で位置ごと移すので、ここで組み直す必要はない */
        if (er >= 1) holdBank(0);                       // 引き起こし終わり。あとはまっすぐ
        const farR = Math.hypot(st.x - GROUND_EYE.x, st.y - GROUND_EYE.y);
        if (farR > REAR_END || manT > 110) { endBloomMates(); rainOn = false; nextManeuver(); }
        break;
      }
      case 'byover': {                           // 頭上通過: 見ている人の真上を低く通り抜ける
        const e3 = eyeDir();
        steerTo(e3.ex - e3.dx * 600, e3.ey - e3.dy * 600, m.alt || 130);
        const past = (st.x - e3.ex) * e3.dx + (st.y - e3.ey) * e3.dy;   // 正なら観覧位置の手前、負なら越えた先
        if (past < -300 || manT > 30) nextManeuver();
        break;
      }
      case 'cupid': case 'star': {               // 描き物: 2 番機以降が図を描き、1 番機は図のそばを回る
        const ff = FIGS[m.fig];
        if (figClock < 0) {
          if (!matesReady() && manT < 60) { orbitEye(GATE.z); st.cue = '隊形を組みます'; break; }   // 集まるまで観覧位置のまわりを回って待つ
          /* 図の真ん中へ向かって上がり、図の面の手前 FIG_NEAR m まで来てから描き始める。
             以前は進入の終わり（観覧位置から 1.8 km・高さ 200 m）で描き始め、僚機は 8 秒のあいだに 1.3 km 先・360 m 上の図の始点へ
             寄せていたので、1 コマに 12〜15 m（240〜300 m/s。速さの上限 150 m/s の 2 倍）で動いていた（利用者の指摘 2026-09-24）。
             図のそばから寄せれば、寄せる距離は図の大きさほどで済む */
          const e7 = eyeDir(), cx = e7.ex + e7.dx * ff.d, cy = e7.ey + e7.dy * ff.d;
          const along7 = (st.x - e7.ex) * e7.dx + (st.y - e7.ey) * e7.dy;
          /* 近づくあいだは煙を出さない（絵の中へ線を引き込まない。以前も図の始めまで 1 番機・僚機とも出していなかった） */
          if (along7 > ff.d + FIG_NEAR && manT < 60) { smokeNone = true; steerTo(cx, cy, ff.z); break; }
          beginFigure(m.fig); figClock = 0; smokeNone = false;
        }
        figClock += dt;
        /* 図を描き終えたら（ff.end）、僚機は図の道から隊形へ戻る（endFigure）。煙は課目の終わりまで切っておく（戻る途中の線が絵に重なる）。
           以前は図の道の延長を課目の終わりまで飛ばし（上限 1.25 で止める）、スタークロスでは下向きの線の機が地面の下（高さ −6 m）まで
           進んで、そこで 4.5 秒止まっていた（実測） */
        if (fig) { fig.t = figClock; if (fig.t >= ff.dur * ff.end) { endFigure(); smokeNone = true; } }
        /* 1 番機は図の下のあたりを ゆっくり回る。目で追う視点は 1 番機を追うので、図も画面に入る */
        const fa = Math.atan2(st.y - figO.y, st.x - figO.x) + 0.5;
        steerTo(figO.x + Math.cos(fa) * 160, figO.y + Math.sin(fa) * 160, Math.max(160, figO.z - 230));
        /* 描き終えて 3 秒は絵を見せ、そのあと視線を機体へ（ゆっくり首を回す）。回し終えるまで課目を続ける */
        if (figClock >= ff.dur + 3 && figAim) { figAim = null; slowAim = 6; }
        if (figClock >= ff.dur + 9) nextManeuver();
        break;
      }
      case 'tree': {                             // クリスマスツリー・ローパス: 減速・脚出し・ライト・濃い煙で頭上を低く抜ける
        if (!treeMode) setTreeMode(true);
        const e6 = eyeDir();
        /* タイヤとライトはスモークと同じ瞬間に入り切りする（refreshMateGear が毎コマ決める。利用者の指示 第 3 便 5） */
        steerTo(e6.ex - e6.dx * 700, e6.ey - e6.dy * 700, m.alt || 110);
        holdBank(clamp(st.b + autoIn.x * 22, -12, 12));                   // 隊形を保つため、傾きは小さく
        const past6 = (st.x - e6.ex) * e6.dx + (st.y - e6.ey) * e6.dy;
        if (past6 < -350 || manT > 60) nextManeuver();
        break;
      }
      case 'cork': {                             // コークスクリュー: 1 番機はまっすぐ、2 番機がその周りを回る
        if (corkT < 0 && !matesReady() && manT < 60) { orbitEye(GATE.z); st.cue = '隊形を組みます'; break; }   // 2 番機が付くまで、観覧位置のまわりを回って待つ
        const e4 = eyeDir();
        steerTo(e4.ex - e4.dx * 700, e4.ey - e4.dy * 700, m.alt || 200);
        holdBank(clamp(st.b + autoIn.x * 22, -16, 16));   // 1 番機はほぼ水平のまま、向きだけ少し直す
        aimLeader = true;                        // 視線は、軸（円の中心）を進む 1 番機に向ける
        if (corkT < 0) {                         // 輪に乗るまでの時間は、いまの離れぐあいで決める
          corkT = 0;
          const h2 = mates[0];
          corkBlend = h2 && h2.visible ? clamp(h2.position.distanceTo(plane.position) / 30, 3, 12) : 3;
        } else corkT += dt;
        const past4 = (st.x - e4.ex) * e4.dx + (st.y - e4.ey) * e4.dy;   // 正なら手前、負なら越えた先
        if (past4 < -320 || manT > 34) nextManeuver();
        break;
      }
      case 'dtake':                              // ダイヤモンド・テイクオフ: ひし形のまま、わずかな時間差で上がる
        /* 全機が上がるまで: 100 m まではまっすぐ上昇。そこからは上がりながら原点のまわりを回って待つ。
           まっすぐ待つと 5・6 番機が上がるまでの 50 秒で 1 km 以上離れてしまい、視点から見えなくなった（実測 v04.24） */
        if (tkOn || st.z < 150) {
          if (st.z < 100) { holdBank(0); holdPitch(clamp(12 - st.z / 30, 3, 12)); }
          else { spdWant = 0.8; orbitAround(GROUND_EYE.x, GROUND_EYE.y, DTAKE_R, GATE.z, turnSign >= 0 ? 1 : -1); }
          if (manT > 60) { spdWant = 1; nextManeuver(); }
          break;
        }
        /* 全機が上がった。ここから追従機も一斉にスモークを出し、原点のまわりを一周する */
        if (dtT < 0) { dtT = 0; hdgSum = 0; prevH = st.h; }
        dtT += dt;
        smokeAll = true;
        /* 輪は 330 m。60 m/s だと旋回半径の下限（バンク 52 度で 287 m）に近く、外へふくらんで 560 m の輪になった（実測）。
           輪のあいだは速さを 0.8 倍に落とす（半径は速さの二乗で効くので、下限が 185 m まで下がる） */
        spdWant = 0.8;
        orbitAround(GROUND_EYE.x, GROUND_EYE.y, DTAKE_R, GATE.z, turnSign >= 0 ? 1 : -1);
        if (hdgSum > 175 || manT > 90) { spdWant = 1; nextManeuver(); }   // 原点のまわりを半周
        break;
      case 'touch': {                            // タッチ・アンド・ゴー: 滑走路に平行になったところから降ろし、順にタイヤをつけて上がる
        if (pathLag <= 0) { seedHistory(60); spreadOnLine(TOUCH_LAG); }   // 追従機は後ろに 9 秒ずつ、滑走路 1・2 に交互に並べ、同じ動きで接地する
        if (touchDone) touchAge += dt;
        if (!touchDone) {
          steerTo(RWY.x, RWY.y + 900, -20);                        // 滑走路の上へ降ろす
          if (st.z <= 3.4) { touchDone = true; touchT = 0; st.cue = 'タッチ'; }
        } else if (touchT < TOUCH_RUN) {                           // 少し間を置いてから上げる（接地しているあいだ）
          touchT += dt; holdBank(0); holdPitch(2); st.cue = 'タッチ';
        } else {
          holdBank(0); holdPitch(clamp(14 - st.z / 25, 4, 14));    // 自動で上がる（「加速」を待たない）
          st.cue = 'ゴー';
        }
        /* 最後の追従機（いちばん遅れている機）が接地して上がり終えるまで、まっすぐ上がり続ける。
           先に次の課目へ移すと、道をたどっている追従機が隊形へ引き戻され、接地できずに終わる（実測: 6 番機） */
        { let maxLag = 0; mates.forEach(h => { if (h.userData.shown && h.userData.lag !== undefined) maxLag = Math.max(maxLag, h.userData.lag); });
          if ((touchDone && touchT >= TOUCH_RUN && st.z > 160 && touchAge > maxLag + 5) || manT > 120) { formScale = 1; endPath(); nextManeuver(); } }
        break;
      }
      case 'opro': {                             // オポジット・コンティニュアス・ロール
        /* 1 番機は東（x = 原点と散開位置の中間の線上、y = 開始位置の距離）から西向きに高速で入る。
           相手は正面の線の鏡（西から東向き）。原点と散開位置の中間で交差し、
           交差の瞬間から機首上げ 30 度と連続ロール。そのまま東・西の無限遠へ */
        beginMirror(m);
        const east = showLocal(st.x, st.y).side;               // 正面から見て右の距離（正が右）
        /* 交差点そのもので演技を始める。以前は 60 m 手前で立てていたため、
           見ている側には「交差点が正面からずれている」と見えた（利用者の指示 第 2 便 7） */
        if (east < 0) oproX = true;
        if (!oproX) {                                          // 交差まで: 線に沿って西向きに高速で、水平を保ったまま
          if (oproZ < 0) oproZ = st.z;
          spdWant = OPRO_SPD;
          holdBank(0);                                          // 進入の線には乗せてあるので、舵で向きを直さない（水平のまま）
          holdPitch(clamp((oproZ - st.z) * 0.1, -3, 3));       // 高さもそのまま
          autoIn.r = 0;
        } else {                                               // 交差の瞬間から: 機首上げ 30 度と、高速の連続ロール
          noTurn = true;                                       // 回しているあいだ、傾きで向きを変えない（進路が流れない）
          spdWant = OPRO_SPD;                                  // 抜けるまで速さを落とさない
          rollBoost = OPRO_ROLL;                               // 交差した直後から速く回す
          /* まず機首を 30 度へ（いっぱいに引いて約 1 秒）。回しながら引くと、舵の向きが回って
             機首が上がらない（実測: 機首が ±8 度で振れるだけ）。上がったら舵を中立にして速く回す */
          if (st.p < 28 && !oproUp) { autoIn.x = 0; autoIn.y = -1; }
          else { oproUp = true; autoIn.x = 1; autoIn.y = 0; }
          autoIn.r = 0;
        }
        /* 地上の視線（利用者の指示 第 2 便 9）。
           進入のあいだは 1 番機を追う → 交差の直前（手前 400 m）から交差点で構える →
           交差して、機体が画面の外へ出たら、進入で追っていた機に戻る。
           距離ではなく inCamView で判じるのは、逐語が「画面外に機体が入ったら」だから。
           figAim を外すときの slowAim は、視線が飛ぶのを防ぐ（タック・クロスと同じ） */
        { const cx = showPt(showLocal(st.x, st.y).along, 0);
          const near = !oproX && east < 400;
          /* 一度画面の外に出たら、そこからは 1 番機を追い続ける（留め金）。
             留め金がないと、機体が画面に戻るたびに交差点へ引き返した（実測） */
          if (oproX && !inCamView(plane.position)) oproBack = true;
          if ((near || oproX) && !oproBack) {
            if (!figAim) figAim = new THREE.Vector3(cx.x, cx.y, st.z); else figAim.set(cx.x, cx.y, st.z);
            aimLeader = false;
          } else { if (figAim) { figAim = null; slowAim = 6; } aimLeader = true; } }
        if (east < -1500 || manT > 60) { spdWant = 1; rollBoost = 1; figAim = null; aimLeader = false; nextManeuver(); }   // 左の無限遠で終わり
        break;
      }
      case 'tuck': {
        /* タック・クロス（利用者の説明どおりに作り直した。v04.76）:
           「進入時点で背面を下にして 2 機が至近距離で真横に並んで横から進入し、会場近くで外側にロールして
             少し膨らみ目の前で交差して交差したそのまま通過していく」。
           相手は「進行方向に沿った線」の鏡なので、こちらが外へ膨らめば相手は逆へ膨らみ、線の上で交差する。
           2 機とも背面のまま入る（左右の鏡は背面を背面のまま映す） */
        beginMirror(m);
        spdWant = TUCK_SPD;                                            // 利用者の指示 第 3 便 4（もう少し高速で）
        const e = mir, rx = e.dy, ry = -e.dx;                          // 線の右手
        const s0 = (st.x - e.ox) * e.dx + (st.y - e.oy) * e.dy;        // 線に沿った位置
        const n0 = (st.x - e.ox) * rx + (st.y - e.oy) * ry;            // 線からの離れ（右が正）
        const lineH = (((Math.atan2(e.dx, e.dy) / D) % 360 + 360) % 360);
        /* 交差する点: いまの奥行きのまま、観覧位置の正面（横のずれ 0）に当たるところ */
        const cL = showLocal(st.x, st.y), cP = showPt(cL.along, 0);
        const sC = (cP.x - e.ox) * e.dx + (cP.y - e.oy) * e.dy;
        const toC = sC - s0;                                           // 交差点までの残り
        if (toC > TUCK_ROLL_D) {
          /* 進入: 背面のまま、線に沿ってまっすぐ。姿勢は直接決める
             （背面では舵の効きが逆で、ふつうの舵取りでは高さも傾きも暴れる） */
          tkT += dt;
          const kk = clamp(tkT / 2.2, 0, 1), ee = kk * kk * (3 - 2 * kk);
          att.setFromAxisAngle(AZ, -lineH * D);
          /* 進入のロール（バンク 0 度 → 180 度）は、背面になったことを見せるための動作であって、
             このあとの交差のロールと一続きではない（利用者の指摘 2026-09-12）。
             したがって向きを本ロールに揃える必要はなく、元のままにする */
          att.multiply(dq.setFromAxisAngle(AY, -180 * ee * D));
          readAttitude();
          st.z += (GATE.z - st.z) * Math.min(1, dt * 0.6);
          /* 線の左 TUCK_SIDE に付ける（相手は鏡で右 TUCK_SIDE）。詰めは 25 m/s まで */
          { const ee2 = clamp((-TUCK_SIDE - n0) * Math.min(1, dt * 0.8), -25 * dt, 25 * dt);
            st.x += rx * ee2; st.y += ry * ee2; }
          autoIn.x = 0; autoIn.y = 0; smIn.x = 0; smIn.y = 0;
        } else if (tkT2 < TUCK_ROLL_T) {
          /* 会場の手前: 背面から一続きに TUCK_ROLL_A（225 度）回す（利用者の説明 第 8 便）。
             180（背面）→ 270（外向きの横倒し）→ 360（水平）→ 405（＝交差点の側へ 45 度）。
             姿勢は直接決める（背面のままふつうの舵取りに渡すと、向きの読みが 180 度あいまいになる）。
             ただし**方位は書き戻さない**。ここが第 8 便の肝で、以前は毎コマ lineH に戻していたため、
             バンクから生まれる旋回（「バンクで曲がる」の段）が毎コマ消され、ロール中はまっすぐ飛んでいた。
             いまの方位 st.h から組み直すと曲がりが残り、外へ回るあいだは外へ膨らみ、
             交差点の側へ傾いてからは線へ戻る。膨らみも戻りも、飛行モデルそのものが作る */
          tkT2 += dt;
          const k2 = clamp(tkT2 / TUCK_ROLL_T, 0, 1), e2 = k2 * k2 * (3 - 2 * k2);
          const roll = 180 + TUCK_ROLL_A * e2;
          /* 方向舵は、バンクが水平（360 度）を越えてから踏み始める。
             線（＝交差点）は右手にあるので、方位を増やす向きに振る */
          const rud = clamp((roll - 360) / Math.max(1, TUCK_ROLL_A - 180), 0, 1);
          att.setFromAxisAngle(AZ, -(st.h + TUCK_RUD * rud * dt) * D);
          att.multiply(dq.setFromAxisAngle(AY, roll * D));
          readAttitude();
          autoIn.x = 0; autoIn.y = 0; smIn.x = 0; smIn.y = 0;
          /* 膨らみの通過点（tkWp === 0）は使わない。膨らみはロール中の旋回が作るので、
             回し終えたらそのまま線へ戻る段（tkWp === 1）へ移り、機首上げして交差する */
          if (tkT2 >= TUCK_ROLL_T && tkWp === 0) tkWp = 1;
        } else if (tkWp < 2) {
          /* 45 度に達したら、そのバンクを保ったまま機首上げして交差する（利用者の説明 第 8 便:
             「内側から 45 度傾いた状態で機首上げで交差しているように見える」）。
             ここを通過点誘導（steerTo）に渡していたのをやめた。誘導は線へ戻すことしか考えないので、
             バンクを 84〜91 度まで倒し直し、機首上げも起きず、高さは門の高さに張り付いた
             （実測 2026-09-12: 交差時のバンク +84 度・機首角 +0.3 度・高さ 179 m・正面から 99 m 行き過ぎ）。
             この飛行モデルは機首の向きに沿って位置を積むので、45 度を保って引けば、それ自体が線へ戻る曲がりになる。
             相手は線の鏡なので、線へ戻った瞬間（n0 が 0）がそのまま交差になる */
          holdBank(TUCK_CROSS_BANK);
          autoIn.y = -TUCK_PULL;
          if (n0 > -3) tkWp = 2;
        } else {
          /* 交差したあとは操縦桿を離す。**翼だけ**が水平に戻り、機首の上下はそのまま
             （利用者の説明 2026-09-12:「交差した時点のまま操縦桿を離すという意味」
             「機体水平と水平面に平行は異なる」）。
             「機体水平」＝翼が水平になること。「水平面に平行」＝機首も水平になること。この 2 つは別物。
             交差したときの上昇角を保ち、舵も当てないので方角も変えずに抜けていく。
             ここは 2 度取り違えた。1 度目は姿勢を丸ごと固定（バンク 48 度・機首上げ 29 度のまま）、
             2 度目は holdPitch(0) まで当てて水平面に平行にしてしまった */
          holdBank(0); autoIn.y = 0;
        }
        autoIn.r = 0;
        /* 地上の視線: 2 機は線の左右に離れて飛ぶので、平均を見ると何もない空を見る。
           1 番機を追い、交差点まで 300 m に入ったら交差点を見る。交差して 250 m 離れたら 1 番機に戻す */
        { const dC = Math.hypot(cP.x - st.x, cP.y - st.y);
          const atCross = (tkWp === 1 && dC < 300) || (tkWp >= 2 && dC < 250);
          if (atCross) { if (!figAim) figAim = new THREE.Vector3(cP.x, cP.y, GATE.z); aimLeader = false; }
          else { if (figAim) { figAim = null; slowAim = 6; } aimLeader = true; } }
        const dOt = Math.hypot(st.x - GROUND_EYE.x, st.y - GROUND_EYE.y);
        if ((tkWp >= 2 && dOt > 1400) || manT > 85) { spdWant = 1; nextManeuver(); }
        break;
      }
      case 'change': {                           // チェンジオーバー・ターン: 北東から入り、頂点で開いて そのまま無限遠へ
        /* 頂点は散開位置と原点の中間（北 300 m）。
           階段の一列で頂点へ向かい、頂点で開いて扇になり、整った速度ベクトルのまま まっすぐ抜ける。
           捻れないよう、舵は頂点で 1 回だけ切る */
        const Oc = GROUND_EYE, vp = showPt(SPREAD_D / 2, 0), vx = vp.x, vy = vp.y;
        const dOc = Math.hypot(st.x - Oc.x, st.y - Oc.y);
        if (chgT < 0) {
          formation = 'steps'; formScale = 1;
          steerTo(vx, vy, GATE.z);
          /* 頂点で一斉に開く。扇への切り替えはこのコマで行う（placeMates は課目の処理の後に走るので、
             ここで切り替えれば、このコマから扇へ寄せ始める） */
          if (Math.hypot(vx - st.x, vy - st.y) < 150 || manT > 60) { chgT = 0; smokeAll = true; joinFast = true; formation = 'fan'; formScale = 1.7; }   // joinFast も同じコマに（寄せの長さは道を引く瞬間に決まる。実測: 無いと開き切るのに 8.9 秒）
        } else {
          chgT += dt;
          /* 散開したら、そのまま 1 番機と平行に並んで扇になる（利用者の指示 2026-09-12:
             「散開直後、そのまま一番機と平行に並び、扇形となる」）。
             以前は「交互に開く（split）」を 3.5 秒はさんでから扇へ移していたため、
             1 番機と平行に並ぶまでに二段階かかって見えた。
             開き始めの速さは joinFast で保ち、隊形は初めから扇にする */
          /* 扇編隊は 5 機とも 1 番機と同じ高さに並ぶ（利用者の指示 11。v04.76）。
             以前はデルタ（6 機の隊形）にしていたため、席の無いはずの 6 番機に席ができて、
             課目の途中で合流して現れていた。扇は 5 機の隊形なので、6 番機は合流するまで出てこない */
          joinFast = chgT < 3.5;                                                         // 開き始めだけ速く寄せる
          formation = 'fan'; formScale = 1.7;                                            // 初めから扇
          /* 散開のあとは曲がらず、翼を水平にしたまま まっすぐ抜ける（利用者の指示 2026-09-24
             「散開直後に 1 番機がバンクするので、5 機の軌跡が外へ膨らむ。軌跡はまっすぐに」）。
             2026-09-13 からは「隊形が整ってから旋回」にしていたが、整うのは散開の 2 秒後で、そこから 1 秒で 58 度まで傾けていた。
             僚機は 1 番機の姿勢で置くので、扇（横 ±54 m）が 1 番機ごと転がり、外側の機は開いた直後に上下・内側へ振られていた
             （実測: 散開 4 秒後に 5 番機が 23 m 内へ戻り、1 番機も 23 m 横へそれた） */
          holdBank(0);
        }
        holdPitch(1); autoIn.r = 0;
        if ((chgT > 7 && dOc > 1500) || manT > 90) nextManeuver();                        // 抜けた先の無限遠
        break;
      }
      case 'turnloop':                           // 360 度ターン & ループ: 1 周旋回してから宙返り
        if (hdgSum < 350) { holdBank(54 * turnSign); holdPitch(0); }
        else { loopSum += RATE.pitch * dt; autoIn.x = 0; autoIn.y = -1; }
        autoIn.r = 0;
        if (loopSum > 360 || manT > 40) nextManeuver();
        break;
    }
    /* 墜落と天井の備え。レインフォールで降りているあいだと、
       タッチ・アンド・ゴーで滑走路へ降ろしているあいだは効かせない（効かせると降りられない） */
    if (!rainOn && !(m.id === 'touch' && !touchDone) && !(m.id === 'tuck' && tkT2 < TUCK_ROLL_T + 0.2) && !(m.id === 'bloom' && spreadOn)) safety();   // 姿勢を直接決めているあいだは手当てしない
    return autoIn;
  }

  /* 地上にいるあいだの動き。翼は水平、方向舵で向きを変える。高さは滑走路の上 */
  /* 地上の道すじ: 通過点を順にたどり、最後の点に決めた向き（hEnd）で着く。
     曲がるときは遅く（5 m/s）、まっすぐは TAXI_V。曲がりは TAXI_TURN 度/秒（止まりかけでも向きは直せる）。
     driveOn は 1 番機にも追従機にも使う。返り値は着いたかどうか */
  /* 滑走路 rx（中心の x）を y = yc で横切ってよいか。ほかの機がその滑走路を使っていて、まだ横切る点を通り過ぎていなければ待つ。
     使っている＝ 滑走路の上を動いている（滑走・接地後の減速）か、その滑走路へ北向きに進入している（最終進入、手前 4 km まで）。
     通り過ぎた＝ その機の y が横切る点より 30 m 北にある（滑走はいつも北向き）。待っている機（並んで止まっている）は数えない */
  const RWY_HALF = 23.5, CROSS_GAP = 11, rwFwd = new THREE.Vector3();   // 停止線は縁から 11 m（描いてある停止線 34〜36.5 m と同じ所）
  function runwayBusy(rx, yc, selfPos) {
    const using = (x, y, z, vMove, fwdY) => {
      if (Math.abs(x - rx) > 60) return false;
      if (y > yc + 30) return false;                                       // もう横切る点より北
      if (z < 25 && Math.abs(y) < STRIP_END + 60) return Math.abs(x - rx) <= RWY_HALF + 5 && vMove > 1;   // 滑走路の上（縁の内側）: 動いていれば使用中
      return z < 400 && y < -STRIP_END && y > -4000 && fwdY > 0.85;         // 南から北向きの最終進入
    };
    if (plane.position !== selfPos) {
      const v = gmode === 'fly' ? SPEED * spdK : gv;
      rwFwd.copy(AY).applyQuaternion(att);
      if (using(st.x, st.y, st.z, v, rwFwd.y)) return true;
    }
    for (const h of mates) {
      const u = h.userData; if (!u.shown || h.position === selfPos) continue;
      const v = u.gp ? u.gp.v : (u.tk && !u.tk.done) ? u.tk.v : (u.parked ? 0 : SPEED);
      rwFwd.copy(AY).applyQuaternion(h.quaternion);
      if (using(h.position.x, h.position.y, h.position.z, v, rwFwd.y)) return true;
    }
    return false;
  }
  function driveOn(p, gp, dt) {
    /* 線（前の通過点 → 次の通過点）に沿って進む。狙うのは通過点そのものではなく、
       自分の位置を線に落とした点の LOOK m 先。こうすると線からずれていても短い距離で線に戻り、
       あとは線の上をまっすぐ走る（通過点を狙うと、ずれたぶんが長い斜めの直進になり、滑走路をはみ出した。実測） */
    const LOOK = 14, R_TURN = 12, V_TURN = 4;              // 角の弧の半径と速さ（弧の上で 19 度/秒 回る）
    if (!gp.start) gp.start = [p.x, p.y];
    /* 角の弧: 角の手前 R_TURN で回り始め、v / R の速さで向きを変え、次の線の上で回り終える（膨らんで戻すことがない） */
    if (gp.arc) {
      const dh = wrap180(gp.arc.to - gp.h), w = (gp.v / R_TURN) / D * dt;
      gp.h = (gp.h + clamp(dh, -w, w) + 360) % 360;
      gp.v = gp.v < V_TURN ? Math.min(V_TURN, gp.v + 4 * dt) : Math.max(V_TURN, gp.v - 6 * dt);
      if (gp.hold) gp.v = Math.max(0, gp.v - 6 * dt);
      p.x += Math.sin(gp.h * D) * gp.v * dt; p.y += Math.cos(gp.h * D) * gp.v * dt;
      if (Math.abs(dh) < 0.6) { gp.h = gp.arc.to; gp.arc = null; }
      return false;
    }
    const A = gp.idx > 0 ? gp.pts[gp.idx - 1] : gp.start, B = gp.pts[gp.idx], last = gp.idx === gp.pts.length - 1;
    const ax = B[0] - A[0], ay = B[1] - A[1], len = Math.hypot(ax, ay) || 1, ux = ax / len, uy = ay / len;
    const s0 = clamp((p.x - A[0]) * ux + (p.y - A[1]) * uy, 0, len);              // 線に落とした位置（A からの距離）
    const s1 = Math.min(len, s0 + LOOK);
    const tx = A[0] + ux * s1, ty = A[1] + uy * s1;
    const dEnd = Math.hypot(B[0] - p.x, B[1] - p.y);
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    const want = d > 1.5 ? ((Math.atan2(dx, dy) / D) % 360 + 360) % 360 : (last ? gp.hEnd : gp.h);
    let e = wrap180(want - gp.h);
    /* 向き直り（駐機を出る最初の区間だけ）は決めた側へ回る（隣の機から離れる側）。
       2 つ目以降の区間にまで効かせると、角で少し行き過ぎたとき（差 91 度）に逆へ 270 度回ってしまい、
       輪を描いて隣の車線の機にぶつかった（実測: 0 m） */
    if (gp.turnDir && gp.idx > 0) gp.turnDir = 0;
    if (gp.turnDir && Math.abs(e) > 90) e = gp.turnDir * Math.abs(e);
    gp.h = (gp.h + clamp(e, -TAXI_TURN * dt, TAXI_TURN * dt) + 360) % 360;
    /* 向きが大きく違うとき（駐機からの向き直り）はごく遅く回る。回る輪が小さくなり、隣の機（34 m）に寄らない */
    /* 角は 4 m/s（輪の半径 9.5 m）。角の手前 30 m から落とす（12 m/s のまま曲がると半径 29 m になり、滑走路の縁近く 18 m まで膨らんだ。実測） */
    /* いまの速さから V_TURN まで落とすのに要る距離（減速 6 m/s²）+ 弧に入る点（角の手前 R_TURN）+ 余裕。
       弧に入る点で落ちきっていないと弧の入りが遅れ、線を越えてから戻る（実測: 20 m/s で 6 m はみ出た） */
    const brake = (gp.v * gp.v - V_TURN * V_TURN) / (2 * 6) + R_TURN + 4;
    let vmax = Math.abs(e) > 90 ? 2 : Math.abs(e) > 30 ? 4 : (last ? Math.min(TAXI_V, dEnd * 0.5) : (len - s0 < Math.max(30, brake) ? V_TURN : (gp.fast && gp.idx === 0 ? 20 : TAXI_V)));
    if (gp.hold) vmax = 0;                                          // 前に機体がいる: 止まって待つ（合流や並びでぶつからない）
    /* 滑走路を横切る線（東西の区間）: 滑走路の縁の手前 CROSS_GAP の停止線で、その滑走路が空くまで待つ。
       もう縁の内側にいるときは待たない（滑走路の上に止まらない） */
    gp.xwait = false;
    if (Math.abs(ux) > 0.7) {
      for (const rx of RWY_X) {
        const from = A[0] - rx, to = B[0] - rx;
        if (Math.sign(from) === Math.sign(to) && Math.abs(from) > RWY_HALF && Math.abs(to) > RWY_HALF) continue;   // この区間は横切らない
        const xStop = rx + Math.sign(from) * (RWY_HALF + CROSS_GAP), sStop = (xStop - A[0]) / ux;
        if (s0 > sStop + 1) continue;                                                             // 停止線を越えている: 渡り切る
        if (runwayBusy(rx, A[1], p)) { gp.xwait = true; vmax = Math.min(vmax, Math.max(0, (sStop - s0 - 2) * 0.6)); }
      }
    }
    gp.v = gp.v < vmax ? Math.min(vmax, gp.v + 4 * dt) : Math.max(vmax, gp.v - 6 * dt);
    p.x += Math.sin(gp.h * D) * gp.v * dt; p.y += Math.cos(gp.h * D) * gp.v * dt;
    if (!last && len - s0 <= R_TURN && gp.v <= V_TURN + 0.5) {       // 角の手前 R_TURN で、次の線の向きへ弧に入る
      const C = gp.pts[gp.idx + 1];
      gp.arc = { to: ((Math.atan2(C[0] - B[0], C[1] - B[1]) / D) % 360 + 360) % 360 };
      gp.idx++;
    }
    if (last && dEnd < 2.5) {
      gp.v = 0; p.x = B[0]; p.y = B[1];
      if (Math.abs(wrap180(gp.hEnd - gp.h)) < 2) { gp.h = gp.hEnd; return true; }
      gp.h = (gp.h + clamp(wrap180(gp.hEnd - gp.h), -TAXI_TURN * dt, TAXI_TURN * dt) + 360) % 360;
    }
    return false;
  }
  /* 駐機からの向き直りをどちらへ回るか: 回る輪の中心（左右 6 m）のうち、いちばん近い他の機から遠いほう */
  function pickTurn(px, py, h, others) {
    const hx = Math.sin(h * D), hy = Math.cos(h * D);
    const score = sgn => { const cx = px + hy * 6 * sgn, cy = py - hx * 6 * sgn; let m = 1e9; others.forEach(o => { m = Math.min(m, Math.hypot(o.x - cx, o.y - cy)); }); return m; };
    return score(1) >= score(-1) ? 1 : -1;     // +1 = 右へ、-1 = 左へ
  }
  let gPath = null, gEnd = 'stand';
  function taxiTo(points, endMode, hEnd) { gPath = { pts: points, idx: 0, v: gv, h: st.h, hEnd }; gEnd = endMode; gmode = 'taxi'; }
  /* 地上の道は南北・東西の線だけ（斜めに進まない。曲がり角は 12 m の輪でなめらかに）。
     駐機 k → 東へ誘導路まで → 南へ取り付けまで → 西へ滑走路まで → 北へ並び（gx, gy） */
  function pathOut(k, gx, gy) { const sd = STANDS[k]; return [[TAXI_X, sd.y], [TAXI_X, TAXI_S], [gx, TAXI_S], [gx, gy]]; }
  /* 取り付けで待つ点（滑走路 1 の東、西向き）。順番待ちの機はここで止まり、前の機が滑走を始めたら滑走路へ */
  const HOLD_PTS = [[46, TAXI_S], [80, TAXI_S], [114, TAXI_S], [148, TAXI_S]];
  function pathHold(k, q) { const sd = STANDS[k]; return [[TAXI_X, sd.y], [TAXI_X, TAXI_S], [HOLD_PTS[q][0], TAXI_S]]; }
  let tkKind = 'pairs';                    // 離陸の種類（並び方）。taxiOut で決める
  /* 滑走路の北端 → 出口を東へ → 誘導路を南へ → 西へ駐機 k（着いてから機首を原点へ） */
  /* 着陸後: 中ほどの出口（EXIT_Y）を東へ → 誘導路を南へ → 西へ駐機 k（着いてから機首を原点へ）。
     北端まで走ってから出ると滑走路を 34〜47 秒ふさぎ、同じ滑走路の次の機（32 秒後）が前の機の離脱前に接地した（実測） */
  /* fromY: 止まった位置の y。中ほどの出口（EXIT_Y）を過ぎて止まったら（長く降りたとき）、戻らずに北の出口（TAXI_N）から出る。
     以前は 387 m で止まったあと出口 240 m へ向き直そうとして、輪を描いてから南へ戻った（実測） */
  function pathIn(k, rwx, fromY) { const sd = STANDS[k], ey = (fromY !== undefined && fromY > EXIT_Y - 25) ? TAXI_N : EXIT_Y;
    return [[RWY.x + (rwx || 0), ey], [TAXI_X, ey], [TAXI_X, sd.y], [sd.x, sd.y]]; }
  let taxiFrom = null;                     // 着陸後、1 番機が誘導路へ入り始めた点（追従機はここまで道をたどり、そこから自分の道へ）
  function groundStep(dt) {
    let drove = false;                                                 // driveOn で位置を進めたか（二重に進めない）
    const turnRate = 26 * Math.min(1, gv / 12);                       // 止まりかけでは曲がらない
    if (gmode === 'land') {
      gv = Math.max(0, gv - 8 * dt);                                  // 減速
      st.h = (st.h + input.r * turnRate * dt + 360) % 360;
      if (gv <= 0.5) { gv = 0; taxiFrom = { x: st.x, y: st.y }; taxiTo(pathIn(0, 0, st.y), 'apron', STANDS[0].h); gPath.fast = true; lightsOn = false; applyGear(); }   // 止まったら誘導路を通って駐機へ（滑走路の上は 20 m/s で出る）
    } else if (gmode === 'taxi') {
      if (!gPath) { gv = 0; gmode = gEnd; }
      else {
        /* driveOn が位置を進める。下の共通の積分は行わない（以前は二重に進めていて、誘導路の 1 番機だけ 2 倍の速さ
           （20 m/s の指示で 40 m/s）になり、角の手前で落としきれず 61 m ふくらんだ。実測。追従機は driveOn だけなので正しかった） */
        const done = driveOn(st, gPath, dt); gv = gPath.v; st.h = gPath.h; drove = true;
        if (done) { gmode = gEnd; gPath = null; st.cue = ''; }
      }
    } else if (gmode === 'takeoff') {
      gv = Math.min(SPEED, gv + 6 * dt);
      st.h = (st.h + input.r * turnRate * 0.5 * dt + 360) % 360;
      rotP = clamp((gv - SPEED * ROT_K) / (SPEED * (0.9 - ROT_K)) * TK_ANG, 0, TK_ANG);     // 機首上げ
      if (gv >= SPEED * 0.9) {                                        // 浮く
        gmode = 'fly'; spdK = gv / SPEED; spdWant = 1; rotP = 0;
        att.setFromAxisAngle(AZ, -st.h * D); att.multiply(dq.setFromAxisAngle(AX, TK_ANG * D)); readAttitude();
        st.z = 4; return;
      }
    } else { gv = 0; rotP = 0; }
    /* 地上では翼は水平。滑走の終わりだけ、機首を上げていく（そのまま浮く） */
    att.setFromAxisAngle(AZ, -st.h * D);
    if (rotP > 0.01) att.multiply(dq.setFromAxisAngle(AX, rotP * D));
    readAttitude();
    if (!drove) { st.x += Math.sin(st.h * D) * gv * dt; st.y += Math.cos(st.h * D) * gv * dt; }
    st.z = 3;
    const W = LIMIT - 30; st.x = clamp(st.x, -W, W); st.y = clamp(st.y, -W, W);
    st.cue = gmode === 'land' ? '着陸しました' : gmode === 'taxi' ? (gEnd === 'apron' ? '駐機場へ戻ります' : '滑走路へ進みます')
           : gmode === 'stand' ? (st.lineup ? '「テイクオフ」で離陸できます' : '全機が並ぶのを待っています') : gmode === 'apron' ? '「離陸準備」で滑走路へ進みます' : '加速中';
  }
  /* 地上で待っているところから演目を始める（離陸から）。
     曲を選んであれば、その頭を待ち、音が立ち上がるところでタイヤが離れる */
  function startFromGround() {
    auto = true; oneShot = false; standWait = false; landRun = false; pathLag = 0;
    let f0 = 0;
    for (let k = 0; k < PROGRAM.length; k++) if (okMan(PROGRAM[k])) { f0 = k; break; }
    /* 「通し」は、曲 1 曲ぶんのまとまりをひとつ選んで行う（選ぶたびに変わる） */
    showT = 0;
    if (showThru && pickChunk()) f0 = chunk[0]; else chunk = null;
    formation = PROGRAM[f0].form || userForm;
    step_i = f0; manT = 0; hdgSum = 0; prevH = st.h; phaseT = 0; e8 = null;
    st.show = '離陸'; manPhase = 'gather'; markOn = false;
    /* 煙は消さない。待機中に出している点検の煙をそのまま続け、滑走を始めるところで止める
       （ここで消すと、「加速」を押した瞬間に煙が消えて出し直したように見える） */
    if (musBuf && actx) {                      // 曲を選んであるとき: イントロを待ってから滑走する
      /* 曲の頭（musLead）が滑走の長さ（MUS_ROLL ≒ 9 秒）より短い曲は、曲を先に鳴らすと浮くのが遅れる。
         その差だけ曲の始まりを遅らせて、浮く瞬間と音の立ち上がりを合わせる（総点検 2026-09-13） */
      musDelay = Math.max(0, MUS_ROLL - musLead);
      if (musDelay <= 0) playMusic();
      musWait = Math.max(0, musLead - MUS_ROLL);
      st.desc = '曲の頭を待ち、音が立ち上がるところで離陸します。';
      st.cue = '曲の頭を待っています';
      return;
    }
    /* 曲がなくても、「加速」からタイヤが離れるまでの時間は同じにする（既定 13.5 秒）。
       そのぶん、滑走を始めるまで待つ（点検の煙を出しながら） */
    musWait = Math.max(0, musLead - MUS_ROLL);
    st.desc = '2 本の滑走路から 2 機ずつ離陸し、上がってから隊形を組みます。';
    st.cue = musWait > 0 ? '待機中' : '離陸します';
    if (musWait <= 0) { gmode = 'takeoff'; startTakeoff(PROGRAM[f0].id === 'dtake' ? 'diamond' : 'pairs'); }
  }
  let lineupPrev = false;                  // 前のコマで「全機が並んだ」状態だったか（曲を止める合図に使う）
  /* 「見え方」の「動きで見る」は、シミュレーター本体をそのまま使い、選んだ操作を舵の入力として入れて物理で動かす
     （利用者の指示 2026-09-13「三人称は別の仕組みではなくシミュレーター操作と同じ仕組み」「実機と全く同じ動きである必要があるので、重力の影響も考えたもの」）。
     操作モード（自分で操縦する画面）は重力を無視する決めなので、重力は gravityOn で切り替える（動きで見るは on） */
  let gravityOn = false;
  /* 操作モード（自分で操縦する画面）にも重力（利用者の指示 2026-09-16。実機どおり、旋回では引かないと沈む）。自動操縦の演目は前のまま（重力なし）。
     縦画面（検証画面）は地面に触れたら墜落として開始位置へ戻す（crashReset。横画面は着陸あつかいのまま） */
  let manualGravity = false, crashReset = false, onCrash = null;
  /* ===== 手動操縦の物理（v2） ===== */
  /* TAU_B: 横滑り角が指令へ追いつく時定数。踏んでも離しても同じ（風見安定）。0.45 秒だと、離した瞬間に機首が 1 秒足らずで進路へ戻り
     「反動」に見えた（利用者の指摘 2026-09-13）。実機のヨーの固有周期は 1〜2 秒なので 0.8 秒に。戻る動きそのものは物理（横滑りが消えて機首が相対風に並ぶ） */
  const PHY = { ALPHA0: 3.5 * D, KY: 14, TAU_A: 0.35, TAU_B: 0.8, A_PULL: 10.5 * D, A_PUSH: 7 * D, BETA_MAX: 10 * D };
  PHY.KL = 9.81 / PHY.ALPHA0;                 // 揚力傾斜（m/s² / rad）。釣り合いの迎角で揚力＝重力になる値
  /* 手動操縦の舵の効き（v06.03、利用者の指示 2026-09-18「ブルーインパルスの軌道を手動でもぎりぎり再現できる程度に、方向舵や機首上げの角度・角速度を調整」）。
     出題・動きで見る（flight.js）には触れない。操縦桿いっぱいで: ロール 120°/s（T-4 は 200°/s 超だが、画面の操縦桿では速すぎると保てない）、
     引き 迎角 +12°・押し −8°、方向舵 横滑り 12°。揚力の加速度は +7 g／−3 g で頭打ち（T-4 の制限荷重）。速い（q が大きい）ほど同じ迎角で強く曲がる */
  const MAN = { roll: 120, pull: 12 * D, push: 8 * D, beta: 12 * D, gmax: 7 * 9.81, gmin: -3 * 9.81 };
  const vel = new THREE.Vector3(), pAcc = new THREE.Vector3(), pTmp = new THREE.Vector3();
  /* 速度を機首から作り直す: 速度＝機首の向き（迎角 0）。昇降舵の指令が 0.35 秒ほどで迎角を釣り合いまで立ち上げ、
     機首が経路より上を向く。最初に経路を機首より下へ向ける形にすると、機首が水平のまま 3.5° の降下になり、
     10 秒で 36 m 沈んで接地した（実測 2026-09-13） */
  function syncVel() {
    /* 釣り合いの水平飛行から始める（試作の trim と同じ）: 経路はいまの機首の向き、機首はそれより迎角ぶん上。
       速度＝機首（迎角 0）から始めると、揚力が立ち上がるまでの 0.35 秒で経路が −1.7° に落ち、
       速さ一定の仮定ではそのままの降下が釣り合ってしまい、放っておくと降り続けた（実測: 10 秒で −18 m） */
    vel.copy(fwd).multiplyScalar(SPEED * Math.max(0.2, spdK));
    att.multiply(dq.setFromAxisAngle(AX, PHY.ALPHA0)); att.normalize(); readAttitude();
    velOk = true;
  }
  function physStep(dt) {
    readAttitude();                           // fwd（機首）・bup（上）・bright（右）を att から
    spdWant = speedLock ? 1 : THR_MIN + (THR_MAX - THR_MIN) * throttle;   // 手動の速さはスロットルで決める。縦画面（検証画面）は 60 m/s に固定
    spdK += (spdWant - spdK) * (1 - Math.exp(-dt / 2.5));
    const v = SPEED * Math.max(0.2, spdK);
    if (!velOk) syncVel();
    /* いまの迎角・横滑り角（速度と機首のずれ） */
    const vr = vel.dot(bright), vf = vel.dot(fwd), vu = vel.dot(bup);
    const alpha = Math.atan2(-vu, vf), beta = Math.atan2(vr, vf);
    /* 力 → 速度 → 位置 */
    const q = (v / SPEED) * (v / SPEED);      // 揚力・横力は速さの二乗に比例（遅いほど同じ迎角で揚力が小さい）
    /* 重力の影響は無視する（利用者の指示 2026-09-13「シミュレーター操作モードでは、重力の影響は無視する」。
       全開でもバンクしているとしばらくして墜落した——実機どおり旋回では引かないと沈むが、練習の場では要らない）。
       やり方: 重力の代わりに「釣り合いの揚力 KL·α0·q の鉛直成分」を差し引く。すると
         釣り合いで飛んでいれば どのバンク・背面でも鉛直の加速度は 0（沈まない・落ちない）、
         バンクすれば釣り合いの揚力の横成分 KL·α0·q·sinφ ＝ g·sinφ が残って旋回する（旋回率は物理と同じ）、
         引けば α − α0 のぶんの揚力が機体の上向きに働いて上昇（背面で引けば降下）、方向舵の横力はそのまま。
       式: a = KL·q·(α·上 − α0·(上·ẑ)·ẑ) − KY·q·β·右 */
    const a0 = Math.min(PHY.ALPHA0 / q, 14 * D);   // 釣り合いの迎角は速さの二乗に反比例（遅いほど機首を上げて飛ぶ。上限 14° ＝ 失速の手前）
    const gOn = gravityOn || (manualGravity && !auto);   // 重力を使うか（動きで見る、手動操縦）
    const kl = auto ? PHY.KL * alpha * q : clamp(PHY.KL * alpha * q, MAN.gmin, MAN.gmax);   // 手動は荷重で頭打ち（v06.03）
    pAcc.copy(bup).multiplyScalar(kl).addScaledVector(bright, -PHY.KY * beta * q);
    pAcc.z -= gOn ? 9.81 : PHY.KL * a0 * q * bup.z;   // 動きで見ると手動操縦は本物の重力。自動操縦は釣り合いの揚力の鉛直成分で支える（重力を無視）
    pTmp.copy(vel).normalize();                     // 速度の向き（前）
    vel.addScaledVector(pAcc, dt).setLength(v);
    st.x += vel.x * dt; st.y += vel.y * dt; st.z += vel.z * dt;
    /* 風見安定（縦横）: 速度の向きが変わったぶんだけ、機首も同じ回転（速度の前×後の軸まわり）で回す。flight.js（出題・動きで見る）と同じ。
       v06.02 までは世界の上下軸まわり（方位の変化 dpsi）だけだった。垂直に近いと方位が定まらず（atan2 が毎コマ ±180° 跳ぶ）、
       機体を毎コマ 180° 回して揚力の向きを打ち消し、全力で引いても宙返りの頂点から先へ進めなかった（点検 2026-09-18）。
       縦の回転も機首に写すので、迎角は舵の指令でしか変わらない（実機の縦の安定） */
    { const c = pTmp.dot(vel) / v, ax = pTmp.clone().cross(vel), sn = ax.length() / v;
      if (sn > 1e-9) att.premultiply(dq.setFromAxisAngle(ax.normalize(), Math.atan2(sn, c))); }
    /* 姿勢: 補助翼はロール角速度。昇降舵・方向舵は迎角・横滑り角を指令へ寄せる（機首を速度まわりに動かす） */
    const roll = (auto ? RATE.roll : MAN.roll) * input.x * dt * D;
    if (roll) att.multiply(dq.setFromAxisAngle(AY, roll));
    /* 重力ありのときの釣り合い: 揚力は機体の上向きなので、鉛直成分は cos(機首の上げ角) ぶん減る。a0 のままだと 3.5° で 0.2% 足りず、
       手を放していても 1 分に 36 m 沈み、2 分ほどで接地した（利用者の報告 2026-09-16「水平に保っていても着地してしまう」）。
       機首の上げ角で割って、翼が水平なら高度をぴったり保つ。バンクの分は補正しない（旋回では引かないと沈む、実機どおり） */
    /* 釣り合いの迎角の補正: 機首の上げ角 60° までは 1/cos（高度を保つ）、それより立てると cos に比例して 0 へ（60° で連続）。
       垂直では釣り合いの揚力が 0 なので、手を放せば真っ直ぐ上へ（重力で減速はしない。速さ一定の模型）。v06.02 までは 1/cos を 0.5 で止めていたので、
       垂直で手を放すと迎角 7° の揚力で機首が倒れ、押し切らないと真っ直ぐ上れなかった（利用者「垂直に真っ直ぐ飛ぶ」の再現、2026-09-18） */
    const cp = Math.abs(Math.cos(st.p * D)), a0t = gOn ? a0 * (cp >= 0.5 ? 1 / cp : cp / 0.25) : a0;
    const PULL = auto ? PHY.A_PULL : MAN.pull, PUSH = auto ? PHY.A_PUSH : MAN.push, BMAX = auto ? PHY.BETA_MAX : MAN.beta;
    const alphaWant = a0t + (input.y < 0 ? -input.y * PULL : -input.y * PUSH);   // 手前（y<0）で迎角を増やす
    const betaWant = -input.r * BMAX;                                             // 右方向舵で機首を右へ（β は負）
    const dA = (alphaWant - alpha) * Math.min(1, dt / PHY.TAU_A), dB = (betaWant - beta) * Math.min(1, dt / PHY.TAU_B);
    if (dA) att.multiply(dq.setFromAxisAngle(AX, dA));
    if (dB) att.multiply(dq.setFromAxisAngle(AZ, dB));                // 機首を右へ振るのは z まわりの負の回転（engine.js と同じ約束）
    att.normalize(); readAttitude();
    st.alpha = alpha / D; st.beta = beta / D;                          // 計器や記録の用（度）
  }
  function step(dt) {
    smDt = dt || 0.05;
    st.mode = gmode;
    st.gIdx = gPath ? gPath.idx : -1;                         // 地上の道の何本目か（誘導路のカメラの段取りに使う）
    st.landStep = manPhase === 'land' ? landStep : -1;       // 着陸の段（-1 = 着陸中でない、0 = 離れる、1 = 直線進入）
    st.landing = landRun;                                     // 着陸して滑走路へ戻るまで
    /* 接地した機の数（1 番機 + 道をたどって高さ 3.5 m 以下になった追従機）。カメラの段取りに使う */
    { let td = (landRun && gmode !== 'fly') ? 1 : 0;
      if (landRun && pathLag > 0) for (let i = 0; i < mates.length; i++) { const u = mates[i].userData; if (u.shown && mates[i].position.z <= 3.5) td++; }
      st.tdN = td; }
    st.landCfg = landRun && gearOn;                           // 着陸体制（滑走路の手前 1.8 km でタイヤを下ろした）
    st.lineup = gmode !== 'stand' || mates.every(h => !h.userData.shown || h.userData.parked);   // 滑走路に全機が並んだ（加速はそれから）
    /* 誘導路を通り終えて全機が並び、離陸準備が済んだところで曲を止める（利用者の指示）。
       「離陸準備」で流し始めた曲は、ここでいったん切れる。「テイクオフ」を押すと startFromGround が頭から流し直し、
       主旋律が入るところでタイヤが離れる（これまでどおり） */
    {
      const lined = gmode === 'stand' && st.lineup;
      if (lined && !lineupPrev && musWait < 0) { musCut = -1; stopMusic(MUS_FADE); }
      lineupPrev = lined;
    }
    st.waiting = musWait >= 0;               // 曲の頭に合わせて滑走を待っているあいだ
    /* 曲は、主旋律（ギター）が入る直前で切る。着陸して戻るあいだの静かなところだけを流す */
    if (musCut >= 0) { musCut -= dt; if (musCut <= 0) { musCut = -1; stopMusic(MUS_FADE); } }
    /* 滑走路に戻ったら、曲を切って離陸の体勢で待つ。「加速」を押されるまで動かない。
       接地したところで自動操縦は切れている（auto = false）ので、待っている印を別に持つ */
    if (auto && !oneShot && chunk) showT += dt;             // 演目の長さ（曲 2 周ぶんに合わせるため）
    if (landClock >= 0) landClock += dt;                    // 1 番機が接地してからの時間
    if (landDesc >= 0) landDesc += dt;                      // 先頭の降下開始からの時間（組ごとの出番に使う）
    /* 着陸の終わり: 追従機が全部、道をたどり終えて待機の位置に着いたら（着く前に隊形を戻すと、隠れてしまう。実測） */
    if (landRun && gmode === 'apron' && mates.every(h => !h.userData.shown || (h.userData.pfDone && h.userData.parked))) {
      landRun = false; manPhase = 'do'; formation = userForm;   // 全機降りたので隊形を戻す
      musCut = -1; stopMusic(MUS_FADE);
      st.show = ''; st.desc = ''; st.cue = '「テイクオフ」で離陸できます';
      if (loopRestart) { loopRestart = false; standWait = true; }
    }
    /* 曲の頭が短い曲は、滑走を先に始めて曲を遅らせて鳴らす（浮く瞬間に音が立ち上がる） */
    if (musDelay > 0) { musDelay -= dt; if (musDelay <= 0) { musDelay = 0; if (musBuf && actx) playMusic(); } }
    /* 曲のイントロを待ってから滑走を始める（主旋律が入るところで浮く） */
    if (musWait >= 0) {
      musWait -= dt;
      st.cue = '曲の頭を待っています';
      if (musWait <= 0) {
        musWait = -1;
        if (gmode === 'stand') { gmode = 'takeoff'; startTakeoff(PROGRAM[step_i] && PROGRAM[step_i].id === 'dtake' ? 'diamond' : 'pairs'); st.cue = '離陸します'; }
      }
    }
    /* 脚は浮いた機から順にしまう。先頭機は自分が 70 m（TK_UP）まで上がったところ。
       追従機はそれぞれ自分の離陸が済んだところで（refreshMateGear が毎フレーム見ている） */
    if (tkOn && gmode === 'fly' && gearOn && !treeMode && st.z > TK_UP) { gearOn = false; lightsOn = false; applyGear(); }
    /* 全機が浮いて編隊へ移ったら、離陸の段取りを閉じる */
    if (tkOn && gmode === 'fly' && mates.every(h => !h.userData.tk || h.userData.tk.done)) {
      tkOn = false; mates.forEach(h => { h.userData.tk = null; });
      if (!treeMode) { gearOn = false; lightsOn = false; applyGear(); }   // 離陸後はタイヤもライトも自動でしまう
    }
    if (gmode !== 'fly') { velOk = false; groundStep(dt); return; }
    /* 自分で操縦しているときは、機体を物理で動かす（2026-09-13、利用者の基準「シミュレーターは景色ではなく機体を動かす。
       合格基準は本物の機体の動きと物理的に同じか」）。
       状態は 位置・速度ベクトル vel・姿勢 att。速度と機首は別物で、そのずれが迎角 α（縦）と横滑り角 β（横）。
         揚力 = KL·α（機体の上向き）、横力 = −KY·β（機体の右向き）、重力 g（鉛直下）。速さは一定（推力＝抗力）。
         補助翼 → ロール角速度、昇降舵 → 迎角の指令、方向舵 → 横滑り角の指令（実機の舵の効き方）。
       これで バンクすれば揚力が傾いて旋回が生まれ、方向舵では機首が先に振れて速度が遅れて追い、
       引けば機首が経路より上を向いて上昇する——式を書かずに出る。式と係数は `_proto.html`（v2、5 つの照合に合格）と同じ。
       以前は「速度＝機首の向き」で、バンクしても曲がらず（旋回は自動操縦の門の中だけ）、重力も無かった（総点検の指摘 #1・#2・#3）。
       「操縦桿を倒しただけで景色が横へ流れると方向舵と混ざる」という以前の理由で旋回を止めていたが、
       本物はそう動くのだから、そう見せるのが練習になる。
       自動操縦（展示飛行）は 19 課目の調整が乗っているので、従来の運動学のまま */
    if (posed) { att.copy(poseQ); readAttitude(); velOk = false; }   // 外から置いた様子（setPose）のまま。この画面の物理は回さない
    else if (!auto) { physStep(dt); }
    else {
    velOk = false;                         // 自動操縦のあいだは vel を使わない（手動に戻った最初のコマで機首から作り直す）
    /* 自動操縦の舵は、目標へ 0.55 秒の時定数で寄せる。
       実機は舵をいきなり一杯には切らないので、そのぶんの緩みを入れる */
    let inp = smIn;
    { const want = autoInputs(dt), kk = 1 - Math.exp(-dt / 0.55);
      smIn.x += (want.x - smIn.x) * kk; smIn.y += (want.y - smIn.y) * kk; smIn.r += (want.r - smIn.r) * kk; }
    const roll = RATE.roll * rollBoost * inp.x * dt * D;   // 機首軸(+y): 右に倒すと右バンク。rollBoost は課目で速く回すとき
    const pitch = -RATE.pitch * inp.y * dt * D;     // 翼軸(+x): 手前に引くと機首上げ
    const yaw = RATE.yaw * inp.r * dt * D;          // 上下軸(+z): 右方向舵で機首が右へ
    if (roll) att.multiply(dq.setFromAxisAngle(AY, roll));
    if (pitch) att.multiply(dq.setFromAxisAngle(AX, pitch));
    /* 方向舵は機体の上下軸まわり（実機のとおり）。傾いているときは、傾いた機体に対して横へ機首が振れる
       （世界で見れば 方位が cos(バンク)、機首の上下が sin(バンク) ぶん変わる）。
       以前は世界の上下軸まわり（premultiply）で、傾いていても水平線に沿って流れていた（利用者の指摘 v04.21）。
       （出題・解説・動きで見るは flight.js の物理で機体を飛ばす。2026-09-13 v05.13 から） */
    if (yaw) att.multiply(dq.setFromAxisAngle(AZ, -yaw));
    /* バンクによる旋回（協調旋回）。世界の上下軸まわりに機体ごと回す。真上・真下付近では効かせない。
       tan(バンク) をそのまま使うと 90 度で符号が裏返り、横倒しの瞬間に方位が逆回りしてガクンとなる。
       実機と同じで、翼が出せる力（荷重倍数）には上限があるので、そこで頭打ちにする。
       浅いバンクでは 1/cos ＝ tan と同じ動き、90 度では最大のまま向きが変わらず、通り過ぎても連続する。
       **自分で操縦しているあいだは効かせない**。出題の約束は「操縦桿右 → 右バンク → 景色は左へ傾く」
       「方向舵右 → 右を向く → 景色は左へ流れる」で、操縦桿を倒しただけで景色が横へ流れると、
       方向舵の見え方と混ざって覚えられない。演技（自動操縦）は目標へ向かうのに旋回が要るので、そちらだけ残す */
    readAttitude();
    if (auto && !noTurn && Math.abs(st.p) < 70) {
      const br = st.b * D, nEff = Math.min(N_MAX, 1 / Math.max(Math.abs(Math.cos(br)), 1 / N_MAX));
      const turn = clamp((9.81 / (SPEED * spdK)) * nEff * Math.sin(br) / D, -30, 30) * dt * D;
      if (turn) att.premultiply(dq.setFromAxisAngle(AZ, -turn));
    }
    att.normalize(); readAttitude();
    spdK += (spdWant - spdK) * (1 - Math.exp(-dt / 2.5));          // 速さはゆっくり変える
    const v = SPEED * spdK;
    st.x += fwd.x * v * dt; st.y += fwd.y * v * dt; st.z += fwd.z * v * dt;
    }   // auto
    /* 技の途中（自動操縦）は、壁を少し越えてもよい。警告も出さず、自然に飛びながら戻ってくる。
       自分で操縦しているときは これまでどおり壁で止める */
    /* 自動操縦のあいだは、広さの決まりを外す（画面を広く使うため）。
       演目はいつも観覧位置のまわりで行われるので、遠くの景色を描き足す必要はない。
       自分で操縦しているときは、これまでどおり壁で止める */
    const C = auto ? SHOW_CEIL + 300 : CEIL;   // 自動操縦の天井は演目の基準のまま
    st.wall = !auto && (Math.abs(st.x) > LIMIT - 4 || Math.abs(st.y) > LIMIT - 4 || st.z > CEIL);
    if (!auto) { st.x = clamp(st.x, -(LIMIT - 4), LIMIT - 4); st.y = clamp(st.y, -(LIMIT - 4), LIMIT - 4); }
    if (st.z >= C) { st.z = C; if (vel.z > 0) vel.z = 0; }          // 天井に当たったら上向きの速さを捨てる（張り付いたまま速度だけ上を向かないように）
    const touchGo = auto && PROGRAM[step_i] && PROGRAM[step_i].id === 'touch' && manPhase === 'do';
    if (rainOn && st.z < 140) { rainOn = false; }                    // 低くなったら引き起こしを戻す
    /* 自動操縦では墜落させない。ただし着陸・タッチ・アンド・ゴー・離陸の上昇中は外す。
       離陸で外さないと、タイヤが離れたその瞬間に 45 m へ引き上げられ、空中へ瞬間移動して見える */
    if (auto && manPhase !== 'land' && !touchGo && !tkOn && st.z < 45) { st.z = 45; levelAttitude(); }
    if (touchGo) { if (st.z < 3) st.z = 3; }                        // 滑走路に触れても着陸あつかいにしない（自動でそのまま上げる）
    else if (crashReset && !auto && st.z <= 3.2) { resetToStart(); if (onCrash) onCrash(); }   // 縦画面: 地面に触れたら墜落として開始位置へ（利用者の指示 2026-09-16）
    else if ((!auto || manPhase === 'land') && st.z <= 3.2) {       // 接地: 着陸とみなして減速に入る
      if (manPhase === 'land' && landClock < 0) landClock = 0;     // ここから、あとの組の出番を数える
      st.z = 3; gmode = 'land'; gv = SPEED * spdK; spdK = 1; spdWant = 1;
      gearOn = true; applyGear();                                   // 着陸なのでタイヤは出ている
      att.setFromAxisAngle(AZ, -st.h * D); readAttitude();
    }
    if (st.z < 3) st.z = 3;
    /* 山や塔に触れそうなときは、その上へ逃がす。ぶつけて墜落にはしない（利用者の指示）。
       斜面に近づくにつれて少しずつ上がるので、山を越えていくように見える */
    const ter = terrainAt(st.x, st.y);          // 0 なら平地。平地で持ち上げると着陸できなくなる
    if (ter > 0 && st.z < ter + OBST_CLEAR) { st.z = ter + OBST_CLEAR; st.cue = '山を越えます'; }
    else if (st.cue === '山を越えます') st.cue = '';
    if (!Number.isFinite(st.x + st.y + st.z + st.h + st.p + st.b)) resetToStart();   // 数でなくなったら開始位置へ戻す
  }
  /* 先頭機の軌跡を残し、そこから編隊機の位置を決める */
  const mq = new THREE.Quaternion(), mp = new THREE.Vector3(), mo = new THREE.Vector3(), cq = new THREE.Quaternion(), fwant = new THREE.Vector3();
  const qFlat = new THREE.Quaternion(), qa = new THREE.Quaternion();
  let flatYaw = 0;                 // 「翼は水平」の置き方に使う方位。真上・真下では方位が決まらないので、そのときは前の値を使う
  /* 追従機の向きを入れ替える。1 コマで回れる角度に上限をつける（乗っている機体が一瞬で回らないように）。
     宙返りの頂点などで置き方が切り替わっても、画面は目で追える速さまでしか回らない */
  const MAX_TURN = 180 * D;        // [°/s]
  /* 機首を「実際に動いた向き」へ向ける（利用者の指摘。v04.76）。
     位置だけ動かして向きを 1 番機のままにすると、機体が真横に滑って見える。
     実測 v04.75（ダイヤモンド・テイクオフのあと）: 進んでいる向きが機首から 2 番機 49 度・4 番機 58 度ずれていた。
     ずれの元は 2 つ。隊形へ寄せる動きと、旋回のときの「腕の長さ × 回る速さ」の振り回し。
     どちらも実際の動きに出るので、動いた向きへ機首を回す。回すのは「いまの機首から動いた向きへ」の
     最短の回転なので、翼の傾き（ロール）はそのまま残る。
     かける強さ w は「まだ寄せている」「離れている」ぶんだけ。隊形に収まると 0 になり、
     ふつうの編隊飛行（全機が同じ動き）では何も変わらない */
  /* 機首を、その機体が実際に進んだ向きに合わせる（利用者の指示 第 3 便 1・2）。
     v04.83 まで: 寄せの途中（u.k が小さい）と、離れた機体（far）だけに掛けていた。
     隊形に収まると重みが 0 になり、1 番機の姿勢をそのまま写していたので、
     宙返りのように各機の弧の半径が違う課目で、進む向きと機首が食い違った
     （実測 v04.82: デルタ・ループで通しの中央値 31.9 度、最大 73.4 度）。
     いまは常に掛ける。各機が自分の動きから機首を決めるので、腹で滑ることがない。
     進んだ向きは、なましてから使う（1 コマぶんの生の動きだと、動きの小さいコマで向きが暴れ、
     その機体に乗っていると画面が振り回される）。
     位置を移した（瞬間移動）コマは、その動きを向きと読まずに捨てる */
  const AIM_VEL_T = 0.08;                  // 進んだ向きをなます時間（秒）
  /* 僚機が出せる速さの上限（1 番機の速さの何倍まで）。利用者の指示 第 3 便 2・3。
     編隊で回るとき、外側の機は実際に速く飛ぶので 1 倍では足りない（実測: デルタ・ロールで最大 2.0 倍）。
     2.5 倍を天井にすると、ふつうの演技には触らずに、飛べない振り回しだけが切れる
     （実測 v04.82: 寄せ切る前に課目が始まると 421 m/s = 7 倍で動いていた） */
  const MATE_SPD_MAX = 2.5;
  const flyV = new THREE.Vector3();
  const AIM_VEL_JUMP = 20;                 // 1 コマでこれ以上動いたら、位置を移したコマと見る（m）
  function aimNose(holder, u, q, dt, far, prev) {
    if (dt <= 0.0005) return;
    crabV.copy(holder.position).sub(prev);
    if (crabV.lengthSq() > AIM_VEL_JUMP * AIM_VEL_JUMP) { u.velS = null; return; }
    crabV.divideScalar(dt);
    const sp = crabV.length();
    if (sp < 5) return;
    crabV.divideScalar(sp);
    if (!u.velS) u.velS = crabV.clone();
    else u.velS.lerp(crabV, 1 - Math.exp(-dt / AIM_VEL_T)).normalize();
    crabF.set(0, 1, 0).applyQuaternion(q);
    const ang = crabF.angleTo(u.velS);
    if (ang < 0.004) return;
    crabAx.crossVectors(crabF, u.velS);
    if (crabAx.lengthSq() < 1e-8) return;
    crabAx.normalize();
    q.premultiply(crabQ.setFromAxisAngle(crabAx, Math.min(ang, 0.9)));
  }
  function turnMate(holder, q, dt) {
    if (!dt) { holder.quaternion.copy(q); return; }
    const a = holder.quaternion.angleTo(q), lim = MAX_TURN * dt;
    if (a > lim) holder.quaternion.slerp(q, lim / a); else holder.quaternion.copy(q);
  }
  const fwd2 = new THREE.Vector3(), moFlat = new THREE.Vector3();
  const moW = new THREE.Vector3(), mirWas = new THREE.Vector3();
  /* 寄せているあいだの「進んでいる向き」を機首に反映するための入れ物 */
  const crabV = new THREE.Vector3(), crabF = new THREE.Vector3(), crabAx = new THREE.Vector3(),
        crabP = new THREE.Vector3(), crabQ = new THREE.Quaternion();
  const lookF = new THREE.Vector3(), lookAx = new THREE.Vector3(), lookQ = new THREE.Quaternion();
  const basePos = new THREE.Vector3(), offNow = new THREE.Vector3(), retFrom = new THREE.Vector3();   // 追従機は「1 番機から見たずれ」で置く
  /* いまの位置から u.want へ向かう道を引き直す。外へ膨らませて、まっすぐ突っ込まないようにする */
  let joinFast = false;                              // 切れのある動きが要る課目では、隊形の移りを速くする
  function startJoin(u) {
    if (!u.from) { u.from = new THREE.Vector3(); u.bow = new THREE.Vector3(); }
    u.from.copy(u.cur); u.k = 0;
    const d = u.from.distanceTo(u.want);
    /* 近寄る速さを抑える（12 m/s まで）。速く寄せると、進入のあいだに速さが急に変わって見える。
       隊形は開始位置までに整っていればよいので、時間をかけて寄せる */
    u.dur = joinFast ? clamp(d / 45, 1.2, 3) : clamp(d / 12, 10, 40);
    /* 離陸のあとの寄せは膨らませない。実測 v04.75（ダイヤモンド・テイクオフ）:
       膨らみのせいで 2 番機が 28 m 沈み、3 番機が 1 番機より 25 m 高く浮き、4 番機は上下に揺れていた */
    const amt = u.tkJoin ? 0 : Math.min(90, d * 0.28);
    u.bow.set((u.from.x >= 0 ? 1 : -1) * amt, 0, amt * 0.3);
  }
  /* 進入で 1 番機の位置を移した（瞬間移動した）とき、僚機を隊形の位置に置き直す印。
     置き直さないと、僚機は前の隊形のずれ（u.cur）を持ったまま移した先に現れ、
     そこから膨らみつきで寄せ直すので、**反対側から超高速で来て急転回する**ように見えた
     （利用者の指摘 2026-09-12。チェンジオーバー・ターンを単体で選んだとき）。
     1 番機と同じところから進入させるため、移した瞬間に隊形を組み上がった形にする */
  let snapForm = false;
  let corkT = -1;                                  // 0 以上ならコークスクリューの最中（2 番機が周りを回る）
  /* 描き物の課目（キューピッド・スタークロス）。編隊では描けない形なので、機体を式で置く。
     1 番機（操作する機体）は隠して、2 番機以降で描く。図は観覧位置の正面の空に立てた面の上に描く */
  /* 図の長さは「描き始めるまでに、機体が道すじへ乗り切っている」ように取る。
     道すじへ寄せるのに最大 8 秒（blend）かかるので、煙を出し始めるのはそのあと。
     乗り切らないうちに煙を出すと、寄せている途中の曲がった線が描かれ、形が崩れる
     （利用者「スタークロスの形が不完全」「ハートの形」） */
  /* 図を描く課目は、描き終わるまで最初の線が消えないようにする（秒）。
     粒の入れ物は 1 機あたり 1400 個・毎秒 25 個なので、56 秒までなら足りる */
  const FIG_LIFE = { cupid: 46, star: 30, eight: 75 };   // レター・エイトは 8 の字が全部残るまで煙を消さない
  /* end: 図の道を飛ぶのをやめて隊形へ戻る時点（dur に対する割合）。キューピッドは矢が抜けきる 1.25（課目の終わりと同じ）、
     スタークロスは星を描き終えた 1.0（その先の延長は下向きの線が地面へ向かう） */
  const FIGS = { cupid: { dur: 36, n: 3, s: 15, d: 545, z: 600, end: 1.25 }, star: { dur: 18, n: 5, s: 15, d: 445, z: 560, end: 1 } };   // v04.19: d を 15% 近くに
  const FIG_NEAR = 200;                            // 図の面のこれだけ手前で描き始める（m）
  let figClock = -1;                               // 描き物を始めてからの時間（秒）。-1 はまだ始めていない
  const HEART_END = 0.64;                          // ハートを描く 2 機は、ここまでで道すじを飛び終える
  const STAR_IN = 0.47, STAR_OUT = 0.89, STAR_R = 16;   // スタークロス: 線を引く区間（この間に頂点から頂点へ飛ぶ）と、星の大きさ（単位）
  let fig = null;                                  // {id, t, dur, n, s}
  const figO = new THREE.Vector3(), figR = new THREE.Vector3(), figU = new THREE.Vector3(0, 0, 1), figF = new THREE.Vector3();
  let figAim = null;   // 図を描いているあいだ、地上からの視線を向ける先（絵の中心）
  let figDrawn = false;   // 図の線を引き始めたか（引き始めてから視線を絵の中心へ移す）
  let aimLeader = false;   // 視線を 1 番機だけに向ける（コークスクリューで、軸を進む機体を追う）
  let aimN = 0;            // 0 以外なら、その番号の機体だけを見る（1 = 1 番機、6 = 6 番機）。着陸の締めに使う
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
    figDrawn = false;          // 視線は、描き始めるまで機体を追う（先に絵の中心へ振ると、機体が来る前に空を見ることになる）
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
  /* 1 周 3.6 秒だと向心加速度 (2πR/T)²/R ≒ 78 m/s²（8 G）で T-4 の制限荷重 +7.33 G を超えていた（総点検 2026-09-13）。
     5.5 秒なら 34 m/s²（約 3.5 G） */
  const CORK_R = 26, CORK_T = 5.5, CORK_LAG = 0.15;   // 回る半径（m）・1 周の時間（秒）・少し後ろ（秒）
  let corkBlend = 3;                               // 輪に乗るまでにかける時間（遠さで決める）
  /* レター・エイト: 3 機が片方の輪を描くあいだ、離れた 1 機がもう片方の輪を描く。
     離れる機体は式で置く（ねじらずに 8 の字を描かせるため）。E8_SPAN は、
     1 番機が何度まわるあいだに輪を描き終えるか。残りの旋回で隊形へ戻る */
  /* レター・エイト。
     3 機の円は 1 機の円の 1.5 倍（`E8_RAD`）。3 機はふつうより遅く（`E8_SLOW`）、
     離れた 1 機は速く飛ぶ。1 機は自分の円を 1 周し、3 機が円の 4 割まで来たところで描き終える。
     そこから 3 機の通った道をたどり、3 機が 3/4 まで来るまでに追いつく（そこでダイヤモンドになる）。
     追いつく速さは残り時間から決めるが、無理のない速さ（`E8_VMAX`）までにとどめる */
  const E8_RAD = 1.5, E8_SLOW = 0.75, E8_LEAD_AT = 130, E8_JOIN_AT = 270, E8_VMAX = 1.55;
  const E8_BLEND = 2.0;                    // 自分の円から 3 機の道へ移るのにかける時間（秒）
  /* 3 機の傾き。深く倒すと円が小さくなり、1 周が短くなって 1 機が 3/4 までに追いつけない
     （追いつく速さが 2 倍を超えてしまう）。浅く倒して円を大きくすると、無理のない速さで間に合う */
  const E8_BANK = 42;
  let e8 = null;
  /* 左右から寄って交差する課目（オポジット・コンティニュアス・ロール、タック・クロス）。
     相手の機体は、見ている正面の線について 1 番機を鏡に映した位置・向きに置く。
     こうすると必ず正面で交差し、ロールの向きも自然に逆になる */
  const MIR_SEEN = 300;                       // 鏡へ渡すときに「跳んだ」と見なす距離（m）
  /* 遠い機を世界の座標で持ち始める距離と、完全に切り離す距離（m） */
  const FARW_NEAR = 400, FARW_FAR = 1000;
  let mir = null;
  function startMirror() { const e = eyeDir(); mir = { ox: e.ex, oy: e.ey, dx: e.dx, dy: e.dy, z0: GATE.z, vert: false, fresh: false }; }
  /* 鏡への受け渡し（v04.40）。課目の始めに渡すと、相手が隊形の隣から鏡の位置へ一度に跳ぶ
     （実測 v04.27・再現 v04.40: オポジットで 1 コマ 3,834 m。機内から見ると隣の機が消えて向こうに現れる）。
     進入で位置を移す瞬間に渡せば、アプリ側の onJump で地上視点に戻っているので跳びは見えない。
     masked が真なら、その瞬間移動と同じコマなので跳びの知らせは要らない */
  function beginMirror(m, masked) {
    if (!m || !m.mirror || mir) return false;
    /* 's' = 進行方向に沿った線の鏡（タック・クロス。2 機が真横に並ぶ）。
       線は、いまの位置から右手へ TUCK_SIDE。相手はその向こう側の同じ距離なので、
       2 機は TUCK_SIDE × 2 だけ離れて真横に並ぶ。ぶつからないよう相手は TUCK_DZ だけ上。
       鏡は左右の傾きを逆にするだけなので、背面（180 度）はそのまま背面のまま映る（＝ 2 機とも背面） */
    if (m.mirror === 's') {
      const hr = st.h * D, dx = Math.sin(hr), dy = Math.cos(hr);
      mir = { ox: st.x + dy * TUCK_SIDE, oy: st.y - dx * TUCK_SIDE, dx, dy,
              z0: GATE.z, vert: false, fresh: !masked, dz: TUCK_DZ };
      tkWp = 0; tkT = 0; tkT2 = 0; return true;
    }
    /* 鏡の上下のずらし。オポジット（'h'）は至近距離で交差させる（利用者の指示 第 2 便 6）。
       横は鏡なので必ず 0 で交わるので、この値がそのまま最接近距離になる */
    startMirror(); mir.dz = m.mirror === 'h' ? OPRO_DZ : 14; mir.fresh = !masked;
    if (m.mirror === 'v') { mir.vert = true; tkWp = 0; }
    return true;
  }
  /* 瞬間移動でない場所で渡してしまったときの受け皿。大きく跳んだら地上視点に戻す（利用者の決め: v04.29） */
  function mirJumped(holder, was) {
    if (!mir || !mir.fresh) return;
    mir.fresh = false;
    if (was && mirWas.distanceTo(holder.position) > MIR_SEEN && opt.onJump) opt.onJump();
  }
  /* タック・クロスの相手。左右ではなく上下の鏡に映す（2 機とも左から入り、右へ抜けるため）。
     ぶつからないよう、相手は奥へ TUCK_DEEP だけ離す */
  const TUCK_DEEP = 90;
  /* タック・クロス（第 8 便 2026-09-12 で、利用者の説明どおりに作り直した）。
     利用者の説明:
       「両機が至近距離でバンク 0 度の状態で進入し、一斉に同じ向きに 180 度ロールして水平を保つ。
         散開位置で外側に、交差点を通る鉛直軸から 45 度傾くまでロールし、
         そこから交差点まで機首上げを行い交差する。
         その後は、操縦桿を元の位置にしたまま、交差の瞬間のまま通過する」
     TUCK_SIDE: 鏡の線からの離れ（2 機の間はこの 2 倍）。
     TUCK_DZ: 相手を上へずらす高さ（交差でぶつからないように）。
     TUCK_ROLL_D: 交差点の手前どれだけでロールを始めるか。
     膨らみの通過点（旧 TUCK_W1 / TUCK_W2 / TUCK_BULGE）と、そのためのバンクの上限（旧 TUCK_BANK）は
     第 8 便で取りやめた。膨らみは通過点が作るものではなく、外へ回っているあいだのバンクが生む旋回が作る。
     引き始めの距離（旧 TUCK_PULL_N）も要らなくなった。機首上げは 45 度に達してから始める */
  const TUCK_SIDE = 14, TUCK_DZ = 14, TUCK_ROLL_D = 350;
  const TUCK_SPD = 1.35;                   // 進入から抜けるまでの速さ（第 5 便で「速度は変えない」）
  const TUCK_PULL = 0.8;                   // 交差までの機首上げの強さ（1 で一杯）
  /* ロールしきるまで（秒）。1.2 → 1.0 → 0.6 → 1.0 → 3.2 → 2.2。
     3.2 秒では膨らみが 63.6 m まで出て、45 度のバンクでは線へ戻りきれなかった（実測 2026-09-12） */
  const TUCK_ROLL_T = 2.2;
  /* 交差のときのバンク（度）。利用者の説明「内側から 45 度傾いた状態で機首上げで交差」。
     回し終えたあとはこの傾きを保ったまま引く（通過点誘導には渡さない） */
  const TUCK_CROSS_BANK = 45;
  /* 回す角（度）。利用者の説明（2026-09-12）:
       「初期バンク 180 度。なす角が 45 度になるまで外向きで操縦桿のみでロールし、
         バンク 0 度あたりから交差点方向の方向舵を踏み始める。45 度で機首上げして交差する」
     180（背面）→ 270（外向きの横倒し）→ 360（水平）→ 405（＝交差点の側へ 45 度）。合わせて 225 度。
     変更前は台本で 130 度しか回さず（180 → 310）、残りは通過点誘導が倒していた。
     その結果、交差の瞬間のバンクが +90.6 度（実測）と、指定の 45 度を大きく行き過ぎていた */
  const TUCK_ROLL_A = 225;
  /* 方向舵（度/秒）。バンクが水平（360 度）を越えたあたりから、交差点の側へ機首を振る */
  const TUCK_RUD = 12;
  const tkQ = new THREE.Quaternion(), mirV = new THREE.Vector3(), mirQi = new THREE.Quaternion();
  /* 鏡で置いたあとの位置を、1 番機から見た相対位置として控える。課目が終わって隊形へ戻るとき、
     ここから寄せ始める（控えないと、隊形の古い位置から寄せ始めた形になり、相手が 800 m 跳ぶ。実測 v04.27） */
  function noteMirrorPos(holder, u) {
    mirQi.copy(att).invert();
    mirV.copy(holder.position).sub(plane.position).applyQuaternion(mirQi);
    u.cur.copy(mirV); u.from = null;
    u.qw = (u.qw || new THREE.Quaternion()).copy(att);
  }
  function placeTuck(holder, u, dt, emitting, color) {
    const e = mir, vx = plane.position.x - e.ox, vy = plane.position.y - e.oy;
    const was = u.shown; if (mir.fresh) mirWas.copy(holder.position);
    holder.position.set(plane.position.x + e.dx * TUCK_DEEP, plane.position.y + e.dy * TUCK_DEEP,
                        Math.max(60, 2 * e.z0 - plane.position.z));      // 高さを鏡に映す
    tkQ.setFromAxisAngle(AZ, -st.h * D);                                  // 向きは同じ
    tkQ.multiply(dq.setFromAxisAngle(AX, -st.p * D));                     // 上下が逆なので、機首の上げ下げも逆
    tkQ.multiply(dq.setFromAxisAngle(AY, (180 - st.b) * D));              // 背中も逆（背面になる）
    turnMate(holder, tkQ, dt); noteMirrorPos(holder, u);
    holder.visible = true; u.shown = true; mirJumped(holder, was);
    if (emitting && color) { emitPos.set(0, -6.9, -0.3).applyQuaternion(tkQ).add(holder.position); emit(emitPos, color, null, 0, 1); }
  }
  const mrQ = new THREE.Quaternion(), qInv = new THREE.Quaternion();
  function placeMirror(holder, u, dt, emitting, color) {
    const e = mir, vx = plane.position.x - e.ox, vy = plane.position.y - e.oy;
    const was = u.shown; if (mir.fresh) mirWas.copy(holder.position);
    const along = vx * e.dx + vy * e.dy;
    holder.position.set(e.ox + e.dx * along - (vx - e.dx * along),
                        e.oy + e.dy * along - (vy - e.dy * along), plane.position.z + (e.dz || 0));
    const face = (Math.atan2(e.dx, e.dy) / D);
    const h2 = 2 * face - st.h;                       // 方位を鏡に映す
    mrQ.setFromAxisAngle(AZ, -h2 * D);
    mrQ.multiply(dq.setFromAxisAngle(AX, st.p * D));
    mrQ.multiply(dq.setFromAxisAngle(AY, -st.b * D));  // 傾きは逆向き
    turnMate(holder, mrQ, dt); noteMirrorPos(holder, u);
    holder.visible = true; u.shown = true; mirJumped(holder, was);
    if (emitting && color) { emitPos.set(0, -6.9, -0.3).applyQuaternion(mrQ).add(holder.position); emit(emitPos, color, null, 0, 1); }
  }
  /* ===== 1 番機の道をそのままたどる（タッチ・アンド・ゴーと着陸）=====
     追従機 i は「1 番機の (i+1) × pathLag 秒前の状態」に置く。同じ動きをして、同じ位置に接地する。
     始めの数秒は、いまの位置からなめらかに道へ寄せる（隊形の位置から急に飛ばない）。
     地上では、1 番機が止まった位置まで来たら道をたどるのをやめ、自分の待機の位置へ走る（重ならない） */
  let pathLag = 0;                         // 0 なら使わない
  /* 追従の間隔（秒）。タッチ・アンド・ゴーと着陸で同じ値にする。
     追従機ごとの遅れ（u.lag）は、いまの間隔から少しずつ広げる（LAG_RATE 秒/秒 = 先頭の 55% の速さで飛んで下がる）。
     一度に目標の遅れへ飛ばすと、道の上を後ろへ瞬間移動する（6 番機は 20 秒 = 1.2 km 後ろへ飛び、
     乗っていると後ろ向きに高速で流れて見えた。実測） */
  /* 追従の間隔（秒）。滑走路は 1・2 に交互なので、同じ滑走路には 2 機おき（着陸 32 秒、タッチ 18 秒）。
     着陸: 前の機が接地して減速し（10 秒）、滑走路の上を 20 m/s で北の出口まで出る（20 秒）のに足りる */
  const TOUCH_LAG = 9.0, LAND_LAG = 18.0;
  const LAG_RATE = 0.45;
  const RP_BLEND = 6;                      // 隊形の席から 1 番機の道へ移るのにかける時間（秒。離れているときは長くする）
  function startPath(lag) {
    const cont = pathLag > 0; pathLag = lag;
    mates.forEach(h => { const u = h.userData; if (!cont) u.lag = undefined; u.pfDone = false; u.parked = false; });
  }
  /* 道をたどるのをやめるとき: いまの位置を隊形の相対位置にして、ふつうの合流に渡す（前へ瞬間移動しない） */
  function endPath() {
    pathLag = 0;
    mates.forEach(h => { const u = h.userData; if (!u.shown) return;
      mo.copy(h.position).sub(plane.position).applyQuaternion(qInv.copy(att).invert());
      u.cur.copy(mo); u.from = null; u.lag = undefined; });
  }
  /* 滑走路の延長線上へ移った直後: 追従機を 1 番機の後ろに lagStep 秒ずつあけて並べる（滑走路 1・2 に交互）。
     見えない距離で行うので、そのまま道をたどれば、滑走路 1 本につき 1 機ずつ、前の機が出てから次が入る間隔になる */
  function spreadOnLine(lagStep) {
    const v = SPEED * spdK;
    pathLag = lagStep;
    mates.forEach((h, i) => { const u = h.userData; if (!u.shown) return;
      const lag = (i + 1) * lagStep; u.lag = lag; u.rpOff = null; u.rwx = ((i + 1) % 2) ? RWY2 : 0; u.pfDone = false; u.parked = false; u.ground = false; u.gp = null;
      h.position.set(plane.position.x - fwd.x * v * lag + u.rwx, plane.position.y - fwd.y * v * lag, plane.position.z - fwd.z * v * lag);
      h.quaternion.copy(att); });
  }
  function placeReplay(holder, u, i, dt, emitting, color) {
    const tgt = (i + 1) * pathLag;
    let fresh = false;
    if (u.lag === undefined) {                                     // いまの間隔から始める（道の上の同じ位置）
      u.lag = u.shown ? Math.min(tgt, holder.position.distanceTo(plane.position) / Math.max(20, SPEED * spdK)) : tgt;
      fresh = u.shown; if (!fresh) u.rpOff = null;
    }
    u.lag = Math.min(tgt, u.lag + LAG_RATE * dt);
    const sAt = stateAt(u.lag);
    /* 道へ移る始めは、隊形の席と道の上の点の差（横に 30〜80 m）を RP_BLEND 秒かけて縮める。
       そのまま置くと、着陸に入った瞬間に僚機が見えているところで横へ跳んだ（実測: 1 コマに 29〜81 m） */
    if (fresh) { u.rpOff = (u.rpOff || new THREE.Vector3()).copy(holder.position).sub(sAt.p); u.rpOff.x -= (u.rwx || 0); u.rpT = 0;
      u.rpDur = clamp(u.rpOff.length() / 60, RP_BLEND, 20); }       // 遠い機（描き物の終わりなど）は、縮める速さが 60 m/s を超えない長さに
    holder.position.copy(sAt.p); holder.position.x += (u.rwx || 0);   // 滑走路 2 に降りる機は 100 m 西の線
    if (u.rpOff && u.rpT < u.rpDur) {
      u.rpT += dt; const kb = clamp(u.rpT / u.rpDur, 0, 1);
      holder.position.addScaledVector(u.rpOff, 1 - kb * kb * (3 - 2 * kb));
    }
    if (holder.position.z < 3) holder.position.z = 3;
    if (!u.shown) holder.quaternion.copy(sAt.q); else turnMate(holder, sAt.q, dt);
    holder.visible = true; u.shown = true;
    if (emitting && color && holder.position.z > 6) { emitPos.set(0, -6.9, -0.3).applyQuaternion(holder.quaternion).add(holder.position); emit(emitPos, color, null, 0, i + 1); }
    /* 地上の道へ移るときのために、いまの向き（方位）を持っておく */
    { const f2 = gfw.copy(AY).applyQuaternion(holder.quaternion); u.gh = ((Math.atan2(f2.x, f2.y) / D) % 360 + 360) % 360; }
  }
  /* 移った直後は軌跡がないので、いまの向きの後ろへまっすぐ sec 秒ぶんの道を作っておく（追従機が道をたどれる） */
  function seedHistory(sec) {
    hist.length = 0;
    const v = SPEED * spdK, n = Math.ceil(sec * 20);
    for (let k = n; k >= 0; k--) {
      const tb = k / 20;
      hist.push({ t: histT - tb, p: new THREE.Vector3(plane.position.x - fwd.x * v * tb, plane.position.y - fwd.y * v * tb, plane.position.z - fwd.z * v * tb), q: att.clone() });
    }
  }
  function recordHistory(dt) {
    histT += dt;
    hist.push({ t: histT, p: plane.position.clone(), q: att.clone() });
    while (hist.length > 2 && hist[0].t < histT - 100) hist.shift();   // 追従が 1 番機の道をたどる（着陸は 5 機 × 16 秒）ぶんまで残す
  }
  const exFwd = new THREE.Vector3(), exPos = new THREE.Vector3(), exSt = { p: exPos, q: null };
  const atSt = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  /* lag 秒前の 1 番機の状態。記録より前を求められたら、いちばん古い点から後ろへ まっすぐ延ばす。
     （その場に留めると、機体が空中で止まって待っているように見える）。
     記録は 1 コマごとなので、前後 2 点の間を割って返す。いちばん近い点をそのまま返すと、
     1 コマぶん（60 m/s なら 1 m）位置が飛び、その機体に乗った一人称視点がガタつく */
  function stateAt(lag) {
    const want = histT - lag;
    /* 求める時刻を二分探索で挟む。端からたどると、90 秒遅れの機では 1 コマに 5000 回を超えて数え、
       着陸のあいだ全体が重くなった（v04.28 で直した） */
    let lo = 0, hi = hist.length - 1, at = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (hist[mid].t <= want) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    for (let i = at < 0 ? -1 : at; i >= 0; i--) {
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
    const s = e8.s, off0 = FORMATIONS[formation].offs[i] || [0, -32, 0];
    e8.t += dt;
    const turned = hdgSum - e8.t0;
    if (!e8.chase) {
      /* 自分の円（3 機の 1/1.5）を、決めた速さで 1 周する */
      e8.ph = Math.min(360, e8.ph + (e8.v1 / e8.rS) / D * dt);
      const hd = e8.h0 - s * e8.ph, a = (hd - s * 90) * D;
      e8p.set(e8.cx - e8.rS * Math.sin(a), e8.cy - e8.rS * Math.cos(a), e8.z);
      /* 傾きは、その円をその速さで回るのに要るぶん */
      const bk = Math.atan(e8.v1 * e8.v1 / (9.81 * e8.rS)) / D;
      e8q.setFromAxisAngle(AZ, -hd * D);
      e8q.multiply(dq.setFromAxisAngle(AY, -s * clamp(bk, 25, 82) * D));
      if (e8.ph >= 360) {                        // 1 周した。ここから 3 機の道をたどって追いつく
        e8.chase = true; e8.bt = 0;
        e8.from = e8p.clone(); e8.fq = e8q.clone();        // 移り始めの位置と向き（つなぎに使う）
        e8.lag = Math.max(0.2, (turned / 360) * e8.lap);   // 3 機の道の、どれだけ後ろにいるか（秒）
      }
    } else {
      /* 3 機の通った道（1 番機の通った道）をたどる。3 機が E8_JOIN_AT まで回るまでに追いつくよう、
         遅れを縮める速さを残り時間から決める。ただし無理のない速さ（E8_VMAX）までにとどめる */
      const slotLag = Math.max(0.2, -off0[1] / Math.max(1, SPEED * spdK));
      const remain = Math.max(0.6, ((E8_JOIN_AT - turned) / 360) * e8.lap);
      const need = (e8.lag - slotLag) / remain;                       // 1 秒あたり、何秒ぶん縮めるか
      const cap = Math.max(0, E8_VMAX / Math.max(0.2, spdK) - 1);     // 速さの上限から決まる縮め方
      e8.lag = Math.max(slotLag, e8.lag - Math.min(need, cap) * dt);
      const sA = stateAt(e8.lag);
      mo.set(off0[0], 0, off0[2]).applyQuaternion(sA.q);
      e8p.copy(sA.p).add(mo); e8q.copy(sA.q);
      /* 円の上の位置と、道の上の位置は 隊形のずれのぶんだけ離れている。
         そのまま移すと飛んで見えるので、少しの間かけてつなぐ（そのあいだも前へ進み続ける） */
      if (e8.bt < E8_BLEND) {
        e8.bt += dt;
        const kb = clamp(e8.bt / E8_BLEND, 0, 1), eb = kb * kb * (3 - 2 * kb);
        e8.from.addScaledVector(fwd2.set(0, 1, 0).applyQuaternion(e8.fq), e8.v1 * dt);
        e8p.lerpVectors(e8.from, e8p, eb);
        e8q.slerp(e8.fq, 1 - eb);
      }
      if (e8.lag <= slotLag + 1e-3 && !e8.done) {  // 列に戻った（ダイヤモンド）。ここでスモークを入れ替える
        e8.done = true; e8.joinT = e8.t;
        u.cur.set(off0[0], off0[1], off0[2]); u.from = null;
      }
    }
    holder.position.copy(e8p);
    turnMate(holder, e8q, dt);
    holder.visible = true; u.shown = true;
    /* 自分の円を描くあいだは出す。たどっているあいだは切る（合流したら、ふつうの決まりに返る） */
    if (emitting && color && !e8.chase) { emitPos.set(0, -6.9, -0.3).applyQuaternion(e8q).add(e8p); emit(emitPos, color, null, 0, i + 1); }
  }
  /* 僚機を目標の点へ飛ばす。速さは一定、曲がりは 1 秒あたり `rate` 度まで、高さはなめらかに寄せる。
     実際に飛べる動き（前へ進むだけ、後退しない）になるので、着陸の進入などに使える。
     戻り値は目標までの距離 */
  const fmV = new THREE.Vector3();
  function flyMateTo(holder, u, tx, ty, tz, dt, spd, rate) {
    const p = holder.position;
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    const want = ((Math.atan2(dx, dy) / D) % 360 + 360) % 360;
    if (u.mh === undefined) u.mh = want;
    u.mh = (u.mh + clamp(wrap180(want - u.mh), -(rate || 25) * dt, (rate || 25) * dt) + 360) % 360;
    p.x += Math.sin(u.mh * D) * spd * dt;
    p.y += Math.cos(u.mh * D) * spd * dt;
    p.z += clamp(tz - p.z, -12 * dt, 12 * dt);
    /* 姿勢: 進む向きへ。曲がっているぶんだけ傾ける */
    const turn = wrap180(want - u.mh);
    const bank = clamp(turn * 1.2, -35, 35);
    fmV.set(0, 0, 0);
    qa.setFromAxisAngle(AZ, -u.mh * D);
    qa.multiply(dq.setFromAxisAngle(AY, bank * D));
    turnMate(holder, qa, dt);
    holder.visible = true; u.shown = true;
    return d;
  }
  /* ===== 2 機ずつの着陸 =====
     1・2 番機 → 3・4 番機 → 5・6 番機 の順に、`LAND_GAP` 秒あけて降りる。
     地上から見る人が、降りる組を順に目で追えるだけの間をとる。
     出番が来るまでは、滑走路の南で輪を描いて待つ（高さは組ごとに変える） */
  /* 待機の輪は小さく（半径 160 m）。大きい輪（620 m）だと、輪のどこにいるかで進入までの道のりが 1 km 以上ちがい、
     接地の時刻が組の中でも 17 秒ずれた（実測）。小さい輪なら道のりの見積もりが当たる */
  const LAND_HOLD_R = 160;
  /* 先頭（1 番機）が最終の降下を始めてからの時間（秒）。-1 はまだ。
     組ごとの出番はここで決める。先頭の降下開始から最後尾の接地までを LAND_TOTAL 秒にそろえる
     （曲の anthem を頭から流すと、ちょうどそこで終わる長さ）。LAND_AT は実測で合わせた出番の時刻 */
  const LAND_TOTAL = 66.5;                 // anthem を頭から流し始めてから、最後尾が接地するまで（秒）
  const LAND_LEAD_TD = 83;                 // 延長線上（南 3.6 km）へ移ってから先頭が接地するまで（実測 83.2 秒）
  const LAND_PAIR_GAP = 14;                // 組ごとの接地の間隔（秒）。最後尾は 33 + 14 × 3 = 75 秒
  const LAND_LAST = LAND_LEAD_TD + 5 * 18.0;  // 先頭の降下開始から最後尾の接地まで（追従 5 機が 18 秒ずつ遅れて降りる）
  /* 最後尾が接地してから、全機が駐機場に停まりきるまで（秒）。
     利用者の指示 15 の「最終機が初期位置に戻りきる」はここ。実測 v04.76（6 機・探針で通した）:
     最後尾の接地が降下開始から 177 秒、全機が停まりきったのが 279 秒 → 102 秒 */
  const LAND_PARK = 102;
  let landMusOn = false;                   // anthem を流し始めたか（着陸で一度だけ）
  let landDesc = -1;
  let landClock = -1;                      // 1 番機が接地してからの時間（秒）。-1 はまだ
  function landMate(holder, u, i, dt) {
    const L = u.ld;
    L.t += dt;
    const rx = ((i + 1) % 2 === 0) ? RWY_X[0] : RWY_X[1];      // 2 本の滑走路に振り分ける
    /* 出番: 1 番機の組（pair 0）は 1 番機と一緒に降りる。
       あとの組は、1 番機が接地してから LAND_GAP 秒ずつあけて降りる */
    /* 1 番機の組は、1 番機が進入に乗って低くなってから一緒に降りる。
       あとの組は、1 番機が接地してから LAND_GAP 秒ずつあけて降りる */
    /* 出番: 組ごとの「接地させたい時刻」（先頭 + 11 秒 × 組の番号）から、いまの位置から接地点までにかかる時間を
       引いた時刻に最終へ入る。輪のどこにいても接地の時刻がそろう（決めた時刻で出すと、輪の位置で 36〜63 秒ぶれた） */
    const tdYw = LAND_TD_Y, gy = RWY.y - 1400;
    /* 道のり ÷ 速さ に、向き直りの時間（進入の点への方位との差 ÷ 22 度/秒）を足す。
       向き直りを見ないと、輪の反対側を向いている機が 8 秒遅れた（実測） */
    const brg = ((Math.atan2(rx - holder.position.x, gy - holder.position.y) / D) % 360 + 360) % 360;
    const turnT = u.mh === undefined ? 4 : Math.abs(wrap180(brg - u.mh)) / 22;
    /* 降りるのにかかる時間も見る。輪の高さ（最後の組は 440 m）から 12 m/s でしか降りられないので、
       道のりの時間より長いことがある（見ないと最後の組が 12 秒遅れた。実測） */
    const pathT = (Math.hypot(rx - holder.position.x, gy - holder.position.y) + (tdYw - gy)) / (SPEED * 0.9);
    const downT = Math.max(0, holder.position.z - 3) / 12 + 2;
    const est = Math.max(pathT, downT) + turnT + 1;      // 余裕は小さく（+6 と +2 では最後の組が 7 秒早かった）
    const want = LAND_LEAD_TD + (L.pair + 1) * LAND_PAIR_GAP;
    const turn = landDesc >= 0 && (L.on || landDesc >= want - est);
    if (!turn) {                                               // 出番待ち: 滑走路の南で輪を描く
      const cx = RWY.x - 40, cy = RWY.y - 1900, z = 260 + L.pair * 90;
      const a = Math.atan2(holder.position.y - cy, holder.position.x - cx) + 0.4;
      flyMateTo(holder, u, cx + Math.cos(a) * LAND_HOLD_R, cy + Math.sin(a) * LAND_HOLD_R, z, dt, SPEED * 0.85, 22);
      return;
    }
    if (!L.on) { L.on = true; L.step = 0; }
    const g = GRID[i + 1], tdY = LAND_TD_Y;              // 接地する点（滑走路の上）
    if (L.step < 2) {
      /* 進入: 滑走路の線に乗り、接地する点まで 3 度の勾配で降りる。
         高さを「接地する点までの距離」から決めるので、手前で降りきってしまわない */
      const far = Math.max(0, tdY - holder.position.y);
      const wz = Math.min(300, 3 + far * LAND_SLOPE);
      const wy = L.step === 0 ? RWY.y - 1400 : tdY;
      const d = flyMateTo(holder, u, rx, wy, wz, dt, SPEED * 0.9, L.step === 0 ? 22 : 18);
      /* 進入の線に乗る点まで、きちんと行ってから最終へ移る。
         「もう北にいるから」で移すと、斜めから滑走路へ突っ込んで、帯を外れる（実測） */
      if (L.step === 0 && d < 200) L.step = 1;
      /* 帯（y = -550〜）に入り、滑走路の線に乗る（横ずれ 20 m 未満）までは 6 m より下げない。接地は帯の上でだけ
         （線に乗る前に降ろすと、帯の脇 x = -31 に降りた。実測） */
      const inStripM = holder.position.y > -STRIP_END + 30 && Math.abs(holder.position.x - rx) < 20;
      if (!inStripM && holder.position.z < 6) holder.position.z = 6;
      if (L.step === 1 && holder.position.z <= 4 && inStripM) { L.step = 2; L.tDown = L.t; }
      if (holder.position.z < 3) holder.position.z = 3;
      return;
    }
    /* 接地したあと: 滑走して減速し、待機の位置で止まる。
       速さの下限を残すと、その場で回り続けて着陸が終わらない（実測: 着陸に 450 秒たっても終わらなかった）。
       0 まで落として、近づくか止まりきったところで終わりにする */
    const spd = Math.max(0, SPEED * 0.9 * (1 - clamp((L.t - L.tDown) / 9, 0, 1)));
    const d = flyMateTo(holder, u, RWY.x + g[0], RWY.y + g[1], 3, dt, spd, 12);
    holder.position.z = 3;
    if (d < 30 || spd <= 0.5) {
      L.done = true; u.shown = true;
      qa.setFromAxisAngle(AZ, -RWY.h * D); holder.quaternion.copy(qa); u.gh = RWY.h;   // 滑走路の向きで止める
    }
  }
  /* 地上では 2 本の滑走路に 2 機ずつ並び、離陸は 2 機ずつ TK_GAP 秒あけて始める。
     浮いて TK_UP まで上がった機体から、ふつうの編隊の置き方に返す（そこで隊形を組み出す） */
  const tgtP = new THREE.Vector3();
  let tkOn = false;                       // 離陸の最中か（全機が編隊へ移るまで true）
  /* kind: 'pairs' = 2 本の滑走路から 2 機ずつ、TK_GAP 秒おき。
     'diamond' = 滑走路 1 本にひし形に並んだまま 4 機が一斉に（ダイヤモンド・テイクオフ） */
  function startTakeoff(kind) {
    tkOn = true;
    mates.forEach(h => { h.userData.ld = null; h.userData.mh = undefined; h.userData.rejoin = false; });   // 着陸の段取りと合流の印は消す
    /* 滑走路に並んでいる機（lineSpot）だけ滑走を始める。取り付けで待つ機は、前の機が滑走を始めてから並び、並んでから滑走する（queueStep）。
       ダイヤモンドは 滑走路 1 本に 4 機がひし形に並んでいて、その形のまま一斉に出る */
    mates.forEach((h, i) => {
      const u = h.userData;
      if (!u.shown || !u.lineSpot || u.queue >= 0) { if (!u.shown) u.tk = null; return; }
      /* ダイヤモンドは、整列の時点でひし形に並んでいるので時間差を置かない。
         置くと前後の間隔が変わって形が崩れる（利用者の指示 第 2 便 2） */
      const wait = 0;
      u.tk = { t: 0, v: 0, x: u.lineSpot[0], y: u.lineSpot[1], z: 3, air: false, done: false, wait };
      u.ground = false;
    });
    gearOn = true; lightsOn = true; applyGear(); landCfg = false;   // 離陸中はタイヤとライトを出す。着陸体制はここで解ける
  }
  /* 順番待ちの機（queue >= 0）: その滑走路を前に使う機（2 つ前の番号。番号 -1 は 1 番機）が滑走を始めたら、滑走路へ出て並び、並んだら滑走する */
  const rolling = k => k < 0 ? (gmode === 'takeoff' || gmode === 'fly') : !!(mates[k] && mates[k].userData.tk && mates[k].userData.tk.t >= mates[k].userData.tk.wait);
  /* その点が、いまのカメラの視界に入っているか（見えているか）。
     展示飛行モードで、後から上がる 5・6 番機を「見えていないあいだに」出すのに使う（利用者の指示 7） */
  const vSee = new THREE.Vector3(), vFwd2 = new THREE.Vector3();
  function inCamView(p, m = 1.15) {                         // m: 画面の端からの余裕（1 = 画面の端）
    vSee.copy(p).sub(cam.position);
    vFwd2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (vSee.dot(vFwd2) <= 0) return false;                 // カメラの後ろ
    vSee.copy(p).project(cam);
    return Math.abs(vSee.x) < m && Math.abs(vSee.y) < m;
  }
  const QUEUE_WAIT_MAX = 25;                                // 見られ続けているときの上限（秒）。演目が止まらないように（2 機ずつの離陸だけ）
  /* 展示飛行のダイヤモンド・テイクオフで取り付けに待つ 5・6 番機は、滑走させずに「見えていないあいだに上がった」扱いにする
     （利用者の指示 2026-09-24「ダイヤモンド・テイクオフの最中に 5・6 番機が視界の中で離陸してはいけない」）。
     以前は待ちの位置が見えていないときに滑走へ出していたが、滑走と上昇の 30 秒ほどのあいだに、
     1 番機を追って原点のまわりを回る視線が滑走路を横切り、離陸が見えていた（実測: 5 番機の滑走・上昇が 2.1 秒 視界に入った）。
     さらに 25 秒見られ続けると見えていても出していた。
     いまは、待ちの位置が視界の外にあるときに地上から消し、隊形の後ろの遠く（ENTRY）で隠して待たせる。
     次の瞬間移動（進入で位置を移す瞬間。画面は一瞬白くなる）で隊形の席に現れる（hold を 0 にする所）。
     瞬間移動がないまま hold が切れたら、後ろの遠くから合流してくる */
  function launchHidden(h, i) {
    const u = h.userData, e = ENTRY[i];
    u.queue = -1; u.parked = false; u.ground = false; u.gp = null; u.tk = null; u.lineSpot = null;
    h.visible = false; u.shown = false; u.rejoin = true; u.hold = 90;
    u.cur.set(e[0], e[1], e[2]); u.k = 1; u.from = null; u.qw = null;
  }
  const queuedHidden = u => auto && (showLoop || showThru) && tkKind === 'diamond' && u.queue !== undefined && u.queue >= 0 && !u.tk;
  /* 瞬間移動の瞬間に、まだ取り付けで待っている機（ずっと見られていて消せなかった機）も上がった扱いにする */
  function launchQueued() { mates.forEach((h, i) => { if (queuedHidden(h.userData)) launchHidden(h, i); }); }
  function queueStep() {
    mates.forEach((h, i) => {
      const u = h.userData;
      if (u.queue === undefined || u.queue < 0 || !u.parked || u.gp || u.tk) return;
      if (!tkOn && gmode !== 'takeoff' && gmode !== 'fly') return;   // 1 番機がまだ待っている
      const r = (u.queue % 2), prev = i - 2;                       // 使う滑走路（0 = 滑走路 1、1 = 滑走路 2）と、前にその滑走路を使った機
      if (!rolling(prev)) { u.qT0 = 0; return; }
      /* 展示飛行モードでは、見られているあいだは出さない（ダイヤモンド・テイクオフの最中に、
         追いかけている視界の中で 5・6 番機が上がってしまわないように）。
         ずっと見られているときのために、待ちの上限を置く */
      if (queuedHidden(u)) { if (!inCamView(h.position)) launchHidden(h, i); return; }
      if (auto && (showLoop || showThru)) {
        if (!u.qT0) u.qT0 = clock;
        if (inCamView(h.position) && clock - u.qT0 < QUEUE_WAIT_MAX) return;
      }
      const gx = RWY.x + (r ? RWY2 : 0);
      u.queue = -1; u.parked = false; u.lineSpot = [gx, RWY.y];
      u.gp = { pts: [[gx, TAXI_S], [gx, RWY.y]], idx: 0, v: 0, h: u.gh, hEnd: RWY.h, wait: 0 };
    });
  }
  function rollMate(holder, u, i, dt, emitting, color) {
    const t = u.tk;
    t.t += dt;
    if (t.t >= t.wait) {
      if (!t.air) {                                   // 滑走
        t.v = Math.min(SPEED, t.v + 6 * dt);
        t.y += t.v * dt;
        t.p = clamp((t.v - SPEED * ROT_K) / (SPEED * (0.9 - ROT_K)) * TK_ANG, 0, TK_ANG);   // 機首上げ
        if (t.v >= SPEED * 0.9) { t.air = true; t.p = TK_ANG; u.parked = false; }   // 浮く（並びで止まっていた印はここで消す。残すと脚をしまえない）
      } else {                                        // 上昇
        t.y += t.v * Math.cos(TK_ANG * D) * dt;
        t.z += t.v * Math.sin(TK_ANG * D) * dt;
        if (t.z > TK_UP) {                            // ここから編隊へ寄せる
          /* 離陸からの寄せは、道を膨らませない（利用者の指摘 4。v04.76）。
             上がっていく列はもう自然な形なので、膨らませると上下にふらつく */
          t.done = true; u.from = null; u.tkJoin = true;
          qa.copy(att).invert();
          mo.set(t.x, t.y, t.z).sub(plane.position).applyQuaternion(qa);
          u.cur.copy(mo);
        }
      }
    }
    holder.position.set(t.x, t.y, t.z);
    qa.setFromAxisAngle(AZ, -RWY.h * D);
    if (t.air) qa.multiply(dq.setFromAxisAngle(AX, TK_ANG * D));
    else if (t.p > 0.01) qa.multiply(dq.setFromAxisAngle(AX, t.p * D));
    turnMate(holder, qa, dt);
    holder.visible = true; u.shown = true;
    /* 浮いたあとは、真後ろに他機がいなければ出す（滑走中は出さない） */
    /* 離陸中はスモークを出さない（浮いてからも、編隊に入るまでは出さない。利用者の指示: 離着陸時はどの機体もオフ） */
  }
  /* 地上にいるあいだの並べ方。着陸してきた機体は、その場から並びへ滑らかに寄せる */
  function groundMates(dt, emitting, cols, on0) {
    const n = FORMATIONS[formation].n;
    queueStep();
    mates.forEach((holder, i) => {
      const u = holder.userData;
      if (i + 1 >= n && !u.ground && !u.gp) { holder.visible = false; u.shown = false; u.tk = null; return; }
      groundOne(holder, u, i, dt, emitting, on0, cols);
    });
  }
  function groundOne(holder, u, i, dt, emitting, on0, cols) {
    {
      if (u.tk && !u.tk.done) { rollMate(holder, u, i, dt, emitting, on0[i + 1] ? cols[(i + 1) % cols.length] : null); return; }
      /* 自分の道（誘導路）を走る。出発は wait 秒あとに（前の機と重ならない） */
      if (u.gp) {
        u.gp.wait -= dt;
        if (u.gp.wait <= 0) {
          /* 前方 45 m の自分の車線（横 9 m 以内）に、先に出た機（1 番機か、番号の若い機）がいれば止まって待つ。
             横 20 m まで見て、あとから出た機も待っていたら、合流で互いに待ち合って動けなくなった（実測） */
          u.gp.hold = false;
          { const hx = Math.sin(u.gp.h * D), hy = Math.cos(u.gp.h * D);
            /* 自分の止まる点より先にいる機は待つ理由にならない（並びの前の機・待ち位置の前の機。
               これを見ていたら、8 m 手前で止まったまま並び終えられず、離陸できなかった。実測） */
            const gpE = u.gp.pts[u.gp.pts.length - 1], dEnd = Math.hypot(gpE[0] - holder.position.x, gpE[1] - holder.position.y);
            /* 車線の前方 45 m（横 9 m 以内）か、すぐ近く 26 m 以内（後ろ以外）。角を曲がった先で待っている機に、曲がりながら
               ぶつかることがあった（実測: 2 m）ので、近くは向きを問わず待つ */
            const near = (px, py) => { const dx = px - holder.position.x, dy = py - holder.position.y; const a = dx * hx + dy * hy, b = Math.abs(dx * hy - dy * hx);
              if (a > dEnd - 3) return false;
              return (a > 2 && a < 45 && b < 9) || (a > -6 && Math.hypot(dx, dy) < 26); };
            if (near(plane.position.x, plane.position.y)) u.gp.hold = true;
            mates.forEach((o, j) => { if (j < i && o.userData.shown && near(o.position.x, o.position.y)) u.gp.hold = true; }); }
          const done = driveOn(holder.position, u.gp, dt); u.gh = u.gp.h;
          if (done) {
            u.parked = true; u.gp = null;
            /* 順番待ちから並んだ機は、そのまま滑走を始める */
            if (u.lineSpot && u.queue === -1 && (tkOn || gmode === 'takeoff' || gmode === 'fly') && !u.tk) {
              u.tk = { t: 0, v: 0, x: u.lineSpot[0], y: u.lineSpot[1], z: 3, air: false, done: false, wait: 0.8 }; u.ground = false; tkOn = true;
            }
          }
        }
        holder.position.z = 3;
        qa.setFromAxisAngle(AZ, -u.gh * D); if (!u.shown) holder.quaternion.copy(qa); else turnMate(holder, qa, dt);
        holder.visible = true; u.shown = true; u.from = null;
        return;
      }
      /* 着陸のあと: 1 番機の道をたどって降り、1 番機が誘導路へ入った点まで来たら、自分の道で駐機へ */
      if (pathLag > 0 && !u.pfDone) {
        placeReplay(holder, u, i, dt, false, null);
        if (taxiFrom && Math.abs(holder.position.y - taxiFrom.y) < 20 && Math.abs(holder.position.x - taxiFrom.x - (u.rwx || 0)) < 20) {
          u.pfDone = true; u.parked = false; u.ground = true; u.lampOn = false;   // 誘導路へ入る: ライトを消す
          u.gp = { pts: pathIn(i + 1, u.rwx || 0, holder.position.y), idx: 0, v: TAXI_V, h: u.gh !== undefined ? u.gh : RWY.h, hEnd: STANDS[i + 1].h, wait: 0, fast: true };
        }
        return;
      }
      if (u.ld && !u.ld.done) { landMate(holder, u, i, dt); return; }
      if ((gmode === 'land' || gmode === 'taxi') && !u.parked) {
        /* （自分で操縦して降りたとき）減速中・誘導路のあいだは、1 番機のすぐ後ろに縦に続く */
        mo.set(0, -(i + 1) * 26, 0).applyQuaternion(att);
        holder.position.copy(plane.position).add(mo); holder.position.z = 3;
        qa.setFromAxisAngle(AZ, -st.h * D);
        if (!u.shown) holder.quaternion.copy(qa); else turnMate(holder, qa, dt);
        u.gh = st.h;
      } else if (!u.shown) {
        /* まだ出ていない機は、いまの並び（滑走路なら GRID、駐機場なら駐機）に置く */
        if (gmode === 'apron' || gmode === 'land' || gmode === 'taxi') { const sd = STANDS[i + 1]; holder.position.set(sd.x, sd.y, 3); u.gh = sd.h; }
        else { const g = GRID[i + 1]; holder.position.set(RWY.x + g[0], RWY.y + g[1], 3); u.gh = RWY.h; }
        holder.quaternion.setFromAxisAngle(AZ, -u.gh * D); u.parked = true;
      } else {
        holder.position.z = 3;                       // 並んで待っている（動かない）
        qa.setFromAxisAngle(AZ, -(u.gh !== undefined ? u.gh : RWY.h) * D); turnMate(holder, qa, dt);
      }
      holder.visible = true; u.shown = true;
      u.from = null;                                  // 飛び立つときに道を引き直す
    }
  }
  /* ===== 飛び去る機 =====
     隊形に席がなくなった機・散開で遠くへ開いた機のうち、視界の中にいるものは、その場で消さない。
     機首の向きのまま（下向きなら水平に直して）1 番機と同じ速さでまっすぐ飛び、視界から出たか、
     DEP_FAR より遠くなって豆粒になったところで隠す。演目が止まらないよう DEP_MAX 秒で必ず隠す */
  const DEP_FAR = 6000, DEP_MAX = 120;
  function departStart(h, u, bloom) {
    const v = new THREE.Vector3(0, 1, 0).applyQuaternion(h.quaternion);
    if (v.z < 0) { v.z = 0; if (v.lengthSq() < 1e-4) v.set(Math.sin(st.h * D), Math.cos(st.h * D), 0); v.normalize(); }
    u.dep = { v: v.multiplyScalar(SPEED * Math.max(0.6, spdK)), t: 0, bloom };
    h.visible = true; u.shown = true;
  }
  function departStep(h, u, i, dt) {
    u.dep.t += dt;
    h.position.addScaledVector(u.dep.v, dt);
    /* 視界の判定は余裕を広く取る（画面の端から 30%）。ふつうの余裕（15%）ちょうどで消すと、端をかすめて出入りする機が
       見えている範囲の際で消えたことになる */
    if (!inCamView(h.position, 1.3) || h.position.distanceTo(cam.position) > DEP_FAR || u.dep.t > DEP_MAX) departHide(h, u, i, u.dep.bloom);
  }
  /* 隠す。散開のあとの機は次の瞬間移動まで隠したまま（hold）、席のなくなった機は後ろの遠く（ENTRY）から次の合流を待つ */
  function departHide(h, u, i, bloom) {
    h.visible = false; u.shown = false; u.rejoin = true; u.dep = null; u.from = null; u.qw = null;
    if (bloom) { u.hold = 90; u.cur.set(0, -120, 0); }
    else { const e = ENTRY[i]; u.cur.set(e[0], e[1], e[2]); u.k = 1; }
  }
  function placeMates(dt) {
    /* 接地して減速しているあいだ（land）は、ふつうの編隊の置き方に任せる。
       追従機は 1 番機の通った道をたどるので、同じところへ順に降りてくる。
       勝手に待機位置へ行かせない。並べるのは誘導路に入ってから、または「滑走路へ戻る」を押したとき */
    if (gmode === 'taxi' || gmode === 'stand' || gmode === 'takeoff' || gmode === 'apron') {
      const on0 = smokers(), cols0 = SMOKE_COLORS[smokeColor].c;
      /* 展示飛行の滑走中（takeoff）は煙を出さない。待機中の点検の煙は、加速を始めたところで切れる。
         上がってからは課目が決める（隊形を組む合間は出さず、課目に入って出す） */
      const emit0 = smokeOn && smokeT >= SMOKE_DT && !(auto && gmode === 'takeoff');
      if (smokeOn && smokeT >= SMOKE_DT) smokeT = 0;
      /* 離陸を待っているあいだは、後ろへ吹き出して流れる煙で点検する（その場にとどまらない）。
         **待機位置に着いた機体から、各自で出す**（利用者の指示 6。v04.76）。
         スモークの入り切り（smokeOn）とは別で、整列の点検としていつも出す。
         1 番機は道を走り終えた時点で gmode が 'stand' になる＝待機位置に着いたとき。
         追従機は自分の並ぶ場所に着いた時（parked）から。滑走を始めたら止める（そこからは飛んでいる煙にする） */
      if (gmode === 'stand' && auto) {
        checkSmoke(plane.position, att, cols0[0], dt);
        /* 待機位置に着いた機は全部出す（利用者の指示 第 1 便 6）。
           隊形の席の数で区切ると、隊形が小さいときに並んでいる機が出さなかった */
        const nChk = mates.length + 1;
        mates.forEach((h, i) => { if (i + 1 < nChk && h.userData.shown && h.userData.parked) checkSmoke(h.position, h.quaternion, cols0[(i + 1) % cols0.length], dt); });
        smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.acolor.needsUpdate = true;
        smokeGeo.attributes.birth.needsUpdate = true; smokeGeo.attributes.asize.needsUpdate = true;
        smokeGeo.attributes.alife.needsUpdate = true; smokeGeo.attributes.avel.needsUpdate = true;
      }
      groundMates(dt, emit0, cols0, on0);
      if (emit0) { smokeGeo.attributes.avel.needsUpdate = true; smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.acolor.needsUpdate = true; smokeGeo.attributes.birth.needsUpdate = true; smokeGeo.attributes.asize.needsUpdate = true; smokeGeo.attributes.alife.needsUpdate = true; }
      smokeMat.uniforms.uTime.value = clock;
      return;
    }
    if (retT >= 0) { retT += dt; if (retT >= retDur) { retT = -1; mates.forEach(h => { h.userData.ret = null; }); } }
    const f = FORMATIONS[formation], on = smokers(), cols = SMOKE_COLORS[smokeColor].c;
    /* 演目の合間（進入・高度取り・水平に戻す）は煙を切る。旋回は演目の一部なので出す */
    const between = auto && manPhase !== 'do';
    const emitting = smokeOn && smokeT >= SMOKE_DT && !between;
    if (emitting) smokeGeo.attributes.avel.needsUpdate = true;   // 飛んでいる煙は速さ 0（点検の粒を使い回しても流れない）
    if (smokeOn && smokeT >= SMOKE_DT) smokeT = 0;
    if (on[0] && emitting && !fig && !tkOn) { emitPos.set(0, -6.9, -0.3).applyQuaternion(att).add(plane.position); emit(emitPos, cols[0 % cols.length], null, 0, 0); }   // 離陸の段取り中（tkOn）は出さない
    queueStep();
    mates.forEach((holder, i) => {
      const target = f.offs[i], u = holder.userData, e = ENTRY[i];
      /* 無限遠へ飛び去った扱いの機は、次の瞬間移動まで出さない（出すと、遠くから隊形へ一気に寄って見える）。
         万一そのままにならないよう、時間で必ず解ける */
      if (u.hold > 0) { u.hold -= dt; holder.visible = false; u.shown = false; if (u.hold > 0) return; }
      if (u.dep) {                                               // 飛び去っている途中
        /* 席ができても、1 番機から 520 m より遠ければ飛び去り続ける（隠れてから、次の移す瞬間に席へ現れる）。
           遠くから合流させると、遠い機の置き方（機首の向きだけで置く・世界の座標で持つ）が混ざって、
           地面の下（−86 m）や上空 490 m へ振られた（実測: レインフォールのあとのクリスマスツリー・ローパス） */
        if ((!target || holder.position.distanceTo(plane.position) > 520) && !snapForm) { departStep(holder, u, i, dt); return; }
        /* 席ができて近ければ、いまの位置から ふつうの合流で寄る。移す瞬間（snapForm）は下で置き直す */
        if (!snapForm) { mo.copy(holder.position).sub(plane.position).applyQuaternion(qInv.copy(att).invert()); u.cur.copy(mo); u.from = null; }
        u.dep = null;
      }
      if (u.gp || (u.ground && !u.tk)) { groundOne(holder, u, i, dt, emitting, on, cols); return; }   // まだ地上（順番待ち・誘導路）
      if (pathLag > 0 && !u.pfDone) { if (i + 1 < f.n) placeReplay(holder, u, i, dt, emitting, on[i + 1] ? cols[(i + 1) % cols.length] : null); else { holder.visible = false; u.shown = false; } return; }
      if (u.tk && !u.tk.done) { rollMate(holder, u, i, dt, emitting, on[i + 1] ? cols[(i + 1) % cols.length] : null); return; }   // まだ滑走・上昇の途中
      if (u.ld && !u.ld.done) { landMate(holder, u, i, dt); return; }   // 2 機ずつの着陸の途中
      if (mir && i === 0) {                                          // 交差する課目の相手
        /* 相手は鏡の位置に置くので、隊形の寄せ（k）は進まない。移した瞬間（snapForm）に席に着いた扱いにする。
           しないと合流の途中（join）のまま残り、スモークが出なかった（実測: タック・クロスの 2 番機） */
        if (snapForm) { u.k = 1; u.from = null; }
        if (mir.vert) placeTuck(holder, u, dt, emitting, on[1] ? cols[1 % cols.length] : null);
        else placeMirror(holder, u, dt, emitting, on[1] ? cols[1 % cols.length] : null);
        return;
      }
      if (bloomS && i < 4) { placeBloom(holder, u, i, dt, emitting, on[i + 1] ? cols[(i + 1) % cols.length] : null); return; }
      if (bloomS && i >= 4) { holder.visible = false; u.shown = false; return; }
      if (e8 && !e8.done && i === e8.solo) { placeEight(holder, u, i, dt, emitting, cols[(i + 1) % cols.length]); return; }
      /* 描き物の最中: 式のとおりに置く。始めの 2.5 秒は、いまの位置から図の始点へなめらかに移る */
      if (fig) {
        if (i >= fig.n) { holder.visible = false; u.shown = false; return; }
        const pu = fig.t / fig.dur;                                // 1 を超えても止めない（延長線上を飛び続ける。どこまでかは FIGS の end）
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
          mq.copy(att); mp.copy(plane.position);
          mo.set(u.cur.x, u.cur.y, u.cur.z).applyQuaternion(mq); mp.add(mo);
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
        if (ok && !figDrawn) { figDrawn = true; figAim = figO.clone(); }   // 線を引き始めた。ここから絵の中心を見る
        if (emitting && ok) {
          let fc = cols[(i + 1) % cols.length];
          if (smokeColor === 'rainbow') fc = fig.id === 'star' ? '#ffd84d' : (i < 2 ? '#ff7fb6' : '#ffffff');
          emitPos.set(0, -6.9, -0.3).applyQuaternion(holder.quaternion).add(holder.position); emit(emitPos, fc, null, 0, i + 1);
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
          moFlat.set(u.cur.x, u.cur.y, u.cur.z).applyQuaternion(att);
          fp2.copy(plane.position).add(moFlat);
          const kc = corkT / corkBlend, ec = kc * kc * (3 - 2 * kc);
          holder.position.lerpVectors(fp2, mp, ec);
        } else {
          holder.position.copy(mp);
          /* 輪に乗り切ってから、編隊での位置も輪のものに移す
             （移すのが早いと、寄せ元の位置が飛んでしまう） */
          u.cur.set(Math.sin(th) * CORK_R, -CORK_LAG * SPEED, Math.cos(th) * CORK_R);
        }
        turnMate(holder, mq, dt); holder.visible = true; u.shown = true;
        if (emitting) { emitPos.set(0, -6.9, -0.3).applyQuaternion(mq).add(holder.position); emit(emitPos, cols[1 % cols.length], null, 0, 1); }
        return;
      }
      /* どの編隊の変更でも、いまの位置から新しい位置へなめらかに移る。
         隊形から外れる機体は後ろの遠く（ENTRY）へ離れていき、届いたら消える */
      fwant.set(target ? target[0] * formScale : e[0], target ? target[1] * formScale : e[1], target ? target[2] * formScale : e[2]);
      if ((spreadOn && target) || snapForm) {                    // 散開の最中と、進入で位置を移した直後: 行き先をそのまま位置にする
        u.want.copy(fwant); u.cur.copy(fwant); u.from = null; u.k = 1;
      } else {
      if (!u.from || u.want.distanceTo(fwant) > 6) { u.want.copy(fwant); startJoin(u); }   // 行き先が変わったら道を引き直す
      else u.want.copy(fwant);
      u.k = Math.min(1, (u.k || 0) + dt / (u.dur || JOIN_TIME));
      const ek = u.k * u.k * (3 - 2 * u.k);                    // ゆっくり出て ゆっくり入る
      u.cur.lerpVectors(u.from, u.want, ek).addScaledVector(u.bow, Math.sin(Math.PI * u.k));
      }
      const settled = u.k > 0.97;
      if (settled && u.tkJoin) u.tkJoin = false;   // 離陸からの寄せが済んだ（次からはふつうに膨らませる）
      /* 離れていく機体は、十分に離れて小さくなってから消す */
      /* 席のない機は、後ろの遠く（ENTRY）へ離れたところで、見えていなければ消す。見えていれば、その向きのまま飛び去らせ、
         視界から出てから消す（departStart）。以前はここで消していたので、500〜1100 m 先の機が視界の中で消えていた
         （利用者の指摘 2026-09-24。実測: 旋回・コークスクリュー・レター・エイトなどの始め）。移す瞬間（snapForm）は画面が白くなるので、そのまま消す */
      if (!target && (settled || u.cur.length() > 520)) {
        if (u.shown && holder.visible && !snapForm && inCamView(holder.position)) { departStart(holder, u, false); return; }
        holder.visible = false; u.shown = false; return;
      }
      holder.visible = true;
      /* 時間差をつけない（1 番機の「いまの」位置と向きから置く）。
         遅らせると、旋回や横転のたびに後続機が道すじの内側・外側へずれて、列が曲がって見える。
         実際の編隊飛行は全機が同時に同じ動きをするので、前後のずれも機体の向きで持たせる */
      const st2 = { p: plane.position, q: att };
      mq.copy(st2.q); mp.copy(st2.p);
      /* 離れている機体は、先頭機の傾きに巻き込まない。巻き込むと、横転のたびに
         「腕の長さ × 回る速さ」で振り回され、あり得ない速さで飛んでしまう。
         近いうちは編隊どおり、離れるほど「機首の向きだけ・翼は水平」の置き方に混ぜる。
         角度ではなく位置そのものを混ぜるので、背面のときも飛びはしない */
      const far = clamp((u.cur.length() - 70) / 130, 0, 1);
      mo.set(u.cur.x, u.cur.y, u.cur.z).applyQuaternion(mq);   // 前後のずれも機体の向きで持つ
      if (far > 0.001) {
        fwd2.set(0, 1, 0).applyQuaternion(st2.q);
        /* 真上・真下を向いているときは方位が決まらない（atan2 が暴れる）ので、直前の方位を使う。
           これをしないと、宙返りの頂点で 180° 向きが飛び、その機体に乗っていると画面が一瞬で回る */
        if (Math.abs(fwd2.z) < 0.95) flatYaw = -Math.atan2(fwd2.x, fwd2.y);
        qFlat.setFromAxisAngle(AZ, flatYaw)
             .multiply(qa.setFromAxisAngle(AX, Math.asin(clamp(fwd2.z, -1, 1))));
        moFlat.set(u.cur.x, u.cur.y, u.cur.z).applyQuaternion(qFlat);
        mo.lerp(moFlat, far);
        /* 遠くの機体は水平に飛んでいるように見せる。切り替えると姿勢が飛ぶので、少しずつ寄せる
           （切り替えだと、その機体に乗っているときに画面が一瞬で回ってしまう） */
        const kf = far * far * (3 - 2 * far);
        if (kf > 0.001) mq.slerp(qFlat, kf);
      }
      /* さらに遠い機は、1 番機の向きから切り離して世界の座標で持つ（v04.40）。
         向きで持つと、腕の長さぶん振り回される（実測: 2.8 km 先の機が、課目の変わり目に 1 コマ 177 m 動いた）。
         FARW_NEAR から効かせ始め、FARW_FAR で完全に切り離す。切り替えではなく混ぜるので、
         寄ってくるあいだに自然と隊形の持ち方へ戻る */
      const farW = clamp((u.cur.length() - FARW_NEAR) / (FARW_FAR - FARW_NEAR), 0, 1);
      if (farW > 0.001) {
        if (!u.qw) u.qw = new THREE.Quaternion().copy(mq);
        moW.set(u.cur.x, u.cur.y, u.cur.z).applyQuaternion(u.qw);
        mo.lerp(moW, farW);
        /* 完全に切り離す手前では、1 番機の向きへ少しずつ寄せ直す（戻るときに位置が飛ばない） */
        if (farW < 1) u.qw.slerp(mq, (1 - farW) * Math.min(1, dt * 3));
      } else if (u.qw) u.qw = null;
      basePos.copy(mp);                  // 1 番機の位置（ここからのずれで置く）
      mp.add(mo);
      if (mp.z < 3) mp.z = 3;            // 地面より下へは置かない（低いところで機首を上げても、後ろの機体がめり込まない）
      if (retT >= 0 && u.ret) {          // 図の終わりの位置から、隊形の位置へ なめらかに戻す
        const k2 = retT / retDur, e2 = k2 * k2 * (3 - 2 * k2);
        /* 混ぜ元は「そのまま飛び続けた位置」。上下の速さは 3 秒で抜き、低くなりすぎないようにする */
        const tz = 3 * (1 - Math.exp(-retT / 3));
        retFrom.set(u.ret.p.x + u.ret.v.x * retT, u.ret.p.y + u.ret.v.y * retT,
                    Math.max(80, u.ret.p.z + u.ret.v.z * tz));
        crabP.copy(holder.position);
        holder.position.lerpVectors(retFrom, mp, e2);
        /* 戻るあいだも飛べる速さに収める（下のふつうの置き方と同じ上限）。混ぜ元はまっすぐ飛び続け、混ぜ先は 1 番機について動くので、
           次の課目の進入で 1 番機が離れていくと 2 点が開き、200 m/s で動いていた（実測: スタークロスのあとのキューピッドの進入） */
        if (dt > 0.0005 && u.shown) {
          flyV.copy(holder.position).sub(crabP);
          const d3 = flyV.length(), lim3 = SPEED * Math.max(0.3, spdK) * MATE_SPD_MAX * dt;
          if (d3 > lim3) holder.position.copy(crabP).addScaledVector(flyV, lim3 / d3);
        }
        turnMate(holder, qa.copy(u.ret.q).slerp(mq, e2), dt);
      } else if (u.shown) {
        crabP.copy(holder.position);     // 動かす前の位置（実際に動いた向きを測るため）
        /* なますのは「世界の中での位置」ではなく「1 番機から見たずれ」。
           位置そのものをなますと、編隊ごと 60 m/s で進むぶんまで毎コマ引きずられ、
           コマの長さのばらつきがそのまま速さのばらつきになる（その機体に乗るとガタつく）。
           ずれをなませば、進むぶんは遅らせた 1 番機の位置がそのまま持つのでなめらか。
           離れているほど強くなます（先頭機の向きの変化が、離れた機体では大きな動きに化けるため） */
        offNow.copy(holder.position).sub(basePos);
        offNow.lerp(mo, 1 - Math.exp(-dt / (0.06 + far * 0.8)));
        holder.position.copy(basePos).add(offNow);
        /* 飛べる動きに収める（利用者の指示 第 3 便 2・3）。席へ移る動きが実機の速さを超えたら、
           そのコマの動きを上限で切る。席から遅れるぶんは次のコマで詰める（実際の編隊もそうする） */
        if (dt > 0.0005) {
          flyV.copy(holder.position).sub(crabP);
          const d2 = flyV.length(), lim2 = SPEED * Math.max(0.3, spdK) * MATE_SPD_MAX * dt;
          if (d2 > lim2 && d2 > 1e-6) { flyV.multiplyScalar(lim2 / d2); holder.position.copy(crabP).add(flyV); }
        }
        if (holder.position.z < 3) holder.position.z = 3;   // なましても地面より下へは置かない
        aimNose(holder, u, mq, dt, far, crabP);
        turnMate(holder, mq, dt);
      } else { holder.position.copy(mp); holder.quaternion.copy(mq); }
      u.shown = true;
      /* 出すかどうかは位置で決めてある（真後ろに他機がいなければ出す）。隊形を移している最中も切らない */
      if (target && on[i + 1] && emitting) { emitPos.set(0, -6.9, -0.3).applyQuaternion(mq).add(holder.position); emit(emitPos, cols[(i + 1) % cols.length], null, 0, i + 1); }
    });
    snapForm = false;                          // 全機を置き直したので印を下ろす
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
    /* 操縦桿を入力に合わせて傾ける。自動操縦（展示飛行・技）のときは自動操縦の舵（smIn）で動かし、機内から見て何の操作をしているかが分かる
       （利用者の指示 2026-09-16「演技の難しさを伝えるため」。ペダルは v05.0x から同じ）。画面の操縦桿（2D）は自動操縦では視点を動かす役目なので変えない */
    const sk = dt ? 1 - Math.exp(-dt / 0.09) : 1, src = auto ? smIn : input;
    stickAim.x += (src.x - stickAim.x) * sk;
    stickAim.y += (src.y - stickAim.y) * sk;
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
      /* 番号で指した機体があれば、それだけを見る（着陸の締め: 最後に降りる機を追う） */
      const aimObj = aimN === 1 ? plane : (aimN > 1 && mates[aimN - 2] && mates[aimN - 2].userData.shown ? mates[aimN - 2] : null);
      if (aimObj) focus.copy(aimObj.position);
      else if (figAim) focus.copy(figAim);
      else if (aimLeader) focus.copy(plane.position);   // 軸を進む 1 番機を見る（コークスクリュー。平均だと回る機に引かれて揺れる）
      else {
        /* 離陸のあいだ（tkOn か滑走中）は第一飛行群だけを見る: 滑走している機・浮いた機。駐機・順番待ち・誘導路の機は数えない */
        const taking = tkOn || gmode === 'takeoff';
        focus.copy(plane.position); let fn = 1;
        /* 飛び去っている機と、隊形に席のない機（後ろへ離れていく機）は数えない（視線が引きずられて演技から外れる） */
        const fo = (FORMATIONS[formation] || { offs: [] }).offs;
        mates.forEach((mt, i) => { const u = mt.userData; if (!mt.visible || u.dep || (!fo[i] && !pathLag && !fig && !bloomS)) return; if (taking && (u.parked || u.gp || (u.ground && !u.tk))) return; focus.add(mt.position); fn++; });
        focus.multiplyScalar(1 / fn);
      }
      /* 見る先が飛んだら、その飛びを控えて足し戻す（上の AIM_JUMP の説明） */
      if (aimHas && focus.distanceTo(aimPrev) > AIM_JUMP) aimOff.add(aimTmp.copy(aimPrev).sub(focus));
      aimPrev.copy(focus); aimHas = true;
      if (aimOff.lengthSq() > 0.01) {
        focus.add(aimOff);
        aimOff.multiplyScalar(Math.max(0, 1 - (dt || 0.016) / AIM_EASE));
      } else aimOff.set(0, 0, 0);
      tmp.copy(focus).sub(gEye);
      const wy = Math.atan2(tmp.x, tmp.y), wp = Math.asin(clamp(tmp.z / Math.max(1, tmp.length()), -1, 1));
      const ddt = dt || 0.016;
      let dyaw = (wy - gYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      let dpit = wp - gPitch;
      /* 振り向き: 見る先が大きく変わったとき（移したあと・機体の切り替え）は、急に飛ばず、
         そのたびの角度に合わせた速さで均一に（SWEEP_T 秒で）向け、着いてからふつうの追従に戻す */
      if (sweep === null && (Math.abs(dyaw) > 20 * D || slowAim > 0)) { sweep = { vy: dyaw / SWEEP_T, vp: dpit / SWEEP_T, t: SWEEP_T }; slowAim = 0; }
      if (sweep) {
        const stp = Math.min(ddt, sweep.t); gYaw += sweep.vy * stp; gPitch += sweep.vp * stp; sweep.t -= stp;
        if (sweep.t <= 0) sweep = null;
      } else {
        const k = 1 - Math.exp(-ddt / 0.45);
        gYaw += dyaw * k;
        gPitch += dpit * k;
      }
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
    /* 乗っている機体の姿勢を画面へ（画面の姿勢指示器・方位計・HUD の用）。2〜6 番機に乗ったとき、画面の計器が 1 番機の姿勢を
       指していた（総点検 2026-09-13 の指摘 #5）。1 番機なら st と同じ値 */
    if (seatObj === plane) { st.sb = st.b; st.sp = st.p; st.sh = st.h; }
    else { const a = attOfQ(seatQ); st.sb = a.b; st.sp = a.p; st.sh = a.h; }
    seatMeshes.forEach(m => { m.visible = !(curView === 'first' && seatObj === plane); });
    mates.forEach((h, i) => { const sm = h.userData.seats; if (sm) sm.forEach(m => { m.visible = !(curView === 'first' && seatObj === h); }); });
    hudOn = false;                           // 一人称（機内）のときだけ、下で true にする
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
      const back = curView === 'front' ? 36 : exam ? -14 : -32, up = curView === 'front' ? 5 : exam ? 3.5 : 10;   // 試験の世界（動きで見る）は出題画像と同じ小さな箱なので近くから（22 m でも遠く、動きが分かりにくかった。利用者の指摘 2026-09-13）
      tmp.set(0, back, up);
      /* 試験の世界（動きで見る）は世界の軸で南から見る。機体といっしょに回らないので、傾き・機首の上下・向きがそのまま見える */
      if (exam) tmp.applyAxisAngle(AX, look.p).applyAxisAngle(AZ, -look.y).add(seatObj.position);
      else tmp.applyAxisAngle(AX, look.p).applyAxisAngle(AZ, -look.y).applyQuaternion(seatQ).add(seatObj.position);
      if (camPos.lengthSq() === 0) camPos.copy(tmp); else camPos.lerp(tmp, 0.18);
      cam.position.copy(camPos); cam.up.copy(exam ? bup2.set(0, 0, 1) : bup2.set(0, 0, 1).applyQuaternion(seatQ)); cam.lookAt(seatObj.position);
    } else {
      cam.position.copy(tmp.copy(EYE).add(eyeOff).applyMatrix4(seatR).add(seatObj.position));
      /* HUD のガラス板を、乗っている機体の操縦席に置く（機内の見せ方のときだけ。「計器だけ」は機体を消すので出さない） */
      hudOn = inCockpit;
      if (hudOn) {
        hudMesh.position.copy(hudTmp.copy(HUD_POS).add(eyeOff).applyMatrix4(seatR).add(seatObj.position));
        hudMesh.quaternion.copy(seatQ).multiply(HUD_Q);
        hudGlass.position.copy(hudMesh.position); hudGlass.quaternion.copy(hudMesh.quaternion);
        hudFrame.position.copy(hudMesh.position); hudFrame.quaternion.copy(hudMesh.quaternion);
        const a = seatObj === plane ? st : attOfQ(seatQ);
        drawHud(a.b, a.p, a.h, seatObj.position.z, (gmode === 'fly' ? SPEED * Math.max(0.2, spdK) : gv) * 1.944);
      }
      /* 一人称の向き: 機体の向きに、見回しを**機体の軸まわり**で掛ける（利用者の指示 2026-09-13
         「コックピット視点では、真横の視線移動は機体水平」「バンク中の視線移動が不自然」）。
         左右は機体の上下軸（首を振る）、上下は機体の左右軸。傾いていれば視線は傾いた機体に沿って横へ動く（実機で首を振るのと同じ）。
         v04.43 で世界の軸まわりにしていたが、バンク中に横へなぞると視線が世界の水平に沿って動き、機体との関係がねじれて見えた。
         見下ろし角 TILT_A（計器盤が視界に入る）は上下の見回しに含める。仰角は ±85° で止める */
      cam.quaternion.copy(seatQ);
      if (look.y) cam.quaternion.multiply(lookQ.setFromAxisAngle(AZ, look.y));      // 左が正（地上視点・以前の符号とそろえる）
      cam.quaternion.multiply(QX90);
      cam.quaternion.multiply(qc.setFromAxisAngle(AX, clamp((exam ? 0 : -TILT_A) + look.p, -85 * D, 85 * D)));   // 試験の世界は見下ろさない（絵の中心が機首の向き）
    }
    /* 視線が向いている方角を毎コマ控える。見回し（首振り）まで含めたカメラの向き。
       3 つの視点の組み立てが終わったこの位置で読む。地上視点では cam を lookAt で組んでいるので st.gh と一致する */
    cfw.set(0, 0, -1).applyQuaternion(cam.quaternion);
    st.vh = ((Math.atan2(cfw.x, cfw.y) / D) % 360 + 360) % 360;
    /* 方位計がどちらを出すか（利用者の指示 2026-09-12）:
       ・一人称（機内）は**いつでも機体の方位**。機体に載っている計器なので、指で視線を動かしても動かない
       ・地上視点は、いつでも視線の方角
       ・三人称は、ふだんは機体の方位（＝計器の表記）。**視線を動かしているあいだだけ**視線の方角にし、
         中央の印も地上視点と同じ「見ている人」にする。視線を中央へ戻せば計器の表記に戻る
       v04.95 で「いつでも視線の方角」にしたのは行き過ぎで、一人称でも見回しに追従してしまっていた */
    st.vhUse = curView === 'ground' ||
               ((curView === 'third' || curView === 'front') && Math.abs(look.y) > 0.01);
    sky.position.copy(cam.position);
  }

  /* ===== 音 =====
     戦闘機の爆音ではなく、速めの航空機が通り過ぎるときのような音にする。
     雑音を帯域で削って「シャーッ」という風切り音を作り、機体ごとに
     距離で大きさを、近づく・遠ざかるで高さを変える（ドップラー）。
     ブラウザは操作なしに音を出せないので、入り切りのボタンが押されたときに作る */
  const AUD_FAR = 3000;                    // ここより遠いと聞こえない（m）。v04.20: 1500 → 3000（進入中の追従機が聞こえるように）
  const AUD_HALF = 260;                    // この距離で半分の大きさ（m）。1/(1 + d/AUD_HALF) で減らす
  const AUD_SPD = 340;                     // 音の速さ（m/s）
  let actx = null, aMaster = null, aNodes = null, soundOn = true;
  /* タイヤの出し入れの機械音（一人称のときだけ。外から見ている人には届かない音）。
     モーターのうなり（帯域を絞った雑音を 1.4 秒、音程を上げ下げ）と、終わりの「ガコン」（低い短い音） */
  let gearNoise = null, gearGain = null;
  /* タイヤの出し入れの音（一人称のときだけ。飛行音の音量とは別に直接出す）。
     利用者が用意した録音を測って、その形を合成で作る（録音そのものは同梱しない）:
     モーター「ウィーン」（1.38 秒）: 主な音程が 2.5 kHz（0.1 秒）→ 3.4 kHz（0.5 秒）→ 3.9 kHz（1.0 秒）と上がり、
       1.1 秒から急に下がって 1.3 秒で消える。倍音（約 7.3 kHz）と、明るいヒス（重心 9〜10 kHz）を伴う。
       音量は 0.1 秒で立ち上がり、0.8〜1.1 秒でいちばん大きい。
     掛け金「ガチャッ」: 一発の短い当たり（40 ms）。体は 375〜656 Hz、上は 2〜4 kHz まで広がる。117 Hz の小さな叩き。
       モーターの終わりの 0.08 秒手前で鳴らす */
  function gearSound(extend) {
    if (curView !== 'first' || !soundOn || !actx || actx.state !== 'running') return;
    try {
      if (!gearNoise) gearNoise = makeNoise(actx);
      if (!gearGain) { gearGain = actx.createGain(); gearGain.gain.value = 1; gearGain.connect(actx.destination); }
      const t = actx.currentTime, dur = 1.38;
      const env = actx.createGain(); env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.8, t + 0.1); env.gain.linearRampToValueAtTime(0.76, t + 0.5);
      env.gain.linearRampToValueAtTime(1.0, t + 0.85); env.gain.setValueAtTime(1.0, t + 1.1);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 1.32);
      env.connect(gearGain);
      /* 音程の道すじ（出すときはそのまま、しまうときは少し低め） */
      const GEAR_PITCH = 0.85;                     // 測った音程より少し低く（利用者の好み。1 で録音どおり）
      const kf = (extend ? 1 : 0.92) * GEAR_PITCH;
      const pitch = o => { o.setValueAtTime(1800 * kf, t); o.exponentialRampToValueAtTime(2500 * kf, t + 0.1);
        o.linearRampToValueAtTime(3400 * kf, t + 0.5); o.linearRampToValueAtTime(3900 * kf, t + 1.0);
        o.setValueAtTime(3900 * kf, t + 1.1); o.exponentialRampToValueAtTime(2000 * kf, t + 1.28); };
      const saw = actx.createOscillator(); saw.type = 'sawtooth'; pitch(saw.frequency);
      const sg = actx.createGain(); sg.gain.value = 0.22; saw.connect(sg); sg.connect(env);
      const h2 = actx.createOscillator(); h2.type = 'sine';
      { const f = h2.frequency; f.setValueAtTime(3600 * kf, t); f.exponentialRampToValueAtTime(5000 * kf, t + 0.1);
        f.linearRampToValueAtTime(6800 * kf, t + 0.5); f.linearRampToValueAtTime(7400 * kf, t + 1.0);
        f.setValueAtTime(7400 * kf, t + 1.1); f.exponentialRampToValueAtTime(4000 * kf, t + 1.28); }
      const hg = actx.createGain(); hg.gain.value = 0.1; h2.connect(hg); hg.connect(env);
      const hiss = actx.createBufferSource(); hiss.buffer = gearNoise; hiss.loop = true;
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500 * GEAR_PITCH;
      const ng = actx.createGain(); ng.gain.value = 0.16; hiss.connect(hp); hp.connect(ng); ng.connect(env);
      const res = actx.createBufferSource(); res.buffer = gearNoise; res.loop = true;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5; pitch(bp.frequency);
      const rg = actx.createGain(); rg.gain.value = 0.25; res.connect(bp); bp.connect(rg); rg.connect(env);
      [saw, h2, hiss, res].forEach(n => { n.start(t); n.stop(t + dur + 0.05); });
      /* 掛け金 */
      const tc = t + dur - 0.08;
      const burst = (fc, q, type, len, vol) => {
        const n = actx.createBufferSource(); n.buffer = gearNoise;
        const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = fc; if (q) f.Q.value = q;
        const g = actx.createGain(); g.gain.setValueAtTime(0.0001, tc - 0.002);
        g.gain.exponentialRampToValueAtTime(vol, tc + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, tc + len);
        n.connect(f); f.connect(g); g.connect(gearGain); n.start(tc); n.stop(tc + len + 0.02);
      };
      burst(600, 1.5, 'bandpass', 0.045, 1.0);        // 体（375〜656 Hz のあたり）
      burst(1800, 0, 'highpass', 0.028, 0.5);         // 上へ広がる当たり
      const body = (fr, len, vol) => {
        const o = actx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(fr, tc);
        o.frequency.exponentialRampToValueAtTime(fr * 0.7, tc + len);
        const g = actx.createGain(); g.gain.setValueAtTime(0.0001, tc - 0.002);
        g.gain.exponentialRampToValueAtTime(vol, tc + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, tc + len);
        o.connect(g); g.connect(gearGain); o.start(tc); o.stop(tc + len + 0.02);
      };
      body(375, 0.06, 0.5); body(117, 0.05, 0.3);
      gearSndN++;
    } catch (e) {}
  }
  let airVol = 0.9, musVol = 0.55;         // 飛行音と曲の大きさ（0〜1）。別々に決められる
  const aPrev = [];                        // 前のコマの距離（ドップラーに使う）
  const aLast = [];                        // 前のコマの位置（速さを見て、止まっている機体は鳴らさない）
  function makeNoise(ctx) {
    const len = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let a = 0, b = 0;
    for (let i = 0; i < len; i++) {        // 低いほうを持ち上げた雑音（そのままだと耳につく）
      const w = Math.random() * 2 - 1;
      a = 0.99 * a + 0.06 * w; b = 0.72 * b + 0.28 * w;
      d[i] = Math.max(-1, Math.min(1, a * 2.6 + b * 0.5));
    }
    return buf;
  }
  /* 機ごとの飛行音の一組（雑音 → 帯域 → 低域 → 立体音 → 大きさ）。
     立体音は向きだけに使い、距離による減りは updateAudio の側で決める（rolloffFactor 0）。
     以前は立体音の側でも inverse（60 m 基準）で減らしていて、1 km 先の機は 0.07 倍 × こちらの減りでほぼ無音だった */
  let aNoiseBuf = null;
  function addANode() {
    if (!aNoiseBuf) aNoiseBuf = makeNoise(actx);
    const src = actx.createBufferSource(); src.buffer = aNoiseBuf; src.loop = true;
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.7;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    /* 立体音。耳の形を模した聞こえ方（HRTF）で置くので、イヤホンだと前後左右が分かる。
       使えない端末では、これまでどおり左右だけの振り分けにする */
    let pan = null, pan3 = null;
    if (actx.createPanner) {
      pan3 = actx.createPanner();
      pan3.panningModel = 'HRTF'; pan3.distanceModel = 'linear';
      pan3.refDistance = 1; pan3.maxDistance = AUD_FAR * 10; pan3.rolloffFactor = 0;
    } else if (actx.createStereoPanner) pan = actx.createStereoPanner();
    const g = actx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(lp);
    if (pan3) { lp.connect(pan3); pan3.connect(g); }
    else if (pan) { lp.connect(pan); pan.connect(g); }
    else lp.connect(g);
    g.connect(aMaster);
    src.start(0);
    aNodes.push({ src, bp, lp, pan, pan3, g });
    aPrev[aNodes.length - 1] = null;
  }
  /* 機の数だけ音の組をそろえる。音の仕組みは最初に画面へ触れたときに作るが、そのとき 2〜6 番機のモデルがまだ
     読めていないことがある（以前はその場合 1 番機の音しか作られず、ほかの機はずっと無音だった） */
  function ensureANodes() {
    if (!actx || !aNodes) return;
    while (aNodes.length < mates.length + 1) addANode();
  }
  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (actx || !AC) return;
    actx = new AC();
    aMaster = actx.createGain(); aMaster.gain.value = airVol; aMaster.connect(actx.destination);
    aNodes = [];
    ensureANodes();
  }
  /* 止めているあいだは音を出さない（機体の音も曲も）。動かしたら元に戻す */
  /* 別のアプリへ移って戻ると、音の仕組みは止まったまま（suspended）か、iPhone では「割り込まれた」
     （interrupted）になる。どちらも「動いていない」として起こし直す。起こせるのは操作の流れの中だけなので、
     触れたときにも呼ぶ（wakeAudio） */
  function audioHold() {
    if (!actx) return;
    try { if (paused || document.hidden) actx.suspend(); else if (actx.state !== 'running') actx.resume(); } catch (e) {}
  }
  function wakeAudio() { if (actx && !paused && !document.hidden && actx.state !== 'running') { try { actx.resume(); } catch (e) {} } }
  /* ほかの画面を見ているあいだも鳴らさない（戻ってきたら元に戻す） */
  document.addEventListener('visibilitychange', audioHold);
  const aPos = new THREE.Vector3(), aRel = new THREE.Vector3(), aRight = new THREE.Vector3();
  const aFwd = new THREE.Vector3(), aUp = new THREE.Vector3();
  function updateAudio(dt) {
    if (!soundOn || !actx || !aNodes || !dt) return;
    ensureANodes();
    aRight.set(1, 0, 0).applyQuaternion(cam.quaternion);       // 耳の右向き
    /* 聞く人の位置と向きを、いまの視点に合わせる（立体音のため） */
    const li = actx.listener;
    aFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    aUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (li.positionX) {
      const t = actx.currentTime;
      li.positionX.setTargetAtTime(cam.position.x, t, 0.02);
      li.positionY.setTargetAtTime(cam.position.y, t, 0.02);
      li.positionZ.setTargetAtTime(cam.position.z, t, 0.02);
      li.forwardX.setTargetAtTime(aFwd.x, t, 0.02); li.forwardY.setTargetAtTime(aFwd.y, t, 0.02);
      li.forwardZ.setTargetAtTime(aFwd.z, t, 0.02);
      li.upX.setTargetAtTime(aUp.x, t, 0.02); li.upY.setTargetAtTime(aUp.y, t, 0.02);
      li.upZ.setTargetAtTime(aUp.z, t, 0.02);
    } else if (li.setPosition) {
      li.setPosition(cam.position.x, cam.position.y, cam.position.z);
      li.setOrientation(aFwd.x, aFwd.y, aFwd.z, aUp.x, aUp.y, aUp.z);
    }
    for (let k = 0; k < aNodes.length; k++) {
      const n = aNodes[k];
      const obj = k === 0 ? plane : mates[k - 1];
      const shown = k === 0 ? plane.visible || curView === 'first' : (mates[k - 1] && mates[k - 1].userData.shown);
      if (!obj || !shown) { n.g.gain.value += (0 - n.g.gain.value) * 0.2; aPrev[k] = null; continue; }
      aPos.copy(obj.position);
      const d = aPos.distanceTo(cam.position);
      /* 大きさ: 近いほど大きい。爆音にならないよう上限を低くする */
      /* 機ごとに、その機までの距離で決める。1 番機が止まっても、飛んでいる機の音は残る */
      const near = d >= AUD_FAR ? 0 : 1 / (1 + d / AUD_HALF) * Math.min(1, (AUD_FAR - d) / 500);
      /* 止まっている機体は音を出さない（滑走路で待っているあいだは静か）。
         1 番機は地上の速さ、僚機は 1 コマの動きから速さを見る */
      let spd = SPEED;
      if (k === 0) spd = gmode === 'fly' ? SPEED * spdK : gv;
      else if (aLast[k]) spd = aLast[k].distanceTo(obj.position) / dt;
      if (!aLast[k]) aLast[k] = obj.position.clone(); else aLast[k].copy(obj.position);
      const run = clamp(spd / 12, 0, 1);                       // 12 m/s より遅いと、だんだん静かに
      const want = Math.min(0.32, near * 0.42) * run;
      n.g.gain.value += (want - n.g.gain.value) * Math.min(1, dt * 6);
      /* ドップラー: 近づいているあいだは高く、遠ざかると低い */
      const prev = aPrev[k]; aPrev[k] = d;
      let rate = 1;
      if (prev != null) {
        const vr = (prev - d) / dt;                            // 近づく速さ（m/s）
        rate = clamp(1 + vr / AUD_SPD, 0.72, 1.45);
      }
      n.src.playbackRate.value += (rate - n.src.playbackRate.value) * Math.min(1, dt * 8);
      n.bp.frequency.value = 380 * rate + Math.min(220, 26000 / Math.max(60, d));
      n.lp.frequency.value = 900 + 2600 * near;                // 遠いと高い音が届かない
      if (n.pan3) {                                            // 立体音: 機体のいる場所に音を置く
        const t = actx.currentTime;
        if (n.pan3.positionX) {
          n.pan3.positionX.setTargetAtTime(aPos.x, t, 0.02);
          n.pan3.positionY.setTargetAtTime(aPos.y, t, 0.02);
          n.pan3.positionZ.setTargetAtTime(aPos.z, t, 0.02);
        } else if (n.pan3.setPosition) n.pan3.setPosition(aPos.x, aPos.y, aPos.z);
      } else if (n.pan) {                                      // 左右だけの振り分け（立体音が使えない端末）
        aRel.copy(aPos).sub(cam.position);
        const side = aRel.dot(aRight) / Math.max(1, aRel.length());
        n.pan.pan.value += (clamp(side, -1, 1) * 0.85 - n.pan.pan.value) * Math.min(1, dt * 6);
      }
    }
  }

  /* ===== 曲（利用者が選んだ手持ちの音楽ファイル）=====
     アプリは音源を持たない。利用者が自分の端末の曲を選び、その場で鳴らすだけ。
     曲の頭を調べて「音が大きく立ち上がるところ」（主旋律が入るところ）を見つけ、
     そこでちょうどタイヤが離れるように滑走を始める */
  /* 滑走を始めてから「タイヤが離れる」までの時間（秒）。地上の加速は 6 m/s^2 で、SPEED の 9 割で浮く。
     主旋律が入るその瞬間にタイヤが離れるよう、ここから逆算して滑走の開始をためる
     （機首を上げ始めるのは、その 1.5 秒ほど前） */
  const MUS_ROLL = SPEED * 0.9 / 6;
  /* 曲の頭（浮くタイミング、秒）。設定で決める。既定は 13.0 秒 */
  let musBuf = null, musSrc = null, musGainNode = null, musLead = 13.5, musWait = -1, musDelay = 0;
  /* 曲のリスト。1 曲なら「イントロは一度、あとは主旋律から折り返しまでを繰り返す」。
     2 曲以上なら順に流し、最後まで行ったら最初へ戻る（それぞれ頭から終わりまで）。
     decode した音は大きい（4 分で 40 MB ほど）ので、いま鳴らす曲と次の曲だけを持つ */
  let musList = [];                        // [{ name, buf: ArrayBuffer }]
  let musIdx = 0;                          // いま鳴らしている曲の番号
  const musDec = new Map();                // 番号 → decode した音
  let musGen = 0;                          // リストを入れ替えた回数（古い decode を捨てるため）
  const anthemIdx = () => musList.findIndex(x => /anthem/i.test(x.name || ''));   // 曲名に anthem を含む曲（細かい時間の決まりはこの曲があるときだけ）
  let loopRestart = false;                 // 固定にしたあと、着陸してから離陸で始め直す
  let musCut = -1;                         // 曲を切るまでの残り（秒）。主旋律が入る直前で切る
  let landRun = false;                     // 着陸して滑走路へ戻っているあいだ
  let standWait = false;                   // 滑走路で「加速」を待っている（押されたら演目を始め直す）
  /* 音の大きさが立ち上がるところを探す。0.05 秒ごとの音量を出し、
     はじめの静かなところの何倍かを超えた最初の点を「主旋律の入り」とする */
  function findLead(buf) {
    const ch = buf.getChannelData(0), sr = buf.sampleRate, step = Math.floor(sr * 0.05);
    const n = Math.min(Math.floor(buf.length / step), Math.floor(90 / 0.05));   // 先頭 90 秒まで見る
    const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let j = 0; j < step; j += 4) { const v = ch[i * step + j] || 0; a += v * v; }
      rms[i] = Math.sqrt(a / (step / 4));
    }
    let quiet = 0, cnt = 0;
    for (let i = 0; i < Math.min(n, 80); i++) { quiet += rms[i]; cnt++; }
    quiet = quiet / Math.max(1, cnt);
    const thr = Math.max(quiet * 2.6, 0.06);
    for (let i = 6; i < n - 4; i++) {
      if (rms[i] > thr && rms[i + 1] > thr && rms[i + 2] > thr) return i * 0.05;
    }
    return 0;
  }
  const MUS_FADE = 0.6;                    // 曲を絞る・戻すのにかける時間（秒）
  const MUS_LOOP_END = MUS_LOOP_END_S;     // 繰り返しの折り返し（3 分 58 秒）。これより短い曲は終わりで折り返す
  function stopMusic(fade) {
    const src = musSrc, g = musGainNode;
    musSrc = null; musGainNode = null;
    if (!src) return;
    src.onended = null;                      // 手で止めたときは次の曲へ進まない
    if (fade && actx && g) {                 // ぶつ切りにせず、短く絞ってから止める
      const t = actx.currentTime;
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
      } catch (e) {}
      try { src.stop(t + fade + 0.05); } catch (e) {}
      setTimeout(() => { try { src.disconnect(); g.disconnect(); } catch (e) {} }, (fade + 0.3) * 1000);
      return;
    }
    try { src.stop(); } catch (e) {}
    try { src.disconnect(); g && g.disconnect(); } catch (e) {}
  }
  async function decodeAt(i) {
    if (!actx || !musList[i]) return null;
    if (musDec.has(i)) return musDec.get(i);
    const gen = musGen;
    const b = await actx.decodeAudioData(musList[i].buf.slice(0));
    if (gen !== musGen) return null;         // そのあいだにリストが変わった
    musDec.set(i, b);
    const ai = anthemIdx();
    for (const k of [...musDec.keys()]) if (k !== i && k !== (i + 1) % musList.length && k !== 0 && k !== ai) musDec.delete(k);
    return b;
  }
  /* 曲を頭から流す。anthem がリストにあればどの順番にあっても anthem から（時間の決まりは anthem に合わせてある）。
     なければリストの最初の曲。前の曲が鳴っていたら短く絞ってから重ねる */
  function playMusic() { const ai = anthemIdx(); musIdx = ai >= 0 ? ai : 0; playTrack(musIdx); }
  function playTrack(i) {
    if (!actx) return;
    const buf = musDec.get(i) || (i === 0 ? musBuf : null);
    if (!buf) { decodeAt(i).then(b => { if (b && musIdx === i && !musSrc) playTrack(i); }); return; }
    if (actx.state !== 'running') actx.resume();
    stopMusic(MUS_FADE);
    const src = actx.createBufferSource(); src.buffer = buf;
    if (musList.length <= 1) {
      /* 止めるまで繰り返す。anthem なら頭のイントロは一度だけで、
         そのあとは「主旋律が入るところ（musLead）」から 3:58 までを繰り返す（そこから 0:13 へ戻る、という決まり）。
         ほかの曲は、その曲を丸ごと繰り返す */
      src.loop = true;
      if (i === anthemIdx()) {
        src.loopStart = Math.max(0, musLead);
        src.loopEnd = Math.min(buf.duration, MUS_LOOP_END);
        if (src.loopEnd <= src.loopStart + 5) { src.loopStart = 0; src.loopEnd = buf.duration; }
      } else { src.loopStart = 0; src.loopEnd = buf.duration; }
    } else {
      /* リスト再生: 終わったら次の曲へ。最後まで行ったら最初へ戻る。次の曲は先に decode しておく */
      const next = (i + 1) % musList.length;
      decodeAt(next).catch(() => {});
      src.onended = () => { if (musSrc === src) { musSrc = null; musIdx = next; playTrack(next); } };
    }
    const g = actx.createGain();
    const t = actx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, musVol), t + MUS_FADE);
    src.connect(g); g.connect(actx.destination);
    src.start(0);
    musSrc = src; musGainNode = g;
  }

  let running = true, raf = 0, last = performance.now();
  /* 1 フレームの中で何かに失敗しても、次のフレームを必ず要求する（要求をやめると画面が固まって見える）。
     続けて失敗するときは自動操縦を切って水平に戻す */
  let timeScale = 1;                          // 時間の進み（縦画面の検証画面はスロー再生 0.3。利用者の指示 2026-09-13「極めてゆっくり」）
  function frame(now) {
    if (!running) return;
    let dt = Math.min(0.05, (now - last) / 1000) * timeScale; last = now;
    if (paused) dt = 0;                       // 一時停止: 時間を進めない（見回しと描き直しは続ける）
    try {
      clock += dt; smokeT += dt;
      step(dt); place(dt); if (dt) recordHistory(dt); placeMates(dt); refreshMateGear(); aimCamera(dt);
      renderer.render(world, cam);
      drawStick();                             // 操縦席の内装（計器盤・操縦桿・コンソール）を本編の上に
      /* HUD のガラス板は、手前 0.05 m のカメラで内装の上に重ねて描く（一人称のカメラは手前 1.1 m で切るため） */
      st.hud3d = hudOn;
      if (hudOn) {
        hudCam.copy(cam); hudCam.near = 0.05; hudCam.far = 8; hudCam.updateProjectionMatrix();
        renderer.autoClear = false; renderer.clearDepth(); renderer.render(hudScene, hudCam); renderer.autoClear = true;
      }
      tellPanel();
      updateAudio(dt);
      st.err = 0;
    } catch (e) {
      st.err = (st.err || 0) + 1;
      if (st.err <= 2) console.error('sim frame error', e);
      if (st.err === 3) { endCork(); endFigure(); if (treeMode) setTreeMode(false); auto = false; oneShot = false; formation = userForm; formScale = 1; levelAttitude(); manPhase = 'do'; st.cue = ''; markOn = false; }
    }
    st.ctl = auto ? smIn : null;   /* 自動操縦の舵（画面の操縦桿と方向舵を表示専用で動かす。利用者の指示 2026-09-16） */
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
    if (thrLever) thrLever.position.y = 2.75 + 0.20 * throttle;   // レバーは画面のスロットルに連動（前へ押すほど速い）
    /* ペダルは方向舵に連動（利用者の指示 2026-09-13）。右を踏むと右のペダルが前へ出て左が戻る。急に動かすと機械らしくないので 0.09 秒でならす */
    rudAim.r += ((auto ? smIn.r : input.r) - rudAim.r) * (1 - Math.exp(-0.016 / 0.09));
    if (pedals[1]) { pedals[1].position.y = 3.36 + 0.06 * rudAim.r; pedals[0].position.y = 3.36 - 0.06 * rudAim.r; }
    /* 計器盤の姿勢指示器と方位指示器は、乗っている機体の姿勢で描く */
    { const so = cockpit.parent || plane, mine = so === plane, a = mine ? st : attOfQ(so.quaternion);
      const v = gmode === 'fly' ? SPEED * Math.max(0.2, spdK) : gv, fz = mine ? (velOk ? vel.z / v : fwd.z) : hudV1.z;   // 地上では滑走の速さ。手動は速度ベクトルの上下（機首ではない）。hudV1 は attOfQ が置いた機首の向き
      drawDials(a, so.position.z, v * 1.944, fz * v, gearOn); }
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
    baseFov = v === 'ground' ? 42 : out ? 55 : 68; cam.near = exam ? (out ? 2 : 5) : out ? 0.5 : 1.1; applyFov(); camPos.set(0, 0, 0);
    /* 煙の太さ: 一人称はすぐ近くを通るので控えめに、それ以外（特に地上）は遠くでも線が消えないように。
       距離で太らせるのはやめたので（v04.76）、遠くの見え方はこの下限が受け持つ */
    const near1 = v === 'first';
    smokeMat.uniforms.uMinPx.value = near1 ? 4 : 10;
    smokeMat.uniforms.uMaxPx.value = near1 ? 60 : 90;
    smokeMat.uniforms.uFarA.value = near1 ? 0.6 : 1.2;
    /* 地上に入ったときは、演目の正面（北）を向く。目で追う設定なら、そのあと機体を追いかける */
    if (v === 'ground') { gYaw = 0; gPitch = 0.06; look.y = 0; look.p = 0; if (!auto && !follow) gAim(); }
  }
  setView(view);

  return {
    input, state: st, setView,
    /* 検証用: 画面の点（0〜1、左上が原点）の下にある部品の名前（本編と内装の両方） */
    pick(nx, ny) {
      const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx * 2 - 1, 1 - ny * 2), cam);
      const hits = rc.intersectObjects(world.children, true).filter(h => h.object.visible).slice(0, 4)
        .map(h => ({ name: h.object.name || h.object.type, dist: +h.distance.toFixed(2), parent: h.object.parent && (h.object.parent.name || h.object.parent.type) }));
      const rc2 = new THREE.Raycaster(); rc2.setFromCamera(new THREE.Vector2(nx * 2 - 1, 1 - ny * 2), oCam);
      rc2.near = 0.03;
      const hits2 = rc2.intersectObjects(overlay.children, true).slice(0, 3).map(h => ({ name: h.object.name || h.object.type, dist: +h.distance.toFixed(2), geo: h.object.geometry && h.object.geometry.type }));
      return { world: hits, overlay: hits2 };
    },
    /* 検証用: カメラの向き（世界）と、乗っている機体の軸との内積 */
    camInfo() { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      return { fwd: [f.x, f.y, f.z].map(v => +v.toFixed(3)), up: [u.x, u.y, u.z].map(v => +v.toFixed(3)),
        fDotRight: +f.dot(bright).toFixed(3), fDotUp: +f.dot(bup).toFixed(3), fDotFwd: +f.dot(fwd).toFixed(3), uDotUp: +u.dot(bup).toFixed(3) }; },
    /* スロットル 0〜1（手動操縦の速さ）。3D のレバーも連動する */
    setThrottle(t) { throttle = clamp(+t || 0, 0, 1); return throttle; }, throttleState() { return throttle; },
    lockSpeed(on) { speedLock = !!on; return speedLock; },
    /* 重力の切り替え（動きで見る = on。操作モード = off） */
    setGravity(on) { gravityOn = !!on; return gravityOn; },
    /* 手動操縦にも重力（操作モード）。自動操縦は変えない */
    setManualGravity(on) { manualGravity = !!on; return manualGravity; },
    /* 縦画面: 地面に触れたら墜落として開始位置へ戻す。fn は戻したときの知らせ */
    setCrashReset(on) { crashReset = !!on; return crashReset; },
    setOnCrash(fn) { onCrash = typeof fn === 'function' ? fn : null; },
    /* 外から与えた機体の様子を置く（「動きで見る」: flight.js で飛ばした姿勢と位置）。姿勢（度）は R = Rz(−yaw)·Rx(pitch)·Ry(bank)（flight.js の matOf と同じ順）、
       位置は START からのずれ dx・dy・dz（m）。置いているあいだ、この画面の物理は回さない。null で外す */
    /* 舵で加わっている回転の向き（動きで見るの三人称）。{ roll, pitch, yaw } それぞれ +1／−1／0。省略で消す */
    setForces(f) {
      f = f || {}; let any = false;
      for (const k of ['roll', 'pitch', 'yaw']) {
        const v = +f[k] || 0;
        for (const key of Object.keys(arrowCache[k])) { arrowCache[k][key].pos.visible = arrowCache[k][key].neg.visible = false; }
        if (v) { const ar = arrowFor(k, Math.abs(v) > 1 ? Math.abs(v) : ARC[k].w); ar.pos.visible = v > 0; ar.neg.visible = v < 0; any = true; }
      }
      forceArrows.visible = any && curView !== 'first';
    },
    setPose(a) {
      if (!a) { posed = false; return; }
      poseQ.setFromAxisAngle(AZ, -a.yaw * D).multiply(dq.setFromAxisAngle(AX, a.pitch * D)).multiply(dq.setFromAxisAngle(AY, a.bank * D));
      posed = true; att.copy(poseQ); readAttitude(); velOk = false;
      st.x = START.x + (a.dx || 0); st.y = START.y + (a.dy || 0); st.z = (exam ? EXAM_H : START.z) + (a.dz || 0);
      if (exam && trailLen < TRAIL_N) {   // 航跡: 2 m 以上進んだら点を足す
        const i = trailLen * 3, j = i - 3;
        if (!trailLen || Math.hypot(st.x - trailPos[j], st.y - trailPos[j + 1], st.z - trailPos[j + 2]) > 2) {
          trailPos[i] = st.x; trailPos[i + 1] = st.y; trailPos[i + 2] = st.z; trailLen++;
          trailGeo.attributes.position.needsUpdate = true; trailGeo.setDrawRange(0, trailLen); } }
    },
    setTimeScale(k) { timeScale = clamp(+k || 1, 0.05, 1); return timeScale; },
    /* 一人称の見せ方を変える。切ると機内が消えて、外の景色がそのまま見える（縦画面はいつもこちら） */
    setCockpit(on) { inCockpit = !!on; const first = curView === 'first';
      cockpit.visible = first && inCockpit; applyBody(); }, cockpitOn() { return inCockpit; },
    /* 画面のドラッグで視点を動かす（度）。一人称は首、三人称は機体のまわり。
       三人称（後方 third・前方 front）は、機体の手前の面が指についてくる向きに回す（利用者の指摘 2026-09-24
       「三人称で右になぞったら左にスライドしてしまう」）。以前は右へなぞるとカメラが機体の右へ回り込み、
       手前の面（後方なら尾、前方なら機首）が左へ流れていた。前方は上下も逆だった（上へなぞると機首が下へ）。
       ここで符号を返すので、一人称・地上と同じく「右へなぞれば視線が右へ、上へなぞれば上へ」になる（実測は内部設計書 v06.44）。
       setLook（段取りで斜めから見せる角度）の意味は変えない。試験の世界（動きで見る）は呼ぶ側が符号を決めているので返さない */
    addLook(dy, dp) {
      if (!exam && (curView === 'third' || curView === 'front')) { dy = -dy; if (curView === 'front') dp = -dp; }
      look.y = ((look.y + dy * D + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      look.p = clamp(look.p + dp * D, -LOOK_MAX_P, LOOK_MAX_P); },
    resetLook() { if (curView === 'ground') gAim(); else { look.y = 0; look.p = 0; } },
    setLook(yawDeg, pitchDeg) { look.y = (+yawDeg || 0) * D; look.p = (+pitchDeg || 0) * D; },   // 三人称前方を斜めから（並びのあいだ）
    /* いまの見回しの角度（度）。首を振っているあいだ HUD を消すのに使う */
    lookState() { return { y: look.y / D, p: look.p / D }; },
    /* 地上視点で 2 回叩いた場所へ立ち位置を移す。画面の座標は −1〜1（中央が 0）。
       地面・滑走路・オブジェクト（山や家や木）の上に立てる */
    /* 地上の立ち位置と向きを原点（初めの位置・北向き）へ戻す */
    groundReset() { gEye.set(GROUND_EYE.x, GROUND_EYE.y, GROUND_EYE.z + EYE_H); gYaw = 0; gPitch = 0.06; look.y = 0; look.p = 0; return true; },
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
      if (!on) { musWait = -1; musDelay = 0; musCut = -1; standWait = false; landRun = false; landCfg = false; stopMusic(MUS_FADE); }
      if (auto) {
        userForm = formation;
        let f0 = 0;
        for (let k = 0; k < PROGRAM.length; k++) if (okMan(PROGRAM[k])) { f0 = k; break; }
        /* 地上で待っているときは、固定モードでも離陸から始める */
        if (gmode === 'stand') { startFromGround(); return; }
        /* すでに飛んでいるときは、そのままの位置から始める（場所を移すと瞬間移動して見える）。
           地上を走っているときだけ、空へ移す */
        if (gmode !== 'fly') {
          gmode = 'fly'; gv = 0; spdK = 1; spdWant = 1;
          Object.assign(st, { x: GROUND_EYE.x - 280, y: GROUND_EYE.y - 460, z: SHOW.ALT, h: 25, ground: false, wall: false });
          levelAttitude(); camPos.set(0, 0, 0); hist.length = 0;
        }
        clearSmoke();
        beginManeuver(f0);
      } else { formation = userForm; formScale = 1; st.show = ''; st.cue = ''; markOn = false; step_i = 0; manPhase = 'do'; chunk = null; endCork(); endFigure(); if (treeMode) setTreeMode(false); }
    },
    autoState() { return auto; },
    /* 固定（エンドレス）モード。true にすると離着陸を含めず、演目を繰り返す */
    /* 自動操縦のボタンを 2 回押したときの「固定」。
       ふつうの版は「通し」: いったん着陸して滑走路で待ち、「加速」から離陸・演目・着陸までを行う。
       体験版の投影は操作できないので、繰り返し映すだけにする（restart = false） */
    setLoop(on, restart = true) {
      if (restart) {
        showThru = !!on; showLoop = false;
        if (!showThru) chunk = null;
        /* 飛んでいるところからでも、着陸させ直さない。
           呼んだ側が standReset() で滑走路の待機からやり直す（画面を切り替えて始める） */
        if (!showThru) loopRestart = false;
      } else { showLoop = !!on; showThru = false; if (!showLoop) loopRestart = false; }
      return showLoop || showThru;
    },
    loopState() { return showLoop || showThru; },
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
    setPaused(on) { paused = !!on; last = performance.now(); audioHold(); return paused; },
    togglePause() { paused = !paused; last = performance.now(); audioHold(); return paused; },
    pausedState() { return paused; },
    /* いまの景色を絵にする（操作ボタンは 3D の外にあるので写らない）。
       描いた直後に読み出す（そうしないと空の絵になる） */
    snapshot() { renderer.render(world, cam); return renderer.domElement.toDataURL('image/png'); },
    /* 乗り換え先を指定する（0 = 1 番機、1〜 = 2 番機〜）。出ていない機なら 1 番機 */
    setSeat(n) { n = n | 0; if (n > 0 && !(mates[n - 1] && mates[n - 1].userData.shown)) n = 0; seat = n; camPos.set(0, 0, 0); return seat; },
    seatState() { return seat; },
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
    /* 「加速」で離陸する。自動操縦で曲を選んであるときは、曲を頭から流し直し、
       主旋律が入るところでちょうどタイヤが離れるように滑走を始める */
    throttle() {
      if (gmode !== 'stand' || !st.lineup) return false;
      if (auto || standWait) { startFromGround(); return true; }
      gmode = 'takeoff'; startTakeoff('pairs'); return true;
    },
    /* 着陸してから滑走路へ戻るまでを飛ばす（減速と誘導路を待たずに待機の形にする） */
    /* 自動操縦を 2 回押して「通し」にしたとき: 画面を切り替えて、滑走路の待機からやり直す。
       飛んでいるところから着陸させ直すと、ずいぶん待たせるうえに動きも不自然になるため */
    standReset() {
      auto = true; oneShot = false; loopRestart = false; landRun = false;
      pickChunk();                             // 「通し」を選ぶたびに、まとまりを選び直す
      endCork(); endFigure(); if (treeMode) setTreeMode(false);
      musCut = -1; musWait = -1; musDelay = 0; stopMusic(MUS_FADE);
      gmode = 'apron'; gv = 0; rotP = 0; spdK = 1; spdWant = 1; tkOn = false; gPath = null; pathLag = 0; taxiFrom = null;
      mates.forEach(h => { h.userData.hold = 0; });
      Object.assign(st, { x: STANDS[0].x, y: STANDS[0].y, z: 3, h: STANDS[0].h, ground: true, wall: false });
      levelAttitude(); hist.length = 0; clearSmoke();
      formation = userForm; formScale = 1; manPhase = 'do'; markOn = false; e8 = null; mir = null;
      st.show = ''; st.desc = ''; st.cue = '「離陸準備」で滑走路へ進みます';
      mates.forEach((h, i) => {
        const u = h.userData, sd = STANDS[i + 1];
        u.tk = null; u.ld = null; u.dep = null; u.mh = undefined; u.from = null; u.shown = false; u.gh = sd.h; u.pfDone = false; u.parked = true; u.lag = undefined; u.gp = null; u.lampOn = false;
        h.position.set(sd.x, sd.y, 3);
        h.quaternion.setFromAxisAngle(AZ, -sd.h * D);
      });
      gearOn = true; applyGear(); landCfg = false;   // 駐機からやり直す: 着陸体制は解ける（スモークを入れられる）
      standWait = true;
      return true;
    },
    /* 駐機場から誘導路を通って滑走路の南端へ進み、離陸の体勢（並び）に入る。追従機は 7 秒ずつ遅れて出発し、自分の並びへ */
    taxiOut() {
      if (gmode !== 'apron') return false;
      landCfg = false;                                          // 次の離陸へ: 着陸体制は解ける（離陸準備からスモークを出せる）
      taxiTo(pathOut(0, RWY.x, RWY.y), 'stand', RWY.h); st.cue = '滑走路へ進みます';
      if (musBuf && actx) { playMusic(); musCut = -1; }        // 離陸準備で曲を流す（テイクオフで頭から流し直し、浮くタイミングを合わせる）
      const n = (auto || standWait) ? 6 : FORMATIONS[formation].n;   // 展示飛行は 6 機とも出す
      const others = k => mates.filter((h, j) => j !== k - 1 && j + 1 < n).map(h => h.position).concat(k === 0 ? [] : [plane.position]);
      gPath.turnDir = pickTurn(st.x, st.y, st.h, others(0));
      /* 最初の課目がダイヤモンド・テイクオフなら 滑走路 1 本に 4 機をダイヤモンドの形で並べる（利用者の指示 第 2 便 1・2）。ほかは 1 機ずつ（2 機）。残りは取り付けで順番を待つ */
      let f0 = 0; for (let k = 0; k < PROGRAM.length; k++) if (okMan(PROGRAM[k])) { f0 = k; break; }
      if (showThru && chunk && chunk.length) f0 = chunk[0];
      tkKind = PROGRAM[f0].id === 'dtake' ? 'diamond' : 'pairs';
      /* 並ぶ機の位置（RWY からのずれ）。残りは待つ。
         ダイヤモンドは FORMATIONS.diamond と同じ並びを滑走路 1 本の上に作る。
         横の広がりは ±16 m（翼端を入れて ±21 m ほど）で、縁の線 ±23.5 m の内側に入る */
      const LINE = tkKind === 'diamond' ? [[-16, -16], [16, -16], [0, -32]] : [[RWY2, 0]];
      mates.forEach((h, i) => { const u = h.userData; if (i + 1 >= n) return;
        u.parked = false; u.shown = true; h.visible = true; u.tk = null; u.ground = true;
        if (i < LINE.length) {                                     // 滑走路に並ぶ
          const g = LINE[i]; u.lineSpot = [RWY.x + g[0], RWY.y + g[1]]; u.queue = -1;
          u.gp = { pts: pathOut(i + 1, u.lineSpot[0], u.lineSpot[1]), idx: 0, v: 0, h: STANDS[i + 1].h, hEnd: RWY.h, wait: (i + 1) * 10,
                   turnDir: pickTurn(h.position.x, h.position.y, STANDS[i + 1].h, others(i + 1)) };
        } else {                                                   // 取り付けで順番を待つ
          const q = i - LINE.length; u.lineSpot = null; u.queue = q;
          u.gp = { pts: pathHold(i + 1, q), idx: 0, v: 0, h: STANDS[i + 1].h, hEnd: 270, wait: (i + 1) * 10,
                   turnDir: pickTurn(h.position.x, h.position.y, STANDS[i + 1].h, others(i + 1)) };
        } });
      return true;
    },
    skipTaxi() {
      if (gmode !== 'land' && gmode !== 'taxi') return false;
      if (gmode === 'taxi' && gEnd === 'stand') {               // 滑走路へ出る途中: 並び（待つ機は取り付けの待ち位置）へ飛ばす
        gmode = 'stand'; gPath = null; gv = 0;
        Object.assign(st, { x: RWY.x, y: RWY.y, h: RWY.h });
        mates.forEach((h, i) => { const u = h.userData; if (!u.shown) return; u.gp = null; u.parked = true;
          const sp = u.lineSpot || (u.queue >= 0 ? HOLD_PTS[u.queue] : null); if (!sp) return;
          u.gh = u.lineSpot ? RWY.h : 270;
          h.position.set(sp[0], sp[1], 3); h.quaternion.setFromAxisAngle(AZ, -u.gh * D); });
        st.cue = '「テイクオフ」で離陸できます';
        return true;
      }
      gmode = 'apron'; gPath = null; gv = 0; spdK = 1; spdWant = 1; pathLag = 0;
      Object.assign(st, { x: STANDS[0].x, y: STANDS[0].y, h: STANDS[0].h });
      mates.forEach((h, i) => { const u = h.userData, sd = STANDS[i + 1]; u.gp = null; u.pfDone = true; u.parked = true; u.gh = sd.h; h.position.set(sd.x, sd.y, 3); h.quaternion.setFromAxisAngle(AZ, -sd.h * D); });
      Object.assign(st, { x: RWY.x, y: RWY.y, z: 3, h: RWY.h, ground: true, wall: false });
      levelAttitude(); st.cue = '「テイクオフ」で離陸できます';
      mates.forEach(h => { h.userData.shown = false; });   // 並びの位置へそのまま置く
      return true;
    },
    groundMode() { return gmode; },
    /* 動きを確かめるための読み取り口（見るだけで、動きは変えない）。
       演目が観覧位置の正面で行われているか、隊形が組めているか、スモークが出ているかを外から測る */
    probe() {
      const cf = cfw.set(0, 0, -1).applyQuaternion(cam.quaternion), cr = crt.set(1, 0, 0).applyQuaternion(cam.quaternion);
      /* cam: カメラが向いている方位・仰角・見かけの傾き（水平線の傾き）。見回しが水平かを測るのに使う */
      const camDir = { h: +((((Math.atan2(cf.x, cf.y) / D) % 360) + 360) % 360).toFixed(1),
                       p: +(Math.asin(clamp(cf.z, -1, 1)) / D).toFixed(1),
                       r: +(Math.asin(clamp(-cr.z, -1, 1)) / D).toFixed(1) };
      return { cam: camDir, gear: gearOn, lights: lightsOn, landCfg, aud: aNodes ? aNodes.map(n => +n.g.gain.value.toFixed(3)) : null, seat, xwait: gPath ? !!gPath.xwait : false, lineup: st.lineup, gIdx: gPath ? gPath.idx : -1, pathLag, audio: actx ? actx.state : null, view: curView, gearSnd: gearSndN, slow: +slowAim.toFixed(1), fig: fig ? +fig.t.toFixed(1) : null, e8solo: e8 ? e8.solo : null, e8done: e8 ? e8.done : null, origin: { x: GROUND_EYE.x, y: GROUND_EYE.y }, along: +showLocal(st.x, st.y).along.toFixed(0), bloom: !!bloomS, rainDive, land: { desc: +landDesc.toFixed(1), step: landStep, musOn: landMusOn, musIdx, musCut: +musCut.toFixed(1), mates: mates.map(h => ({ pf: !!h.userData.pfDone, parked: !!h.userData.parked, on: !!h.userData.shown, ld: h.userData.ld ? { on: h.userData.ld.on, step: h.userData.ld.step, done: h.userData.ld.done } : null })) }, ready: matesReady(), phase: manPhase, show: st.show, step: step_i, cue: st.cue, gz: GATE.z, gx: GATE.x, gy: GATE.y, fr: showFr,
               aim: { x: focus.x, y: focus.y, z: focus.z },
               /* 1 番機の機首の向き */
               mf0: (() => { const v = gfw.copy(AY).applyQuaternion(plane.quaternion); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; })(),
               form: formation, scale: formScale, smoke: smokeOnArr.slice(), smWhy: smWhyArr.slice(),
               see: mates.map(h => h.visible && inCamView(h.position)), camP: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)],   // see: 各機がいまのカメラの視界に入っているか、camP: カメラの位置（瞬間移動・離陸・視線を測る）
               bloomC: bloomS ? { x: +bloomS.c.x.toFixed(1), y: +bloomS.c.y.toFixed(1) } : null,
               gearM: mates.map((h, i) => gearSets[i + 1] ? +gearSets[i + 1].visible : -1),
               mates: mates.map(h => ({ x: h.position.x, y: h.position.y, z: h.position.z, on: !!h.userData.shown,
                 mh: +((Math.atan2(gfw.copy(AY).applyQuaternion(h.quaternion).x, gfw.y) / D % 360 + 360) % 360).toFixed(1),
                 mb: +(Math.asin(clamp(gfw.copy(AX).applyQuaternion(h.quaternion).z, -1, 1)) / D).toFixed(1),
                 /* 機首の向き（3 次元の単位ベクトル）。進む向きとのめを測るのに使う */
                 mf: (() => { const v = gfw.copy(AY).applyQuaternion(h.quaternion); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; })(),
                 /* 機体の上がどちらを向いているか（1 = 背が上、-1 = 背面）。傾きの値だけでは背面と水平を見分けられない */
                 mup: +gfw.copy(AZ).applyQuaternion(h.quaternion).z.toFixed(2), lamp: lightSets[mates.indexOf(h) + 1] ? +lightSets[mates.indexOf(h) + 1].visible : -1, k: h.userData.k === undefined ? null : +h.userData.k.toFixed(2), xwait: h.userData.gp ? !!h.userData.gp.xwait : false, tk: h.userData.tk ? (h.userData.tk.done ? 2 : h.userData.tk.air ? 1 : 0) : null })) };
    },
    setLights(on) { lightsOn = !!on; applyGear(); }, lightState() { return lightsOn; },
    /* 地上からの視線を、その番号の機体に向ける（0 でふつうの追従に戻す）。着陸の締めに使う */
    aimAt(n) { aimN = Math.max(0, Math.min(6, +n || 0)); return aimN; },
    setFollow(on) { follow = !!on; if (follow && curView === 'ground') { look.y = 0; look.p = 0; } },
    /* 自動操縦で地上から見るときは、機体を目で追う（演目を見失わないように） */
    autoGroundFollow() { if (auto && curView === 'ground' && !follow) { follow = true; look.y = 0; look.p = 0; return true; } return false; },
    followState() { return follow; },
    zoomVal() { return zoom; },
    /* 技の一覧（移動のための旋回と正面通過を除く）と、1 つだけ行わせる呼び出し。
       自分で操縦しているときに技を選ぶと、その技の間だけ自動で飛び、終わると操縦が戻る */
    /* 技の一覧。need: 'ground' は地上にいるときだけ、'air' は飛んでいるときだけ使える（v04.37）。
       着陸（land）は技ではないが、一覧から呼べるようにする */
    maneuvers() { const seen = new Set();   // 同じ技が演技の中に何度も出るので、一覧では 1 つにまとめる
      const air = gmode === 'fly';
      const list = PROGRAM.map((m, i) => ({ i, id: m.id, ja: m.ja, desc: m.desc || '',
        need: m.id === 'dtake' ? 'ground' : 'air',
        lock: !okMan(m) || (m.id === 'dtake' ? air : !air) }))
        .filter(m => m.id !== 'orbit' && m.id !== 'pass' && !seen.has(m.id) && seen.add(m.id));
      list.push({ i: -1, id: 'land', ja: '着陸', desc: '滑走路へ進入して着陸し、誘導路を通って駐機場へ戻ります。', need: 'air', lock: !air });
      return list; },
    /* 見せる課目を絞る（体験版）。ids を渡すとその id だけ、null で全部に戻す */
    setAllowed(ids) { allowIds = (ids && ids.length) ? ids.slice() : null; },
    /* 進入を飛ばして、その課目の開始位置へ置く（技をひとつだけ行うとき用）。進入中だけ効く。
       開始位置は、正面から入る課目なら正面の線の上（m.far か FRONT_START の距離）、
       方角を決めた課目なら決めた点（GATE）、滑走路の課目なら延長線の南 900 m */
    skipEntry() {
      if (!auto || (manPhase !== 'in' && manPhase !== 'align')) return false;
      const m = PROGRAM[step_i], e = eyeDir();
      let hx, hy, hh;
      if (m.rwy) { hx = RWY.x; hy = RWY.y - 900; hh = RWY.h; }
      else if (m.at !== undefined) { hx = GATE.x; hy = GATE.y;
        hh = ((Math.atan2(GROUND_EYE.x - hx, GROUND_EYE.y - hy) / D) % 360 + 360) % 360; }
      else { const d = (m.far || FRONT_START);
        hx = e.ex + e.dx * d; hy = e.ey + e.dy * d;
        hh = ((Math.atan2(e.ex - hx, e.ey - hy) / D) % 360 + 360) % 360; }
      st.x = hx; st.y = hy; st.z = GATE.z;
      att.setFromAxisAngle(AZ, -hh * D); readAttitude();
      spdK = 1; spdWant = 1;
      hist.length = 0; clearSmoke();
      launchQueued();
      mates.forEach(h => { const u = h.userData; u.hold = 0; u.k = 1; u.from = null; u.qw = null; });
      snapForm = true;                           // 隊形は組み上がった形にする（置き直しは placeMates で行う）
      slowAim = SLOW_AIM; beginMirror(m, true); if (opt.onJump) opt.onJump();
      endEntry(); return true; },
    entryState() { return auto && (manPhase === 'in' || manPhase === 'align'); },
    runManeuver(i) {
      /* 着陸（一覧の -1）。飛んでいるときだけ */
      if (i === -1) { if (gmode !== 'fly') return false; if (!auto) { userForm = formation; oneShot = false; } auto = true; chunk = null; beginLanding(); return true; }
      if (!PROGRAM[i] || !okMan(PROGRAM[i])) return false;
      if (PROGRAM[i].id === 'dtake') {            // ダイヤモンド・テイクオフは地上から（滑走路に並んでいるとき）
        if (gmode === 'fly') return false;
        if (!auto) { userForm = formation; oneShot = false; }
        auto = true; beginManeuver(i); return true;
      }
      if (gmode !== 'fly' && PROGRAM[i].id !== 'dtake') return false;   // ほかの技は飛んでいるときだけ
      if (gmode !== 'fly') { gmode = 'fly'; st.z = Math.max(st.z, 120); spdK = 1; spdWant = 1; levelAttitude(); }
      if (!auto) { userForm = formation; oneShot = true; }   // 自分で操縦しているときは、その技だけ行って操縦を返す
      auto = true; beginManeuver(i); return true;
    },
    setProps(on) { props.visible = !!on; },   // オブジェクト（山・民家・木・塔）の出し入れ
    setFormation(f) { if (FORMATIONS[f]) { formation = f; userForm = f; } },   // 飛びながら変えられる。合流は placeMates がなめらかにする
    formation() { return formation; },
    /* 音の入り切り。ブラウザの決まりで、操作された流れの中でしか音を出せないので、
       入れたときに作る。切ったときは鳴らさない（作ったものは残す） */
    setSound(on) {
      soundOn = !!on;
      if (soundOn) { initAudio(); if (actx && actx.state !== 'running') actx.resume(); }
      else if (aNodes) aNodes.forEach(n => { n.g.gain.value = 0; });
      return soundOn;
    },
    soundState() { return soundOn; },
    wakeAudio() { wakeAudio(); },
    /* 飛行音と曲の大きさ（0〜1）。飛行音と曲は同時に鳴るので、別々に決められるようにする */
    setVol(kind, v) {
      const x = clamp(+v || 0, 0, 1);
      if (kind === 'mus') { musVol = x; if (musGainNode && actx) { try { musGainNode.gain.cancelScheduledValues(actx.currentTime); musGainNode.gain.setValueAtTime(Math.max(0.0001, x), actx.currentTime); } catch (e) {} } }
      else { airVol = x; if (aMaster) aMaster.gain.value = x; }
      return x;
    },
    vols() { return { air: airVol, mus: musVol }; },
    /* 利用者が選んだ音楽ファイルを読む。アプリは音源を持たず、選ばれたものをその場で鳴らすだけ。
       返り値は「主旋律が入るところ（秒）」。地上から演目を始めると、ここでタイヤが離れる */
    async loadMusic(arrayBuffer, name) { return this.setMusicList([{ name: name || '', buf: arrayBuffer }]); },
    /* 曲のリストを入れ替える。最初の曲だけ decode して、主旋律の入りを調べる（離陸の合図に使う） */
    async setMusicList(list) {
      initAudio();
      stopMusic(); musGen++; musDec.clear(); musBuf = null; musIdx = 0;
      musList = (list || []).filter(x => x && x.buf);
      if (!actx || !musList.length) return null;
      if (actx.state !== 'running') await actx.resume().catch(() => {});
      musBuf = await decodeAt(0);
      if (!musBuf) return null;
      const ai = anthemIdx();
      if (ai > 0) await decodeAt(ai);          // 離陸で頭から流すので、先に decode しておく
      const found = findLead(ai > 0 && musDec.get(ai) ? musDec.get(ai) : musBuf);
      /* anthem がリストにあるときは、隠し設定（曲の頭 13.5 秒、13.5 秒〜3:58 を繰り返す。設定画面の「浮くタイミング」を v04.88 で外したあとも、
         anthem 限定でこの決まりは残す）をそのまま使い、解析した値で上書きしない。
         v05.01 の総点検で「探した値を常に使う」に変えたところ、anthem で浮くタイミングが合わず、イントロが繰り返し流れた（利用者の指摘 2026-09-17「元のようにして」）。
         anthem が無いときだけ、探した値を使う（見つからなければ 13.5 秒） */
      if (ai >= 0) musLead = 13.5; else musLead = found > 0 ? found : 13.5;
      return { lead: musLead, found, dur: musBuf.duration, n: musList.length };
    },
    musicInfo() { return musBuf ? { lead: musLead, dur: musBuf.duration, n: musList.length } : null; },
    /* 展示飛行モードの長さ（秒）と並び。並びは課目 id の配列、null ならおまかせ */
    setShowLen(sec) { showLen = Math.max(120, +sec || SHOW_LEN_DEFAULT); return showLen; },
    setProgram(ids) { customProg = Array.isArray(ids) && ids.length ? ids.slice() : null; },
    terrain(x, y) { return terrainAt(x, y); },
    smokeGap(reset) { const r = gapMax.slice(); if (reset) gapMax.length = 0; return r; },
    smokeCount() { let n = 0; for (let i = 0; i < sBirth.length; i++) if (clock - sBirth[i] < sLife[i]) n++; return n; },   // 生きている煙の粒の数（確かめ用）
    programList() { return PROGRAM.map(m => ({ id: m.id, ja: m.ja, role: ROLE[m.id] || '' })).filter(m => m.role); },
    /* 曲を手で流す・止める（ボタン用） */
    playMusicNow() { if (!musBuf) return false; initAudio(); playMusic(); musCut = -1; return true; },
    stopMusicNow() { musCut = -1; musWait = -1; musDelay = 0; stopMusic(MUS_FADE); return true; },
    musicPlaying() { return !!musSrc; },
    setLead(sec) { musLead = Math.max(0, +sec || 0); return musLead; },
    clearMusic() { stopMusic(); musGen++; musDec.clear(); musList = []; musBuf = null; musLead = 0; musWait = -1; musDelay = 0; },
    setSmoke(on) { if (on && landCfg && auto) return false; smokeOn = !!on; return smokeOn; },   // 着陸体制の錠は自動操縦のあいだだけ
    smokeState() { return smokeOn; },
    clearTrail() { trailLen = 0; trailGeo.setDrawRange(0, 0); },   // 「動きで見る」: 周回の頭で、前の周の航跡を消す
    setSmokeColor(c) { if (SMOKE_COLORS[c]) { smokeColor = c; clearSmoke(); } },
    level() { levelAttitude(); st.ground = false; landCfg = false; if (gmode !== 'fly') { gmode = 'fly'; st.z = Math.max(st.z, 60); spdK = 1; } },
    home() { gmode = 'fly'; gv = 0; spdK = 1; spdWant = 1; Object.assign(st, { x: START.x, y: START.y, z: START.z, h: START.h, ground: false, wall: false }); levelAttitude(); camPos.set(0, 0, 0); hist.length = 0; clearSmoke(); },
    dispose() { running = false; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); cv.remove();
      if (actx) { try { aNodes && aNodes.forEach(n => n.src.stop()); actx.close(); } catch (e) {} actx = null; aNodes = null; } }
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
