const express = require('express');
const http = require('http');
const app = express();
const server = http.createServer(app);

// Simple in-memory store
let visitorCount = 0;
const visitors = new Map();

// Allow CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Main page (for iframe)
app.get('/', (req, res) => {
    const visitorId = req.query.id || `visitor_${Date.now()}_${Math.random()}`;
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Counter</title>
        <script>
            // Send visitor count to parent
            function updateParent(count) {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({
                        type: 'visitorCount',
                        count: count
                    }, '*');
                }
            }
            
            // Poll server for count
            async function getCount() {
                try {
                    const response = await fetch('/count');
                    const data = await response.json();
                    updateParent(data.count);
                    
                    // Register this visitor
                    await fetch('/visit?id=${visitorId}');
                } catch (error) {
                    console.log('Counter offline');
                }
            }
            
            // Initial load
            getCount();
            
            // Update every 10 seconds
            setInterval(getCount, 10000);
            
            // Clean up on page unload
            window.addEventListener('beforeunload', () => {
                fetch('/leave?id=${visitorId}', { method: 'POST' });
            });
        </script>
    </head>
    <body style="margin:0;padding:0;">
        <!-- Empty page for iframe -->
    </body>
    </html>
    `);
});

// API: Register visit
app.get('/visit', (req, res) => {
    const id = req.query.id;
    if (id) {
        visitors.set(id, Date.now());
        visitorCount = visitors.size;
    }
    res.json({ success: true });
});

// API: Remove visitor
app.post('/leave', (req, res) => {
    const id = req.query.id;
    if (id && visitors.has(id)) {
        visitors.delete(id);
        visitorCount = visitors.size;
    }
    res.json({ success: true });
});

// API: Get current count
app.get('/count', (req, res) => {
    // Clean up old visitors (30 seconds timeout)
    const now = Date.now();
    for (const [id, timestamp] of visitors.entries()) {
        if (now - timestamp > 30000) { // 30 seconds
            visitors.delete(id);
        }
    }
    visitorCount = visitors.size;
    
    res.json({ 
        count: visitorCount,
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        count: visitorCount,
        uptime: process.uptime()
    });
});

// Clean up old visitors every 20 seconds
setInterval(() => {
    const now = Date.now();
    for (const [id, timestamp] of visitors.entries()) {
        if (now - timestamp > 30000) { // 30 seconds
            visitors.delete(id);
        }
    }
    visitorCount = visitors.size;
}, 20000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Visitor counter server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints:`);
    console.log(`   http://localhost:${PORT}/count - Get current count`);
    console.log(`   http://localhost:${PORT}/health - Health check`);
});
