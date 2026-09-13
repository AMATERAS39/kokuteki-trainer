/* flight.js — 飛行モデル（1 つ）。出題（engine.js）・解説と「動きで見る」（index.html）・シミュレーター（sim3d.js）が同じ式で機体を動かす。
   利用者の原則（2026-09-13）:「試験は本物の機体から撮影された景色で出題される。出題・解説・動きの見え方は実機と全く同じ動きを再現する」
   「動かすべきは世界ではなく、機体である」。以前の出題は「操作 1 つ＝姿勢の回転 1 つ」（engine.js の applyOp）で景色を回していた。

   式（`_proto.html` v2 と同じ。sim3d.js の physStep v2 をここへ移した）:
     状態 = 姿勢 M（3×3、列は 機体の 右・前・上 を世界座標で）、速度ベクトル vel、位置 pos。世界は x 東・y 北・z 上。
     迎角 α = 機首と速度の縦のずれ、横滑り角 β = 横のずれ。揚力 KL·α·q（機体の上）、横力 −KY·β·q（機体の右）、重力 g（鉛直下）。
     速さは一定（推力＝抗力）。q = (v/60)²（揚力・横力は速さの二乗に比例）。
     補助翼 → ロール角速度 ROLL·x、昇降舵 → 迎角の指令（手前で +A_PULL、奥で −A_PUSH、時定数 TAU_A）、方向舵 → 横滑り角の指令（±BETA_MAX、時定数 TAU_B）。
     風見安定（縦横）: 速度の向きが変わったぶんだけ機首も同じ回転で回す（迎角・横滑り角は舵の指令でしか変わらない）。
   重力: 出題・解説・動きで見るは本物の重力。操作モード（自分で操縦する画面）は利用者の決めで重力を無視し、代わりに釣り合いの揚力の鉛直成分を差し引く
   （gravity:false。釣り合いで飛んでいればどのバンクでも沈まず、旋回率は物理と同じ）。
   ES module としても（sim3d.js が import）、ふつうの script としても（index.html → engine.js）読める: 何も export せず globalThis.AAT_FLIGHT に置く */
(function (g) {
  'use strict';
  const D = Math.PI / 180, G = 9.81, SPEED = 60;
  const PHY = { ALPHA0: 3.5 * D, KY: 14, TAU_A: 0.35, TAU_B: 0.8, A_PULL: 10.5 * D, A_PUSH: 7 * D, BETA_MAX: 10 * D, ROLL: 60 * D, A_MAX: 14 * D };
  PHY.KL = G / PHY.ALPHA0;   // 揚力傾斜（m/s² / rad）。釣り合いの迎角で揚力＝重力
  /* 出題・解説・動きで見る の機体: 速さ V（m/s）と、操作 → 舵の入力（x: 操縦桿 左右（右 +）、y: 前後（奥 +）、r: 方向舵（右 +））。
     入力の大きさは「水平から 2 秒でバンク 20°・機首 8°・機首の振れ 10°」になるように合わせる（以前の出題の変化量）。値は calibrate() で求めた（下） */
  /* 速さ 200 m/s（約 720 km/h。T-4 の巡航に近い速い想定）。バンクによる旋回率は g·tanφ/V で速さに反比例するので、
     遅い想定ほど、傾いているだけで目印が横へ流れる量が大きくなる（実測: バンク 30° を 4 秒保つと 60 m/s で 23.6°、150 m/s で 9.0°、200 m/s で 6.7°、250 m/s で 5.3°）。
     受験生には「機体に対して横の流れ＝方向舵」としか説明されないので、速い想定にして旋回の流れを小さく保つ（利用者の判断 2026-09-13）。
     入力（200 m/s で水平から 2 秒）: 操縦桿 左右 ±0.17 → バンク 20.4°、奥 0.0728 → 機首 −8.0°、手前 −0.0483 → 機首 +8.0°、方向舵 ±0.5259 → 機首の振れ 10.0°（v05.18 の風見安定（縦）で合わせ直した） */
  const EXAM = { V: 200, INPUT: { 'stick-right': { x: 0.17 }, 'stick-left': { x: -0.17 }, 'stick-forward': { y: 0.0728 }, 'stick-back': { y: -0.0483 }, 'rudder-right': { r: 0.5259 }, 'rudder-left': { r: -0.5259 } } };

  /* ===== 試験の景色の世界（出題の絵 engine.js の svgCockpit と、3D の sim3d.js の scenery:'exam' が同じものを描く） =====
     遠くの目印は方向（絵の px: 方位 = x/6°、仰角 = −y/6°）。地面の目印は始めの位置からの m（x 東・y 北）。機体の高さは H（m）。
     地面の目印（畑・湖・道・集落）は、上空から地面を見下ろす写真（機首下げの問題）でも景色の向きと動きが読めるように置く（利用者の指示 2026-09-13。
     それまでは地面が無地で、機首下げが続くと答えられなくなるので、出題で「奥」を含む選択肢を 1 つに制限していた） */
  const WORLD = {
    H: 1000,                                  // 機体の高さ（m）
    peaks: [22, 40, 18, 55, 30, 72, 26, 48, 20, 64, 36, 28, 58, 24, 44, 30, 68, 22, 50, 34, 26, 60, 18, 42, 30, 54, 20, 46, 38, 24],   // 山並みの頂の高さ（px）。方位は −145°〜+145° を 10° 刻み
    snow: { tri: [[-130, 0], [-90, -72], [-50, 0]], cap: [[-100, -54], [-90, -72], [-80, -54], [-90, -58]] },   // 雪山（px）
    tower: { post: [[228, 0], [232, 0], [232, -40], [228, -40]], cap: [[220, -38], [240, -38], [240, -46], [220, -46]] },   // 塔（px）
    sun: { x: 110, y: -96, r: 15 },           // 太陽（px）
    radial: [-7, -5, -3.5, -2.2, -1.2, -0.5, 0.5, 1.2, 2.2, 3.5, 5, 7],   // 地面の放射の線: 進行方向に平行な線の横ずれ = 130/240·k·H
    gap: 300,                                 // 地面の横の線の間隔（m）
    colors: { field: '#6f7a3a', field2: '#8a7a45', lake: '#3d6fa3', road: '#3a3f46', town: '#b9b1a3' },   // CSS 変数 --ck-<名前> が無いときの色
    ground: [
      { c: 'field', pts: [[300, 1800], [1300, 1800], [1300, 2600], [300, 2600]] },
      { c: 'field2', pts: [[-2600, 2200], [-1800, 2200], [-1800, 2900], [-2600, 2900]] },
      { c: 'field', pts: [[1600, 4200], [2600, 4200], [2600, 5000], [1600, 5000]] },
      { c: 'field2', pts: [[-900, 5200], [-100, 5200], [-100, 6200], [-900, 6200]] },
      { c: 'field', pts: [[-3200, 7000], [-2000, 7000], [-2000, 7800], [-3200, 7800]] },
      { c: 'lake', pts: [[-1000, 3300], [-1120, 3490], [-1400, 3560], [-1680, 3490], [-1800, 3300], [-1680, 3110], [-1400, 3040], [-1120, 3110]] },
      { c: 'road', pts: [[-8000, 1480], [8000, 1480], [8000, 1520], [-8000, 1520]] },
      { c: 'road', pts: [[680, -3000], [720, -3000], [720, 14000], [680, 14000]] },
      { c: 'town', pts: [[950, 2850], [1040, 2850], [1040, 2940], [950, 2940]] },
      { c: 'town', pts: [[1100, 2900], [1190, 2900], [1190, 2990], [1100, 2990]] },
      { c: 'town', pts: [[1250, 2860], [1340, 2860], [1340, 2950], [1250, 2950]] },
      { c: 'town', pts: [[1000, 3020], [1090, 3020], [1090, 3110], [1000, 3110]] },
      { c: 'town', pts: [[1180, 3040], [1270, 3040], [1270, 3130], [1180, 3130]] }
    ],
    /* 星（夜だけ）: 絵の乱数（種 7）で 70 個。cx −600〜600・cy −40〜−340（px）、半径 0.8〜2.2 px */
    stars: (() => { let x = 7; const r = () => (x = (x * 48271) % 2147483647) / 2147483647; const out = [];
      for (let i = 0; i < 70; i++) out.push({ x: Math.round(-600 + r() * 1200), y: Math.round(-40 - r() * 300), r: +(0.8 + r() * 1.4).toFixed(1) }); return out; })()
  };

  /* ---- 3×3 の回転（engine.js の matOf と同じ約束: R = Rz(−yaw)·Rx(pitch)·Ry(bank)、列 = 右・前・上） ---- */
  const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const rot = (axis, a) => { const c = Math.cos(a), s = Math.sin(a);   // 機体の軸まわり（x: 翼、y: 機首、z: 上下）、ラジアン
    if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
    if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
  const matOf = (bank, pitch, yaw) => mul(mul(rot('z', -yaw * D), rot('x', pitch * D)), rot('y', bank * D));   // 度
  const eulerOf = M => {   // 度。yaw は方位（北 0、時計回り正）
    const fx = M[0][1], fy = M[1][1], fz = M[2][1], rz = M[2][0], uz = M[2][2];
    return { yaw: Math.atan2(fx, fy) / D, pitch: Math.asin(Math.max(-1, Math.min(1, fz))) / D, bank: Math.atan2(-rz, uz) / D };
  };
  const col = (M, j) => [M[0][j], M[1][j], M[2][j]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /* 1 コマ進める。s = { M, vel:[x,y,z], pos:[x,y,z] }（破壊的）。inp = { x, y, r }。
     o.v: 速さ（m/s、既定 60）、o.q: 動圧の比（既定 (v/60)²）、o.gravity: 本物の重力か（既定 true）。戻り値: { alpha, beta }（ラジアン） */
  function step(s, inp, dt, o) {
    o = o || {};
    const v = o.v || SPEED, q = o.q == null ? (v / SPEED) * (v / SPEED) : o.q, gravity = o.gravity !== false;
    let M = s.M; const vel = s.vel, pos = s.pos;
    const right = col(M, 0), fwd = col(M, 1), up = col(M, 2);
    const vr = dot(vel, right), vf = dot(vel, fwd), vu = dot(vel, up);
    const alpha = Math.atan2(-vu, vf), beta = Math.atan2(vr, vf);
    const a0 = Math.min(PHY.ALPHA0 / q, PHY.A_MAX);   // 釣り合いの迎角（遅いほど機首を上げて飛ぶ。上限は失速の手前）
    const kl = PHY.KL * alpha * q, ky = -PHY.KY * beta * q;
    const acc = [up[0] * kl + right[0] * ky, up[1] * kl + right[1] * ky, up[2] * kl + right[2] * ky];
    acc[2] -= gravity ? G : PHY.KL * a0 * q * up[2];
    const vl0 = Math.hypot(vel[0], vel[1], vel[2]), v0 = [vel[0] / vl0, vel[1] / vl0, vel[2] / vl0];
    vel[0] += acc[0] * dt; vel[1] += acc[1] * dt; vel[2] += acc[2] * dt;
    { const k = v / Math.hypot(vel[0], vel[1], vel[2]); vel[0] *= k; vel[1] *= k; vel[2] *= k; }
    pos[0] += vel[0] * dt; pos[1] += vel[1] * dt; pos[2] += vel[2] * dt;
    /* 風見安定（縦横とも）: 速度の向きが変わったぶんだけ機首も同じ回転で回す（迎角・横滑り角・バンクは変わらない）。
       v05.17 までは横（世界の上下軸まわり）だけで、縦は昇降舵の時定数 τ_A で機首が速度を追っていた。速い機体では τ_A の遅れが
       わずかな迎角の増えとなり、それが大きな揚力（KL·q）になって、傾いて手を放しても沈まず「水平面に平行に旋回」していた（利用者の指摘 2026-09-13）。
       実機は縦の安定も強く、機首は相対風に沿う。手を放して傾けば、揚力の鉛直成分が足りないぶん経路が下へ曲がり、機首がそれを追う */
    { const v1 = [vel[0] / v, vel[1] / v, vel[2] / v], ax = [v0[1] * v1[2] - v0[2] * v1[1], v0[2] * v1[0] - v0[0] * v1[2], v0[0] * v1[1] - v0[1] * v1[0]];
      const sn = Math.hypot(ax[0], ax[1], ax[2]), cs = dot(v0, v1);
      if (sn > 1e-12) { const k = [ax[0] / sn, ax[1] / sn, ax[2] / sn], c = cs, s1 = sn, t = 1 - c;
        const Rw = [[t * k[0] * k[0] + c, t * k[0] * k[1] - s1 * k[2], t * k[0] * k[2] + s1 * k[1]],
                    [t * k[0] * k[1] + s1 * k[2], t * k[1] * k[1] + c, t * k[1] * k[2] - s1 * k[0]],
                    [t * k[0] * k[2] - s1 * k[1], t * k[1] * k[2] + s1 * k[0], t * k[2] * k[2] + c]];
        M = mul(Rw, M); } }
    /* 補助翼: 速度の向き（相対風）を軸に回す。機首の軸まわりに回すと、横滑り（方向舵中）のぶんが迎角に化け、
       τ_A の遅れの間に大きな揚力（KL·q）が出て、左ロール＋左方向舵で機体が上昇した（4 秒で +16 m。利用者の指摘 2026-09-13「水平面に平行に移動しているように見える」の点検で発見）。
       実機も縦横の安定が強く、数秒の尺度では相対風のまわりに回るのと同じ（迎角・横滑り角は舵の指令でしか変わらない、の徹底） */
    const roll = PHY.ROLL * (inp.x || 0) * dt;
    if (roll) { const k = [vel[0] / v, vel[1] / v, vel[2] / v], c = Math.cos(roll), s1 = Math.sin(roll), t = 1 - c;
      M = mul([[t * k[0] * k[0] + c, t * k[0] * k[1] - s1 * k[2], t * k[0] * k[2] + s1 * k[1]],
               [t * k[0] * k[1] + s1 * k[2], t * k[1] * k[1] + c, t * k[1] * k[2] - s1 * k[0]],
               [t * k[0] * k[2] - s1 * k[1], t * k[1] * k[2] + s1 * k[0], t * k[2] * k[2] + c]], M); }
    const y = inp.y || 0, alphaWant = a0 + (y < 0 ? -y * PHY.A_PULL : -y * PHY.A_PUSH);   // 手前（y<0）で迎角を増やす
    const betaWant = -(inp.r || 0) * PHY.BETA_MAX;                                       // 右方向舵で機首を右へ（β は負）
    const dA = (alphaWant - alpha) * Math.min(1, dt / PHY.TAU_A), dB = (betaWant - beta) * Math.min(1, dt / PHY.TAU_B);
    if (dA) M = mul(M, rot('x', dA));
    if (dB) M = mul(M, rot('z', dB));   // 機首を右へ振るのは z まわりの負の回転
    s.M = M;
    return { alpha, beta };
  }

  /* ①の状態を作る。init = { bank, pitch, yaw }（度。pitch は経路の上下、yaw は方位）。
     経路は init の向き、機首はそれより水平飛行の迎角ぶん上、舵は中立。**傾いていても引きは足さない**（引いていれば「操作をしている」ことになり嘘になる。利用者の指示 2026-09-13）。
     傾いた①から手を放せば、揚力の鉛直成分が足りないぶん沈みながら旋回する——実機どおり。sim3d の手動操縦の syncVel も同じ */
  function trim(init, o) {
    o = o || {};
    const v = o.v || SPEED, q = o.q == null ? (v / SPEED) * (v / SPEED) : o.q;
    let M = matOf(init.bank || 0, init.pitch || 0, init.yaw || 0);
    const fwd = col(M, 1), vel = [fwd[0] * v, fwd[1] * v, fwd[2] * v];
    M = mul(M, rot('x', Math.min(PHY.ALPHA0 / q, PHY.A_MAX)));
    return { s: { M, vel, pos: [o.x || 0, o.y || 0, o.z || 0] } };
  }

  /* 操作の区間を飛ばして、時刻ごとの姿勢と位置を返す。init = { bank, pitch, yaw }、segs = [{ dur: 秒, ops: [op id…] }, …]。
     戻り値 { samples: [{ t, bank, pitch, yaw, dx, dy, dz }…]（dt 刻み。yaw は連続）, frames: [①, ②, …]（各区間の終わりの姿勢）, dur }
     区間の中では操作は一定。操作が無ければ舵は中立（手を放した状態）。dt は既定 1/120 秒 */
  function run(init, segs, o) {
    o = o || {};
    const dt = o.dt || 1 / 120, { s } = trim(init, o), samples = [], frames = [];
    let t = 0, prevYaw = null;
    const snap = () => { const e = eulerOf(s.M);
      if (prevYaw !== null) { while (e.yaw - prevYaw > 180) e.yaw -= 360; while (e.yaw - prevYaw < -180) e.yaw += 360; } prevYaw = e.yaw;
      return { t, bank: e.bank, pitch: e.pitch, yaw: e.yaw, dx: s.pos[0], dy: s.pos[1], dz: s.pos[2] }; };
    samples.push(snap()); frames.push(samples[0]);
    for (const seg of segs) {
      const inp = { x: 0, y: 0, r: 0 }, IN = o.inputs || EXAM.INPUT;
      for (const id of seg.ops || []) { const i = IN[id] || {}; inp.x += i.x || 0; inp.y += i.y || 0; inp.r += i.r || 0; }
      const n = Math.round(seg.dur / dt);
      for (let k = 0; k < n; k++) { step(s, inp, dt, o); t += dt; samples.push(snap()); }
      frames.push(samples[samples.length - 1]);
    }
    return { samples, frames, dur: t };
  }
  /* 時刻 t の様子（samples から線形補間） */
  function at(traj, t) {
    const S = traj.samples, n = S.length; if (n === 1 || t <= 0) return S[0]; if (t >= traj.dur) return S[n - 1];
    const i = Math.min(n - 2, Math.floor(t / traj.dur * (n - 1))), a = S[i], b = S[i + 1], k = (t - a.t) / (b.t - a.t || 1);
    const m = (p, q2) => p + (q2 - p) * k;
    return { t, bank: m(a.bank, b.bank), pitch: m(a.pitch, b.pitch), yaw: m(a.yaw, b.yaw), dx: m(a.dx, b.dx), dy: m(a.dy, b.dy), dz: m(a.dz, b.dz) };
  }

  /* 検証用: 速さ v で、水平から各操作を dur 秒入れたときの変化量（度）。入力の大きさを決めるときに使う */
  function calibrate(v, inputs, dur) {
    const out = {};
    for (const id of Object.keys(inputs)) { const r = run({ bank: 0, pitch: 0, yaw: 0 }, [{ dur: dur || 2, ops: [id] }], { v, inputs }), a = r.frames[0], b = r.frames[1];
      out[id] = { bank: +(b.bank - a.bank).toFixed(2), pitch: +(b.pitch - a.pitch).toFixed(2), yaw: +(b.yaw - a.yaw).toFixed(2), dz: +(b.dz - a.dz).toFixed(1) }; }
    return out;
  }
  g.AAT_FLIGHT = { PHY, SPEED, EXAM, WORLD, step, trim, run, at, calibrate, matOf, eulerOf, mul, rot };
})(globalThis);
