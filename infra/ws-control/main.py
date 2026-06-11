"""Tiny mobile control panel for the claude-1 Cloud Workstation.

Start / stop / status buttons plus a link that opens the ttyd web terminal
(which drops straight into the Claude Code tmux session).

Auth: Firebase Auth Google sign-in on the page; the backend verifies the
Firebase ID token and allows only the owner email. (IAP is unavailable on
org-less projects, and the terminal link is separately IAM-gated by the
Cloud Workstations gateway anyway.)
"""
import requests
from flask import Flask, jsonify, request as flask_request
import google.auth
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token

ALLOWED_EMAILS = {"supremekim17@gmail.com"}
FIREBASE_PROJECT = "lingu-480600"
WS_RESOURCE = ("projects/lingu-480600/locations/us-central1/"
               "workstationClusters/claude-cluster/"
               "workstationConfigs/claude-dev/workstations/claude-1")
API_BASE = "https://workstations.googleapis.com/v1/"
TERMINAL_URL = ("https://7681-claude-1.cluster-"
                "4rgu7iutprcxgtt7j7wspxgk7g.cloudworkstations.dev")

app = Flask(__name__)
_creds, _ = google.auth.default(
    scopes=["https://www.googleapis.com/auth/cloud-platform"])


def _authorized():
    header = flask_request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    try:
        claims = google_id_token.verify_firebase_token(
            header.removeprefix("Bearer "), GoogleAuthRequest(),
            audience=FIREBASE_PROJECT)
    except ValueError:
        return False
    return bool(claims) and claims.get("email_verified") \
        and claims.get("email") in ALLOWED_EMAILS


def _api(method, suffix=""):
    if not _creds.valid:
        _creds.refresh(GoogleAuthRequest())
    resp = requests.request(
        method, API_BASE + WS_RESOURCE + suffix,
        headers={"Authorization": f"Bearer {_creds.token}"}, timeout=30)
    return resp.json()


@app.get("/status")
def status():
    if not _authorized():
        return jsonify(error="unauthorized"), 401
    return jsonify(state=_api("GET").get("state", "UNKNOWN"))


@app.post("/start")
def start():
    if not _authorized():
        return jsonify(error="unauthorized"), 401
    return jsonify(_api("POST", ":start"))


@app.post("/stop")
def stop():
    if not _authorized():
        return jsonify(error="unauthorized"), 401
    return jsonify(_api("POST", ":stop"))


PAGE = f"""<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Workstation</title>
<style>
  body {{ font-family: -apple-system, sans-serif; background: #111;
         color: #eee; display: flex; flex-direction: column; align-items: center;
         gap: 16px; padding: 32px 16px; }}
  h1 {{ font-size: 1.2rem; margin: 0; }}
  #state {{ font-size: 1.6rem; font-weight: 700; padding: 8px 20px;
            border-radius: 12px; background: #222; }}
  .running {{ color: #4ade80; }} .stopped {{ color: #f87171; }}
  .busy {{ color: #facc15; }}
  button, a.btn {{ width: 100%; max-width: 360px; padding: 18px;
    font-size: 1.15rem; font-weight: 600; border: 0; border-radius: 14px;
    text-align: center; text-decoration: none; cursor: pointer; }}
  #signin {{ background: #2563eb; color: #fff; }}
  #open {{ background: #d97706; color: #fff; display: block; }}
  #start {{ background: #16a34a; color: #fff; }}
  #stop {{ background: #dc2626; color: #fff; }}
  button:disabled, a.btn.disabled {{ opacity: .35; pointer-events: none; }}
  .authed {{ display: none; }}
  small {{ color: #888; }}
</style></head><body>
<h1>Claude Workstation (claude-1)</h1>
<button id="signin">Google로 로그인</button>
<div id="state" class="authed">…</div>
<a class="btn authed" id="open" href="{TERMINAL_URL}" target="_blank">🤖 Claude 터미널 열기 (새 탭)</a>
<button class="authed" id="start" onclick="act('start')">▶️ 켜기</button>
<button class="authed" id="stop" onclick="act('stop')">⏹ 끄기</button>
<small class="authed">켜는 데 ~2분 · 30분 유휴 시 자동 종료</small>
<iframe id="term" style="display:none; width:100%; max-width:900px; height:65vh;
  border:1px solid #333; border-radius:12px;" allow="clipboard-read; clipboard-write"></iframe>
<script type="module">
import {{ initializeApp }} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {{ getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged }}
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const auth = getAuth(initializeApp({{
  apiKey: "AIzaSyDGLmiMun2eMunDsJMgoo7vRCqSgmHZ4LU",
  authDomain: "lingu-480600.firebaseapp.com",
  projectId: "lingu-480600",
}}));

let user = null;
document.getElementById('signin').onclick =
  () => signInWithPopup(auth, new GoogleAuthProvider());
onAuthStateChanged(auth, u => {{
  user = u;
  document.getElementById('signin').style.display = u ? 'none' : 'block';
  document.querySelectorAll('.authed').forEach(
    el => el.style.display = u ? 'block' : 'none');
  if (u) refresh();
}});

async function call(path, opts) {{
  const token = await user.getIdToken();
  return fetch(path, {{ ...opts,
    headers: {{ Authorization: 'Bearer ' + token }} }});
}}
async function refresh() {{
  if (!user) return;
  try {{
    const s = (await (await call('/status')).json()).state || 'UNKNOWN';
    const el = document.getElementById('state');
    el.textContent = s.replace('STATE_', '');
    el.className = 'authed ' + (s === 'STATE_RUNNING' ? 'running'
                 : s === 'STATE_STOPPED' ? 'stopped' : 'busy');
    document.getElementById('open').classList.toggle('disabled', s !== 'STATE_RUNNING');
    document.getElementById('start').disabled = s !== 'STATE_STOPPED';
    document.getElementById('stop').disabled = s !== 'STATE_RUNNING';
    const term = document.getElementById('term');
    if (s === 'STATE_RUNNING' && !term.src) term.src = '{TERMINAL_URL}';
    if (s !== 'STATE_RUNNING' && term.src) term.src = '';
    term.style.display = s === 'STATE_RUNNING' ? 'block' : 'none';
  }} catch (e) {{ document.getElementById('state').textContent = 'ERR'; }}
}}
window.act = async a => {{
  document.getElementById(a).disabled = true;
  await call('/' + a, {{ method: 'POST' }});
  setTimeout(refresh, 1500);
}};
setInterval(refresh, 5000);
</script></body></html>"""


@app.get("/")
def home():
    return PAGE
