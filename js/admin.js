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

    function getToken() {
        return localStorage.getItem('adminToken');
    }

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
        inactivityTimer = setTimeout(
            () => cerrarSesion('Sesión expirada por inactividad.'),
            CONFIG.SESSION_TIMEOUT_MS
        );
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
            let msg = 'Sesión inválida. Vuelve a iniciar sesión.';
            try {
                const data = await res.clone().json();
                if (data && data.mensaje) msg = data.mensaje;
            } catch (_) {}
            cerrarSesion(msg);
            throw new Error(msg);
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

    // ============================
    // LOGIN
    // ============================
    const loginForm = $('loginAdminForm');
    if (loginForm) {
        const toggle = $('togglePass');
        if (toggle) {
            toggle.addEventListener('click', () => {
                const input = $('password');
                const icon = toggle.querySelector('i');
                const isPass = input.type === 'password';
                input.type = isPass ? 'text' : 'password';
                icon.className = isPass ? 'bi bi-eye-slash' : 'bi bi-eye';
            });
        }

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

                if (!res.ok || !data.token) {
                    throw new Error(data.mensaje || 'Credenciales inválidas.');
                }
                if (data.rol !== 'ADMIN') {
                    throw new Error('Esta cuenta no tiene permisos de administrador.');
                }

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

    // ============================
    // DASHBOARD
    // ============================
    if (!verificarSesionActiva()) return;

    ['click', 'keydown', 'mousemove', 'scroll'].forEach(evt => {
        document.addEventListener(evt, resetTimer, { passive: true });
    });

    if ($('adminActual')) {
        $('adminActual').textContent = localStorage.getItem('adminUsername') || 'admin';
    }

    if ($('btnLogout')) {
        $('btnLogout').addEventListener('click', () => {
            if (confirm('¿Cerrar sesión del panel administrador?')) cerrarSesion();
        });
    }

    // ============================
    // REGISTRAR CLIENTE
    // ============================
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

            if (!nombres || !apellidos) {
                return showAlert('registerAlert', 'Nombres y apellidos son obligatorios.', 'warning');
            }
            if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(correoPersonal)) {
                return showAlert('registerAlert', 'Correo debe ser @gmail.com', 'warning');
            }
            if (password.length < 8) {
                return showAlert('registerAlert', 'Contraseña mínima 8 caracteres.', 'warning');
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
                    <p class="mb-1"><strong>Usuario generado:</strong> ${data.username}</p>
                    <p class="mb-1"><strong>Email de login:</strong> ${data.email}</p>
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

    // ============================
    // LISTAR CLIENTES
    // ============================
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
                tabla.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Sin clientes registrados.</td></tr>';
                return;
            }

            tabla.innerHTML = '';
            clientes.forEach(c => {
                let estadoBadge, botones;

                switch (c.estado) {
                    case 'ACTIVO':
                        estadoBadge = '<span class="badge bg-success">ACTIVO</span>';
                        botones = `
                            <button class="btn btn-sm btn-outline-primary" onclick="window.__editarCliente(${c.id})" title="Editar">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-warning" onclick="window.__suspenderCliente(${c.id})" title="Suspender">
                                <i class="bi bi-pause-circle"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="window.__eliminarCliente(${c.id})" title="Eliminar">
                                <i class="bi bi-trash"></i>
                            </button>`;
                        break;
                    case 'SUSPENDIDO':
                        estadoBadge = '<span class="badge bg-danger">SUSPENDIDO</span>';
                        botones = `
                            <button class="btn btn-sm btn-outline-primary" onclick="window.__editarCliente(${c.id})" title="Editar">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-success" onclick="window.__reactivarCliente(${c.id})" title="Reactivar">
                                <i class="bi bi-play-circle"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="window.__eliminarCliente(${c.id})" title="Eliminar">
                                <i class="bi bi-trash"></i>
                            </button>`;
                        break;
                    default: // PENDIENTE
                        estadoBadge = '<span class="badge bg-warning text-dark">PENDIENTE</span>';
                        botones = `
                            <button class="btn btn-sm btn-success" onclick="window.__activarCliente(${c.id})" title="Activar">
                                <i class="bi bi-check2-circle"></i> Activar
                            </button>
                            <button class="btn btn-sm btn-outline-primary" onclick="window.__editarCliente(${c.id})" title="Editar">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="window.__eliminarCliente(${c.id})" title="Eliminar">
                                <i class="bi bi-trash"></i>
                            </button>`;
                }

                tabla.innerHTML += `
                    <tr>
                        <td>${c.id}</td>
                        <td><strong>${c.nombres} ${c.apellidos}</strong></td>
                        <td>${c.usuario?.username || '--'}</td>
                        <td>${c.correoPersonal || '--'}</td>
                        <td>${c.telefono || '--'}</td>
                        <td>${estadoBadge}</td>
                        <td class="text-center">${botones}</td>
                    </tr>`;
            });
        } catch (err) {
            tabla.innerHTML = `<tr><td colspan="7" class="text-center text-danger">${err.message}</td></tr>`;
        }
    }

    // ============================
    // ACTIVAR
    // ============================
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

    // ============================
    // EDITAR
    // ============================
    window.__editarCliente = async function (clienteId) {
        try {
            const res = await apiFetch('/admin/clientes');
            if (!res.ok) throw new Error('No se pudo cargar');
            const clientes = await res.json();
            const c = clientes.find(x => x.id === clienteId);
            if (!c) return;

            $('editClienteId').value = c.id;
            $('editNombres').value = c.nombres;
            $('editApellidos').value = c.apellidos;
            $('editCorreoPersonal').value = c.correoPersonal || '';
            $('editTelefono').value = c.telefono || '';
            new bootstrap.Modal($('editClienteModal')).show();
        } catch (err) {
            alert(err.message);
        }
    };

    if ($('btnSaveEdit')) {
        $('btnSaveEdit').addEventListener('click', async () => {
            const id = $('editClienteId').value;
            const body = {
                nombres: $('editNombres').value.trim(),
                apellidos: $('editApellidos').value.trim(),
                correoPersonal: $('editCorreoPersonal').value.trim(),
                telefono: $('editTelefono').value.trim()
            };

            if (!body.nombres || !body.apellidos || !body.correoPersonal) {
                return alert('Nombres, apellidos y correo son obligatorios.');
            }
            if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(body.correoPersonal)) {
                return alert('Correo debe ser @gmail.com');
            }

            try {
                const res = await apiFetch(`/admin/clientes/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(body)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'Error');

                bootstrap.Modal.getInstance($('editClienteModal')).hide();
                alert('Cliente actualizado');
                cargarClientes();
            } catch (err) {
                alert(err.message);
            }
        });
    }

    // ============================
    // ELIMINAR
    // ============================
    window.__eliminarCliente = async function (clienteId) {
        if (!confirm('¿Eliminar permanentemente este cliente? Se borrarán sus lecturas y configuración.')) return;
        try {
            const res = await apiFetch(`/admin/clientes/${clienteId}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.mensaje || 'Error al eliminar');
            alert('Cliente eliminado');
            cargarClientes();
        } catch (err) {
            alert(err.message);
        }
    };

    // ============================
    // SUSPENDER / REACTIVAR
    // ============================
    window.__suspenderCliente = async function (clienteId) {
        if (!confirm('¿Suspender el servicio de este cliente? No podrá iniciar sesión hasta reactivarlo.')) return;
        try {
            const res = await apiFetch(`/admin/clientes/${clienteId}/suspender`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.mensaje || 'Error al suspender');
            alert('Servicio suspendido');
            cargarClientes();
        } catch (err) {
            alert(err.message);
        }
    };

    window.__reactivarCliente = async function (clienteId) {
        if (!confirm('¿Reactivar el servicio de este cliente?')) return;
        try {
            const res = await apiFetch(`/admin/clientes/${clienteId}/reactivar`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.mensaje || 'Error al reactivar');
            alert('Servicio reactivado');
            cargarClientes();
        } catch (err) {
            alert(err.message);
        }
    };

    // ============================
    // PERSONAL ADMIN
    // ============================
    async function cargarPersonal() {
        const tabla = $('personalTable');
        if (!tabla) return;
        tabla.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Cargando...</td></tr>';

        try {
            const res = await apiFetch('/admin/personal');
            if (!res.ok) throw new Error('No se pudo cargar');
            const lista = await res.json();

            if (lista.length === 0) {
                tabla.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Sin personal registrado.</td></tr>';
                return;
            }

            tabla.innerHTML = '';
            lista.forEach(p => {
                tabla.innerHTML += `<tr>
                    <td>${p.id}</td>
                    <td><strong>${p.username}</strong></td>
                    <td>${p.email}</td>
                </tr>`;
            });
        } catch (err) {
            tabla.innerHTML = `<tr><td colspan="3" class="text-center text-danger">${err.message}</td></tr>`;
        }
    }

    const createPersonalForm = $('createPersonalForm');
    if (createPersonalForm) {
        createPersonalForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideAlert('personalAlert');

            const username = $('personalUsername').value.trim();
            const email = $('personalEmail').value.trim();
            const password = $('personalPassword').value;

            if (username.length < 4) return showAlert('personalAlert', 'Usuario mínimo 4 caracteres.', 'warning');
            if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email)) {
                return showAlert('personalAlert', 'Email debe ser @gmail.com', 'warning');
            }
            if (password.length < 8) return showAlert('personalAlert', 'Contraseña mínimo 8 caracteres.', 'warning');

            try {
                const res = await apiFetch('/admin/personal', {
                    method: 'POST',
                    body: JSON.stringify({ username, email, password })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'Error');

                showAlert('personalAlert', `Personal admin creado: ${data.username}`, 'success');
                createPersonalForm.reset();
                $('personalPassword').value = 'Admin1234!';
                cargarPersonal();
            } catch (err) {
                showAlert('personalAlert', err.message, 'danger');
            }
        });
    }

    // ============================
    // NAVEGACIÓN / INIT
    // ============================
    if ($('btnRefresh')) $('btnRefresh').addEventListener('click', cargarClientes);
    if ($('tab-list-btn')) $('tab-list-btn').addEventListener('click', cargarClientes);
    if ($('tab-personal-btn')) $('tab-personal-btn').addEventListener('click', cargarPersonal);

    cargarClientes();
    cargarPersonal();
})();