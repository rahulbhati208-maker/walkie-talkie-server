const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');

// --- SERVER SETUP ---
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

// Enable CORS for cloud hosting
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Middleware to parse JSON for the Repeater
app.use(express.json());

// Store pending requests for the Interceptor
const pendingInterceptions = {};

// --- FRONTEND UI (Mobile First) ---
const FRONTEND_UI = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Mobile Proxy</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root {
            --bg: #121212;
            --card: #1e1e1e;
            --border: #333;
            --accent: #2196f3;
            --danger: #f44336;
            --success: #4caf50;
            --text: #e0e0e0;
            --tab-height: 60px;
        }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

        /* --- MAIN VIEW AREA --- */
        .viewport { flex: 1; position: relative; overflow: hidden; display: flex; flex-direction: column; }
        .view { display: none; height: 100%; flex-direction: column; width: 100%; }
        .view.active { display: flex; }

        /* --- BOTTOM NAVIGATION --- */
        .bottom-nav { height: var(--tab-height); background: #1a1a1a; border-top: 1px solid var(--border); display: flex; justify-content: space-around; align-items: center; padding-bottom: env(safe-area-inset-bottom); z-index: 100; }
        .nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #666; font-size: 10px; gap: 4px; background: none; border: none; position: relative; }
        .nav-item.active { color: var(--accent); }
        .nav-icon { font-size: 20px; }
        
        /* Notification Dot */
        .badge-dot { position: absolute; top: 8px; right: 30%; width: 10px; height: 10px; background: var(--danger); border-radius: 50%; border: 2px solid #1a1a1a; display: none; }
        .badge-dot.visible { display: block; }

        /* --- BROWSER TAB --- */
        .url-bar-container { padding: 10px; background: var(--card); border-bottom: 1px solid var(--border); display: flex; gap: 8px; }
        .url-input { flex: 1; background: #2d2d2d; border: 1px solid #444; color: white; padding: 8px 12px; border-radius: 8px; font-size: 14px; outline: none; }
        .btn-go { background: var(--success); color: white; border: none; padding: 0 15px; border-radius: 8px; font-weight: bold; }
        iframe { flex: 1; border: none; background: white; }

        /* --- INTERCEPTOR TAB --- */
        .interceptor-view { padding: 15px; overflow-y: auto; height: 100%; }
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60%; color: #555; text-align: center; }
        
        .req-card { background: var(--card); border-radius: 12px; padding: 15px; display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--border); height: 100%; }
        .card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid #333; }
        .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
        .status-badge.req { background: #2196f333; color: #64b5f6; }
        .status-badge.res { background: #4caf5033; color: #81c784; }

        .input-group { display: flex; flex-direction: column; gap: 6px; }
        .label { font-size: 11px; color: #888; font-weight: 600; }
        .code-input { background: #000; border: 1px solid #333; color: #0f0; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; }
        textarea.code-input { flex: 1; resize: none; min-height: 150px; }

        .action-row { display: flex; gap: 10px; margin-top: auto; padding-top: 10px; }
        .btn { flex: 1; padding: 12px; border: none; border-radius: 8px; font-weight: bold; font-size: 14px; cursor: pointer; color: white; }
        .btn-fwd { background: var(--success); }
        .btn-drop { background: var(--danger); }
        .btn-repeat { background: #ff9800; color: black; }

        /* --- REPEATER TAB --- */
        .repeater-view { padding: 15px; display: flex; flex-direction: column; gap: 15px; height: 100%; overflow-y: auto; }
        .repeater-response { flex: 1; background: #000; border: 1px solid #333; border-radius: 8px; padding: 10px; font-family: monospace; font-size: 11px; color: #ccc; overflow: auto; white-space: pre-wrap; }
    </style>
</head>
<body>

    <div class="viewport">
        <!-- 1. BROWSER -->
        <div id="view-browser" class="view active">
            <div class="url-bar-container">
                <input type="text" id="browser-url" class="url-input" value="https://jsonplaceholder.typicode.com/posts/1">
                <button class="btn-go" onclick="navigate()">GO</button>
            </div>
            <iframe id="web-frame" src="about:blank"></iframe>
        </div>

        <!-- 2. INTERCEPTOR -->
        <div id="view-intercept" class="view">
            <div class="interceptor-view">
                <div id="intercept-empty" class="empty-state">
                    <div style="font-size: 40px; margin-bottom: 10px;">🛡️</div>
                    <div>No pending traffic</div>
                    <div style="font-size: 12px; margin-top: 5px;">Requests will appear here</div>
                </div>

                <div id="intercept-active" class="req-card" style="display:none;">
                    <div class="card-header">
                        <span id="int-badge" class="status-badge req">Outgoing Request</span>
                        <span style="font-size:11px; color:#666">ID: <span id="int-id">...</span></span>
                    </div>

                    <!-- URL/Method Inputs -->
                    <div class="input-group" id="int-meta-group">
                        <span class="label">METHOD & URL</span>
                        <div style="display:flex; gap: 5px;">
                            <select id="int-method" class="code-input" style="width: 80px;">
                                <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
                            </select>
                            <input type="text" id="int-url" class="code-input" style="flex:1;">
                        </div>
                    </div>

                    <!-- Status Code Input (Response only) -->
                    <div class="input-group" id="int-status-group" style="display:none;">
                        <span class="label">STATUS CODE</span>
                        <input type="number" id="int-status" class="code-input">
                    </div>

                    <!-- Body Input -->
                    <div class="input-group" style="flex:1;">
                        <span class="label">BODY / PAYLOAD</span>
                        <textarea id="int-body" class="code-input"></textarea>
                    </div>

                    <!-- Actions -->
                    <div class="action-row">
                        <button class="btn btn-drop" onclick="dropRequest()">Drop</button>
                        <!-- Only show Send to Repeater for Requests -->
                        <button id="btn-to-repeater" class="btn btn-repeat" onclick="sendToRepeaterFromIntercept()">Repeat</button>
                        <button class="btn btn-fwd" onclick="forwardRequest()">Forward</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 3. REPEATER -->
        <div id="view-repeat" class="view">
            <div class="repeater-view">
                <div class="card-header">
                    <span class="status-badge" style="background:#ff9800; color:black">Repeater</span>
                    <button onclick="clearRepeater()" style="background:none; border:none; color:#666; font-size:11px;">Clear</button>
                </div>

                <div class="input-group">
                    <span class="label">TARGET</span>
                    <div style="display:flex; gap: 5px;">
                        <select id="rep-method" class="code-input" style="width: 80px;">
                            <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
                        </select>
                        <input type="text" id="rep-url" class="code-input" style="flex:1;" placeholder="https://...">
                    </div>
                </div>

                <div class="input-group" style="height: 120px;">
                    <span class="label">REQUEST BODY</span>
                    <textarea id="rep-body" class="code-input" placeholder="{ json... }"></textarea>
                </div>

                <button class="btn btn-fwd" onclick="executeRepeater()" id="btn-rep-send">Send Request</button>

                <div class="input-group" style="flex:1;">
                    <span class="label">RESPONSE</span>
                    <div id="rep-response" class="repeater-response">No response yet...</div>
                </div>
            </div>
        </div>
    </div>

    <!-- BOTTOM NAV -->
    <div class="bottom-nav">
        <button class="nav-item active" onclick="switchTab('browser')">
            <span class="nav-icon">🌐</span>
            <span>Browser</span>
        </button>
        <button class="nav-item" onclick="switchTab('intercept')">
            <span class="nav-icon">🛡️</span>
            <span>Intercept</span>
            <div id="badge-intercept" class="badge-dot"></div>
        </button>
        <button class="nav-item" onclick="switchTab('repeat')">
            <span class="nav-icon">🔁</span>
            <span>Repeater</span>
        </button>
    </div>

    <script>
        const socket = io();
        let currentPhase = null; 
        let currentId = null;

        // --- 1. SOCKET HANDLING (Interception) ---

        socket.on('intercept_request', (data) => {
            handleTraffic('request', data);
        });

        socket.on('intercept_response', (data) => {
            handleTraffic('response', data);
        });

        function handleTraffic(type, data) {
            // Show notification dot
            document.getElementById('badge-intercept').classList.add('visible');
            
            // Setup internal state
            currentPhase = type;
            currentId = data.id;

            // Update UI
            document.getElementById('intercept-empty').style.display = 'none';
            document.getElementById('intercept-active').style.display = 'flex';
            document.getElementById('int-id').innerText = data.id;
            document.getElementById('int-body').value = data.body || '';

            if (type === 'request') {
                document.getElementById('int-badge').className = 'status-badge req';
                document.getElementById('int-badge').innerText = 'Outgoing Request';
                document.getElementById('int-meta-group').style.display = 'flex';
                document.getElementById('int-status-group').style.display = 'none';
                document.getElementById('btn-to-repeater').style.display = 'block'; // Can repeat requests
                
                document.getElementById('int-url').value = data.url;
                document.getElementById('int-method').value = data.method;
            } else {
                document.getElementById('int-badge').className = 'status-badge res';
                document.getElementById('int-badge').innerText = 'Incoming Response';
                document.getElementById('int-meta-group').style.display = 'none';
                document.getElementById('int-status-group').style.display = 'flex';
                document.getElementById('btn-to-repeater').style.display = 'none'; // Cannot repeat responses directly
                
                document.getElementById('int-status').value = data.status;
            }
        }

        // --- 2. INTERCEPTOR ACTIONS ---

        function forwardRequest() {
            if (!currentId) return;

            const body = document.getElementById('int-body').value;

            if (currentPhase === 'request') {
                socket.emit('forward_request', {
                    id: currentId,
                    url: document.getElementById('int-url').value,
                    method: document.getElementById('int-method').value,
                    body: body
                });
            } else {
                socket.emit('forward_response', {
                    id: currentId,
                    status: document.getElementById('int-status').value,
                    body: body
                });
                // Done with this cycle
                clearInterceptUI();
            }
            
            // Clear UI immediately but don't force switch tab (stay context aware)
            clearInterceptUI();
        }

        function dropRequest() {
            clearInterceptUI();
            // In a real app we would tell server to abort, here we just hide UI
        }

        function clearInterceptUI() {
            document.getElementById('intercept-empty').style.display = 'flex';
            document.getElementById('intercept-active').style.display = 'none';
            document.getElementById('badge-intercept').classList.remove('visible');
            currentId = null;
        }

        // --- 3. REPEATER ACTIONS ---

        function sendToRepeaterFromIntercept() {
            // Copy data
            document.getElementById('rep-url').value = document.getElementById('int-url').value;
            document.getElementById('rep-method').value = document.getElementById('int-method').value;
            document.getElementById('rep-body').value = document.getElementById('int-body').value;
            
            // Switch tab
            switchTab('repeat');
        }

        async function executeRepeater() {
            const btn = document.getElementById('btn-rep-send');
            const out = document.getElementById('rep-response');
            
            btn.innerText = "Sending...";
            btn.disabled = true;
            out.innerText = "Waiting for server...";

            const payload = {
                url: document.getElementById('rep-url').value,
                method: document.getElementById('rep-method').value,
                body: document.getElementById('rep-body').value
            };

            try {
                // We send this to OUR server to execute, avoiding CORS on client
                const res = await fetch('/api/repeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await res.json();
                out.innerText = \`STATUS: \${data.status}\\n\\n\${data.body}\`;
            } catch (err) {
                out.innerText = "Error: " + err.message;
            }

            btn.innerText = "Send Request";
            btn.disabled = false;
        }

        function clearRepeater() {
            document.getElementById('rep-url').value = '';
            document.getElementById('rep-body').value = '';
            document.getElementById('rep-response').innerText = 'No response yet...';
        }

        // --- 4. NAVIGATION ---

        function navigate() {
            const url = document.getElementById('browser-url').value;
            document.getElementById('web-frame').src = '/proxy?url=' + encodeURIComponent(url);
        }

        function switchTab(name) {
            document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            
            // Find index for button highlighting
            const idx = name === 'browser' ? 0 : name === 'intercept' ? 1 : 2;
            document.querySelectorAll('.nav-item')[idx].classList.add('active');
            
            document.getElementById('view-' + name).classList.add('active');
        }
    </script>
</body>
</html>
`;

// --- BACKEND LOGIC ---

// 1. UI Route
app.get('/', (req, res) => res.send(FRONTEND_UI));

// 2. Repeater API (Executes without intercepting)
app.post('/api/repeat', async (req, res) => {
    try {
        const { url, method, body } = req.body;
        console.log(`[Repeater] ${method} ${url}`);
        
        const response = await axios({
            url, method,
            data: body,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            validateStatus: () => true,
            responseType: 'arraybuffer'
        });

        res.json({
            status: response.status,
            body: response.data.toString('utf-8')
        });
    } catch (err) {
        res.status(500).json({ status: 500, body: err.message });
    }
});

// 3. Proxy Engine (With Interception)
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.send("No URL provided");
    const reqId = Date.now().toString();

    try {
        // --- PHASE 1: OUTGOING REQUEST ---
        io.emit('intercept_request', { id: reqId, url: targetUrl, method: 'GET', body: '' });
        
        // Wait for user edit...
        const modReq = await waitForSignal(reqId, 'request');

        // Execute Real Request
        const response = await axios({
            url: modReq.url,
            method: modReq.method,
            data: modReq.body,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            validateStatus: () => true,
            responseType: 'arraybuffer'
        });
        const bodyStr = response.data.toString('utf-8');

        // --- PHASE 2: INCOMING RESPONSE ---
        io.emit('intercept_response', { id: reqId, status: response.status, body: bodyStr });

        // Wait for user edit...
        const modRes = await waitForSignal(reqId, 'response');

        // Send to Browser
        let final = modRes.body;
        if(final.includes('<head>')) final = final.replace('<head>', `<head><base href="${modReq.url}">`);
        
        res.status(parseInt(modRes.status)).send(final);

    } catch (err) {
        res.send(`Proxy Error: ${err.message}`);
    }
});

function waitForSignal(id, type) {
    return new Promise((resolve, reject) => {
        pendingInterceptions[`${id}_${type}`] = resolve;
        setTimeout(() => {
            if(pendingInterceptions[`${id}_${type}`]) {
                delete pendingInterceptions[`${id}_${type}`];
                reject(new Error("Timeout"));
            }
        }, 60000);
    });
}

io.on('connection', (socket) => {
    socket.on('forward_request', (data) => {
        const key = `${data.id}_request`;
        if(pendingInterceptions[key]) {
            pendingInterceptions[key](data);
            delete pendingInterceptions[key];
        }
    });
    socket.on('forward_response', (data) => {
        const key = `${data.id}_response`;
        if(pendingInterceptions[key]) {
            pendingInterceptions[key](data);
            delete pendingInterceptions[key];
        }
    });
});

server.listen(PORT, () => console.log(`Server on ${PORT}`));


