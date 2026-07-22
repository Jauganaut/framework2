Below is the complete implementation incorporating the Flask Web UI Manager, Extension Injector, and pycloudflared Orchestrator.

## 1. Directory Structure

Organize your deployment folder on your host machine:

Plaintext

/opt/browser-manager/
├── app.py                      # Flask Control Panel & Orchestrator
├── requirements.txt            # Python dependencies
├── extensions/                 # Put custom .xpi / CRX unpacked folders here
│   └── ublock_origin.xpi
└── templates/
    └── index.html              # Management Web Interface

## 2. Extension Policy Setup (app.py)

To pre-load extensions automatically into every dynamically spawned container, generate a policies.json file on the fly and mount it into /etc/firefox/policies/policies.json.

Here is the complete app.py backend script:

```python
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
    print(f"============================================================")
    
    app.run(host="0.0.0.0", port=UI_PORT)
```

## 3. Web UI Dashboard (templates/index.html)

Create templates/index.html to provide a visual interface to launch, launch-into, or kill browser instances:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Browser Orchestrator</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
            background: #121212; 
            color: #e0e0e0; 
            margin: 2rem; 
        }
        .card { 
            background: #1e1e1e; 
            padding: 1.5rem; 
            border-radius: 8px; 
            margin-bottom: 1rem; 
            border: 1px solid #333; 
        }
        button { 
            background: #0070f3; 
            color: white; 
            border: none; 
            padding: 0.6rem 1.2rem; 
            border-radius: 4px; 
            cursor: pointer; 
        }
        button.danger { 
            background: #d32f2f; 
        }
        table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-top: 1rem; 
        }
        th, td { 
            text-align: left; 
            padding: 0.8rem; 
            border-bottom: 1px solid #333; 
        }
        a { 
            color: #4dabf7; 
            text-decoration: none; 
        }
    </style>
</head>
<body>
    <h1>Firefox Instance Manager</h1>
    
    <div class="card">
        <h3>Launch New Isolated Browser</h3>
        <input type="text" id="sessionName" placeholder="Session Label (e.g., Target-A)" 
               style="padding: 0.5rem; width: 250px;">
        <button onclick="spawnSession()">Spawn Instance</button>
    </div>

    <div class="card">
        <h3>Active Sessions</h3>
        <table>
            <thead>
                <tr>
                    <th>Session ID</th>
                    <th>Local Port</th>
                    <th>Tunnel Public URL</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="sessionTable">
                {% for id, session in sessions.items() %}
                <tr>
                    <td>{{ session.session_id }}</td>
                    <td>{{ session.local_port }}</td>
                    <td><a href="{{ session.tunnel_url }}" target="_blank">{{ session.tunnel_url }}</a></td>
                    <td>
                        <button class="danger" onclick="terminateSession('{{ session.session_id }}')">Kill</button>
                    </td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
    </div>

    <script>
        async function spawnSession() {
            const name = document.getElementById('sessionName').value;
            const res = await fetch('/api/spawn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name })
            });
            if (res.ok) window.location.reload();
        }

        async function terminateSession(id) {
            const res = await fetch(`/api/terminate/${id}`, { method: 'POST' });
            if (res.ok) window.location.reload();
        }
    </script>
</body>
</html>
```

## 4. Dependencies & Execution Steps

### Step 1: Install Requirements
```bash
pip install flask docker portpicker pycloudflared
```

### Step 2: Add Add-ons
Drop any .xpi extensions into `/opt/browser-manager/extensions/` (e.g., downloading .xpi releases directly from Mozilla Add-ons).

### Step 3: Run the Orchestrator
```bash
python3 app.py
```

## Project Overview

This implementation provides:

1. **Flask Web UI Manager**: A dashboard to launch and manage isolated Firefox browser instances
2. **Extension Injector**: Automatically installs extensions (like uBlock Origin) into every container using Firefox Enterprise Policies
3. **pycloudflared Orchestrator**: Creates secure, public tunnels for each Firefox instance and the management dashboard itself
4. **Persistent Storage**: Each browser instance gets persistent storage for cookies, history, and settings
5. **Container Isolation**: Each browser runs in its own Docker container for complete with Dockerfile://localhost:/app

This is to run isolated browser extension injection. This allows researchers, security professionals, and developers to quickly spawn isolated browsing sessions with custom extensions exposed via secure public URLs. The system includes: a control panel dashboard, automatic extension injection via Firefox policies, containerization for isolation, and secure tunneling via Cloudflare for remote access.