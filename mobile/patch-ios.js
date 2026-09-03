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

/* Xcode プロジェクトのバンドル ID を確実に書き込む。
   ここが Capacitor の既定値のままだと、取ってきたプロビジョニングプロファイルと
   照合できず、書庫を作る段階で「requires a provisioning profile」で落ちる */
const PBX = path.join(__dirname, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const APPID = JSON.parse(fs.readFileSync(path.join(__dirname, 'capacitor.config.json'), 'utf8')).appId;
if (fs.existsSync(PBX)) {
  let x = fs.readFileSync(PBX, 'utf8');
  const before = x;
  x = x.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, 'PRODUCT_BUNDLE_IDENTIFIER = ' + APPID + ';');
  if (process.env.DEVELOPMENT_TEAM) {
    x = x.replace(/DEVELOPMENT_TEAM = [^;]*;/g, 'DEVELOPMENT_TEAM = ' + process.env.DEVELOPMENT_TEAM + ';');
  }
  if (x !== before) { fs.writeFileSync(PBX, x); console.log('project.pbxproj のバンドル ID を', APPID, 'にしました'); }
  else console.log('project.pbxproj は直す必要がありませんでした');
} else {
  console.error('project.pbxproj がありません');
  process.exit(1);
}

/* 対応 iOS を 15.0 以上にする。
   Capacitor の既定は 14.0 で、アップロード時に警告 90068 が出る
   （2027 年春から 15.0 未満は受け付けられなくなる）。
   Podfile は pod install より前に直す必要があるので、このスクリプトは cap sync の前に走らせる */
const TARGET = '15.0';
const PODFILE = path.join(__dirname, 'ios', 'App', 'Podfile');
if (fs.existsSync(PODFILE)) {
  let pf = fs.readFileSync(PODFILE, 'utf8');
  const before = pf;
  pf = pf.replace(/platform :ios, '[\d.]+'/, "platform :ios, '" + TARGET + "'");
  if (pf !== before) { fs.writeFileSync(PODFILE, pf); console.log('Podfile の対応 iOS を', TARGET, 'にしました'); }
}
if (fs.existsSync(PBX)) {
  let x = fs.readFileSync(PBX, 'utf8');
  const before = x;
  x = x.replace(/IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = ' + TARGET + ';');
  if (x !== before) { fs.writeFileSync(PBX, x); console.log('プロジェクトの対応 iOS を', TARGET, 'にしました'); }
}
