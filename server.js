const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');
const querystring = require('querystring'); // Helper for form data

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Parse standard form data and JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pendingInterceptions = {};

const FRONTEND_UI = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Interceptor</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --bg: #121212; --card: #1e1e1e; --border: #333; --accent: #2196f3; --danger: #f44336; --success: #4caf50; --text: #e0e0e0; --tab-height: 50px; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        
        body { margin: 0; font-family: sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

        /* TOP NAVIGATION */
        .top-nav { 
            height: var(--tab-height); background: #1a1a1a; border-bottom: 1px solid var(--border); 
            display: flex; justify-content: space-around; align-items: center; 
            padding-top: env(safe-area-inset-top); flex-shrink: 0; z-index: 999;
        }
        .nav-item { 
            flex: 1; height: 100%; display: flex; align-items: center; justify-content: center; 
            color: #666; font-size: 14px; font-weight: bold; background: none; border: none; 
            border-bottom: 3px solid transparent; position: relative; cursor: pointer;
        }
        .nav-item.active { color: var(--accent); border-bottom-color: var(--accent); }
        .badge-dot { 
            position: absolute; top: 12px; right: 10px; width: 8px; height: 8px; 
            background: var(--danger); border-radius: 50%; display: none; 
        }
        .badge-dot.visible { display: block; }

        /* MAIN CONTENT */
        .viewport { flex: 1; position: relative; overflow: hidden; display: flex; flex-direction: column; }
        .view { display: none; height: 100%; flex-direction: column; width: 100%; }
        .view.active { display: flex; }

        /* BROWSER TAB */
        .url-bar { padding: 10px; background: var(--card); display: flex; gap: 8px; border-bottom: 1px solid var(--border); }
        .url-input { flex: 1; background: #2d2d2d; border: 1px solid #444; color: white; padding: 8px; border-radius: 4px; outline: none; }
        .btn-go { background: var(--success); color: white; border: none; padding: 0 15px; border-radius: 4px; font-weight: bold; }
        iframe { flex: 1; border: none; background: white; }

        /* INTERCEPTOR TAB */
        .interceptor-view { padding: 20px; overflow-y: auto; flex: 1; }
        .req-card { background: var(--card); border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--border); min-height: 100%; }
        .code-input { background: #000; border: 1px solid #333; color: #0f0; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 13px; width: 100%; }
        textarea.code-input { flex: 1; resize: none; min-height: 200px; }
        .action-row { display: flex; gap: 10px; margin-top: auto; }
        .btn { flex: 1; padding: 15px; border: none; border-radius: 4px; font-weight: bold; color: white; font-size: 14px; }
        .btn-fwd { background: var(--success); }
        .btn-drop { background: var(--danger); }
        .btn-rep { background: #ff9800; color: black; }

        /* REPEATER TAB */
        .repeater-view { padding: 20px; display: flex; flex-direction: column; gap: 10px; height: 100%; overflow-y: auto; }
        #rep-response { white-space: pre-wrap; }
    </style>
</head>
<body>

    <!-- TOP NAVIGATION -->
    <div class="top-nav">
        <button class="nav-item active" onclick="switchTab('browser')">Browser</button>
        <button class="nav-item" onclick="switchTab('intercept')">
            Intercept
            <div id="badge-intercept" class="badge-dot"></div>
        </button>
        <button class="nav-item" onclick="switchTab('repeat')">Repeater</button>
    </div>

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
                    <h3>Waiting for Traffic...</h3>
                    <p>Click a link or submit a form in the Browser.</p>
                </div>

                <div id="intercept-active" class="req-card" style="display:none;">
                    <div style="display:flex; justify-content:space-between; color:#888; font-size:12px;">
                        <span id="int-badge" style="font-weight:bold; font-size:14px;">REQUEST</span>
                        <span>ID: <span id="int-id">0</span></span>
                    </div>

                    <div id="int-meta-group" style="display:flex; gap:5px;">
                        <select id="int-method" class="code-input" style="width:80px;"><option>GET</option><option>POST</option></select>
                        <input type="text" id="int-url" class="code-input" style="flex:1;">
                    </div>

                    <div id="int-status-group" style="display:none;">
                        <input type="number" id="int-status" class="code-input" placeholder="Status Code">
                    </div>

                    <textarea id="int-body" class="code-input" placeholder="Body / Payload"></textarea>

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
                    <select id="rep-method" class="code-input" style="width:80px;"><option>GET</option><option>POST</option></select>
                    <input type="text" id="rep-url" class="code-input" style="flex:1;">
                </div>
                <textarea id="rep-body" class="code-input" style="height:120px; min-height:120px; flex:none;"></textarea>
                <button class="btn btn-fwd" onclick="executeRepeater()" id="btn-rep-send">Send Request</button>
                <div id="rep-response" class="code-input" style="flex:1; overflow:auto; background:#111; color:#ccc;">Response...</div>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let currentPhase = null; 
        let currentId = null;

        // Listeners
        socket.on('intercept_request', (data) => handleTraffic('request', data));
        socket.on('intercept_response', (data) => handleTraffic('response', data));

        function handleTraffic(type, data) {
            // 1. Force Switch to Interceptor Tab so user sees it
            switchTab('intercept');

            // 2. Visuals
            document.getElementById('badge-intercept').classList.add('visible');
            currentPhase = type;
            currentId = data.id;

            document.getElementById('intercept-empty').style.display = 'none';
            document.getElementById('intercept-active').style.display = 'flex';
            document.getElementById('int-id').innerText = data.id;
            
            // Body Formatting
            let displayBody = data.body;
            if (typeof displayBody === 'object') {
                // Pretty print object if possible, or convert to query string
                try { 
                    displayBody = JSON.stringify(displayBody, null, 2); 
                } catch(e) {
                    displayBody = data.body;
                }
            }
            document.getElementById('int-body').value = displayBody || '';

            // Setup Fields based on Type
            const badge = document.getElementById('int-badge');
            
            if (type === 'request') {
                badge.innerText = 'OUTGOING REQUEST';
                badge.style.color = '#2196f3'; // Blue
                document.getElementById('int-meta-group').style.display = 'flex';
                document.getElementById('int-status-group').style.display = 'none';
                document.getElementById('btn-to-rep').style.display = 'block';
                document.getElementById('int-url').value = data.url;
                document.getElementById('int-method').value = data.method;
            } else {
                badge.innerText = 'INCOMING RESPONSE';
                badge.style.color = '#4caf50'; // Green
                document.getElementById('int-meta-group').style.display = 'none';
                document.getElementById('int-status-group').style.display = 'block';
                document.getElementById('btn-to-rep').style.display = 'none';
                document.getElementById('int-status').value = data.status;
            }
        }

        function forwardRequest() {
            if (!currentId) return;
            let body = document.getElementById('int-body').value;

            // Try to parse back to object if it looks like JSON (for repeater compatibility)
            try { body = JSON.parse(body); } catch(e) {}

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
                // Ensure body is stringified properly if it's an object
                let bodyVal = document.getElementById('rep-body').value;
                try { bodyVal = JSON.parse(bodyVal); } catch(e){}

                const res = await fetch('/api/repeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: document.getElementById('rep-url').value,
                        method: document.getElementById('rep-method').value,
                        body: bodyVal
                    })
                });
                const data = await res.json();
                out.innerText = 'STATUS: ' + data.status + '\\n\\n' + data.body;
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

app.get('/', (req, res) => res.send(FRONTEND_UI));

app.post('/api/repeat', async (req, res) => {
    try {
        const { url, method, body } = req.body;
        // Fix for Repeater: Send form data correctly if needed
        let dataToSend = body;
        let contentType = 'application/json';

        // If it was parsed as an object but method is POST, try to convert to form data if it looks like one
        if (method === 'POST' && typeof body === 'object') {
            dataToSend = querystring.stringify(body);
            contentType = 'application/x-www-form-urlencoded';
        }

        const response = await axios({
            url, method, data: dataToSend,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': contentType },
            validateStatus: () => true, responseType: 'arraybuffer'
        });
        res.json({ status: response.status, body: response.data.toString('utf-8') });
    } catch (err) { res.status(500).json({ status: 500, body: err.message }); }
});

app.all('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.send("No URL provided");
    const reqId = Date.now().toString();
    const incomingMethod = req.method;
    const incomingBody = (incomingMethod === 'POST') ? req.body : '';

    try {
        // --- PHASE 1: INTERCEPT REQUEST ---
        io.emit('intercept_request', { 
            id: reqId, url: targetUrl, method: incomingMethod, body: incomingBody 
        });
        
        const modReq = await waitForSignal(reqId, 'request');

        // --- PHASE 2: REAL REQUEST ---
        // Crucial Fix: Ensure Form Data is stringified if Axios needs it
        let realBody = modReq.body;
        let contentType = 'application/x-www-form-urlencoded'; // Standard for forms

        // If the body is an object (from our express parser), stringify it for the outgoing request
        if (typeof realBody === 'object' && modReq.method === 'POST') {
            realBody = querystring.stringify(realBody);
        }
        // If user typed raw JSON in interceptor, let's try to send as JSON? 
        // For now, we stick to form simulation as that's what browsers do naturally.

        const response = await axios({
            url: modReq.url,
            method: modReq.method,
            data: realBody,
            headers: { 
                'User-Agent': 'Mozilla/5.0',
                'Content-Type': contentType 
            },
            validateStatus: () => true,
            responseType: 'arraybuffer'
        });

        // --- PHASE 3: INTERCEPT RESPONSE ---
        let bodyStr = response.data.toString('utf-8');
        io.emit('intercept_response', { id: reqId, status: response.status, body: bodyStr });
        const modRes = await waitForSignal(reqId, 'response');

        // --- PHASE 4: INJECT SCRIPTS & SEND ---
        let finalBody = modRes.body;
        res.removeHeader("Content-Security-Policy");
        res.removeHeader("X-Frame-Options");

        const scriptInjection = `
            <base href="${modReq.url}">
            <script>
                const PROXY_BASE = window.location.origin + '/proxy?url=';

                document.addEventListener('click', function(e) {
                    const anchor = e.target.closest('a');
                    if (anchor && anchor.href && !anchor.href.startsWith('javascript:')) {
                        e.preventDefault();
                        window.location.href = PROXY_BASE + encodeURIComponent(anchor.href);
                    }
                });
                
                document.addEventListener('submit', function(e) {
                    e.preventDefault();
                    const form = e.target;
                    const action = form.action || window.location.href;
                    const method = (form.method || 'GET').toUpperCase();
                    
                    if (method === 'POST') {
                        const tempForm = document.createElement('form');
                        tempForm.method = 'POST';
                        tempForm.action = PROXY_BASE + encodeURIComponent(action);
                        tempForm.style.display = 'none';
                        
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
                        const formData = new FormData(form);
                        const params = new URLSearchParams(formData);
                        const separator = action.includes('?') ? '&' : '?';
                        const fullUrl = action + separator + params.toString();
                        window.location.href = PROXY_BASE + encodeURIComponent(fullUrl);
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


