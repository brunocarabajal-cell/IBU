const NAVBAR_API_BASE = (() => {
  try {
    return localStorage.getItem('ibu_api_base') || 'http://127.0.0.1:3000';
  } catch (error) {
    return 'http://127.0.0.1:3000';
  }
})();

const actiState = {
  initialized: false,
  open: false,
  loading: false,
  messages: [],
  config: null
};

function getSessionUser() {
  try {
    return JSON.parse(localStorage.getItem('ibu_user')) || null;
  } catch (error) {
    return null;
  }
}

function getAuthHeaders() {
  const user = getSessionUser();
  return user?.legajo ? { 'X-User-Legajo': String(user.legajo) } : {};
}

function cerrarSesion() {
  localStorage.removeItem('ibu_user');
  window.location.href = 'Login.html';
}

function getThemeMode() {
  try {
    return localStorage.getItem('ibu_theme') === 'dark' ? 'dark' : 'light';
  } catch (error) {
    return 'light';
  }
}

function applyThemeMode(mode) {
  document.body.classList.toggle('ibu-dark', mode === 'dark');
}

function toggleThemeMode() {
  const nextMode = getThemeMode() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('ibu_theme', nextMode);
  } catch (error) {
    console.warn('No se pudo guardar la preferencia de tema');
  }

  applyThemeMode(nextMode);
  window.dispatchEvent(new Event('resize'));
  const switchInput = document.getElementById('theme-switch');
  if (switchInput) {
    switchInput.checked = nextMode === 'dark';
  }
}

async function cargarUsuario(active) {
  applyThemeMode(getThemeMode());
  const storedUser = getSessionUser();
  let resolvedUser = storedUser;

  if (storedUser?.legajo) {
    try {
      const res = await fetch(`${NAVBAR_API_BASE}/usuarios/${storedUser.legajo}`, {
        headers: getAuthHeaders()
      });

      if (res.ok) {
        const data = await res.json();
        resolvedUser = {
          id: data.id,
          nombre: data.nombre,
          rol: data.perfil || data.puesto,
          puesto: data.puesto,
          legajo: data.legajo,
          codigo: data.codigo,
          ubicacion: data.ubicacion,
          ubicacionDescripcion: data.ubicacionDescripcion,
          accesoTotalUbicaciones: data.accesoTotalUbicaciones
        };
        localStorage.setItem('ibu_user', JSON.stringify(resolvedUser));
      }
    } catch (error) {
      console.warn('No se pudo refrescar el usuario actual desde la API');
    }
  }

  if (!resolvedUser) {
    resolvedUser = {
      nombre: 'Invitado',
      rol: 'Sin sesión',
      legajo: '-',
      codigo: '-'
    };
  }

  renderNavbar(active, resolvedUser);
  initActiWidget();
}

function renderNavbar(active, user) {
  const navbar = `
  <div class="top-section">
    <div class="navbar">
      <div style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <img src="../assets/Logo.png" style="width:26px;height:26px;">
        <span>IBU</span>
      </div>

      <div class="nav-center">
        <div class="nav-links">
          <span class="${active==='inicio'?'active':''}" onclick="goInicio()">Inicio</span>
          <span class="${active==='inventario'?'active':''}" onclick="goInventario()">Inventario</span>
          <span class="${active==='prorrogas'?'active':''}" onclick="goProrrogas()">Prórrogas</span>
          <span class="${active==='reportes'?'active':''}" onclick="goReportes()">Reportes</span>
          <span class="${active==='usuarios'?'active':''}" onclick="goUsuarios()">Usuarios</span>
        </div>
      </div>

      <div class="nav-user">
        <div>
          <div style="font-weight:500;">${user.nombre}</div>
          <div style="font-size:12px;opacity:0.7;">${user.rol}</div>
          <div style="font-size:12px;opacity:0.7;">${user.legajo}</div>
        </div>
        <div class="nav-user-actions">
          <label class="theme-switch" title="Modo nocturno" aria-label="Modo nocturno">
            <input id="theme-switch" type="checkbox" ${getThemeMode() === 'dark' ? 'checked' : ''} onchange="toggleThemeMode()">
            <span class="theme-slider"></span>
          </label>
          <button class="logout-btn" onclick="cerrarSesion()" aria-label="Cerrar sesión" title="Cerrar sesión">↪</button>
        </div>
      </div>
    </div>
  </div>
  `;

  document.getElementById('navbar-container').innerHTML = navbar;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initActiWidget() {
  if (actiState.initialized) {
    return;
  }

  const widget = document.createElement('div');
  widget.innerHTML = `
    <button id="acti-fab" class="acti-fab" type="button" aria-label="Abrir chat de Acti" title="Acti">
      <img src="../assets/Acti_imagen.png" alt="Acti">
    </button>
    <aside id="acti-panel" class="acti-panel" aria-hidden="true">
      <div class="acti-panel-header">
        <div class="acti-panel-brand">
          <img src="../assets/Acti_imagen.png" alt="Acti">
          <div>
            <strong>Acti</strong>
            <span>Asistente IBU</span>
          </div>
        </div>
        <button id="acti-close" class="acti-close" type="button" aria-label="Cerrar chat">×</button>
      </div>
      <div id="acti-messages" class="acti-messages"></div>
      <div id="acti-actions" class="acti-actions"></div>
      <form id="acti-form" class="acti-form">
        <textarea id="acti-input" class="acti-input" placeholder="Escribile a Acti..." rows="1"></textarea>
        <button id="acti-send" class="acti-send" type="submit">Enviar</button>
      </form>
    </aside>
  `;

  document.body.appendChild(widget);

  document.getElementById('acti-fab').addEventListener('click', toggleActiPanel);
  document.getElementById('acti-close').addEventListener('click', toggleActiPanel);
  document.getElementById('acti-form').addEventListener('submit', sendActiMessage);
  document.getElementById('acti-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendActiMessage(event);
    }
  });

  actiState.initialized = true;
  loadActiConfig();
}

function toggleActiPanel() {
  actiState.open = !actiState.open;
  const panel = document.getElementById('acti-panel');
  const fab = document.getElementById('acti-fab');
  if (!panel || !fab) return;

  panel.classList.toggle('open', actiState.open);
  panel.setAttribute('aria-hidden', actiState.open ? 'false' : 'true');
  fab.classList.toggle('hidden', actiState.open);

  if (actiState.open) {
    const input = document.getElementById('acti-input');
    if (input) input.focus();
  }
}

function renderActiMessages() {
  const container = document.getElementById('acti-messages');
  if (!container) return;

  container.innerHTML = actiState.messages.map(message => `
    <div class="acti-message ${message.role === 'user' ? 'user' : 'assistant'}">
      <div class="acti-bubble">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div>
    </div>
  `).join('');

  container.scrollTop = container.scrollHeight;
}

function renderActiActions() {
  const actions = document.getElementById('acti-actions');
  if (!actions) return;
  actions.innerHTML = '';
}

function setActiLoading(loading) {
  actiState.loading = loading;
  const input = document.getElementById('acti-input');
  const send = document.getElementById('acti-send');
  if (input) input.disabled = loading;
  if (send) {
    send.disabled = loading;
    send.textContent = loading ? 'Enviando...' : 'Enviar';
  }
}

async function loadActiConfig() {
  try {
    const res = await fetch(`${NAVBAR_API_BASE}/acti/config`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error();
    actiState.config = await res.json();
  } catch (error) {
    actiState.config = {
      enabled: false,
      welcomeMessage: 'Hola, soy Acti. Por ahora el chat no está disponible.'
    };
  }

  if (actiState.messages.length === 0) {
    actiState.messages.push({
      role: 'assistant',
      content: actiState.config.welcomeMessage
    });
  }

  renderActiMessages();
  renderActiActions();
}

async function sendActiMessage(event) {
  if (event) {
    event.preventDefault();
  }

  if (actiState.loading) {
    return;
  }

  const input = document.getElementById('acti-input');
  if (!input) return;

  const content = input.value.trim();
  if (!content) return;

  actiState.messages.push({ role: 'user', content });
  input.value = '';
  renderActiMessages();
  setActiLoading(true);

  try {
    const res = await fetch(`${NAVBAR_API_BASE}/acti/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        messages: actiState.messages.map(message => ({
          role: message.role,
          content: message.content
        }))
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      actiState.messages.push({
        role: 'assistant',
        content: data.error || 'No pude responder en este momento.'
      });
    } else {
      actiState.messages.push({
        role: 'assistant',
        content: data.reply || 'No recibí una respuesta para mostrar.'
      });
    }
  } catch (error) {
    actiState.messages.push({
      role: 'assistant',
      content: 'No pude comunicarme con Acti en este momento.'
    });
  } finally {
    setActiLoading(false);
    renderActiMessages();
    renderActiActions();
  }
}
