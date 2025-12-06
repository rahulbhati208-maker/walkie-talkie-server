const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');
const querystring = require('querystring');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

// Enable CORS
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Parse both JSON and Form Data (Crucial for intercepting forms)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pendingInterceptions = {};

// --- FRONTEND UI (Mobile Fixed Layout) ---
const FRONTEND_UI = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Interceptor</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root {
            --bg: #121212; --card: #1e1e1e; --border: #333;
            --accent: #2196f3; --danger: #f44336; --success: #4caf50;
            --text: #e0e0e0; --tab-height: 60px;
        }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        
        body { 
            margin: 0; font-family: sans-serif; background: var(--bg); color: var(--text); 
            display: flex; flex-direction: column; height: 100vh; overflow: hidden; 
        }

        .viewport { 
            flex: 1; position: relative; overflow: hidden; display: flex; flex-direction: column; 
        }
        
        .view { display: none; height: 100%; flex-direction: column; width: 100%; }
        .view.active { display: flex; }

        .bottom-nav { 
            height: var(--tab-height); background: #1a1a1a; border-top: 1px solid var(--border); 
            display: flex; justify-content: space-around; align-items: center; 
            padding-bottom: env(safe-area-inset-bottom); flex-shrink: 0; z-index: 999;
        }
        .nav-item { 
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; 
            height: 100%; color: #666; font-size: 10px; gap: 4px; background: none; border: none; 
            position: relative; 
        }
        .nav-item.active { color: var(--accent); }
        .nav-icon { font-size: 20px; }
        .badge-dot { 
            position: absolute; top: 10px; right: 35%; width: 10px; height: 10px; 
            background: var(--danger); border-radius: 50%; border: 2px solid #1a1a1a; display: none; 
        }
        .badge-dot.visible { display: block; }

        /* Browser Tab */
        .url-bar { padding: 8px; background: var(--card); border-bottom: 1px solid var(--border); display: flex; gap: 8px; }
        .url-input { flex: 1; background: #2d2d2d; border: 1px solid #444; color: white; padding: 8px; border-radius: 6px; outline: none; }
        .btn-go { background: var(--success); color: white; border: none; padding: 0 15px; border-radius: 6px; font-weight: bold; }
        iframe { flex: 1; border: none; background: white; }

        /* Interceptor */
        .interceptor-view { padding: 15px; overflow-y: auto; flex: 1; }
        .req-card { 
            background: var(--card); border-radius: 8px; padding: 15px; 
            display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border); 
            min-height: 100%; 
        }
        .code-input { 
            background: #000; border: 1px solid #333; color: #0f0; padding: 10px; 
            border-radius: 4px; font-family: monospace; font-size: 12px; width: 100%;
        }
        textarea.code-input { flex: 1; resize: none; min-height: 200px; }
        .action-row { display: flex; gap: 10px; margin-top: 10px; }
        .btn { flex: 1; padding: 12px; border: none; border-radius: 6px; font-weight: bold; color: white; }
        .btn-fwd { background: var(--success); }
        .btn-drop { background: var(--danger); }
        .btn-rep { background: #ff9800; color: black; }
        
        /* Repeater */
        .repeater-view { padding: 15px; display: flex; flex-direction: column; gap: 10px; height: 100%; overflow-y: auto; }
    </style>
</head>
<body>

    <div class="viewport">
        <!-- 1. BROWSER -->
        <div id="view-browser" class="view active">
            <div class="url-bar">
                <input type="text" id="browser-url" class="url-input" value="https://jsonplaceholder.typicode.com/posts/1">
                <button class="btn-go" onclick="navigate()">GO</button>
            </div>
            <iframe id="web-frame" src="about:blank"></iframe>
        </div>

        <!-- 2. INTERCEPT -->
        <div id="view-intercept" class="view">
            <div class="interceptor-view">
                <div id="intercept-empty" style="text-align:center; margin-top: 50%; color: #666;">
                    <h3>Ready to Intercept</h3>
                    <p>Interact with the browser to capture traffic.</p>
                </div>

                <div id="intercept-active" class="req-card" style="display:none;">
                    <div style="display:flex; justify-content:space-between; color:#888; font-size:12px;">
                        <span id="int-badge" style="color:var(--accent)">REQUEST</span>
                        <span>ID: <span id="int-id">0</span></span>
                    </div>

                    <div id="int-meta-group" style="display:flex; gap:5px;">
                        <select id="int-method" class="code-input" style="width:70px;"><option>GET</option><option>POST</option></select>
                        <input type="text" id="int-url" class="code-input" style="flex:1;">
                    </div>

                    <div id="int-status-group" style="display:none;">
                        <input type="number" id="int-status" class="code-input" placeholder="Status">
                    </div>

                    <textarea id="int-body" class="code-input" placeholder="Body data..."></textarea>

                    <div class="action-row">
                        <button class="btn btn-drop" onclick="dropRequest()">Drop</button>
                        <button id="btn-to-rep" class="btn btn-rep" onclick="sendToRepeater()">Repeat</button>
                        <button class="btn btn-fwd" onclick="forwardRequest()">Forward</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 3. REPEATER -->
        <div id="view-repeat" class="view">
            <div class="repeater-view">
                <div style="display:flex; gap:5px;">
                    <select id="rep-method" class="code-input" style="width:70px;"><option>GET</option><option>POST</option></select>
                    <input type="text" id="rep-url" class="code-input" style="flex:1;">
                </div>
                <textarea id="rep-body" class="code-input" style="height:100px; min-height:100px; flex:none;"></textarea>
                <button class="btn btn-fwd" onclick="executeRepeater()" id="btn-rep-send">Send Request</button>
                <div id="rep-response" class="code-input" style="flex:1; overflow:auto; background:#111; color:#ccc;">Response will appear here...</div>
            </div>
        </div>
    </div>

    <div class="bottom-nav">
        <button class="nav-item active" onclick="switchTab('browser')">
            <span class="nav-icon">🌐</span><span>Browser</span>
        </button>
        <button class="nav-item" onclick="switchTab('intercept')">
            <span class="nav-icon">🛡️</span><span>Intercept</span>
            <div id="badge-intercept" class="badge-dot"></div>
        </button>
        <button class="nav-item" onclick="switchTab('repeat')">
            <span class="nav-icon">🔁</span><span>Repeater</span>
        </button>
    </div>

    <script>
        const socket = io();
        let currentPhase = null; 
        let currentId = null;

        socket.on('intercept_request', (data) => handleTraffic('request', data));
        socket.on('intercept_response', (data) => handleTraffic('response', data));

        function handleTraffic(type, data) {
            document.getElementById('badge-intercept').classList.add('visible');
            currentPhase = type;
            currentId = data.id;

            document.getElementById('intercept-empty').style.display = 'none';
            document.getElementById('intercept-active').style.display = 'flex';
            document.getElementById('int-id').innerText = data.id;
            
            // Format body if it's JSON-like or Object
            let displayBody = data.body;
            if (typeof displayBody === 'object') {
                displayBody = new URLSearchParams(displayBody).toString();
            }
            document.getElementById('int-body').value = displayBody || '';

            if (type === 'request') {
                document.getElementById('int-badge').innerText = 'OUTGOING REQUEST';
                document.getElementById('int-badge').style.color = '#2196f3';
                document.getElementById('int-meta-group').style.display = 'flex';
                document.getElementById('int-status-group').style.display = 'none';
                document.getElementById('btn-to-rep').style.display = 'block';
                document.getElementById('int-url').value = data.url;
                document.getElementById('int-method').value = data.method;
            } else {
                document.getElementById('int-badge').innerText = 'INCOMING RESPONSE';
                document.getElementById('int-badge').style.color = '#4caf50';
                document.getElementById('int-meta-group').style.display = 'none';
                document.getElementById('int-status-group').style.display = 'block';
                document.getElementById('btn-to-rep').style.display = 'none';
                document.getElementById('int-status').value = data.status;
            }
        }

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
            }
            clearInterceptUI();
        }

        function dropRequest() { clearInterceptUI(); }

        function clearInterceptUI() {
            document.getElementById('intercept-empty').style.display = 'block';
            document.getElementById('intercept-active').style.display = 'none';
            document.getElementById('badge-intercept').classList.remove('visible');
            currentId = null;
        }

        function sendToRepeater() {
            document.getElementById('rep-url').value = document.getElementById('int-url').value;
            document.getElementById('rep-method').value = document.getElementById('int-method').value;
            document.getElementById('rep-body').value = document.getElementById('int-body').value;
            switchTab('repeat');
        }

        async function executeRepeater() {
            const btn = document.getElementById('btn-rep-send');
            const out = document.getElementById('rep-response');
            btn.innerText = "Sending..."; btn.disabled = true;

            try {
                const res = await fetch('/api/repeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: document.getElementById('rep-url').value,
                        method: document.getElementById('rep-method').value,
                        body: document.getElementById('rep-body').value
                    })
                });
                const data = await res.json();
                out.innerText = \`STATUS: \${data.status}\\n\\n\${data.body}\`;
            } catch (err) { out.innerText = err.message; }
            btn.innerText = "Send Request"; btn.disabled = false;
        }

        function navigate() {
            const url = document.getElementById('browser-url').value;
            document.getElementById('web-frame').src = '/proxy?url=' + encodeURIComponent(url);
        }

        function switchTab(name) {
            document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            
            const idx = name === 'browser' ? 0 : name === 'intercept' ? 1 : 2;
            document.querySelectorAll('.nav-item')[idx].classList.add('active');
            document.getElementById('view-' + name).classList.add('active');
        }
    </script>
</body>
</html>
`;

// --- BACKEND LOGIC ---
app.get('/', (req, res) => res.send(FRONTEND_UI));

// Repeater API
app.post('/api/repeat', async (req, res) => {
    try {
        const { url, method, body } = req.body;
        const response = await axios({
            url, method, data: body,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            validateStatus: () => true, responseType: 'arraybuffer'
        });
        res.json({ status: response.status, body: response.data.toString('utf-8') });
    } catch (err) { res.status(500).json({ status: 500, body: err.message }); }
});

// MAIN PROXY ENGINE (Supports GET and POST)
app.all('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.send("No URL provided");
    const reqId = Date.now().toString();

    // Determine payload based on method
    const incomingMethod = req.method;
    const incomingBody = (incomingMethod === 'POST') ? req.body : '';

    try {
        // --- PHASE 1: INTERCEPT REQUEST ---
        // Emit the body to the UI (if it's an object, UI handles formatting)
        io.emit('intercept_request', { 
            id: reqId, 
            url: targetUrl, 
            method: incomingMethod, 
            body: incomingBody 
        });
        
        const modReq = await waitForSignal(reqId, 'request');

        // --- PHASE 2: REAL REQUEST ---
        const response = await axios({
            url: modReq.url,
            method: modReq.method,
            data: modReq.body, // Send the modified body
            headers: { 
                'User-Agent': 'Mozilla/5.0',
                'Content-Type': 'application/x-www-form-urlencoded' // Default for forms
            },
            validateStatus: () => true, 
            responseType: 'arraybuffer'
        });

        // --- PHASE 3: INTERCEPT RESPONSE ---
        let bodyStr = response.data.toString('utf-8');
        io.emit('intercept_response', { id: reqId, status: response.status, body: bodyStr });
        const modRes = await waitForSignal(reqId, 'response');

        // --- PHASE 4: SEND TO BROWSER WITH INJECTION ---
        let finalBody = modRes.body;
        
        res.removeHeader("Content-Security-Policy");
        res.removeHeader("X-Frame-Options");

        // The Magic Script: Intercepts Clicks AND Form Submits
        const scriptInjection = `
            <base href="${modReq.url}">
            <script>
                // 1. Intercept Links (GET)
                document.addEventListener('click', function(e) {
                    const anchor = e.target.closest('a');
                    if (anchor && anchor.href && !anchor.href.startsWith('javascript:')) {
                        e.preventDefault();
                        window.location.href = '/proxy?url=' + encodeURIComponent(anchor.href);
                    }
                });
                
                // 2. Intercept Forms (GET and POST)
                document.addEventListener('submit', function(e) {
                    e.preventDefault();
                    const form = e.target;
                    const action = form.action || window.location.href;
                    const method = (form.method || 'GET').toUpperCase();
                    
                    if (method === 'POST') {
                        // Create a hidden form that posts to OUR server
                        const tempForm = document.createElement('form');
                        tempForm.method = 'POST';
                        tempForm.action = '/proxy?url=' + encodeURIComponent(action);
                        tempForm.style.display = 'none';
                        
                        // Copy inputs
                        const formData = new FormData(form);
                        for (const [key, value] of formData.entries()) {
                            const input = document.createElement('input');
                            input.name = key;
                            input.value = value;
                            tempForm.appendChild(input);
                        }
                        
                        document.body.appendChild(tempForm);
                        tempForm.submit();
                    } else {
                        // Handle GET forms (append params to URL)
                        const formData = new FormData(form);
                        const params = new URLSearchParams(formData);
                        const separator = action.includes('?') ? '&' : '?';
                        const fullUrl = action + separator + params.toString();
                        window.location.href = '/proxy?url=' + encodeURIComponent(fullUrl);
                    }
                });
            </script>
        `;

        if (finalBody.includes('<head>')) {
            finalBody = finalBody.replace('<head>', '<head>' + scriptInjection);
        } else {
            finalBody = scriptInjection + finalBody;
        }

        res.status(parseInt(modRes.status)).send(finalBody);

    } catch (err) { res.send(`Proxy Error: ${err.message}`); }
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
        if(pendingInterceptions[key]) { pendingInterceptions[key](data); delete pendingInterceptions[key]; }
    });
    socket.on('forward_response', (data) => {
        const key = `${data.id}_response`;
        if(pendingInterceptions[key]) { pendingInterceptions[key](data); delete pendingInterceptions[key]; }
    });
});

server.listen(PORT, () => console.log(`Server on ${PORT}`));


