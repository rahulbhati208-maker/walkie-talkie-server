const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');

// --- RENDER CONFIGURATION ---
const app = express();
const server = http.createServer(app);

// Use the PORT Render gives us, or 10000 if testing locally
const PORT = process.env.PORT || 10000;

// Setup Socket.io with CORS enabled for the cloud
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Store pending requests (The "Pause" Memory)
const pendingInterceptions = {};

// --- 1. THE FRONTEND UI (Served as a String) ---
const FRONTEND_UI = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Walkie-Talkie Interceptor</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --bg: #121212; --panel: #1e1e1e; --border: #333; --accent: #00bcd4; --text: #e0e0e0; }
        body { margin: 0; font-family: 'Segoe UI', monospace; background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }
        
        /* SIDEBAR */
        .sidebar { width: 250px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        .sidebar h2 { padding: 20px; margin: 0; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .nav-btn { padding: 15px 20px; background: transparent; border: none; color: #888; text-align: left; cursor: pointer; border-left: 3px solid transparent; transition: 0.2s; font-size: 14px; }
        .nav-btn:hover { background: #2d2d2d; color: white; }
        .nav-btn.active { background: #252526; color: white; border-left-color: var(--accent); }
        .nav-btn.alert { color: #ff9800; border-left-color: #ff9800; animation: flash 1s infinite; }
        @keyframes flash { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

        /* MAIN AREA */
        .main { flex: 1; display: flex; flex-direction: column; position: relative; }
        .view { display: none; height: 100%; flex-direction: column; }
        .view.active { display: flex; }

        /* BROWSER TAB */
        .address-bar { padding: 10px; background: var(--panel); border-bottom: 1px solid var(--border); display: flex; gap: 10px; }
        .address-bar input { flex: 1; background: #2d2d2d; border: 1px solid #444; color: white; padding: 8px 12px; border-radius: 4px; font-family: monospace; }
        .btn-go { background: #4caf50; color: white; border: none; padding: 0 20px; cursor: pointer; font-weight: bold; border-radius: 4px; }
        iframe { flex: 1; border: none; background: white; }

        /* INTERCEPTOR TAB */
        .interceptor-container { padding: 20px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
        .empty-msg { text-align: center; color: #555; margin-top: 100px; }
        
        .intercept-card { display: flex; flex-direction: column; height: 100%; gap: 15px; }
        .card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
        .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .badge.req { background: #2196f3; color: white; }
        .badge.res { background: #4caf50; color: white; }

        .editor-section { flex: 1; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
        .field-group { display: flex; flex-direction: column; gap: 5px; }
        label { font-size: 12px; color: #888; }
        input, textarea, select { background: #1a1a1a; border: 1px solid #444; color: #0f0; padding: 10px; font-family: 'Consolas', monospace; font-size: 13px; }
        textarea { resize: vertical; min-height: 200px; }

        .controls { padding-top: 15px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }
        .btn-fwd { background: var(--accent); color: white; border: none; padding: 10px 20px; cursor: pointer; font-weight: bold; }
        .btn-drop { background: #f44336; color: white; border: none; padding: 10px 20px; cursor: pointer; }
    </style>
</head>
<body>

    <div class="sidebar">
        <h2>Interceptor Tool</h2>
        <button class="nav-btn active" id="tab-browser" onclick="switchTab('browser')">🌐 Browser</button>
        <button class="nav-btn" id="tab-interceptor" onclick="switchTab('interceptor')">🛡️ Interceptor</button>
    </div>

    <div class="main">
        <!-- BROWSER VIEW -->
        <div id="view-browser" class="view active">
            <div class="address-bar">
                <input type="text" id="url-input" value="https://jsonplaceholder.typicode.com/posts/1" placeholder="Enter URL...">
                <button class="btn-go" onclick="navigate()">GO</button>
            </div>
            <iframe id="web-frame" src="about:blank"></iframe>
        </div>

        <!-- INTERCEPTOR VIEW -->
        <div id="view-interceptor" class="view">
            <div id="empty-state" class="empty-msg">
                <h3>Tunnel Open</h3>
                <p>Waiting for traffic...</p>
            </div>
            
            <div id="active-intercept" class="interceptor-container" style="display:none;">
                <div class="intercept-card">
                    <div class="card-header">
                        <span id="int-type" class="badge req">Request</span>
                        <span style="font-size:12px; color:#666">ID: <span id="int-id">0</span></span>
                    </div>

                    <div class="editor-section">
                        <!-- Request Fields -->
                        <div id="req-fields">
                            <div class="field-group">
                                <label>Target URL</label>
                                <input type="text" id="edit-url">
                            </div>
                            <div class="field-group">
                                <label>Method</label>
                                <select id="edit-method">
                                    <option value="GET">GET</option>
                                    <option value="POST">POST</option>
                                </select>
                            </div>
                        </div>

                        <!-- Response Fields -->
                        <div id="res-fields" style="display:none;">
                            <div class="field-group">
                                <label>Status Code</label>
                                <input type="number" id="edit-status">
                            </div>
                        </div>

                        <!-- Shared Body Field -->
                        <div class="field-group" style="flex:1;">
                            <label>Body / Payload / HTML</label>
                            <textarea id="edit-body"></textarea>
                        </div>
                    </div>

                    <div class="controls">
                        <button class="btn-drop" onclick="dropAction()">Drop</button>
                        <button class="btn-fwd" onclick="forwardAction()">Forward >></button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Connect to the Render Server automatically
        const socket = io();
        
        let currentPhase = null; // 'request' or 'response'
        let currentId = null;

        // --- SOCKET LISTENERS ---

        // 1. Intercept Request
        socket.on('intercept_request', (data) => {
            setupInterceptor('request', data);
        });

        // 2. Intercept Response
        socket.on('intercept_response', (data) => {
            setupInterceptor('response', data);
        });

        function setupInterceptor(type, data) {
            currentPhase = type;
            currentId = data.id;

            // Show UI
            document.getElementById('empty-state').style.display = 'none';
            document.getElementById('active-intercept').style.display = 'flex';
            
            // Alert user visually
            const tabBtn = document.getElementById('tab-interceptor');
            tabBtn.classList.add('alert');

            // Populate Fields
            document.getElementById('int-id').innerText = data.id;
            document.getElementById('edit-body').value = data.body || '';

            if (type === 'request') {
                document.getElementById('int-type').className = 'badge req';
                document.getElementById('int-type').innerText = 'OUTGOING REQUEST';
                document.getElementById('req-fields').style.display = 'block';
                document.getElementById('res-fields').style.display = 'none';
                
                document.getElementById('edit-url').value = data.url;
                document.getElementById('edit-method').value = data.method;
            } else {
                document.getElementById('int-type').className = 'badge res';
                document.getElementById('int-type').innerText = 'INCOMING RESPONSE';
                document.getElementById('req-fields').style.display = 'none';
                document.getElementById('res-fields').style.display = 'block';
                
                document.getElementById('edit-status').value = data.status;
            }
        }

        // --- ACTIONS ---

        function forwardAction() {
            if (!currentId) return;

            const body = document.getElementById('edit-body').value;

            if (currentPhase === 'request') {
                const url = document.getElementById('edit-url').value;
                const method = document.getElementById('edit-method').value;
                socket.emit('forward_request', { id: currentId, url, method, body });
            } else {
                const status = document.getElementById('edit-status').value;
                socket.emit('forward_response', { id: currentId, status, body });
                
                // If we forwarded a response, the cycle is done. Go back to browser.
                switchTab('browser');
            }

            resetInterceptor();
        }

        function dropAction() {
            // Simply hide UI for this demo
            resetInterceptor();
            switchTab('browser');
        }

        function resetInterceptor() {
            document.getElementById('empty-state').style.display = 'block';
            document.getElementById('active-intercept').style.display = 'none';
            document.getElementById('tab-interceptor').classList.remove('alert');
            currentId = null;
        }

        // --- NAVIGATION & TABS ---

        function navigate() {
            const url = document.getElementById('url-input').value;
            // Point iframe to our server's proxy route
            document.getElementById('web-frame').src = '/proxy?url=' + encodeURIComponent(url);
        }

        function switchTab(tab) {
            document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
            
            document.getElementById('view-' + tab).classList.add('active');
            document.getElementById('tab-' + tab).classList.add('active');

            if(tab === 'interceptor') {
                document.getElementById('tab-interceptor').classList.remove('alert');
            }
        }
    </script>
</body>
</html>
`;

// --- 2. BACKEND SERVER LOGIC ---

app.use(express.json());

// Serve the UI
app.get('/', (req, res) => {
    res.send(FRONTEND_UI);
});

// The Main Proxy Engine
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.send('No URL provided');

    const reqId = Date.now().toString(); // Unique ID for this traffic
    console.log(`[${reqId}] Traffic: ${targetUrl}`);

    try {
        // --- PHASE 1: PAUSE OUTGOING REQUEST ---
        io.emit('intercept_request', {
            id: reqId,
            url: targetUrl,
            method: 'GET',
            body: '' 
        });

        // Wait for user to click "Forward"
        const modifiedReq = await waitForSignal(reqId, 'request');

        // --- PHASE 2: EXECUTE REAL REQUEST ---
        const response = await axios({
            url: modifiedReq.url,
            method: modifiedReq.method,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            validateStatus: () => true, // Don't throw error on 404
            responseType: 'arraybuffer' // Get raw data
        });

        // Convert buffer to string
        let bodyStr = response.data.toString('utf-8');

        // --- PHASE 3: PAUSE INCOMING RESPONSE ---
        io.emit('intercept_response', {
            id: reqId,
            status: response.status,
            body: bodyStr
        });

        // Wait for user to click "Forward" again
        const modifiedRes = await waitForSignal(reqId, 'response');

        // --- PHASE 4: SEND TO BROWSER ---
        // Inject <base> tag so images load correctly from the original site
        let finalBody = modifiedRes.body;
        if (finalBody.includes('<head>')) {
            finalBody = finalBody.replace('<head>', `<head><base href="${modifiedReq.url}">`);
        }

        res.status(parseInt(modifiedRes.status)).send(finalBody);

    } catch (err) {
        console.error(err);
        res.status(500).send(`Proxy Error: ${err.message}`);
    }
});

// Helper: Wraps socket events in a Promise
function waitForSignal(id, type) {
    return new Promise((resolve, reject) => {
        pendingInterceptions[`${id}_${type}`] = resolve;

        // Timeout after 60 seconds
        setTimeout(() => {
            if (pendingInterceptions[`${id}_${type}`]) {
                delete pendingInterceptions[`${id}_${type}`];
                reject(new Error("Interceptor Timeout"));
            }
        }, 60000);
    });
}

// Socket Event Handling
io.on('connection', (socket) => {
    socket.on('forward_request', (data) => {
        const key = `${data.id}_request`;
        if (pendingInterceptions[key]) {
            pendingInterceptions[key](data);
            delete pendingInterceptions[key];
        }
    });

    socket.on('forward_response', (data) => {
        const key = `${data.id}_response`;
        if (pendingInterceptions[key]) {
            pendingInterceptions[key](data);
            delete pendingInterceptions[key];
        }
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`\n🔥 Server is live on PORT: ${PORT}`);
});

