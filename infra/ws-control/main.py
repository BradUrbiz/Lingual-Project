"""Tiny mobile control panel for the claude-1 Cloud Workstation.

Start / stop / status buttons plus a link that opens the ttyd web terminal
(which drops straight into the Claude Code tmux session). Deployed on
Cloud Run behind IAP; the runtime service account holds per-workstation
admin rights only.
"""
import requests
from flask import Flask, jsonify
import google.auth
from google.auth.transport.requests import Request as GoogleAuthRequest

WS_RESOURCE = ("projects/lingu-480600/locations/us-central1/"
               "workstationClusters/claude-cluster/"
               "workstationConfigs/claude-dev/workstations/claude-1")
API_BASE = "https://workstations.googleapis.com/v1/"
TERMINAL_URL = ("https://7681-claude-1.cluster-"
                "4rgu7iutprcxgtt7j7wspxgk7g.cloudworkstations.dev")

app = Flask(__name__)
_creds, _ = google.auth.default(
    scopes=["https://www.googleapis.com/auth/cloud-platform"])


def _api(method, suffix=""):
    if not _creds.valid:
        _creds.refresh(GoogleAuthRequest())
    resp = requests.request(
        method, API_BASE + WS_RESOURCE + suffix,
        headers={"Authorization": f"Bearer {_creds.token}"}, timeout=30)
    return resp.json()


@app.get("/status")
def status():
    return jsonify(state=_api("GET").get("state", "UNKNOWN"))


@app.post("/start")
def start():
    return jsonify(_api("POST", ":start"))


@app.post("/stop")
def stop():
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
  #open {{ background: #d97706; color: #fff; display: block; }}
  #start {{ background: #16a34a; color: #fff; }}
  #stop {{ background: #dc2626; color: #fff; }}
  button:disabled, a.btn.disabled {{ opacity: .35; pointer-events: none; }}
  small {{ color: #888; }}
</style></head><body>
<h1>Claude Workstation (claude-1)</h1>
<div id="state">…</div>
<a class="btn" id="open" href="{TERMINAL_URL}" target="_blank">🤖 Claude 터미널 열기</a>
<button id="start" onclick="act('start')">▶️ 켜기</button>
<button id="stop" onclick="act('stop')">⏹ 끄기</button>
<small>켜는 데 ~2분 · 30분 유휴 시 자동 종료</small>
<script>
async function refresh() {{
  try {{
    const s = (await (await fetch('/status')).json()).state || 'UNKNOWN';
    const el = document.getElementById('state');
    el.textContent = s.replace('STATE_', '');
    el.className = s === 'STATE_RUNNING' ? 'running'
                 : s === 'STATE_STOPPED' ? 'stopped' : 'busy';
    document.getElementById('open').classList.toggle('disabled', s !== 'STATE_RUNNING');
    document.getElementById('start').disabled = s !== 'STATE_STOPPED';
    document.getElementById('stop').disabled = s !== 'STATE_RUNNING';
  }} catch (e) {{ document.getElementById('state').textContent = 'ERR'; }}
}}
async function act(a) {{
  document.getElementById(a).disabled = true;
  await fetch('/' + a, {{method: 'POST'}});
  setTimeout(refresh, 1500);
}}
refresh(); setInterval(refresh, 5000);
</script></body></html>"""


@app.get("/")
def home():
    return PAGE
