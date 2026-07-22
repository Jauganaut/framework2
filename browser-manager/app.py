import os
import time
import json
import portpicker
import docker
from flask import Flask, render_template, request, jsonify, redirect
from pycloudflared import try_cloudflare

app = Flask(__name__)
docker_client = docker.from_env()

# In-memory store for active sessions
# Schema: { session_id: { "port": 5801, "tunnel_url": "https://...", "container_id": "..." } }
ACTIVE_SESSIONS = {}

POLICIES_PATH = "/opt/browser-manager/policies.json"
EXTENSIONS_DIR = "/opt/browser-manager/extensions"

def ensure_extension_policies():
    """Generates Firefox Enterprise Policy enforcing auto-installation of extensions."""
    policies = {
        "policies": {
            "ExtensionSettings": {
                "*": {
                    "installation_mode": "allowed"
                }
            }
        }
    }
    
    # If custom .xpi files exist in EXTENSIONS_DIR, force install them
    if os.path.exists(EXTENSIONS_DIR):
        for file in os.listdir(EXTENSIONS_DIR):
            if file.endswith(".xpi"):
                ext_id = file.replace(".xpi", "") + "@custom"
                policies["policies"]["ExtensionSettings"][ext_id] = {
                    "installation_mode": "force_installed",
                    "install_url": f"file://{EXTENSIONS_DIR}/{file}"
                }

    os.makedirs(os.path.dirname(POLICIES_PATH), exist_ok=True)
    with open(POLICIES_PATH, "w") as f:
        json.dump(policies, f, indent=2)

@app.route("/")
def index():
    return render_template("index.html", sessions=ACTIVE_SESSIONS)

@app.route("/api/spawn", methods=["POST"])
def spawn_session():
    data = request.get_json() or {}
    session_name = data.get("name", f"session-{int(time.time())}")
    
    # 1. Allocate dynamic free host port
    local_port = portpicker.pick_unused_port()
    
    # 2. Host persistence directory for cookies/history
    data_dir = f"/var/docker/firefox/data/{session_name}"
    os.makedirs(data_dir, exist_ok=True)

    # 3. Spawn Docker Container
    container = docker_client.containers.run(
        image="jlesage/firefox:latest",
        name=f"firefox-{session_name}",
        detach=True,
        ports={'5800/tcp': local_port},
        volumes={
            data_dir: {'bind': '/config', 'mode': 'rw'},
            POLICIES_PATH: {'bind': '/etc/firefox/policies/policies.json', 'mode': 'ro'},
            EXTENSIONS_DIR: {'bind': EXTENSIONS_DIR, 'mode': 'ro'}
        },
        environment={"ENABLE_DARK_MODE": "1"},
        shm_size="2g"
    )

    # 4. Spawn Cloudflare Quick Tunnel via pycloudflared
    tunnel = try_cloudflare(port=local_port)
    tunnel_url = tunnel.tunnel_url

    ACTIVE_SESSIONS[session_name] = {
        "session_id": session_name,
        "local_port": local_port,
        "tunnel_url": tunnel_url,
        "container_id": container.short_id
    }

    return jsonify({"status": "success", "session": ACTIVE_SESSIONS[session_name]})

@app.route("/api/terminate/<session_id>", methods=["POST"])
def terminate_session(session_id):
    if session_id in ACTIVE_SESSIONS:
        session_info = ACTIVE_SESSIONS[session_id]
        try:
            container = docker_client.containers.get(f"firefox-{session_id}")
            container.stop()
            container.remove()
        except Exception as e:
            print(f"Error stopping container: {e}")
        
        del ACTIVE_SESSIONS[session_id]
        return jsonify({"status": "success", "message": f"Terminated {session_id}"})
    return jsonify({"status": "error", "message": "Session not found"}), 404

if __name__ == "__main__":
    ensure_extension_policies()
    
    # Tunnel the Web UI Manager itself
    UI_PORT = 5000
    print("[*] Launching Cloudflare Tunnel for Management Dashboard...")
    ui_tunnel = try_cloudflare(port=UI_PORT)
    print(f"============================================================")
    print(f" MANAGEMENT DASHBOARD ACCESSIBLE AT: {ui_tunnel.tunnel_url}")
    print(f"================================================================\n")
    
    app.run(host="0.0.0.0", port=UI_PORT)