const token = localStorage.getItem('token');
const usuarioId = localStorage.getItem('userId');
const username = localStorage.getItem('username');

if (!token || !usuarioId) {
    window.location.replace('login.html');
    return;
}

const TIMEOUT_MS = 30 * 60 * 1000;
let _timer = null;

function resetTimer() {
    localStorage.setItem('lastActivity', Date.now().toString());
    clearTimeout(_timer);
    _timer = setTimeout(() => {
        localStorage.clear();
        alert('Sesión expirada por inactividad.');
        window.location.replace('login.html');
    }, TIMEOUT_MS);
}

const last = parseInt(localStorage.getItem('lastActivity') || '0', 10);
if (!last || Date.now() - last > TIMEOUT_MS) {
    localStorage.clear();
    window.location.replace('login.html');
    return;
}
resetTimer();
['click', 'keydown', 'mousemove', 'scroll'].forEach(evt =>
    document.addEventListener(evt, resetTimer, { passive: true }));