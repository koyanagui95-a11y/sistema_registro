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
    let clientesCache = [];
    let logoutConfirmado = false;
    let deferredPrompt = null;

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        });
    }

    function escapeHtml(val) {
        return String(val ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getToken() { return localStorage.getItem('adminToken'); }
    function getRol() { return localStorage.getItem('adminRol') || 'PERSONAL'; }
    function esAdmin() { return getRol() === 'ADMIN'; }

    function mostrarToast(mensaje, tipo = 'info') {
        const toastEl = $('adminToast');
        const toastBody = $('adminToastBody');
        if (toastEl && toastBody && window.bootstrap && bootstrap.Toast) {
            toastEl.className = `toast align-items-center text-bg-${tipo} border-0 shadow`;
            toastBody.textContent = mensaje;
            const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 4000 });
            toast.show();
            return;
        }
        if ($('alert')) showAlert('alert', mensaje, tipo);
        else if ($('registerAlert')) showAlert('registerAlert', mensaje, tipo);
    }

    function cerrarSesion(msg) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUsername');
        localStorage.removeItem('adminRol');
        localStorage.removeItem('adminLastActivity');
        if (msg) {
            sessionStorage.setItem('adminLoginNotice', msg);
            sessionStorage.setItem('adminLoginNoticeType', 'warning');
        }
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
        const res = await fetch(`${CONFIG.API_URL}${path}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`,
                ...(opts.headers || {})
            }
        });

        if (res.status === 401) {
            cerrarSesion('Sesión inválida o expirada. Vuelve a iniciar sesión.');
            throw new Error('No autorizado');
        }

        if (res.status === 403) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.mensaje || 'No tienes permisos para realizar esta acción.');
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

    function obtenerEstadoPago(cliente) {
        if (!cliente || !cliente.fechaProximoPago) {
            return {
                badge: '<span class="badge bg-secondary">SIN FECHA</span>',
                detalle: 'Sin registro'
            };
        }

        const vencimiento = new Date(cliente.fechaProximoPago);
        if (isNaN(vencimiento.getTime())) {
            return {
                badge: '<span class="badge bg-secondary">SIN FECHA</span>',
                detalle: 'Fecha inválida'
            };
        }

        const diasGracia = Number.isFinite(Number(cliente.diasGracia)) ? Number(cliente.diasGracia) : 5;
        const limiteGracia = new Date(vencimiento.getTime() + diasGracia * 24 * 60 * 60 * 1000);
        const ahora = new Date();
        const fechaCorta = vencimiento.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });

        if (ahora <= vencimiento) {
            return {
                badge: '<span class="badge bg-success">AL DÍA</span>',
                detalle: `Vence: ${fechaCorta}`
            };
        }

        if (ahora <= limiteGracia) {
            return {
                badge: '<span class="badge bg-warning text-dark">EN GRACIA</span>',
                detalle: `Venció: ${fechaCorta} (${diasGracia}d gracia)`
            };
        }

        return {
            badge: '<span class="badge bg-danger">VENCIDO</span>',
            detalle: `Venció: ${fechaCorta}`
        };
    }

    const loginForm = $('loginAdminForm');
    if (loginForm) {
        const notice = sessionStorage.getItem('adminLoginNotice');
        const noticeType = sessionStorage.getItem('adminLoginNoticeType') || 'warning';
        if (notice) {
            showAlert('alert', notice, noticeType);
            sessionStorage.removeItem('adminLoginNotice');
            sessionStorage.removeItem('adminLoginNoticeType');
        }

        const toggle = $('togglePass');
        if (toggle) {
            toggle.addEventListener('click', () => {
                const input = $('password');
                const icon = toggle.querySelector('i');
                if (!input || !icon) return;
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
                if (data.rol !== 'ADMIN' && data.rol !== 'PERSONAL') {
                    throw new Error('Esta cuenta no tiene permisos de administración.');
                }

                localStorage.setItem('adminToken', data.token);
                localStorage.setItem('adminUsername', data.username);
                localStorage.setItem('adminRol', data.rol);
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
    if ($('adminRolBadge')) {
        $('adminRolBadge').textContent = esAdmin() ? 'JEFE' : 'PERSONAL';
        $('adminRolBadge').className = esAdmin() ? 'badge bg-danger ms-1' : 'badge bg-info text-dark ms-1';
    }

    if (esAdmin() && $('tab-personal-item')) {
        $('tab-personal-item').style.display = 'block';
    }

    if ($('btnLogout')) {
        $('btnLogout').addEventListener('click', () => {
            if (!logoutConfirmado) {
                logoutConfirmado = true;
                mostrarToast('Pulsa Salir nuevamente para confirmar el cierre de sesión.', 'warning');
                setTimeout(() => { logoutConfirmado = false; }, 4000);
                return;
            }
            cerrarSesion();
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
            const descripcionServicio = $('descripcionServicio').value.trim();
            const costoSistema = parseFloat($('costoSistema').value) || 120;
            const costoSensores = parseFloat($('costoSensores').value) || 20;
            const costoComponentes = parseFloat($('costoComponentes').value) || 50;
            const costoMensual = parseFloat($('costoMensual').value) || 20;

            if (!nombres || !apellidos) return showAlert('registerAlert', 'Nombres y apellidos son obligatorios.', 'warning');
            if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(correoPersonal)) return showAlert('registerAlert', 'Correo debe ser @gmail.com', 'warning');

            const btn = $('btnRegister');
            const spinner = $('registerSpinner');
            btn.disabled = true;
            spinner.classList.remove('d-none');

            try {
                const res = await apiFetch('/admin/clientes', {
                    method: 'POST',
                    body: JSON.stringify({
                        nombres, apellidos, correoPersonal, telefono,
                        descripcionServicio, costoSistema, costoSensores, costoComponentes, costoMensual
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'No se pudo registrar.');

                $('registerResult').className = 'alert alert-success mt-4';
                $('registerResult').classList.remove('d-none');
                $('registerResult').innerHTML = `
                    <h5 class="fw-bold mb-2"><i class="bi bi-check-circle me-1"></i>Cliente registrado</h5>
                    <p class="mb-1"><strong>Usuario:</strong> ${escapeHtml(data.username)}</p>
                    <p class="mb-1"><strong>Email:</strong> ${escapeHtml(data.email)}</p>
                    <p class="mb-1"><strong>UUID Dispositivo:</strong> <code>${escapeHtml(data.dispositivoId)}</code></p>
                    <p class="mb-1"><strong>Estado:</strong> ${escapeHtml(data.estado)}</p>
                    <p class="mb-0 small text-muted">Copia el UUID para configurar el dispositivo.</p>
                `;
                registerForm.reset();
                $('costoSistema').value = '120';
                $('costoSensores').value = '20';
                $('costoComponentes').value = '50';
                $('costoMensual').value = '20';
                mostrarToast('Cliente registrado correctamente.', 'success');
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
        tabla.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Cargando...</td></tr>';

        try {
            const res = await apiFetch('/admin/clientes');
            if (!res.ok) throw new Error('No se pudieron cargar los clientes');
            const clientes = await res.json();
            clientesCache = Array.isArray(clientes) ? clientes : [];

            if ($('badgeTotal')) $('badgeTotal').textContent = clientesCache.length;

            if (clientesCache.length === 0) {
                tabla.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Sin clientes registrados.</td></tr>';
                return;
            }

            tabla.innerHTML = '';
            clientesCache.forEach(c => {
                const safeId = Number(c.id);
                const pagoInfo = obtenerEstadoPago(c);
                let estadoBadge, botones;

                if (esAdmin()) {
                    switch (c.estado) {
                        case 'ACTIVO':
                            estadoBadge = '<span class="badge bg-success">ACTIVO</span>';
                            botones = `
                                <button class="btn btn-sm btn-outline-primary" onclick="window.__editarCliente(${safeId})" title="Editar"><i class="bi bi-pencil"></i></button>
                                <button class="btn btn-sm btn-outline-info" onclick="window.__verPrecios(${safeId})" title="Precios y cobros"><i class="bi bi-currency-dollar"></i></button>
                                <button class="btn btn-sm btn-outline-warning" onclick="window.__suspenderCliente(${safeId})" title="Suspender"><i class="bi bi-pause-circle"></i></button>
                                <button class="btn btn-sm btn-outline-danger" onclick="window.__eliminarCliente(${safeId})" title="Eliminar"><i class="bi bi-trash"></i></button>`;
                            break;
                        case 'SUSPENDIDO':
                            estadoBadge = '<span class="badge bg-danger">SUSPENDIDO</span>';
                            botones = `
                                <button class="btn btn-sm btn-outline-primary" onclick="window.__editarCliente(${safeId})" title="Editar"><i class="bi bi-pencil"></i></button>
                                <button class="btn btn-sm btn-outline-info" onclick="window.__verPrecios(${safeId})" title="Precios y cobros"><i class="bi bi-currency-dollar"></i></button>
                                <button class="btn btn-sm btn-outline-success" onclick="window.__reactivarCliente(${safeId})" title="Reactivar"><i class="bi bi-play-circle"></i></button>
                                <button class="btn btn-sm btn-outline-danger" onclick="window.__eliminarCliente(${safeId})" title="Eliminar"><i class="bi bi-trash"></i></button>`;
                            break;
                        default:
                            estadoBadge = '<span class="badge bg-warning text-dark">PENDIENTE</span>';
                            botones = `
                                <button class="btn btn-sm btn-success" onclick="window.__activarCliente(${safeId})" title="Activar"><i class="bi bi-check2-circle"></i> Activar</button>
                                <button class="btn btn-sm btn-outline-primary" onclick="window.__editarCliente(${safeId})" title="Editar"><i class="bi bi-pencil"></i></button>
                                <button class="btn btn-sm btn-outline-danger" onclick="window.__eliminarCliente(${safeId})" title="Eliminar"><i class="bi bi-trash"></i></button>`;
                    }
                } else {
                    if (c.estado === 'ACTIVO') {
                        estadoBadge = '<span class="badge bg-success">ACTIVO</span>';
                        botones = `
                            <button class="btn btn-sm btn-outline-success" onclick="window.__verPrecios(${safeId})" title="Registrar cobro"><i class="bi bi-cash-coin"></i> Cobro</button>
                            <button class="btn btn-sm btn-outline-warning" onclick="window.__suspenderCliente(${safeId})" title="Suspender"><i class="bi bi-pause-circle"></i> Suspender</button>`;
                    } else if (c.estado === 'SUSPENDIDO') {
                        estadoBadge = '<span class="badge bg-danger">SUSPENDIDO</span>';
                        botones = `
                            <button class="btn btn-sm btn-outline-success" onclick="window.__verPrecios(${safeId})" title="Registrar cobro"><i class="bi bi-cash-coin"></i> Cobro</button>
                            <button class="btn btn-sm btn-success" onclick="window.__reactivarCliente(${safeId})" title="Reactivar"><i class="bi bi-play-circle"></i> Reactivar</button>`;
                    } else {
                        estadoBadge = '<span class="badge bg-warning text-dark">PENDIENTE</span>';
                        botones = '<span class="text-muted small">Pendiente de activación</span>';
                    }
                }

                const uuidCorto = c.dispositivoId ? escapeHtml(c.dispositivoId.substring(0, 8) + '...') : '--';
                const uuidBtn = c.dispositivoId
                    ? `<button type="button" class="btn btn-sm btn-link p-0 btn-copiar-uuid" data-uuid="${escapeHtml(c.dispositivoId)}" title="${escapeHtml(c.dispositivoId)}"><code>${uuidCorto}</code></button>`
                    : '--';

                tabla.innerHTML += `
                    <tr>
                        <td>${escapeHtml(c.id)}</td>
                        <td><strong>${escapeHtml(c.nombres)} ${escapeHtml(c.apellidos)}</strong></td>
                        <td>${escapeHtml(c.usuario?.username || '--')}</td>
                        <td>${escapeHtml(c.correoPersonal || '--')}</td>
                        <td>${escapeHtml(c.telefono || '--')}</td>
                        <td>${uuidBtn}</td>
                        <td>${estadoBadge}</td>
                        <td>
                            <div>${pagoInfo.badge}</div>
                            <div class="small text-muted">${escapeHtml(pagoInfo.detalle)}</div>
                        </td>
                        <td class="text-center">${botones}</td>
                    </tr>`;
            });

            tabla.querySelectorAll('.btn-copiar-uuid').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const uuid = btn.getAttribute('data-uuid');
                    if (!uuid) return;
                    try {
                        await navigator.clipboard.writeText(uuid);
                        mostrarToast(`UUID copiado: ${uuid}`, 'success');
                    } catch (_) {
                        mostrarToast(`UUID: ${uuid}`, 'info');
                    }
                });
            });
        } catch (err) {
            tabla.innerHTML = `<tr><td colspan="9" class="text-center text-danger">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    window.__activarCliente = async function (clienteId) {
        if (!esAdmin()) return mostrarToast('Solo el jefe puede activar clientes.', 'warning');
        try {
            const res = await apiFetch(`/admin/clientes/${clienteId}/activar`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (data.emailFallido) {
                    mostrarToast(`Cliente activado, pero el correo a ${data.emailFallido} falló.`, 'warning');
                } else {
                    throw new Error(data.mensaje || 'No se pudo activar');
                }
            } else {
                mostrarToast(`Cliente activado. Correo enviado a: ${data.emailEnviado}`, 'success');
            }
            await cargarClientes();
        } catch (err) {
            mostrarToast(err.message, 'danger');
            await cargarClientes();
        }
    };

    window.__editarCliente = async function (clienteId) {
        if (!esAdmin()) return mostrarToast('Solo el jefe puede editar clientes.', 'warning');
        try {
            let c = clientesCache.find(x => x.id === clienteId);
            if (!c) {
                const res = await apiFetch('/admin/clientes');
                const clientes = await res.json();
                clientesCache = Array.isArray(clientes) ? clientes : [];
                c = clientesCache.find(x => x.id === clienteId);
            }
            if (!c) return;
            $('editClienteId').value = c.id;
            $('editNombres').value = c.nombres;
            $('editApellidos').value = c.apellidos;
            $('editCorreoPersonal').value = c.correoPersonal || '';
            $('editTelefono').value = c.telefono || '';
            new bootstrap.Modal($('editClienteModal')).show();
        } catch (err) {
            mostrarToast(err.message, 'danger');
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
            if (!body.nombres || !body.apellidos || !body.correoPersonal) return mostrarToast('Campos obligatorios incompletos.', 'warning');
            if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(body.correoPersonal)) return mostrarToast('Correo debe ser @gmail.com', 'warning');
            try {
                const res = await apiFetch(`/admin/clientes/${id}`, { method: 'PUT', body: JSON.stringify(body) });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'Error');
                bootstrap.Modal.getInstance($('editClienteModal')).hide();
                mostrarToast('Cliente actualizado', 'success');
                cargarClientes();
            } catch (err) {
                mostrarToast(err.message, 'danger');
            }
        });
    }

    window.__eliminarCliente = async function (clienteId) {
        if (!esAdmin()) return mostrarToast('Solo el jefe puede eliminar clientes.', 'warning');
        try {
            const res = await apiFetch(`/admin/clientes/${clienteId}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.mensaje || 'Error al eliminar');
            mostrarToast('Cliente eliminado', 'success');
            cargarClientes();
        } catch (err) {
            mostrarToast(err.message, 'danger');
        }
    };

    window.__suspenderCliente = function (clienteId) {
        $('suspenderClienteId').value = clienteId;
        $('motivoSuspension').value = 'Falta de pago mensual vencido.';
        new bootstrap.Modal($('suspenderClienteModal')).show();
    };

    if ($('btnConfirmarSuspension')) {
        $('btnConfirmarSuspension').addEventListener('click', async () => {
            const clienteId = $('suspenderClienteId').value;
            const motivo = $('motivoSuspension').value.trim();
            try {
                const res = await apiFetch(`/admin/clientes/${clienteId}/suspender`, {
                    method: 'POST',
                    body: JSON.stringify({ motivo })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'Error');
                bootstrap.Modal.getInstance($('suspenderClienteModal')).hide();
                mostrarToast('Servicio suspendido y cliente notificado', 'success');
                cargarClientes();
            } catch (err) {
                mostrarToast(err.message, 'danger');
            }
        });
    }

    window.__reactivarCliente = async function (clienteId) {
        try {
            const res = await apiFetch(`/admin/clientes/${clienteId}/reactivar`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.mensaje || 'Error');
            mostrarToast('Servicio reactivado y cliente notificado', 'success');
            cargarClientes();
        } catch (err) {
            mostrarToast(err.message, 'danger');
        }
    };

    window.__verPrecios = async function (clienteId) {
        try {
            let c = clientesCache.find(x => x.id === clienteId);
            if (!c) {
                const res = await apiFetch('/admin/clientes');
                const clientes = await res.json();
                clientesCache = Array.isArray(clientes) ? clientes : [];
                c = clientesCache.find(x => x.id === clienteId);
            }
            if (!c) return;

            const soloLecturaPrecios = !esAdmin();
            $('preciosClienteId').value = c.id;
            $('precioSistema').value = c.costoSistema ?? 120;
            $('precioSensores').value = c.costoSensores ?? 20;
            $('precioComponentes').value = c.costoComponentes ?? 50;
            $('precioMensual').value = c.costoMensual ?? 20;
            $('precioDiasGracia').value = c.diasGracia ?? 5;
            $('precioDescripcion').value = c.descripcionServicio || '';

            ['precioSistema', 'precioSensores', 'precioComponentes', 'precioMensual', 'precioDiasGracia', 'precioDescripcion'].forEach(campoId => {
                if ($(campoId)) $(campoId).disabled = soloLecturaPrecios;
            });
            if ($('btnSavePrecios')) {
                $('btnSavePrecios').classList.toggle('d-none', soloLecturaPrecios);
            }

            const pagoInfo = obtenerEstadoPago(c);
            $('precioFechaPago').textContent = c.fechaProximoPago
                ? `${new Date(c.fechaProximoPago).toLocaleString('es-PE')} (${pagoInfo.detalle})`
                : 'Sin registrar';

            new bootstrap.Modal($('preciosModal')).show();
        } catch (err) {
            mostrarToast(err.message, 'danger');
        }
    };

    if ($('btnSavePrecios')) {
        $('btnSavePrecios').addEventListener('click', async () => {
            if (!esAdmin()) return mostrarToast('Solo el jefe puede modificar precios.', 'warning');
            const id = $('preciosClienteId').value;
            const body = {
                costoSistema: parseFloat($('precioSistema').value) || 0,
                costoSensores: parseFloat($('precioSensores').value) || 0,
                costoComponentes: parseFloat($('precioComponentes').value) || 0,
                costoMensual: parseFloat($('precioMensual').value) || 0,
                diasGracia: parseInt($('precioDiasGracia').value) || 5,
                descripcionServicio: $('precioDescripcion').value.trim()
            };
            try {
                const res = await apiFetch(`/admin/clientes/${id}/precios`, {
                    method: 'PUT',
                    body: JSON.stringify(body)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'Error');
                mostrarToast('Precios actualizados', 'success');
                bootstrap.Modal.getInstance($('preciosModal')).hide();
                cargarClientes();
            } catch (err) {
                mostrarToast(err.message, 'danger');
            }
        });
    }

    if ($('btnRegistrarPago')) {
        $('btnRegistrarPago').addEventListener('click', async () => {
            const id = $('preciosClienteId').value;
            try {
                const res = await apiFetch(`/admin/clientes/${id}/pago?meses=1`, { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'Error');
                mostrarToast(`Pago registrado. Próximo pago: ${new Date(data.fechaProximoPago).toLocaleString('es-PE')}`, 'success');
                bootstrap.Modal.getInstance($('preciosModal')).hide();
                cargarClientes();
            } catch (err) {
                mostrarToast(err.message, 'danger');
            }
        });
    }

    async function cargarPersonal() {
        const tabla = $('personalTable');
        if (!tabla) return;
        tabla.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Cargando...</td></tr>';
        try {
            const res = await apiFetch('/admin/personal');
            if (!res.ok) throw new Error('No se pudo cargar');
            const lista = await res.json();
            if (lista.length === 0) {
                tabla.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Sin personal registrado.</td></tr>';
                return;
            }
            tabla.innerHTML = '';
            lista.forEach(p => {
                const rolBadge = p.rol === 'ADMIN'
                    ? '<span class="badge bg-danger">JEFE</span>'
                    : '<span class="badge bg-info text-dark">PERSONAL</span>';
                tabla.innerHTML += `<tr>
                    <td>${escapeHtml(p.id)}</td>
                    <td><strong>${escapeHtml(p.username)}</strong></td>
                    <td>${escapeHtml(p.email)}</td>
                    <td>${rolBadge}</td>
                </tr>`;
            });
        } catch (err) {
            tabla.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${escapeHtml(err.message)}</td></tr>`;
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
            if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email)) return showAlert('personalAlert', 'Email debe ser @gmail.com', 'warning');
            if (password.length < 8) return showAlert('personalAlert', 'Contraseña mínimo 8 caracteres.', 'warning');

            try {
                const res = await apiFetch('/admin/personal', {
                    method: 'POST',
                    body: JSON.stringify({ username, email, password })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.mensaje || 'Error');
                showAlert('personalAlert', `Personal creado: ${data.username} (rol: ${data.rol})`, 'success');
                createPersonalForm.reset();
                $('personalPassword').value = 'Admin1234!';
                cargarPersonal();
            } catch (err) {
                showAlert('personalAlert', err.message, 'danger');
            }
        });
    }

    if ($('btnRefresh')) $('btnRefresh').addEventListener('click', cargarClientes);
    if ($('tab-list-btn')) $('tab-list-btn').addEventListener('click', cargarClientes);
    if ($('tab-personal-btn')) $('tab-personal-btn').addEventListener('click', cargarPersonal);

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const btn = $('btnInstallAdminPwa');
        if (btn) btn.classList.remove('d-none');
    });

    if ($('btnInstallAdminPwa')) {
        $('btnInstallAdminPwa').addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
            $('btnInstallAdminPwa').classList.add('d-none');
        });
    }

    cargarClientes();
    if (esAdmin()) cargarPersonal();
})();