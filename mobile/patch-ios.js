/* cap sync のあとに、Xcode プロジェクト（生成物）へ手当てをする。
   ios/ は毎回作り直すので、設定は必ずこのスクリプトで入れる。
   - 向き: 縦も横も許可する（横画面では視界が画面いっぱいになる作りなので、横を止めてはいけない）
   - 輸出コンプライアンス: HTTPS だけなので「該当しない」を Info.plist に入れておく（申請ごとに聞かれない）
   - 表示名: TENRYU
   - 起動時の背景色は capacitor.config.json で指定している */
const fs = require('fs'), path = require('path');
const PLIST = path.join(__dirname, 'ios', 'App', 'App', 'Info.plist');
if (!fs.existsSync(PLIST)) { console.error('Info.plist がありません。先に npx cap add ios を実行してください'); process.exit(1); }
let s = fs.readFileSync(PLIST, 'utf8');

const ORIENT_PHONE = ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];
const ORIENT_PAD = ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];
const arr = v => '\n\t<array>\n' + v.map(x => '\t\t<string>' + x + '</string>').join('\n') + '\n\t</array>';

/* key があれば中身を置き換え、なければ末尾に足す */
function setKey(key, valueXml) {
  const re = new RegExp('<key>' + key + '</key>\\s*(<array>[\\s\\S]*?</array>|<string>[\\s\\S]*?</string>|<true/>|<false/>)');
  if (re.test(s)) s = s.replace(re, '<key>' + key + '</key>' + valueXml);
  else s = s.replace(/\n<\/dict>\n<\/plist>/, '\n\t<key>' + key + '</key>' + valueXml + '\n</dict>\n</plist>');
}

setKey('UISupportedInterfaceOrientations', arr(ORIENT_PHONE));
setKey('UISupportedInterfaceOrientations~ipad', arr(ORIENT_PAD));
setKey('ITSAppUsesNonExemptEncryption', '\n\t<false/>');
setKey('CFBundleDisplayName', '\n\t<string>TENRYU</string>');
fs.writeFileSync(PLIST, s);
console.log('Info.plist を直しました（向き・輸出コンプライアンス・表示名）');
