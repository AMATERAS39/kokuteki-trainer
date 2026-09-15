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
  /* base: 文末形、cont: 連用形（「〜し、」でつなぐ）、view: 見え方（短く。解説・見え方の一覧・アプリ説明で使う） */
  const OPS = [
    { id: 'stick-right', ja: '操縦桿 右', base: '操縦桿を右に倒す', cont: '操縦桿を右に倒し', group: 'stick', view: '景色が左に傾く' },
    { id: 'stick-left', ja: '操縦桿 左', base: '操縦桿を左に倒す', cont: '操縦桿を左に倒し', group: 'stick', view: '景色が右に傾く' },
    { id: 'stick-forward', ja: '操縦桿 奥', base: '操縦桿を奥に倒す', cont: '操縦桿を奥に倒し', group: 'stick', view: '水平線が上がる' },
    { id: 'stick-back', ja: '操縦桿 手前', base: '操縦桿を手前に引く', cont: '操縦桿を手前に引き', group: 'stick', view: '水平線が下がる' },
    { id: 'rudder-right', ja: 'ヨー 右', base: '右方向舵を踏む', cont: '右方向舵を踏み', group: 'rudder', view: '目印が左へ流れる' },
    { id: 'rudder-left', ja: 'ヨー 左', base: '左方向舵を踏む', cont: '左方向舵を踏み', group: 'rudder', view: '目印が右へ流れる' }
  ];
  /* 見え方の一覧だけの「おまけ」: 操縦桿の斜め（ロールと機首の上げ下げの同時）。出題（OPS）には入れない（利用者の指示 2026-09-16。断定はできないが、ほぼ試験には出ないと思われる） */
  const EXTRA_OPS = [
    { id: 'stick-forward-left', ja: '操縦桿 左奥', base: '操縦桿を左奥に倒す', cont: '操縦桿を左奥に倒し', group: 'stick', view: '景色が右に傾きながら水平線が上がる' },
    { id: 'stick-forward-right', ja: '操縦桿 右奥', base: '操縦桿を右奥に倒す', cont: '操縦桿を右奥に倒し', group: 'stick', view: '景色が左に傾きながら水平線が上がる' },
    { id: 'stick-back-left', ja: '操縦桿 左手前', base: '操縦桿を左手前に引く', cont: '操縦桿を左手前に引き', group: 'stick', view: '景色が右に傾きながら水平線が下がる' },
    { id: 'stick-back-right', ja: '操縦桿 右手前', base: '操縦桿を右手前に引く', cont: '操縦桿を右手前に引き', group: 'stick', view: '景色が左に傾きながら水平線が下がる' }
  ];
  const OP_BY_ID = Object.fromEntries([...OPS, ...EXTRA_OPS].map(o => [o.id, o]));
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
  const LEVELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard', max: 'Max' };   // Max は操縦操作だけ
  const lvOf = s => s.level === 'medium' ? 'normal' : (s.level || 'hard');   // medium は旧称。max は操縦操作だけ（ほかの種目では hard として扱う）
  /* 画面の姿勢指示器のリアルタイム更新に使う係数（svgAI と同じ値） */
  const CK = { aiK: 2.4 };   // 画面の姿勢指示器の係数（svgAI と同じ）

  /* ---------- 出題生成 ---------- */
  /* N マークの向きと機首の向きが一致すると答えが自明になるので、機首は N と別の向きだけを出題する（dir≠0）。
     N マークは 8 方位（45° 刻み、上を含む）のいずれかにランダムに置く。 */
  /* 方位の難易度
     easy: 答えは東西南北のみ、N マークは上に固定（機首と同じ向きになってもよい）
     normal: 答えは東西南北のみ、N マークはランダム（機首とは重ならない）
     hard: 答えは 8 方位、印は N とは限らない（8 方位のどれか。本番と同じ。利用者の指示 2026-09-14）、印の向きはランダム、機首は印の方位とは重ならない
     mark: 印の方位（DIRS の番号）、phi: 印を描く向き（画面の上から時計回り、度）、theta: 機首を描く向き。北は phi − 45·mark にある */
  function genHeading(s) {
    if (s.level === 'max') s = Object.assign({}, s, { level: 'hard' });
    const lv = lvOf(s);
    const mark = lv === 'hard' ? rnd(8) : 0;
    const dir = lv === 'easy' ? pick([0, 2, 4, 6]) : lv === 'normal' ? pick([2, 4, 6]) : (mark + 1 + rnd(7)) % 8;
    const phi = (lv === 'easy' || s.north === 'fixed') ? 0 : rnd(8) * 45;
    return { type: 'heading', dir, mark, phi, theta: norm(phi - mark * 45 + dir * 45), level: lv };
  }
  function pickDistractors(cands, isValid, n) {
    /* n が 0 のときに全部返していた（`out.length === n` を押してから見ていた）。枕が 3 つ取れた Hard・Max の問題で選択肢が 14 個になった（利用者の指摘 2026-09-13） */
    const seen = new Set(); const out = [];
    if (n <= 0) return out;
    for (const c of shuffle(cands.slice())) {
      const k = c.join(',');
      if (isValid(c) && !seen.has(k)) { seen.add(k); out.push(c); }
      if (out.length >= n) break;
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
  function attCands(bank, pitch, pmOverride) {
    const pm = pmOverride || (pitch ? (Math.abs(pitch) === 90 ? 30 : Math.abs(pitch)) : 30), bm = bank ? Math.abs(bank) : 30, out = [];
    for (const bs of [-1, 0, 1]) for (const ps of [-1, 0, 1]) if (cls(bs, ps) !== cls(bank, pitch)) out.push([bs * bm, ps * pm]);
    return out;
  }
  /* 姿勢指示器の難易度
     easy: 機首は北の縦の面だけ（北・真上・真下）。上下と傾きは変わる
     medium: 14 方向すべて。翼は水平に固定
     hard: 14 方向すべて + バンク */
  function genAttitude(s) {
    if (s.level === 'max') s = Object.assign({}, s, { level: 'hard' });
    const lv = lvOf(s);
    const pool = lv === 'easy' ? DIR14.filter(x => x.id === 'north' || x.id === 'up' || x.id === 'down') : DIR14;
    const d = pick(pool), pitch = d.pitch, bank = lv === 'normal' ? 0 : pickBank(s, d);
    /* 誤答の組み方（点検 2026-09-13: 選択肢の並びだけで Easy 92%・Normal 71%・Hard 45% 当たっていた。当てずっぽうは 25%）
       - 真上・真下: 反対の ±90 を必ず混ぜる。以前は誤答がすべて ±30 だったので「±90 の選択肢があればそれが正解」だった（28,483/28,483）
       - Easy: 答えは北（ピッチ 0）か真上・真下。誤答のピッチも 0 か ±90 にそろえる（±30 の誤答は「必ず誤答」と分かっていた）
       - Normal: 翼は水平なので、傾いた誤答は「必ず誤答」と分かる。傾いた誤答は 1 つまでにし、残りは水平でピッチの区分が違うもの */
    let dis;
    if (Math.abs(pitch) === 90) {
      const rest = attCands(bank, pitch, lv === 'easy' ? 90 : undefined).filter(([b, p]) => !(b === 0 && p === -pitch));
      dis = [[0, -pitch], ...pickDistractors(rest, () => true, 2)];
    } else if (lv === 'easy') dis = pickDistractors(attCands(bank, pitch, 90), () => true, 3);
    else if (lv === 'normal') {
      const c = attCands(bank, pitch);
      dis = [...pickDistractors(c.filter(([b]) => b === 0), () => true, 2), ...pickDistractors(c.filter(([b]) => b !== 0), () => true, 1)];
    } else dis = pickDistractors(attCands(bank, pitch), () => true, 3);
    const opts = shuffle([{ bank, pitch, ok: true }, ...dis.map(([b, p]) => ({ bank: b, pitch: p, ok: false }))]);
    return { type: 'attitude', dir14: d, bank, pitch, opts, level: lv };
  }
  /* 複合: 14 方向のうち方位が定まる 12 方向 → 姿勢指示器＋方位指示器。誤答は「方位違い（姿勢は同じ）」と「姿勢の区分違い（方位は同じ）」を混ぜる */
  function genCombo(s) {
    if (s.level === 'max') s = Object.assign({}, s, { level: 'hard' });
    /* 難易度: easy は東西南北のみ・水平（上下も傾きもなし）、medium は東西南北のみ（傾きあり）、hard は 12 方向すべて */
    const lv = lvOf(s);
    const pool = DIR14.filter(x => x.heading !== null && (lv === 'hard' || x.pitch === 0));
    const d = pick(pool), heading = d.heading, pitch = d.pitch, bank = lv === 'easy' ? 0 : pickBank(s, d);
    /* 誤答は 2×2 の格子で組む: 方位 {正解, 別} × 姿勢 {正解, 別} の 4 つから正解を除いた 3 つ。
       どの選択肢も「方位を 1 つ、姿勢を 1 つ、他と共有する」対称な形になる。
       以前は「方位だけ違う」「姿勢だけ違う」を混ぜていたため、正解だけが方位も姿勢も他と共有する「ハブ」になり、
       絵を見ずに選択肢の並びだけで Easy 99%・Normal 94%・Hard 92% 当たった（点検 2026-09-13、30 万問の交差検証）。
       Easy・Normal の答えは東西南北なので、誤答の方位も東西南北から取る（斜めの誤答は「必ず誤答」と分かっていた） */
    let hAlt = [...new Set([heading + 180, 360 - heading, heading + 90, heading - 90, heading + 45, heading - 45].map(norm))].filter(h => h !== heading);
    if (lv !== 'hard') hAlt = hAlt.filter(h => h % 90 === 0);
    const h2 = pick(hAlt), [b2, p2] = pick(attCands(bank, pitch));
    const dis = [[h2, bank, pitch], [heading, b2, p2], [h2, b2, p2]];
    const opts = shuffle([{ heading, bank, pitch, ok: true }, ...dis.map(([h, b, p]) => ({ heading: h, bank: b, pitch: p, ok: false }))]);
    /* 方位指示器の印: むずかしいときだけ、機首の方位と重ならない方位を毎回抽選する。それ以外は北（N）に固定 */
    const mark = lv === 'hard' ? pick([0, 1, 2, 3, 4, 5, 6, 7].filter(i => i !== heading / 45)) : 0;
    return { type: 'combo', dir14: d, dir: heading / 45, heading, bank, pitch, mark, opts, level: lv };
  }
  /* 操縦操作の①②③は、飛行モデル（flight.js）で機体を動かして得る。利用者の原則（2026-09-13）:
     「試験では本物の機体から実際に撮影された景色が画像として出題される。出題・解説・動きの見え方は実機と全く同じ動きを再現する」
     「動かすべきは世界ではなく、機体である」。
     以前（v05.12 まで）は「操作 1 つ＝機体の軸まわりの回転 1 つ」（applyOp: バンク 20°・ピッチ 8°・ヨー 10°）で景色を回していた。
     いまは、操作を舵の入力として入れ、重力ありの物理で EXAM_DT 秒ずつ飛ばす。傾いていれば旋回して目印が横へ流れ、引けば上昇し、方向舵では機首が先に振れる——実機どおり。
     速さは flight.js の EXAM.V（200 m/s、T-4 の巡航に近い速い想定）。バンクによる旋回率は g·tanφ/V で速さに反比例し、遅い想定ほど傾いているだけで目印が横へ流れる（利用者の判断）。
     状態 { bank, pitch, yaw } の pitch は機首の上下（経路ではない）、yaw は方位。svgCockpit はこの姿勢に固定したカメラの絵 */
  const F = () => global.AAT_FLIGHT;
  const EXAM_DT = 2;                      // 写真の間隔（秒）。試験の実際は不明
  /* 操作の区間: 順番なら ①→② に操縦桿・②→③ に方向舵、同時なら両区間に両方。1 操作は両区間とも同じ */
  function opSegs(ops, simul) {
    const two = ops.length === 2 && ops[0] !== ops[1];
    if (!two) return [{ dur: EXAM_DT, ops: [ops[0]] }, { dur: EXAM_DT, ops: [ops[0]] }];
    return simul ? [{ dur: EXAM_DT, ops }, { dur: EXAM_DT, ops }] : [{ dur: EXAM_DT, ops: [ops[0]] }, { dur: EXAM_DT, ops: [ops[1]] }];
  }
  /* 飛ばした結果（samples: 1/120 秒ごとの姿勢と位置、frames: ①②③） */
  function simControl(init, ops, simul) { return F().run(init, opSegs(ops, simul), { v: F().EXAM.V, inputs: F().EXAM.INPUT }); }
  function genControl(s) {
    /* 出題は 1 操作（同じ操作を続ける）と 2 操作の混在。2 操作は「操縦桿 → 方向舵」の順に限る（利用者の指定）。
       同じ操作の繰り返しや左右の切り返し（左に倒して右に倒す等）は 2 操作としては出さない */
    const STICK = OPS.filter(o => o.group === 'stick'), RUDDER = OPS.filter(o => o.group === 'rudder');
    /* 難易度: easy は 1 操作だけ、normal は 1 操作と 2 操作の混在、hard は混在＋視界の目盛りなし、
       ①の姿勢（初期状態）: hard までは 水平・傾きだけ・機首の上下だけ のどれか（傾きと機首の上下の複合は出ない）。
       max は hard に加えて複合も出る（水平・傾き・上下・複合の全パターンが対象。複合だけではない。利用者の指示 2026-09-14。
       v05.42 までは max が必ず複合、hard までは傾きと上下を独立に引いていたので複合が 8/15 で出ていた） */
    const lv0 = lvOf(s), lv = lv0 === 'max' ? 'hard' : lv0, max = lv0 === 'max';
    const one = s.ops === 'single' || lv === 'easy' || (s.ops !== 'double' && Math.random() < 1 / 3);
    const first = one ? pick(OPS).id : pick(STICK).id;
    const ops = one ? [first, first] : [first, pick(RUDDER).id];
    const rand = s.init === 'random';
    const pat = max ? pick(['level', 'bank', 'pitch', 'both']) : rand ? pick(['level', 'bank', 'pitch']) : 'level';   // ①の姿勢の型
    const init = { bank: (pat === 'bank' || pat === 'both') ? pick([-30, -15, 15, 30]) : 0,
                   pitch: (pat === 'pitch' || pat === 'both') ? pick([-10, 10]) : 0,
                   yaw: (max || rand) ? pick([-10, 0, 10]) : 0 };
    const single = ops[0] === ops[1];
    /* 2 操作は「順番」（①→②で操縦桿、②→③で方向舵）と「同時」（①→②でも②→③でも両方が進む）を半々で出す。
       答えの文はどちらも同じ。試験の写真がどちらの形かは文言から分からないので、両方に慣れる */
    const simul = !single && Math.random() < 0.5;
    const frames = simControl(init, ops, simul).frames.map(f => ({ bank: f.bank, pitch: f.pitch, yaw: f.yaw, dx: f.dx, dy: f.dy, dz: f.dz }));
    /* 4 択: 1 操作（6 通り）と「操縦桿 → 方向舵」（8 通り）を混ぜた中から、正解以外を誤答にする */
    const key = a => a.join('|');
    const cands = [];
    for (const o of OPS) cands.push([o.id, o.id]);
    if (lv !== 'easy' && s.ops !== 'single') for (const st of STICK) for (const rd of RUDDER) cands.push([st.id, rd.id]);
    /* 誤答の選び方（利用者の指摘 v04.25）: 操縦桿を倒している向きが写真で明らかなとき、本番の難しさは
       「方向舵を踏んでいるかどうか」の見分けにある。正解と同じ操縦桿の向きで方向舵だけ違う選択肢
       （右だけ／右 + 右方向舵／右 + 左方向舵）を必ず混ぜる。Hard は 2 つ、Normal は 1 つ。
       操縦桿の向きだけで答えが決まらないようにする。方向舵だけの正解のときは、逆の方向舵を必ず混ぜる */
    const stickOf = a => (OP_BY_ID[a[0]].group === 'stick' ? a[0] : null);
    /* v04.81〜v05.16 は「操縦桿 奥」を含む選択肢を 1 問に 1 つまでにしていた（機首下げで地面が画面を埋めると変化が読めなかった）。
       地面に目印（畑・湖・道・集落）を置いたので外した（利用者の指示 2026-09-13。本番では地面を見下ろす写真もある） */
    /* 枕（方向舵だけ違う選択肢）を張る操縦桿の向きは、正解の向きだけでなく、確率 1/2 で別の向き（誤答同士）にも張る。
       正解の向きにだけ張っていたため「同じ向きが 3 つ並べば正解はその中」（Hard で 99.4%）、
       「方向舵だけの選択肢が 1 つしか無ければ必ず誤答」（正解が方向舵のときは逆の方向舵を必ず混ぜていたため）と、
       絵を見ずに分かってしまっていた（点検 2026-09-13、20 万問）。別の向きに張るときは枕を 1 つ多くして、並びの数でも見分けられないようにする。
       正解が方向舵だけのときも、逆の方向舵を混ぜるのは確率 1/2 にする */
    const decoy = stickOf(ops) && Math.random() < 0.5 ? pick(STICK.filter(o => o.id !== stickOf(ops))).id : null;
    const pad = decoy || stickOf(ops);
    const rudPad = !stickOf(ops) && Math.random() < 0.5;
    const same = (pad ? cands.filter(c => stickOf(c) === pad && key(c) !== key(ops))
                      : rudPad ? cands.filter(c => c[0] === c[1] && OP_BY_ID[c[0]].group === 'rudder' && key(c) !== key(ops)) : []);
    const nSame = Math.min(same.length, (lv === 'hard' ? 2 : 1) + (decoy ? 1 : 0));
    const disSame = pickDistractors(same, () => true, nSame);
    const disRest = pickDistractors(cands, c => key(c) !== key(ops) && !disSame.some(f => key(f) === key(c)), 3 - disSame.length);
    const dis = disSame.concat(disRest);
    const opts = shuffle([{ ops, ok: true }, ...dis.map(c => ({ ops: c, ok: false }))]).map(o => ({ ...o, text: opsText(o.ops) }));
    return { type: 'control', ops, frames, init, single, simul, opts, level: lv0, hud: lv !== 'hard' };
  }
  function generate(mode, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings);
    return mode === 'heading' ? genHeading(s) : mode === 'attitude' ? genAttitude(s) : mode === 'combo' ? genCombo(s) : genControl(s);
  }

  /* ---------- 採点と解説 ---------- */
  const bankText = b => b > 0 ? `右バンク${b}°` : b < 0 ? `左バンク${-b}°` : '水平（バンクなし）';
  const pitchText = p => p > 0 ? `機首上げ${p}°` : p < 0 ? `機首下げ${-p}°` : '水平（ピッチなし）';

  function gradeHeading(q, dir) {
    const ok = dir === q.dir, mk = q.mark || 0, k = DIRS[mk].k, rel = ((q.dir - mk) % 8 + 8) % 8;
    const lines = rel === 0 ? [`機首が ${k} の印と同じ向き → ${DIRS[q.dir].ja}。`]
      : [`${k} の印から時計回りに 45° ずつ数えます。機首は ${k} から ${rel * 45}° の方向。`];
    if (mk) lines.push(`印が N ではないので、まず ${k}（${DIRS[mk].ja}）の位置から北を決めます。`);
    else if (q.phi) lines.push('北が上ではないので、画面の上下ではなく N マークを基準に読み替えます。');
    return { ok, correct: q.dir, answerText: `${DIRS[q.dir].ja}（${DIRS[q.dir].k}）`, lines };
  }
  function gradeOpts(q, i) {
    const ci = q.opts.findIndex(o => o.ok), ok = i === ci;
    const { pitch, bank } = q, d = q.dir14;
    const lines = [d.read];
    if (bank) lines.push(`${bankText(bank)}：機首の向きに対して${bank > 0 ? '右' : '左'}の翼が下がっている（南から見た絵では、機首がこちらを向くほど左右が逆に見える）。姿勢指示器では水平線が${bank > 0 ? '右上がり' : '左上がり'}に傾く。`);
    else lines.push('翼が水平なのでバンクなし。水平線が傾いている選択肢は誤り。');
    lines.push(pitch > 0 ? '機首上げ：姿勢指示器では水平線が中心より下がり、空（青）の面積が増える。' : pitch < 0 ? '機首下げ：水平線が中心より上がり、地面（茶）の面積が増える。' : '水平飛行：水平線が中心を通る。');
    let answerText = `${ci + 1}（機首 ${d.ja}：${bank ? bankText(bank) + '、' : ''}${pitchText(pitch)}`;
    if (q.type === 'combo') {
      const NPOS = ['真上', '右上', '右', '右下', '真下', '左下', '左', '左上'];
      const m = ((q.mark || 0) - q.dir + 8) % 8;
      lines.push(`方位：${DIRS[q.dir].ja}（${DIRS[q.dir].k}）。機首は常に上を向き、方位指示器の ${DIRS[q.mark || 0].k}（${DIRS[q.mark || 0].ja}）の印は ${NPOS[m]} に来ます。`);
      answerText += ` / ${DIRS[q.dir].ja}`;
    }
    return { ok, correct: ci, answerText: answerText + '）', lines };
  }
  /* 操縦操作の解説: 見え方の一覧・動きで見ると同じ形で、①の状態・操作・同時か順番かを示し、区間ごとの見え方を 1 行ずつ。
     理屈（傾くと流れる、方向舵の向き など）は書かない。アプリ説明にある（利用者の指示 2026-09-13「長すぎて読めない」） */
  const initText = init => { const t = [init.bank ? bankText(init.bank) : '', init.pitch ? pitchText(init.pitch) : ''].filter(Boolean); return t.length ? t.join('・') : '水平'; };
  function gradeControl(q, i) {
    const ci = q.opts.findIndex(o => o.ok), ok = i === ci;
    const a = OP_BY_ID[q.ops[0]], b = OP_BY_ID[q.ops[1]];
    const lines = [`①は${initText(q.init)}${q.single ? '' : '、2 つの操作は' + (q.simul ? '同時' : '順番')}。`];   // 正答の文は上の行（answerText）にある
    if (q.single) lines.push(`①→②→③：${a.view}。`);
    else if (q.simul) lines.push(`①→②→③：${a.view}、${b.view}。`);
    else lines.push(`①→②：${a.view}。　②→③：${b.view}。`);
    return { ok, correct: ci, answerText: `${ci + 1}（${opsText(q.ops)}）`, lines };
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
    /* 真ん中の印は 2 つ用意する。hi-a が機体、hi-g が「見ている人」（地上から見るときに使う）。
       出し分けは画面側の CSS で行う。
       目盛りは 10° 刻み、印は 1 箇所だけ（方位モードの上面図の N マークと同じ読み方にそろえる）。
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
<path class="hi-a" d="M0,-30 L4,-16 L4,-2 L22,8 L22,13 L4,7 L4,16 L11,21 L11,25 L0,22 L-11,25 L-11,21 L-4,16 L-4,7 L-22,13 L-22,8 L-4,-2 L-4,-16 Z" fill="var(--accent)" opacity=".9"/><g class="hi-g"><path d="M0,-6 L20,-34 A34,34 0 0 0 -20,-34 Z" fill="var(--accent)" opacity=".45"/><circle r="7" fill="var(--accent)"/></g>
<polygon points="0,-96 -7,-84 7,-84" fill="var(--accent)"/><circle r="92" fill="none" stroke="var(--bezel, #0a0d11)" stroke-width="6"/><circle r="96" fill="none" stroke="var(--line2)" stroke-width="2"/></svg>`;
  }

  /* ---------- 描画: コックピット視界 ----------
     機体の状態 st = { bank, pitch, yaw, dx, dy, dz }（度・m。dx dy dz は始めの位置からのずれ）から、flight.js の WORLD を
     機体に固定したピンホールカメラで写す（焦点距離 F_PX = 6/tan1° ≈ 343.8 px で 1° ≈ 6 px、視線の中心は (180, 108)）。
     3D（sim3d.js の scenery:'exam'）と同じ世界・同じレンズなので、同じ状態なら同じ絵になる。
     v05.16 までは、方位・仰角を px に置いてから傾き・上下を平行移動と回転で近似していた。機首を大きく下げると地面の目印の位置が合わなくなる。
     空と地面: 水平線は直線で、中心から F·tan(ピッチ) だけ機体の下方向へ、傾きはバンク（ピンホールで厳密）。
     目印: 遠くのもの（山並み・雪山・塔・太陽・星）は方向、地面のもの（畑・湖・道・集落・地面の線）は位置から写す。カメラの手前の面で切る */
  const F_PX = 6 / Math.tan(D);
  const WORLD = () => global.AAT_FLIGHT.WORLD;
  function projector(st) {
    const M = global.AAT_FLIGHT.matOf(st.bank, st.pitch, st.yaw), W = WORLD();
    const R = [M[0][0], M[1][0], M[2][0]], Fw = [M[0][1], M[1][1], M[2][1]], U = [M[0][2], M[1][2], M[2][2]];
    const H = W.H + (st.dz || 0), ox = st.dx || 0, oy = st.dy || 0;
    const body = d => [d[0] * R[0] + d[1] * R[1] + d[2] * R[2], d[0] * Fw[0] + d[1] * Fw[1] + d[2] * Fw[2], d[0] * U[0] + d[1] * U[1] + d[2] * U[2]];
    const img = b => [180 + F_PX * b[0] / b[1], 108 - F_PX * b[2] / b[1]];
    const dir = (azDeg, elDeg) => { const a = azDeg * D, e = elDeg * D; return body([Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]); };
    const gnd = (X, Y) => body([X - ox, Y - oy, -H]);
    const pt = (b, near) => b[1] > near ? img(b) : null;
    /* 多角形・線分を手前の面（by = near）で切ってから写す */
    const clip = (bs, near, closed) => { const out = []; const n = bs.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) { const a = bs[i], b = bs[(i + 1) % n], ina = a[1] > near, inb = b[1] > near;
        if (ina) out.push(a); if (ina !== inb) { const t = (near - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, near, a[2] + (b[2] - a[2]) * t]); } }
      if (!closed && bs[n - 1][1] > near) out.push(bs[n - 1]);
      return out; };
    const poly = (bs, near) => { const c = clip(bs, near, true); return c.length >= 3 ? c.map(img) : null; };
    const seg = (a, b, near) => { const c = clip([a, b], near, false); return c.length >= 2 ? [img(c[0]), img(c[c.length - 1])] : null; };
    return { dir, gnd, pt, poly, seg, vec: body };
  }
  const fx = v => (Math.round(v * 10) / 10).toString();
  const P = pts => pts.map(p => fx(p[0]) + ',' + fx(p[1])).join(' ');
  /* o.marks: 目印（雪山の頂と塔の先端に輪）、o.ref: ①の状態（①の正面の目印を景色に固定して破線で）、o.hud: HUD の印（既定 true） */
  function svgCockpit(st, o = {}) {
    const id = 'ck' + (++uid), W = WORLD(), pr = projector(st), hud = o.hud !== false;
    const bank = st.bank, pitch = Math.max(-80, Math.min(80, st.pitch));
    const att = b => `translate(180 108) rotate(${fx(-b.bank)}) translate(0 ${fx(F_PX * Math.tan(Math.max(-80, Math.min(80, b.pitch)) * D))})`;
    /* 山並み: 絵の稜線を 10 px ごとに柱に切り、手前にあるものだけを続けて多角形に */
    const line = [[-900, 0], ...W.peaks.map((v, i) => [-870 + i * 60, -v]), [900, 0]];
    const yAt = x => { for (let i = 1; i < line.length; i++) if (x <= line[i][0]) { const a = line[i - 1], b = line[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return 0; };
    let ridge = '', run = [];
    const flush = () => { if (run.length >= 2) ridge += `<polygon points="${P(run.map(r => r[0]).concat(run.map(r => r[1]).reverse()))}" fill="var(--ck-mtn, #4a5c70)"/>`; run = []; };
    for (let x = -900; x <= 900; x += 10) { const t = pr.pt(pr.dir(x / 6, -yAt(x) / 6), 1e-3), b = pr.pt(pr.dir(x / 6, 0), 1e-3); if (t && b) run.push([t, b]); else flush(); }
    flush();
    const shape = (pts, near, fill) => { const q = pr.poly(pts, near); return q ? `<polygon points="${P(q)}" fill="${fill}"/>` : ''; };
    const dirs = pts => pts.map(p => pr.dir(p[0] / 6, -p[1] / 6));
    const snow = shape(dirs(W.snow.tri), 1e-3, 'var(--ck-mtn2, #65788d)') + shape(dirs(W.snow.cap), 1e-3, 'var(--ck-snow, #e8eef4)');
    const tower = shape(dirs(W.tower.post), 1e-3, '#2b333c') + shape(dirs(W.tower.cap), 1e-3, '#e2574f');
    const sunP = pr.pt(pr.dir(W.sun.x / 6, -W.sun.y / 6), 1e-3);
    const sun = sunP ? `<circle cx="${fx(sunP[0])}" cy="${fx(sunP[1])}" r="${W.sun.r}" fill="var(--ck-sun, #ffd36b)"/>` : '';
    let stars = '';
    for (const sIt of W.stars) { const p = pr.pt(pr.dir(sIt.x / 6, -sIt.y / 6), 1e-3); if (p) stars += `<circle cx="${fx(p[0])}" cy="${fx(p[1])}" r="${sIt.r}"/>`; }
    /* 地面: 格子（真上から見て正方形。東西・南北の線を gap m おき、始めの位置のまわり ±gridR m）、目印 */
    let gl = '';
    { const G = W.gap, R = W.gridR;   // 3D と同じ範囲（始めの位置のまわり ±R m）
      const line = q => { if (q) gl += `<line x1="${fx(q[0][0])}" y1="${fx(q[0][1])}" x2="${fx(q[1][0])}" y2="${fx(q[1][1])}"/>`; };
      for (let v = -R; v <= R; v += G) { line(pr.seg(pr.gnd(v, -R), pr.gnd(v, R), 1)); line(pr.seg(pr.gnd(-R, v), pr.gnd(R, v), 1)); } }
    let gf = '';
    for (const g of W.ground) gf += shape(g.pts.map(p => pr.gnd(p[0], p[1])), 1, `var(--ck-${g.c}, ${W.colors[g.c]})`);
    /* 目印の輪（雪山の頂・塔の先端）と ①の水平線 */
    let mk = '';
    if (o.marks) { const a = pr.pt(pr.dir(-15, 12), 1e-3), b = pr.pt(pr.dir(230 / 6, 42 / 6), 1e-3);
      if (a) mk += `<circle cx="${fx(a[0])}" cy="${fx(a[1])}" r="16" fill="none" stroke="#f2a93b" stroke-width="3"/>`;
      if (b) mk += `<circle cx="${fx(b[0])}" cy="${fx(b[1])}" r="14" fill="none" stroke="#f2a93b" stroke-width="3"/>`; }
    /* ①の正面の目印: ①で画面中央に交差していた 2 本の線（①の水平線と平行な線と、それに直角な線）を**景色に固定**し、いまの姿勢から写す。
       機体が右に傾けば線は左に傾いて見え、機首を上げれば下がり、方向舵で横へ流れる——景色と同じ動き（利用者の指示 2026-09-13「その位置で固定」）。
       線は無限遠の方向の集まり（①の機体座標で (u, 1, 0) と (0, 1, v)）なので、ピンホールでは直線に写る */
    const ref = o.ref ? refLines(pr, o.ref) : '';
    return `<svg viewBox="0 0 360 240" width="100%" style="aspect-ratio:360/240;display:block" role="img" aria-label="コックピットからの視界">
<defs><clipPath id="${id}"><path d="M16,40 Q180,4 344,40 L344,182 L16,182 Z"/></clipPath><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ck-sky-top, var(--ck-sky, var(--sky)))"/><stop offset="1" style="stop-color:var(--ck-sky-hz, var(--ck-sky, var(--sky)))"/></linearGradient></defs><rect width="360" height="240" fill="var(--bezel, #0a0d11)"/>
<g clip-path="url(#${id})"><g transform="${att({ bank, pitch })}"><rect x="-1200" y="-1200" width="2400" height="1200" fill="url(#${id}s)"/><rect x="-1200" y="0" width="2400" height="1200" fill="var(--ck-earth, var(--earth))"/></g>
<g fill="var(--ck-star, none)">${stars}</g>${sun}${ridge}${snow}${tower}<g stroke="#000" opacity=".12" stroke-width="1">${gl}</g>${gf}
<g transform="${att({ bank, pitch })}"><line x1="-1200" x2="1200" y1="0" y2="0" stroke="#fff" stroke-width="1.5" opacity=".8"/></g>${mk}${ref}</g>
${ckFrame(hud)}</svg>`;
  }
  /* ①の正面の目印の 2 本の破線（svgCockpit の o.ref）。pr はいまの姿勢の写像、ref は ①の状態 */
  function refLines(pr, ref) {
    const M0 = global.AAT_FLIGHT.matOf(ref.bank, ref.pitch, ref.yaw || 0);
    const w = p => [M0[0][0] * p[0] + M0[0][1] * p[1] + M0[0][2] * p[2], M0[1][0] * p[0] + M0[1][1] * p[1] + M0[1][2] * p[2], M0[2][0] * p[0] + M0[2][1] * p[1] + M0[2][2] * p[2]];
    let out = '';
    for (const [p1, p2] of [[[-5, 1, 0], [5, 1, 0]], [[0, 1, -5], [0, 1, 5]]]) { const q = pr.seg(pr.vec(w(p1)), pr.vec(w(p2)), 1e-3);
      if (q) out += `<line x1="${fx(q[0][0])}" y1="${fx(q[0][1])}" x2="${fx(q[1][0])}" y2="${fx(q[1][1])}"/>`; }
    return `<g stroke="#f2a93b" stroke-width="2" stroke-dasharray="7 6" opacity=".9">${out}</g>`;
  }
  /* 「動きで見る」の一人称（3D の景色）に重ねる ①の正面の目印。出題の絵と同じレンズなので、同じ写像で描けば景色に貼り付いて見える。
     枠は出題と同じ 360×188 の切り取り（キャノピーの中だけに描く） */
  function svgRefLines(st, ref) {
    const id = 'rf' + (++uid);
    return `<svg viewBox="0 0 360 188" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block" aria-hidden="true">
<defs><clipPath id="${id}"><path d="M16,40 Q180,4 344,40 L344,182 L16,182 Z"/></clipPath></defs><g clip-path="url(#${id})">${refLines(projector(st), ref)}</g></svg>`;
  }
  /* 視界の枠（HUD の印・キャノピーの縁・グレアシールド）。svgCockpit と、3D の景色に重ねる svgCockpitFrame で同じものを使う */
  const ckFrame = hud => `${hud ? '<g stroke="var(--hud, #7cf59a)" stroke-width="2" fill="none"><line x1="180" y1="98" x2="180" y2="118"/><line x1="170" y1="108" x2="190" y2="108"/><path d="M118,108 h32 v8 M242,108 h-32 v8"/></g>' : ''}
<path d="M16,40 Q180,4 344,40 L344,182 L16,182 Z" fill="none" stroke="var(--line)" stroke-width="4"/>
<path d="M0,240 L0,190 Q180,170 360,190 L360,240 Z" fill="var(--glare, #1a2027)"/><path d="M0,192 Q180,172 360,192" fill="none" stroke="var(--line2)" stroke-width="3"/>`;
  /* 3D の景色（「動きで見る」の一人称）の上に重ねる枠。キャノピーの外は枠の色で塗り、中は透かす */
  function svgCockpitFrame(hud = true) {
    return `<svg viewBox="0 0 360 240" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block" aria-hidden="true">
<path fill-rule="evenodd" d="M0,0 H360 V240 H0 Z M16,40 Q180,4 344,40 L344,182 L16,182 Z" fill="var(--bezel, #0a0d11)"/>${ckFrame(hud)}</svg>`;
  }

  /* ---------- 描画: T-4 イラスト版（上面図・後方/前方図・側面図を回転して使う） ---------- */
  const IMG = 'img/t4-';
  function figTopDown(theta, phi, mark = 0) {
    /* 上面図は 3D モデルを真上から描画したもの（機首が上＝北）。theta をそのまま回転に使う。mark: 印の方位（0 = N。Hard では 8 方位のどれか） */
    /* 絵は外接枠では中央だが、翼と尾翼の重みが尾側にあるため（面積の重心は中心より 9% 尾側）、絵を 6 上げて翼の付け根のあたりを環の中心（回転の軸）に置く。
       中心に置くと、機体が中心から尾側へずれて見えた（利用者の指摘 2026-09-14） */
    /* 印（三角と文字）と機体の絵が重ならないように、機体を 144 → 108 に縮めて文字の内側に収める。印は絵の上に描き、文字に背景色の縁取り
       （尾翼や翼が印の方向にあると、文字が機体の下に隠れていた。利用者の指摘 2026-09-14） */
    const ticks = [0, 90, 180, 270].map(a => `<line x1="100" y1="14" x2="100" y2="24" stroke="var(--faint)" stroke-width="2" transform="rotate(${a} 100 100)"/>`).join('') +
      [45, 135, 225, 315].map(a => `<line x1="100" y1="14" x2="100" y2="22" stroke="var(--faint)" stroke-width="2" transform="rotate(${a} 100 100)"/>`).join('');
    return `<svg viewBox="0 0 200 200" width="100%" style="aspect-ratio:1;display:block" role="img" aria-label="上面図">
<circle cx="100" cy="100" r="96" fill="var(--bezel)"/><circle cx="100" cy="100" r="88" fill="var(--card)" stroke="var(--line2)" stroke-width="1"/>${ticks}
<image href="img/t4-top.webp" x="46" y="40" width="108" height="108" preserveAspectRatio="xMidYMid meet" transform="rotate(${theta} 100 100)"/>
<g transform="rotate(${phi} 100 100)"><polygon points="100,13 94,27 106,27" fill="var(--accent)"/><text x="100" y="41" text-anchor="middle" font-family="var(--mono)" font-size="14" font-weight="700" fill="var(--accent)" stroke="var(--card)" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${DIRS[mark].k}</text></g></svg>`;
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

  /* 14 方向の絵（南からの固定視点）と読み方の凡例。
     北は画面の奥（紙面の表から裏）なので、**円に ×**で示す（矢の羽を後ろから見た形）。
     以前は斜めの矢印で描いていたが、奥行きなのか斜めの向きなのかが紛らわしかった（利用者の指摘 2026-09-11） */
  /* bank: 0 なら bi-<id>.webp、右バンク 30 なら bi-<id>-r30.webp、左バンク 60 なら bi-<id>-l60.webp */
  function figDir14(d, bank = 0) {
    const suffix = bank ? `-${bank > 0 ? 'r' : 'l'}${Math.abs(bank)}` : '';
    return `<div class="d14"><img src="img/bi-${d.id}${suffix}.webp" alt="第三者視点（南から）" style="width:100%;height:auto;display:block">
<svg class="d14legend" viewBox="0 0 76 54" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 35V12M17 17l5-5 5 5"/><path d="M27 40h27M49 35l5 5-5 5"/><circle cx="22" cy="40" r="5"/><path d="M18.5 36.5l7 7M25.5 36.5l-7 7"/></g>
<g font-family="var(--mono)" font-size="10" font-weight="700" fill="currentColor"><text x="22" y="9" text-anchor="middle">上</text><text x="58" y="44">東</text><text x="14" y="44" text-anchor="end">北</text></g></svg></div>`;
  }

  global.AAT = { DIRS, DIR14, BANKS, MODES, OPS, OP_BY_ID, HI_LABELS, LEVELS, DEFAULT_SETTINGS, CK, generate, simControl, opSegs, EXAM_DT, opsText,
    gradeHeading, gradeOpts, gradeControl, bankText, pitchText, svgTopDown, svg3D, svgAI, svgHI, svgCockpit, svgCockpitFrame, svgRefLines, figTopDown, figAttitude, figDir14 };
})(window);
