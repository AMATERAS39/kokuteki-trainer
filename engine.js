/* 航空適性トレーナー ロジック層
   出題生成・採点・計器 SVG 生成。色は CSS 変数のみ参照し、レイアウトには関与しない。 */
(function (global) {
  'use strict';
  const D = Math.PI / 180;
  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; };
  const norm = a => ((a % 360) + 360) % 360;
  let uid = 0;

  /* ---------- 定数 ---------- */
  const DIRS = [
    { k: 'N', ja: '北' }, { k: 'NE', ja: '北東' }, { k: 'E', ja: '東' }, { k: 'SE', ja: '南東' },
    { k: 'S', ja: '南' }, { k: 'SW', ja: '南西' }, { k: 'W', ja: '西' }, { k: 'NW', ja: '北西' }
  ];
  const MODES = { heading: '方位', attitude: '姿勢指示器', combo: '方位×姿勢指示器', control: '操縦操作' };
  /* base: 文末形、cont: 連用形（「〜し、」でつなぐ） */
  const OPS = [
    { id: 'stick-right', ja: '操縦桿 右', base: '操縦桿を右に倒す', cont: '操縦桿を右に倒し', group: 'stick', effect: { bank: 20 }, body: '機体が右に傾く', view: '景色が左に傾く（水平線が右上がりになる）' },
    { id: 'stick-left', ja: '操縦桿 左', base: '操縦桿を左に倒す', cont: '操縦桿を左に倒し', group: 'stick', effect: { bank: -20 }, body: '機体が左に傾く', view: '景色が右に傾く（水平線が左上がりになる）' },
    { id: 'stick-forward', ja: '操縦桿 奥', base: '操縦桿を奥に倒す', cont: '操縦桿を奥に倒し', group: 'stick', effect: { pitch: -8 }, body: '機体が沈む（機首下げ）', view: '水平線が上がり、地面が広がる' },
    { id: 'stick-back', ja: '操縦桿 手前', base: '操縦桿を手前に引く', cont: '操縦桿を手前に引き', group: 'stick', effect: { pitch: 8 }, body: '機体が上昇する（機首上げ）', view: '水平線が下がり、空が広がる' },
    { id: 'rudder-right', ja: 'ヨー 右', base: '右方向舵を踏む', cont: '右方向舵を踏み', group: 'rudder', effect: { yaw: 10 }, body: '水平のまま右を向く', view: '水平線は変わらず、景色が左へ流れる' },
    { id: 'rudder-left', ja: 'ヨー 左', base: '左方向舵を踏む', cont: '左方向舵を踏み', group: 'rudder', effect: { yaw: -10 }, body: '水平のまま左を向く', view: '水平線は変わらず、景色が右へ流れる' }
  ];
  const OP_BY_ID = Object.fromEntries(OPS.map(o => [o.id, o]));
  const OPPOSITE = { 'stick-right': 'stick-left', 'stick-left': 'stick-right', 'stick-forward': 'stick-back', 'stick-back': 'stick-forward', 'rudder-right': 'rudder-left', 'rudder-left': 'rudder-right' };
  /* 操作列を文にする: 単一操作なら「操縦桿を右に倒す」、2 操作なら「操縦桿を右に倒し、右方向舵を踏む」 */
  function opsText(ops) {
    if (ops.length === 2 && ops[0] === ops[1]) return OP_BY_ID[ops[0]].base;
    return ops.map((id, i) => i < ops.length - 1 ? OP_BY_ID[id].cont : OP_BY_ID[id].base).join('、');
  }
  const HI_LABELS = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];
  /* 第三者視点（南からの固定視点）で機首が向く 14 方向。heading は北 0° 時計回り、pitch は機首上げ正 [°]。
     読み方: 画面の奥が北、手前が南、右が東、左が西。 */
  const DIR14 = [
    { id: 'north', ja: '北', heading: 0, pitch: 0, read: '機首が画面の奥を向いている → 北。' },
    { id: 'south', ja: '南', heading: 180, pitch: 0, read: '機首がこちら（手前）を向いている → 南。' },
    { id: 'east', ja: '東', heading: 90, pitch: 0, read: '機首が画面の右を向いている → 東。側面が見えるので機首は水平（ピッチなし）。' },
    { id: 'west', ja: '西', heading: 270, pitch: 0, read: '機首が画面の左を向いている → 西。側面が見えるので機首は水平（ピッチなし）。' },
    { id: 'up', ja: '上', heading: null, pitch: 90, read: '機首が真上。腹面（下側）が見えている → 垂直上昇。姿勢指示器はほぼ全面が空。' },
    { id: 'down', ja: '下', heading: null, pitch: -90, read: '機首が真下。背面（上側）が見えている → 垂直降下。姿勢指示器はほぼ全面が地面。' },
    { id: 'ne_up', ja: '北東上', heading: 45, pitch: 30, read: '機首が奥・右・上 → 北東へ上昇。' },
    { id: 'nw_up', ja: '北西上', heading: 315, pitch: 30, read: '機首が奥・左・上 → 北西へ上昇。' },
    { id: 'se_up', ja: '南東上', heading: 135, pitch: 30, read: '機首が手前・右・上 → 南東へ上昇。' },
    { id: 'sw_up', ja: '南西上', heading: 225, pitch: 30, read: '機首が手前・左・上 → 南西へ上昇。' },
    { id: 'ne_down', ja: '北東下', heading: 45, pitch: -30, read: '機首が奥・右・下 → 北東へ降下。' },
    { id: 'nw_down', ja: '北西下', heading: 315, pitch: -30, read: '機首が奥・左・下 → 北西へ降下。' },
    { id: 'se_down', ja: '南東下', heading: 135, pitch: -30, read: '機首が手前・右・下 → 南東へ降下。' },
    { id: 'sw_down', ja: '南西下', heading: 225, pitch: -30, read: '機首が手前・左・下 → 南西へ降下。' }
  ];

  const DEFAULT_SETTINGS = { north: 'random', view: 'rear', ops: 'double', init: 'level', auto: false, bank: 'on', level: 'hard' };
  const LEVELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  const lvOf = s => s.level === 'medium' ? 'normal' : (s.level || 'hard');   // medium は旧称
  /* 視界・姿勢指示器のリアルタイム更新に使う係数（svgCockpit / svgAI と同じ値） */
  const CK = { kp: 5, ky: 6, aiK: 2.4, grow: 0.45 };

  /* ---------- 出題生成 ---------- */
  /* N マークの向きと機首の向きが一致すると答えが自明になるので、機首は N と別の向きだけを出題する（dir≠0）。
     N マークは 8 方位（45° 刻み、上を含む）のいずれかにランダムに置く。 */
  /* 方位の難易度
     easy: 答えは東西南北のみ、N マークは上に固定（機首と同じ向きになってもよい）
     medium: 答えは東西南北のみ、N マークはランダム（機首とは重ならない）
     hard: 答えは 8 方位、N マークはランダム（機首とは重ならない） */
  function genHeading(s) {
    const lv = lvOf(s);
    const dir = lv === 'easy' ? pick([0, 2, 4, 6]) : lv === 'normal' ? pick([2, 4, 6]) : 1 + rnd(7);
    const phi = (lv === 'easy' || s.north === 'fixed') ? 0 : rnd(8) * 45;
    return { type: 'heading', dir, phi, theta: norm(phi + dir * 45), level: lv };
  }
  function pickDistractors(cands, isValid, n) {
    const seen = new Set(); const out = [];
    for (const c of shuffle(cands.slice())) {
      const k = c.join(',');
      if (isValid(c) && !seen.has(k)) { seen.add(k); out.push(c); }
      if (out.length === n) break;
    }
    return out;
  }
  /* 種目2: 14 方向の絵 → 姿勢指示器。翼は常に水平なので、正解はバンク 0。
     誤答はバンクを付けたもの・ピッチを反転したもの・水平にしたもの。 */
  /* バンク: 設定 bank が 'off' でなければ、真上・真下を除く 12 方向で 0 / ±30 / ±60 から選ぶ（水平が 1/3） */
  const BANKS = [30, 60];
  const pickBank = (s, d) => (s.bank === 'off' || Math.abs(d.pitch) === 90) ? 0 : pick([0, 0, 30, -30, 60, -60]);
  /* 誤答は「機首の上下・水平」と「バンクの左右・水平」の区分が正解と必ず違うものだけ（絵からは角度の大きさまで読めないので、大きさだけが違う選択肢は出さない）。
     誤答の角度は正解と同じ大きさ（正解が水平なら 30°、真上・真下なら 30°）にそろえる */
  const cls = (b, p) => `${Math.sign(b)}/${Math.sign(p)}`;
  function attCands(bank, pitch) {
    const pm = pitch ? (Math.abs(pitch) === 90 ? 30 : Math.abs(pitch)) : 30, bm = bank ? Math.abs(bank) : 30, out = [];
    for (const bs of [-1, 0, 1]) for (const ps of [-1, 0, 1]) if (cls(bs, ps) !== cls(bank, pitch)) out.push([bs * bm, ps * pm]);
    return out;
  }
  /* 姿勢指示器の難易度
     easy: 機首は北の縦の面だけ（北・真上・真下）。上下と傾きは変わる
     medium: 14 方向すべて。翼は水平に固定
     hard: 14 方向すべて + バンク */
  function genAttitude(s) {
    const lv = lvOf(s);
    const pool = lv === 'easy' ? DIR14.filter(x => x.id === 'north' || x.id === 'up' || x.id === 'down') : DIR14;
    const d = pick(pool), pitch = d.pitch, bank = lv === 'normal' ? 0 : pickBank(s, d);
    const dis = pickDistractors(attCands(bank, pitch), () => true, 3);
    const opts = shuffle([{ bank, pitch, ok: true }, ...dis.map(([b, p]) => ({ bank: b, pitch: p, ok: false }))]);
    return { type: 'attitude', dir14: d, bank, pitch, opts, level: lv };
  }
  /* 複合: 14 方向のうち方位が定まる 12 方向 → 姿勢指示器＋方位指示器。誤答は「方位違い（姿勢は同じ）」と「姿勢の区分違い（方位は同じ）」を混ぜる */
  function genCombo(s) {
    /* 難易度: easy は東西南北のみ・水平（上下も傾きもなし）、medium は東西南北のみ（傾きあり）、hard は 12 方向すべて */
    const lv = lvOf(s);
    const pool = DIR14.filter(x => x.heading !== null && (lv === 'hard' || x.pitch === 0));
    const d = pick(pool), heading = d.heading, pitch = d.pitch, bank = lv === 'easy' ? 0 : pickBank(s, d);
    const hc = [heading + 180, 360 - heading, heading + 90, heading - 90, heading + 45, heading - 45].map(norm).filter(h => h !== heading).map(h => [h, bank, pitch]);
    const ac = attCands(bank, pitch).map(([b, p]) => [heading, b, p]);
    const cands = [...hc, ...ac, [norm(heading + 180), -bank, pitch]].filter(([h, b, p]) => !(h === heading && b === bank && p === pitch));
    const dis = pickDistractors(cands, () => true, 3);
    const opts = shuffle([{ heading, bank, pitch, ok: true }, ...dis.map(([h, b, p]) => ({ heading: h, bank: b, pitch: p, ok: false }))]);
    /* 方位指示器の印: むずかしいときだけ、機首の方位と重ならない方位を毎回抽選する。それ以外は北（N）に固定 */
    const mark = lv === 'hard' ? pick([0, 1, 2, 3, 4, 5, 6, 7].filter(i => i !== heading / 45)) : 0;
    return { type: 'combo', dir14: d, dir: heading / 45, heading, bank, pitch, mark, opts, level: lv };
  }
  /* 方向舵は機体の上下軸まわりに効く。機体が傾いていると、その軸も傾いているので、機首は水平面ではなく斜めに振れる
     （右バンクで右方向舵なら機首はやや沈む）。ヨーは cos(バンク) 倍、ピッチは −sin(バンク) 倍で効く */
  function applyOp(state, opId) {
    const o = OP_BY_ID[opId], e = o.effect;
    if (o.group === 'rudder') {
      const b = state.bank * D, r = e.yaw;
      return { bank: state.bank, pitch: state.pitch - r * Math.sin(b), yaw: state.yaw + r * Math.cos(b) };
    }
    return { bank: state.bank + (e.bank || 0), pitch: state.pitch + (e.pitch || 0), yaw: state.yaw + (e.yaw || 0) };
  }
  function genControl(s) {
    /* 出題は 1 操作（同じ操作を続ける）と 2 操作の混在。2 操作は「操縦桿 → 方向舵」の順に限る（利用者の指定）。
       同じ操作の繰り返しや左右の切り返し（左に倒して右に倒す等）は 2 操作としては出さない */
    const STICK = OPS.filter(o => o.group === 'stick'), RUDDER = OPS.filter(o => o.group === 'rudder');
    /* 難易度: easy は 1 操作だけ、medium は 1 操作と 2 操作の混在、hard は混在＋視界の目盛りなし */
    const lv = lvOf(s);
    const one = s.ops === 'single' || lv === 'easy' || (s.ops !== 'double' && Math.random() < 1 / 3);
    const first = one ? pick(OPS).id : pick(STICK).id;
    const ops = one ? [first, first] : [first, pick(RUDDER).id];
    const rand = s.init === 'random';
    const init = { bank: rand ? pick([-30, -15, 0, 15, 30]) : 0, pitch: rand ? pick([-10, 0, 10]) : 0, yaw: rand ? pick([-10, 0, 10]) : 0 };
    const frames = [init];
    for (const op of ops) frames.push(applyOp(frames[frames.length - 1], op));
    const single = ops[0] === ops[1];
    /* 4 択: 1 操作（6 通り）と「操縦桿 → 方向舵」（8 通り）を混ぜた中から、正解以外を誤答にする */
    const key = a => a.join('|');
    const cands = [];
    for (const o of OPS) cands.push([o.id, o.id]);
    if (lv !== 'easy' && s.ops !== 'single') for (const st of STICK) for (const rd of RUDDER) cands.push([st.id, rd.id]);
    const dis = pickDistractors(cands, c => key(c) !== key(ops), 3);
    const opts = shuffle([{ ops, ok: true }, ...dis.map(c => ({ ops: c, ok: false }))]).map(o => ({ ...o, text: opsText(o.ops) }));
    return { type: 'control', ops, frames, init, single, opts, level: lv, hud: lv !== 'hard' };
  }
  function generate(mode, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings);
    return mode === 'heading' ? genHeading(s) : mode === 'attitude' ? genAttitude(s) : mode === 'combo' ? genCombo(s) : genControl(s);
  }

  /* ---------- 採点と解説 ---------- */
  const bankText = b => b > 0 ? `右バンク${b}°` : b < 0 ? `左バンク${-b}°` : '水平（バンクなし）';
  const pitchText = p => p > 0 ? `機首上げ${p}°` : p < 0 ? `機首下げ${-p}°` : '水平（ピッチなし）';

  function gradeHeading(q, dir) {
    const ok = dir === q.dir;
    const lines = q.dir === 0 ? ['機首が N マークと同じ向き → 北。']
      : [`N マークから時計回りに 45° ずつ数えます。機首は N から ${q.dir * 45}° の方向。`];
    if (q.phi) lines.push('北が上ではないので、画面の上下ではなく N マークを基準に読み替えます。');
    return { ok, correct: q.dir, answerText: `${DIRS[q.dir].ja}（${DIRS[q.dir].k}）`, lines };
  }
  function gradeOpts(q, i) {
    const ci = q.opts.findIndex(o => o.ok), ok = i === ci;
    const { pitch, bank } = q, d = q.dir14;
    const lines = [d.read];
    if (bank) lines.push(`${bankText(bank)}：機首の向きに対して${bank > 0 ? '右' : '左'}の翼が下がっている（南から見た絵では、機首がこちらを向くほど左右が逆に見える）。姿勢指示器では水平線が${bank > 0 ? '右上がり' : '左上がり'}に傾く。`);
    else lines.push('翼が水平なのでバンクなし。水平線が傾いている選択肢は誤り。');
    lines.push(pitch > 0 ? '機首上げ：姿勢指示器では水平線が中心より下がり、空（青）の面積が増える。' : pitch < 0 ? '機首下げ：水平線が中心より上がり、地面（茶）の面積が増える。' : '水平飛行：水平線が中心を通る。');
    let answerText = `${'ABCD'[ci]}（機首 ${d.ja}：${bank ? bankText(bank) + '、' : ''}${pitchText(pitch)}`;
    if (q.type === 'combo') {
      const NPOS = ['真上', '右上', '右', '右下', '真下', '左下', '左', '左上'];
      const m = ((q.mark || 0) - q.dir + 8) % 8;
      lines.push(`方位：${DIRS[q.dir].ja}（${DIRS[q.dir].k}）。機首は常に上を向き、方位指示器の ${DIRS[q.mark || 0].k}（${DIRS[q.mark || 0].ja}）の印は ${NPOS[m]} に来ます。印を付ける方位は毎回変わります。`);
      answerText += ` / ${DIRS[q.dir].ja}`;
    }
    return { ok, correct: ci, answerText: answerText + '）', lines };
  }
  function gradeControl(q, i) {
    const ci = q.opts.findIndex(o => o.ok), ok = i === ci;
    if (q.single) {
      const o = OP_BY_ID[q.ops[0]], b = q.frames[0].bank;
      let v = o.view;
      if (o.group === 'rudder' && Math.abs(b) > 1) v = `水平線の傾きは変わらないまま景色が${o.effect.yaw > 0 ? '左' : '右'}へ流れ、${(o.effect.yaw > 0) === (b > 0) ? '少し上がる（機首が沈む）' : '少し下がる（機首が上がる）'}`;
      return { ok, correct: ci, answerText: `${'ABCD'[ci]}（${opsText(q.ops)}）`,
        lines: [`①→②→③：同じ向きに変化が続いている。${v} → ${o.body} → ${o.base}。`, '途中で操作が変わっていないので、操作は 1 つです。'] };
    }
    const lines = q.ops.map((id, k) => {
      const o = OP_BY_ID[id], b = q.frames[k].bank;
      let v = o.view, body = o.body;
      if (o.group === 'rudder' && Math.abs(b) > 1) {
        const right = o.effect.yaw > 0, down = right === (b > 0);
        v = `水平線の傾きは変わらないまま景色が${right ? '左' : '右'}へ流れ、${down ? '少し上がる（機首が沈む）' : '少し下がる（機首が上がる）'}`;
        body = `機体の上下軸まわりに${right ? '右' : '左'}を向き、傾いているぶん機首が${down ? '沈む' : '上がる'}`;
      }
      return `${'①②③'[k]}→${'①②③'[k + 1]}：${v} → ${body} → ${o.base}。`;
    });
    if (q.ops.some((id, k) => OP_BY_ID[id].group === 'rudder' && Math.abs(q.frames[k].bank) > 1))
      lines.push('方向舵は機体の上下軸まわりに効くので、機体が傾いているときは機首が水平面ではなく斜めに振れます（傾いた側へ沈む）。');
    if (q.init.bank || q.init.pitch || q.init.yaw) lines.push('①の時点で既に傾いている場合でも、答えるのは各区間での変化を生む操作です。');
    return { ok, correct: ci, answerText: `${'ABCD'[ci]}（${opsText(q.ops)}）`, lines };
  }

  /* ---------- 描画: 上面図 ---------- */
  const JET_TOP = '<path d="M0,-62 L7,-34 L9,-6 L44,18 L44,26 L10,20 L9,34 L23,44 L23,50 L4,46 L0,54 L-4,46 L-23,50 L-23,44 L-9,34 L-10,20 L-44,26 L-44,18 L-9,-6 L-7,-34 Z" fill="var(--jet, #b9c2cc)" stroke="var(--jet-line, #66717d)" stroke-width="2" stroke-linejoin="round"/><ellipse cx="0" cy="-22" rx="4.5" ry="12" fill="var(--canopy, #3d7fbf)"/><path d="M0,-6 L0,34" stroke="var(--jet-line, #66717d)" stroke-width="1.5"/>';
  /* すべての描画関数は width=100% の SVG を返す。実寸は親要素の幅（%・vw 等）で決める。 */
  function svgTopDown(theta, phi) {
    const ticks = [0, 45, 90, 135, 180, 225, 270, 315].map(a =>
      `<line x1="0" y1="-150" x2="0" y2="${a % 90 == 0 ? -136 : -142}" stroke="${a == 0 ? 'var(--accent)' : 'var(--faint)'}" stroke-width="${a % 90 == 0 ? 3 : 1.5}" transform="rotate(${a})"/>`).join('');
    return `<svg viewBox="-160 -160 320 320" width="100%" style="aspect-ratio:1;display:block" role="img" aria-label="上面図">
<circle r="150" fill="var(--panel2)" stroke="var(--line2)"/><circle r="100" fill="none" stroke="var(--line)" stroke-dasharray="3 5"/>
<g transform="rotate(${phi})">${ticks}<polygon points="0,-150 -9,-124 0,-131 9,-124" fill="var(--accent)"/><text y="-104" text-anchor="middle" font-family="var(--display)" font-weight="700" font-size="22" fill="var(--accent)">N</text></g>
<g transform="rotate(${theta})">${JET_TOP}</g></svg>`;
  }

  /* ---------- 描画: 第三者視点 3D ---------- */
  function jetModel() {
    const w = 0.45, h = 0.38, zb = -3.4, zf = 1.8, zn = 5.2, F = '#aab4be', W = '#98a3ad', T = '#8e99a4', C = '#62a9e6';
    const P = []; const add = (pts, c, bias) => P.push({ pts, c, bias: bias || 0 });
    add([[-w, h, zb], [w, h, zb], [w, h, zf], [-w, h, zf]], F);
    add([[-w, -h, zb], [w, -h, zb], [w, -h, zf], [-w, -h, zf]], F);
    add([[w, -h, zb], [w, h, zb], [w, h, zf], [w, -h, zf]], F);
    add([[-w, -h, zb], [-w, h, zb], [-w, h, zf], [-w, -h, zf]], F);
    add([[-w, -h, zb], [w, -h, zb], [w, h, zb], [-w, h, zb]], '#3a424b');
    add([[-w, h, zf], [w, h, zf], [0, 0, zn]], F);
    add([[-w, -h, zf], [w, -h, zf], [0, 0, zn]], F);
    add([[w, h, zf], [w, -h, zf], [0, 0, zn]], F);
    add([[-w, h, zf], [-w, -h, zf], [0, 0, zn]], F);
    add([[w, -0.05, 1.0], [3.6, -0.05, -1.7], [3.6, -0.05, -2.4], [w, -0.05, -2.4]], W);
    add([[-w, -0.05, 1.0], [-3.6, -0.05, -1.7], [-3.6, -0.05, -2.4], [-w, -0.05, -2.4]], W);
    add([[3.3, -0.05, -1.95], [3.6, -0.05, -1.7], [3.6, -0.05, -2.4], [3.3, -0.05, -2.4]], '#35e07a', -0.5);
    add([[-3.3, -0.05, -1.95], [-3.6, -0.05, -1.7], [-3.6, -0.05, -2.4], [-3.3, -0.05, -2.4]], '#ff5252', -0.5);
    add([[w, 0.05, -2.5], [1.7, 0.05, -3.3], [1.7, 0.05, -3.6], [w, 0.05, -3.6]], T);
    add([[-w, 0.05, -2.5], [-1.7, 0.05, -3.3], [-1.7, 0.05, -3.6], [-w, 0.05, -3.6]], T);
    add([[0, h, -1.6], [0, 2.2, -3.0], [0, 2.2, -3.5], [0, h, -3.5]], T);
    const cw = 0.3, ct = h + 0.45;
    add([[-cw, ct, 0.3], [cw, ct, 0.3], [cw, ct, 2.2], [-cw, ct, 2.2]], C);
    add([[cw, h, 0.3], [cw, ct, 0.3], [cw, ct, 2.2], [cw, h, 3.0]], C);
    add([[-cw, h, 0.3], [-cw, ct, 0.3], [-cw, ct, 2.2], [-cw, h, 3.0]], C);
    add([[-cw, ct, 2.2], [cw, ct, 2.2], [cw, h, 3.0], [-cw, h, 3.0]], C);
    add([[-cw, h, 0.3], [cw, h, 0.3], [cw, ct, 0.3], [-cw, ct, 0.3]], C);
    return P;
  }
  const MODEL = jetModel();
  const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const shade = (hex, f) => { const [r, g, b] = hexRgb(hex).map(v => Math.max(0, Math.min(255, Math.round(v * f)))); return `rgb(${r},${g},${b})`; };
  function svg3D(bank, pitch, front) {
    const cr = Math.cos(bank * D), sr = Math.sin(bank * D), cp = Math.cos(pitch * D), sp = Math.sin(pitch * D);
    const yaw = front ? 180 : 0, cy = Math.cos(yaw * D), sy = Math.sin(yaw * D);
    const az = 26 * D, el = 18 * D, ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    const tf = ([x, y, z]) => {
      const x1 = x * cr + y * sr, y1 = -x * sr + y * cr, z1 = z;
      const x2 = x1, y2 = y1 * cp + z1 * sp, z2 = -y1 * sp + z1 * cp;
      const x3 = x2 * cy + z2 * sy, y3 = y2, z3 = -x2 * sy + z2 * cy;
      const xv = x3 * ca + z3 * sa, yv = y3, zv = -x3 * sa + z3 * ca;
      return [xv, yv * ce + zv * se, -yv * se + zv * ce];
    };
    const L = [-0.35, 0.85, -0.4]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
    const S = 27, CX = 180, CY = 128;
    const polys = MODEL.map(p => {
      const v = p.pts.map(tf);
      const a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const nl = Math.hypot(...n) || 1;
      const dot = Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
      const depth = v.reduce((s, q) => s + q[2], 0) / v.length + p.bias;
      const pts = v.map(q => `${(CX + q[0] * S).toFixed(1)},${(CY - q[1] * S).toFixed(1)}`).join(' ');
      return { pts, depth, fill: shade(p.c, 0.5 + 0.5 * dot), stroke: shade(p.c, 0.35) };
    }).sort((a, b) => b.depth - a.depth);
    const body = polys.map(p => `<polygon points="${p.pts}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="0.8" stroke-linejoin="round"/>`).join('');
    return `<svg viewBox="0 0 360 250" width="100%" style="aspect-ratio:360/250;display:block" role="img" aria-label="第三者視点">
<rect width="360" height="98" fill="var(--sky)"/><rect y="98" width="360" height="152" fill="var(--earth)"/>
<line x1="0" x2="360" y1="98" y2="98" stroke="#fff" stroke-width="1.5" opacity=".9"/>
${[112, 132, 158, 192, 232].map((y, i) => `<line x1="0" x2="360" y1="${y}" y2="${y}" stroke="#000" opacity="${.06 + i * .02}"/>`).join('')}
${body}<rect x="0.5" y="0.5" width="359" height="249" fill="none" stroke="var(--line2)"/></svg>`;
  }

  /* ---------- 描画: 計器 ---------- */
  function svgAI(bank, pitch) {
    const id = 'ai' + (++uid), k = 2.4;
    const ladder = [-80, -70, -60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80].map(p => {
      const y = -p * k, w = Math.abs(p) % 20 == 0 ? 34 : 20;
      return `<line x1="${-w}" y1="${y}" x2="${w}" y2="${y}" stroke="#fff" stroke-width="2"/><text x="${w + 5}" y="${y + 4}" font-size="11" fill="#fff" font-family="var(--mono)">${Math.abs(p)}</text><text x="${-w - 5}" y="${y + 4}" font-size="11" fill="#fff" text-anchor="end" font-family="var(--mono)">${Math.abs(p)}</text>`;
    }).join('');
    const scale = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map(a =>
      `<line x1="0" y1="-90" x2="0" y2="${Math.abs(a) % 30 == 0 ? -78 : -83}" stroke="#fff" stroke-width="${a == 0 ? 3 : 2}" transform="rotate(${a})"/>`).join('');
    return `<svg viewBox="-100 -100 200 200" width="100%" style="aspect-ratio:1;display:block" role="img" aria-label="姿勢指示器">
<defs><clipPath id="${id}"><circle r="90"/></clipPath></defs><circle r="97" fill="var(--bezel, #0a0d11)"/>
<g clip-path="url(#${id})"><g class="ai-h" transform="rotate(${-bank}) translate(0 ${(pitch * k).toFixed(1)})">
<rect x="-400" y="-500" width="800" height="500" fill="var(--sky)"/><rect x="-400" y="0" width="800" height="500" fill="var(--earth)"/>
<line x1="-400" x2="400" y1="0" y2="0" stroke="#fff" stroke-width="2.5"/>${ladder}</g>
<g class="ai-p" transform="rotate(${-bank})"><polygon points="0,-90 -7,-77 7,-77" fill="#fff"/></g>${scale}</g>
<path d="M-44,0 H-16 L-8,8 L0,0 L8,8 L16,0 H44" stroke="var(--accent)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<circle r="92" fill="none" stroke="var(--bezel, #0a0d11)" stroke-width="6"/><circle r="96" fill="none" stroke="var(--line2)" stroke-width="2"/></svg>`;
  }
  function svgHI(heading, mark = 0) {
    /* 目盛りは 10° 刻み、印は 1 箇所だけ（方位モードの上面図の N マークと同じ読み方にそろえる）。
       mark は印を付ける方位（0=N, 1=NE, … 45° 刻み）。出題ごとに変わり、機首の方位とは重ならない。
       目盛りは 8 方位のぶんだけ（45° 刻み。方位モードの上面図と同じ） */
    let card = '';
    for (let i = 0; i < 8; i++) {
      const a = i * 45, major = i % 2 == 0;
      card += `<line x1="0" y1="-88" x2="0" y2="${major ? -72 : -78}" stroke="var(--inst-ink, #fff)" stroke-width="${major ? 3 : 2}" transform="rotate(${a})"/>`;
    }
    const mk = DIRS[((mark % 8) + 8) % 8].k;
    card += `<g transform="rotate(${mark * 45})"><polygon points="0,-86 -7,-68 7,-68" fill="var(--accent)"/><text y="-44" text-anchor="middle" font-size="${mk.length > 1 ? 17 : 22}" font-weight="700" font-family="var(--display)" fill="var(--accent)">${mk}</text></g>`;
    return `<svg viewBox="-100 -100 200 200" width="100%" style="aspect-ratio:1;display:block" role="img" aria-label="方位指示器">
<circle r="97" fill="var(--bezel, #0a0d11)"/><circle r="90" fill="var(--card, #1a2027)"/><circle r="90" fill="none" stroke="var(--line2)" stroke-width="1"/><g class="hi-c" transform="rotate(${-heading})">${card}</g>
<path d="M0,-30 L4,-16 L4,-2 L22,8 L22,13 L4,7 L4,16 L11,21 L11,25 L0,22 L-11,25 L-11,21 L-4,16 L-4,7 L-22,13 L-22,8 L-4,-2 L-4,-16 Z" fill="var(--accent)" opacity=".9"/>
<polygon points="0,-96 -7,-84 7,-84" fill="var(--accent)"/><circle r="92" fill="none" stroke="var(--bezel, #0a0d11)" stroke-width="6"/><circle r="96" fill="none" stroke="var(--line2)" stroke-width="2"/></svg>`;
  }

  /* ---------- 描画: コックピット視界 ---------- */
  const PEAKS = (() => { const h = [22, 40, 18, 55, 30, 72, 26, 48, 20, 64, 36, 28, 58, 24, 44, 30, 68, 22, 50, 34, 26, 60, 18, 42, 30, 54, 20, 46, 38, 24]; return h.map((v, i) => [-870 + i * 60, -v]); })();
  /* 星: 夜間だけ描く（昼は fill none）。位置は固定で、ヨーやバンクに合わせて景色と一緒に動く */
  const STARS = (() => { let x = 7; const r = () => (x = (x * 48271) % 2147483647) / 2147483647; let out = ''; for (let i = 0; i < 70; i++) out += `<circle cx="${(-600 + r() * 1200).toFixed(0)}" cy="${(-40 - r() * 300).toFixed(0)}" r="${(0.8 + r() * 1.4).toFixed(1)}"/>`; return out; })();
  /* progress: 前進の度合い 0..1。時間が進むと機体が前進し、景色（山・塔・太陽）が大きく見える */
  /* 空は上（--ck-sky-top）から水平線（--ck-sky-hz）への縦グラデーション。日の出・夕焼けで水平線付近だけ色づく。未定義なら --ck-sky → --sky */
  /* marks: true で目印を描く（雪山の頂と塔の先端にオレンジの輪、①の水平線の位置に破線）。見え方の確認画面用 */
  function svgCockpit(bank, pitch, yaw, progress = 0, marks = false, hud = true) {
    const id = 'ck' + (++uid), kp = 5, ky = 6, sc = (1 + 0.45 * progress).toFixed(3);
    const mk = marks ? '<circle cx="-90" cy="-72" r="16" fill="none" stroke="#f2a93b" stroke-width="3"/><circle cx="230" cy="-42" r="14" fill="none" stroke="#f2a93b" stroke-width="3"/>' : '';
    const ref = marks ? '<line x1="16" x2="344" y1="108" y2="108" stroke="#f2a93b" stroke-width="2" stroke-dasharray="7 6" opacity=".9"/><text x="20" y="102" font-size="11" font-family="var(--mono)" fill="#f2a93b">①の水平線</text>' : '';
    const mtn = 'M-900,0 ' + PEAKS.map(p => `L${p[0]},${p[1]}`).join(' ') + ' L900,0 Z';
    const ground = [10, 22, 38, 60, 90, 130, 180].map((y, i) => `<line x1="-900" x2="900" y1="${y}" y2="${y}" stroke="#000" opacity="${.08 + i * .02}"/>`).join('');
    return `<svg viewBox="0 0 360 240" width="100%" style="aspect-ratio:360/240;display:block" role="img" aria-label="コックピットからの視界">
<defs><clipPath id="${id}"><path d="M16,40 Q180,4 344,40 L344,182 L16,182 Z"/></clipPath><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ck-sky-top, var(--ck-sky, var(--sky)))"/><stop offset="1" style="stop-color:var(--ck-sky-hz, var(--ck-sky, var(--sky)))"/></linearGradient></defs><rect width="360" height="240" fill="var(--bezel, #0a0d11)"/>
<g clip-path="url(#${id})"><g class="ck-att" transform="translate(180 108) rotate(${-bank}) translate(0 ${(pitch * kp).toFixed(1)})">
<rect x="-900" y="-900" width="1800" height="900" fill="url(#${id}s)"/><rect x="-900" y="0" width="1800" height="900" fill="var(--ck-earth, var(--earth))"/>${ground}
<g class="ck-yaw" transform="translate(${(-yaw * ky).toFixed(1)} 0) scale(${sc})"><g fill="var(--ck-star, none)">${STARS}</g><circle cx="110" cy="-96" r="15" fill="var(--ck-sun, #ffd36b)"/><path d="${mtn}" fill="var(--ck-mtn, #4a5c70)"/>
<path d="M-130,0 L-90,-72 L-50,0 Z" fill="var(--ck-mtn2, #65788d)"/><path d="M-100,-54 L-90,-72 L-80,-54 L-90,-58 Z" fill="var(--ck-snow, #e8eef4)"/>
<rect x="228" y="-40" width="4" height="40" fill="#2b333c"/><rect x="220" y="-46" width="20" height="8" fill="#e2574f"/>${mk}</g>
<line x1="-900" x2="900" y1="0" y2="0" stroke="#fff" stroke-width="1.5" opacity=".8"/></g></g>
${ref}${hud ? '<g stroke="var(--hud, #7cf59a)" stroke-width="2" fill="none"><line x1="180" y1="98" x2="180" y2="118"/><line x1="170" y1="108" x2="190" y2="108"/><path d="M118,108 h32 v8 M242,108 h-32 v8"/></g>' : ''}
<path d="M16,40 Q180,4 344,40 L344,182 L16,182 Z" fill="none" stroke="var(--line)" stroke-width="4"/>
<path d="M0,240 L0,190 Q180,170 360,190 L360,240 Z" fill="var(--glare, #1a2027)"/><path d="M0,192 Q180,172 360,192" fill="none" stroke="var(--line2)" stroke-width="3"/></svg>`;
  }

  /* ---------- 描画: T-4 イラスト版（上面図・後方/前方図・側面図を回転して使う） ---------- */
  const IMG = 'img/t4-';
  function figTopDown(theta, phi) {
    /* 上面図は 3D モデルを真上から描画したもの（機首が上＝北）。theta をそのまま回転に使う */
    const ticks = [0, 90, 180, 270].map(a => `<line x1="100" y1="14" x2="100" y2="24" stroke="var(--faint)" stroke-width="2" transform="rotate(${a} 100 100)"/>`).join('') +
      [45, 135, 225, 315].map(a => `<line x1="100" y1="14" x2="100" y2="22" stroke="var(--faint)" stroke-width="2" transform="rotate(${a} 100 100)"/>`).join('');
    return `<svg viewBox="0 0 200 200" width="100%" style="aspect-ratio:1;display:block" role="img" aria-label="上面図">
<circle cx="100" cy="100" r="96" fill="var(--bezel)"/><circle cx="100" cy="100" r="88" fill="var(--card)" stroke="var(--line2)" stroke-width="1"/>${ticks}
<g transform="rotate(${phi} 100 100)"><polygon points="100,13 94,27 106,27" fill="var(--accent)"/><text x="100" y="42" text-anchor="middle" font-family="var(--mono)" font-size="14" font-weight="700" fill="var(--accent)">N</text></g>
<image href="img/t4-top.webp" x="28" y="28" width="144" height="144" preserveAspectRatio="xMidYMid meet" transform="rotate(${theta} 100 100)"/></svg>`;
  }
  function figAttitude(bank, pitch, front, sideRight) {
    /* バンク: 後方図は時計回り = 右バンク。前方図は左右が逆に見えるので符号反転。
       ピッチ: 左側面図（機首が左）は機首上げで反時計回り。右側面図（機首が右）は時計回り。 */
    const bankRot = front ? -bank : bank;
    const pitchRot = sideRight ? pitch : -pitch;
    const panel = (img, rot, label) => `<div class="attp"><svg viewBox="0 0 200 200" width="100%" style="aspect-ratio:1;display:block" role="img" aria-label="${label}">
<rect width="200" height="100" fill="var(--sky3)"/><rect y="100" width="200" height="100" fill="var(--earth3)"/><line x1="0" x2="200" y1="100" y2="100" stroke="var(--muted)" stroke-width="1"/>
${[112, 128, 150, 178].map((y, i) => `<line x1="0" x2="200" y1="${y}" y2="${y}" stroke="#000" opacity="${.08 + i * .03}"/>`).join('')}
<image href="${IMG}${img}.png" x="12" y="30" width="176" height="140" preserveAspectRatio="xMidYMid meet" transform="rotate(${rot} 100 100)"/></svg></div>`;
    return `<div class="att">${panel(front ? 'front' : 'rear', bankRot, front ? '前方から見た図' : '後方から見た図')}${panel(sideRight ? 'right' : 'left', pitchRot, sideRight ? '右側面から見た図' : '左側面から見た図')}</div>`;
  }

  /* 14 方向の絵（南からの固定視点）と読み方の凡例 */
  /* bank: 0 なら bi-<id>.webp、右バンク 30 なら bi-<id>-r30.webp、左バンク 60 なら bi-<id>-l60.webp */
  function figDir14(d, bank = 0) {
    const suffix = bank ? `-${bank > 0 ? 'r' : 'l'}${Math.abs(bank)}` : '';
    return `<div class="d14"><img src="img/bi-${d.id}${suffix}.webp" alt="第三者視点（南から）" style="width:100%;height:auto;display:block">
<svg class="d14legend" viewBox="0 0 76 54" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 44V14M13 19l5-5 5 5"/><path d="M18 44h36M49 39l5 5-5 5"/><path d="M18 44l14-11M27 33l5-0 0 5"/></g>
<g font-family="var(--mono)" font-size="10" font-weight="700" fill="currentColor"><text x="18" y="10" text-anchor="middle">上</text><text x="58" y="48">東</text><text x="36" y="30">北</text></g></svg></div>`;
  }

  global.AAT = { DIRS, DIR14, BANKS, MODES, OPS, OP_BY_ID, HI_LABELS, LEVELS, DEFAULT_SETTINGS, CK, generate, applyOp, opsText,
    gradeHeading, gradeOpts, gradeControl, bankText, pitchText, svgTopDown, svg3D, svgAI, svgHI, svgCockpit, figTopDown, figAttitude, figDir14 };
})(window);
