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

async function cargarUsuario(active) {
  const storedUser = getSessionUser();
  let resolvedUser = storedUser;

  if (storedUser?.legajo) {
    try {
      const res = await fetch(`http://127.0.0.1:3000/usuarios/${storedUser.legajo}`, {
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
          <button class="logout-btn" onclick="cerrarSesion()" aria-label="Cerrar sesión" title="Cerrar sesión">↪</button>
        </div>
      </div>
    </div>
  </div>
  `;

  document.getElementById('navbar-container').innerHTML = navbar;
}
