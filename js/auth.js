localStorage.setItem('userId', data.id);
localStorage.setItem('username', data.username);
localStorage.setItem('rol', data.rol);
localStorage.setItem('token', data.token);
localStorage.setItem('lastActivity', Date.now().toString());
window.location.replace('index.html');