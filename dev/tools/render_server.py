# dev/ を配信し、ブラウザから POST された PNG（data URL）をリポジトリ直下の img/ に、GLB を model/ に保存する小さなサーバー
import http.server, socketserver, base64, os, sys, urllib.parse
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # dev/（配信元。render/ と t4model/ がある）
REPO = os.path.dirname(ROOT)                                                # リポジトリ直下（保存先 img/ model/）
PORT = 8766
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def do_POST(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = q.get('name', [''])[0]
        if urllib.parse.urlparse(self.path).path == '/saveglb':
            n = int(self.headers.get('Content-Length', 0)); data = self.rfile.read(n)
            out = os.path.join(REPO, 'model', f'{name}.glb'); os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, 'wb').write(data)
            self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers(); self.wfile.write(f'saved {len(data)} bytes'.encode()); return
        if not name or not all(c.isalnum() or c in '-_' for c in name):
            self.send_response(400); self.end_headers(); return
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n).decode()
        data = base64.b64decode(body.split(',', 1)[1])
        out = os.path.join(REPO, 'img', f'{name}.png')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, 'wb').write(data)
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers(); self.wfile.write(b'saved')
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), H) as s:
    print('serving', ROOT, 'on', PORT, flush=True); s.serve_forever()
