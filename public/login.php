<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp Clone - Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); width: 300px; }
        input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #075e54; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        a { display: block; text-align: center; margin-top: 15px; color: #075e54; text-decoration: none; font-size: 14px; }
    </style>
</head>
<body>
    <div class="card">
        <h2 style="text-align: center; color: #075e54;">Login</h2>
        <form action="/login" method="POST">
            <input type="text" name="phone" placeholder="Phone Number" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Login</button>
        </form>
        <a href="/register.html">New user? Register here</a>
    </div>
</body>
</html>
