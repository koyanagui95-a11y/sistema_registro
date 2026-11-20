const CONFIG = {
    API_URL: (() => {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8080/api';
        return 'https://riego-back-kzob.onrender.com/api';
    })(),
    SESSION_TIMEOUT_MS: 30 * 60 * 1000
};

(function () {
    const $ = (id) => document.getElementById(id);
    let inactivityTimer = null;

    function getToken() { return localStorage.getItem('adminToken'); }

    function cerrarSesion(msg) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUsername');
        localStorage.removeItem('adminLastActivity');
        if (msg) alert(msg);
        window.location.replace('index.html');
    }

    function resetTimer() {
        if (!getToken()) return;
        localStorage.setItem('adminLastActivity', Date.now().toString());
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => cerrarSesion('Sesión expirada por inactividad.'), CONFIG.SESSION_TIMEOUT_MS);
    }

    function verificarSesionActiva() {
        const last = parseInt(localStorage.getItem('adminLastActivity') || '0', 10);
        if (!getToken() || !last || Date.now() - last > CONFIG.SESSION_TIMEOUT_MS) {
            cerrarSesion('Sesión expirada. Vuelve a iniciar sesión.');
            return false;
        }
        resetTimer();
        return true;
    }

    async function apiFetch(path, opts = {}) {
        const token = getToken();
        const res = await fetch(`${CONFIG.API_URL}${path}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(opts.headers || {})
            }
        });
        if (res.status === 401 || res.status === 403) {
            cerrarSesion('Sesión inválida. Vuelve a iniciar sesión.');
            throw new Error('No autorizado');
        }
        return res;
    }

    function showAlert(elId, message, type = 'danger') {
        const el = $(elId);
        if (!el) return;
        el.className = `alert alert-${type}`;
        el.textContent = message;
        el.classList.remove('d-none');
    }

    function hideAlert(elId) {
        const el = $(elId);
        if (el) el.classList.add('d-none');
    }

    const loginForm = $('loginAdminForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideAlert('alert');

            const username = $('username').value.trim();
            const password = $('password').value;
            const btn = $('btnLogin');
            const btnText = $('btnLoginText');
            const spinner = $('spinner');

            if (username.length < 4) return showAlert('alert', 'Usuario inválido.', 'warning');
            if (password.length < 8) return showAlert('alert', 'Contraseña inválida.', 'warning');

            btn.disabled = true;
            spinner.classList.remove('d-none');
            btnText.textContent = 'Verificando...';

            try {
                const res = await fetch(`${CONFIG.API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.token) throw new Error(data.mensaje || 'Credenciales inválidas.');
                if (data.rol !== 'ADMIN') throw new Error('Esta cuenta no tiene permisos de administrador.');

                localStorage.setItem('adminToken', data.token);
                localStorage.setItem('adminUsername', data.username);
                localStorage.setItem('adminLastActivity', Date.now().toString());
                window.location.replace('dashboard.html');
            } catch (err) {
                showAlert('alert', err.message || 'Error al iniciar sesión.', 'danger');
                btn.disabled = false;
                spinner.classList.add('d-none');
                btnText.textContent = 'Acceder al panel';
            }
        });
        return;
    }

    if (!verificarSesionActiva()) return;

    ['click', 'keydown', 'mousemove', 'scroll'].forEach(evt => {
        document.addEventListener(evt, resetTimer, { passive: true });
    });

    if ($('adminActual')) $('adminActual').textContent = localStorage.getItem('adminUsername') || 'admin';

    if ($('btnLogout')) {
        $('btnLogout').addEventListener('click', () => {
            if (confirm('¿Cerrar sesión?')) cerrarSesion();
        });
    }

    const registerForm = $('registerClientForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideAlert('registerAlert');
            $('registerResult').classList.add('d-none');

            const nombres = $('nombres').value.trim();
            const apellidos = $('apellidos').value.trim();
            const correoPersonal = $('correoPersonal').value.trim();
            const telefono = $('telefono').value.trim();
            const password = $('password').value;

            if (!nombres || !apellidos) return showAlert('registerAlert', 'Nombres y apellidos son obligatorios.', 'warning');
            if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(correoPersonal)) {
                return showAlert('registerAlert', 'Correo debe ser @gmail.com', 'warning');
            }

            const btn = $('btnRegister');
            const spinner = $('registerSpinner');
            btn.disabled = true;
            spinner.classList.remove('d-none');

            try {
                const res = await apiFetch('/admin/clientes', {
                    method: 'POST',
                    body: JSON.stringify({ nombres, apellidos, correoPersonal, telefono, password })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'No se pudo registrar.');

                $('registerResult').className = 'alert alert-success mt-4';
                $('registerResult').classList.remove('d-none');
                $('registerResult').innerHTML = `
                    <h5 class="fw-bold mb-2"><i class="bi bi-check-circle me-1"></i>Cliente registrado</h5>
                    <p class="mb-1"><strong>Usuario:</strong> ${data.username}</p>
                    <p class="mb-1"><strong>Estado:</strong> ${data.estado}</p>
                    <p class="mb-0 small text-muted">Activa al cliente desde la pestaña "Clientes Registrados" cuando el ESP32 esté listo.</p>
                `;
                registerForm.reset();
                $('password').value = '123456789';
                cargarClientes();
            } catch (err) {
                showAlert('registerAlert', err.message || 'Error al registrar.', 'danger');
            } finally {
                btn.disabled = false;
                spinner.classList.add('d-none');
            }
        });
    }

    async function cargarClientes() {
        const tabla = $('clientesTable');
        if (!tabla) return;
        tabla.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Cargando...</td></tr>';

        try {
            const res = await apiFetch('/admin/clientes');
            if (!res.ok) throw new Error('No se pudieron cargar los clientes');
            const clientes = await res.json();

            if ($('badgeTotal')) $('badgeTotal').textContent = clientes.length;

            if (clientes.length === 0) {
                tabla.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Sin clientes.</td></tr>';
                return;
            }

            tabla.innerHTML = '';
            clientes.forEach(c => {
                const estado = c.estado === 'ACTIVO'
                    ? '<span class="badge bg-success">ACTIVO</span>'
                    : '<span class="badge bg-warning text-dark">PENDIENTE</span>';
                const boton = c.estado === 'ACTIVO'
                    ? '<button class="btn btn-sm btn-outline-secondary" disabled>Ya activo</button>'
                    : `<button class="btn btn-sm btn-success" onclick="window.__activarCliente(${c.id})"><i class="bi bi-check2-circle me-1"></i>Activar</button>`;

                tabla.innerHTML += `
                    <tr>
                        <td>${c.id}</td>
                        <td><strong>${c.nombres} ${c.apellidos}</strong></td>
                        <td>${c.usuario?.username || '--'}</td>
                        <td>${c.correoPersonal || '--'}</td>
                        <td>${c.telefono || '--'}</td>
                        <td>${estado}</td>
                        <td>${boton}</td>
                    </tr>`;
            });
        } catch (err) {
            tabla.innerHTML = `<tr><td colspan="7" class="text-center text-danger">${err.message}</td></tr>`;
        }
    }

    window.__activarCliente = async function (clienteId) {
        if (!confirm('¿Activar este cliente? Se enviarán las credenciales a su correo personal.')) return;
        try {
            const res = await apiFetch(`/admin/clientes/${clienteId}/activar`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.mensaje || 'No se pudo activar');
            alert(data.mensaje || 'Cliente activado.');
            cargarClientes();
        } catch (err) {
            alert(err.message || 'Error al activar.');
        }
    };

    if ($('btnRefresh')) $('btnRefresh').addEventListener('click', cargarClientes);
    if ($('tab-list-btn')) $('tab-list-btn').addEventListener('click', cargarClientes);
    cargarClientes();
})();s