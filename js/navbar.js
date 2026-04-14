async function cargarUsuario(active){
  let data = null;
  try {
    const res = await fetch('http://localhost:3000/usuarios/146685');
    data = await res.json();
  } catch (e) {
    console.warn('API no disponible, usando datos mock');
    data = {
      nombre: 'Bruno Carabajal',
      puesto: 'Analista',
      codigo: '700'
    };
  }

  localStorage.setItem('ibu_user', JSON.stringify({
    nombre: data.nombre,
    rol: data.puesto,
    legajo: data.codigo
  }));

  renderNavbar(active);
}
function renderNavbar(active){
  const user = JSON.parse(localStorage.getItem('ibu_user')) || {
    nombre: 'Bruno Carabajal',
    rol: 'Analista',
    legajo: '700'
  };

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
        <img src="../assets/user.jpg" class="avatar-img">
        <div>
          <div style="font-weight:500;">${user.nombre}</div>
          <div style="font-size:12px;opacity:0.7;">${user.rol}</div>
          <div style="font-size:12px;opacity:0.7;">${user.legajo}</div>
        </div>
      </div>

    </div>
  </div>
  `;

  document.getElementById('navbar-container').innerHTML = navbar;
}