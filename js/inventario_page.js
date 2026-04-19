const INVENTARIO_API_BASE = typeof getApiBase === 'function' ? getApiBase() : 'http://127.0.0.1:3000';

let descripcionValor = '';
let ubicacionValor = '';
let tipoValor = '';
let cantidadClasesValor = '';
let fechaValor = new Date().toISOString().slice(0, 10);
let inventariosPendientes = [];
let filtrosInventario = { ubicaciones: [], tipos: [] };
let inventarioActual = null;
let modalAbierto = false;
let inventarioSort = { field: 'fechaInventario', direction: 'desc', type: 'date' };

function goInicio() {
  window.location.href = 'Dashboard.html';
}

function goInventario() {
  window.location.href = 'Inventario.html';
}

function goProrrogas() {
  window.location.href = 'Prorrogas.html';
}

function goReportes() {
  window.location.href = 'reportes.html';
}

function goUsuarios() {
  window.location.href = 'usuarios.html';
}

function authHeadersInventario() {
  try {
    const user = JSON.parse(localStorage.getItem('ibu_user')) || {};
    return user.legajo ? { 'X-User-Legajo': String(user.legajo) } : {};
  } catch (error) {
    return {};
  }
}

function escapeHtmlInventario(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatFechaInventario(value) {
  if (!value) return '-';
  const fecha = new Date(`${value}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return value;
  return fecha.toLocaleDateString('es-AR');
}

function diffDaysInventario(value) {
  if (!value) return '-';
  const hoy = new Date();
  const fecha = new Date(`${value}T00:00:00`);
  hoy.setHours(0, 0, 0, 0);
  fecha.setHours(0, 0, 0, 0);
  const diff = Math.round((hoy.getTime() - fecha.getTime()) / 86400000);
  return diff < 0 ? 0 : diff;
}

function getSessionUserInventario() {
  try {
    return JSON.parse(localStorage.getItem('ibu_user')) || {};
  } catch (error) {
    return {};
  }
}

function isActivosFijosInventario() {
  return getSessionUserInventario().rol === 'Analista de AAFF';
}

function updateInventarioMessage(message) {
  const helper = document.getElementById('inventario-helper');
  if (helper) {
    if (message) {
      helper.innerText = message;
      helper.classList.remove('hidden');
    } else {
      helper.innerText = '';
      helper.classList.add('hidden');
    }
  }
}

function updateSortIndicators() {
  const indicators = document.querySelectorAll('.sort-indicator');
  indicators.forEach(item => {
    item.innerText = '↕';
  });

  const activeIndicator = document.getElementById(`sort-${inventarioSort.field}`);
  if (activeIndicator) {
    activeIndicator.innerText = inventarioSort.direction === 'asc' ? '↑' : '↓';
  }
}

function ordenarInventarios(field, type) {
  if (inventarioSort.field === field) {
    inventarioSort.direction = inventarioSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    inventarioSort = {
      field,
      type,
      direction: type === 'text' ? 'asc' : 'desc'
    };
  }

  renderTablaInventarios();
}

function normalizeSortValue(item, field, type) {
  if (field === 'dias') {
    return diffDaysInventario(item.fechaInventario);
  }

  const value = item[field];
  if (type === 'number') {
    return Number(value || 0);
  }

  if (type === 'date') {
    return new Date(`${value}T00:00:00`).getTime() || 0;
  }

  return String(value || '').toLocaleLowerCase('es-AR');
}

function getSortedInventarios() {
  return [...inventariosPendientes].sort((left, right) => {
    const leftValue = normalizeSortValue(left, inventarioSort.field, inventarioSort.type);
    const rightValue = normalizeSortValue(right, inventarioSort.field, inventarioSort.type);

    if (leftValue < rightValue) {
      return inventarioSort.direction === 'asc' ? -1 : 1;
    }

    if (leftValue > rightValue) {
      return inventarioSort.direction === 'asc' ? 1 : -1;
    }

    return 0;
  });
}

function currentInventoryKey(item) {
  return encodeURIComponent([
    item.numeroInventario,
    item.ubicacion,
    item.fechaInventario,
    item.tipo
  ].join('|'));
}

function decodeInventoryKey(key) {
  const [numeroInventario, ubicacion, fechaInventario, tipo] = decodeURIComponent(key).split('|');
  return { numeroInventario, ubicacion, fechaInventario, tipo };
}

function renderCreateControls() {
  const descContainer = document.getElementById('input-descripcion');
  const ubiContainer = document.getElementById('select-ubicacion');
  const tipoContainer = document.getElementById('select-tipo');
  const clasesContainer = document.getElementById('input-clases');
  const fechaContainer = document.getElementById('input-fecha');
  const btnContainer = document.getElementById('btn-crear-container');

  descContainer.innerHTML = '';
  ubiContainer.innerHTML = '';
  tipoContainer.innerHTML = '';
  clasesContainer.innerHTML = '';
  fechaContainer.innerHTML = '';
  btnContainer.innerHTML = '';

  const inputDescripcion = crearInput({
    placeholder: 'Ej: Inventario general mayo',
    value: descripcionValor,
    onChange: value => {
      descripcionValor = value;
    }
  });
  descContainer.appendChild(inputDescripcion);

  select_mult('#select-ubicacion', {
    options: filtrosInventario.ubicaciones.map(item => item.codigo),
    placeholder: 'Seleccionar ubicación',
    multiple: false,
    selectedValue: ubicacionValor,
    onChange: value => {
      ubicacionValor = Array.isArray(value) ? (value[0] || '') : (value || '');
    }
  });

  select_mult('#select-tipo', {
    options: filtrosInventario.tipos,
    placeholder: 'Seleccionar tipo',
    multiple: false,
    selectedValue: tipoValor,
    onChange: value => {
      tipoValor = Array.isArray(value) ? (value[0] || '') : (value || '');
    }
  });

  const inputClases = crearInput({
    placeholder: 'Ej: 6',
    value: cantidadClasesValor,
    type: 'number',
    onChange: value => {
      cantidadClasesValor = value;
    }
  });
  inputClases.min = '1';
  clasesContainer.appendChild(inputClases);

  const inputFecha = crearInputDate({
    value: fechaValor,
    onChange: value => {
      fechaValor = value;
    }
  });
  fechaContainer.appendChild(inputFecha);

  const botonCrear = crearBotonPrincipal({
    texto: 'Crear',
    onClick: crearInventario,
    size: 'lg'
  });
  btnContainer.appendChild(botonCrear);
}

function renderTablaInventarios() {
  const tbody = document.querySelector('#tabla tbody');
  tbody.innerHTML = '';
  updateSortIndicators();

  if (inventariosPendientes.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No hay inventarios pendientes para tus ubicaciones habilitadas.</td></tr>';
    return;
  }

  getSortedInventarios().forEach(item => {
    const dias = Number(item.dias ?? diffDaysInventario(item.fechaInventario));
    const statusClass = item.estado === 'Vencido' ? 'status-expired' : 'status-pending';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtmlInventario(item.numeroInventario)}</td>
      <td>${escapeHtmlInventario(formatFechaInventario(item.fechaInventario))}</td>
      <td>${escapeHtmlInventario(dias)}</td>
      <td>${escapeHtmlInventario(item.descripcion || '-')}</td>
      <td>${escapeHtmlInventario(item.tipo || '-')}</td>
      <td>${escapeHtmlInventario(item.ubicacion || '-')}</td>
      <td>${escapeHtmlInventario(item.cantidadClases)}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtmlInventario(item.estado || 'Pendiente')}</span></td>
      <td><button class="btn-ingresar" onclick="abrirInventario('${currentInventoryKey(item)}')">Ingresar</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function cargarFiltrosInventario() {
  const response = await fetch(`${INVENTARIO_API_BASE}/inventarios/filtros`, {
    headers: authHeadersInventario()
  });

  if (!response.ok) {
    throw new Error('No se pudieron obtener los filtros');
  }

  filtrosInventario = await response.json();
  if (!ubicacionValor && filtrosInventario.ubicaciones.length === 1) {
    ubicacionValor = filtrosInventario.ubicaciones[0].codigo;
  }
  if (!tipoValor && filtrosInventario.tipos.length === 1) {
    tipoValor = filtrosInventario.tipos[0];
  }
  renderCreateControls();
}

async function cargarInventariosPendientes() {
  const response = await fetch(`${INVENTARIO_API_BASE}/inventarios`, {
    headers: authHeadersInventario()
  });

  if (!response.ok) {
    throw new Error('No se pudieron obtener los inventarios pendientes');
  }

  inventariosPendientes = await response.json();
  renderTablaInventarios();
}

async function crearInventario() {
  if (!descripcionValor.trim() || !ubicacionValor || !tipoValor || !fechaValor || Number(cantidadClasesValor) <= 0) {
    updateInventarioMessage('Completá descripción, ubicación, tipo, cantidad de clases y fecha para crear el inventario.');
    return;
  }

  updateInventarioMessage('Creando inventario pendiente...');

  try {
    const response = await fetch(`${INVENTARIO_API_BASE}/inventarios`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeadersInventario()
      },
      body: JSON.stringify({
        descripcion: descripcionValor.trim(),
        ubicacion: ubicacionValor,
        tipo: tipoValor,
        cantidadClases: Number(cantidadClasesValor),
        fechaInventario: fechaValor
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'No se pudo crear el inventario');
    }

    descripcionValor = '';
    cantidadClasesValor = '';
    renderCreateControls();
    await cargarInventariosPendientes();
    updateInventarioMessage(`Se creó el inventario ${data.numeroInventario} en estado pendiente.`);
    abrirInventario(currentInventoryKey(data));
  } catch (error) {
    updateInventarioMessage(error.message || 'No se pudo crear el inventario.');
  }
}

function renderDetalleInventario(data) {
  inventarioActual = data;

  document.getElementById('modal-numero').innerText = data.resumen.numeroInventario;
  document.getElementById('modal-fecha').innerText = formatFechaInventario(data.resumen.fechaInventario);
  document.getElementById('modal-descripcion').innerText = data.resumen.descripcion || '-';
  document.getElementById('modal-ubicacion').innerText = data.resumen.ubicacion || '-';
  document.getElementById('modal-tipo').innerText = data.resumen.tipo || '-';
  const btnFinalizar = document.getElementById('btn-finalizar-inventario');
  const btnCancelar = document.getElementById('btn-cancelar-inventario');
  const bloqueoPorVencimiento = data.resumen.vencido && !data.permisos?.puedeFinalizar;

  btnFinalizar.disabled = !data.permisos?.puedeFinalizar;
  btnCancelar.disabled = !data.permisos?.puedeCancelar;
  btnFinalizar.title = bloqueoPorVencimiento ? 'Sólo Analista de AAFF puede finalizar inventarios vencidos.' : '';
  btnCancelar.title = bloqueoPorVencimiento ? 'Sólo Analista de AAFF puede cancelar inventarios vencidos.' : '';

  const tbody = document.getElementById('detalleBody');
  tbody.innerHTML = '';

  data.detalle.forEach(item => {
    const tr = document.createElement('tr');
    tr.dataset.rowId = String(item.id);
    tr.innerHTML = `
      <td><input class="table-input" data-field="numeroClase" value="${escapeHtmlInventario(item.numeroClase || '')}"></td>
      <td><input class="table-input" data-field="descripcionClase" value="${escapeHtmlInventario(item.descripcionClase || '')}"></td>
      <td><input class="table-input table-input-num" data-field="stockTeorico" type="number" value="${escapeHtmlInventario(item.stockTeorico || 0)}"></td>
      <td><input class="table-input table-input-num" data-field="stockFisicosAptos" type="number" value="${escapeHtmlInventario(item.stockFisicosAptos || 0)}"></td>
      <td><input class="table-input table-input-num" data-field="stockFisicosNoAptos" type="number" value="${escapeHtmlInventario(item.stockFisicosNoAptos || 0)}"></td>
      <td class="diff-value" data-field="diferencia">${escapeHtmlInventario(item.diferencia || 0)}</td>
      <td><input class="table-input" data-field="numeroBaja" value="${escapeHtmlInventario(item.numeroBaja || '')}"></td>
      <td><input class="table-input" data-field="numeroAlta" value="${escapeHtmlInventario(item.numeroAlta || '')}"></td>
      <td><input class="table-input" data-field="observacion" value="${escapeHtmlInventario(item.observacion || '')}"></td>
    `;

    tbody.appendChild(tr);
  });

  document.getElementById('firma-administrativo').value = data.firmas.administrativo || '';
  document.getElementById('firma-p1').value = data.firmas.participante1 || '';
  document.getElementById('firma-p2').value = data.firmas.participante2 || '';
  document.getElementById('firma-gerencia').value = data.firmas.gerencia || '';

  tbody.querySelectorAll('input[data-field="stockTeorico"], input[data-field="stockFisicosAptos"], input[data-field="stockFisicosNoAptos"]').forEach(input => {
    input.addEventListener('input', () => {
      const row = input.closest('tr');
      calcularDiferenciaFila(row);
    });
  });

  tbody.querySelectorAll('tr').forEach(row => calcularDiferenciaFila(row));
}

function calcularDiferenciaFila(row) {
  const teorico = Number(row.querySelector('input[data-field="stockTeorico"]').value || 0);
  const aptos = Number(row.querySelector('input[data-field="stockFisicosAptos"]').value || 0);
  const noAptos = Number(row.querySelector('input[data-field="stockFisicosNoAptos"]').value || 0);
  const diff = aptos + noAptos - teorico;
  const cell = row.querySelector('[data-field="diferencia"]');
  cell.innerText = String(diff);
  cell.classList.remove('diff-pos', 'diff-neg');
  if (diff > 0) cell.classList.add('diff-pos');
  if (diff < 0) cell.classList.add('diff-neg');
}

async function obtenerDetalleInventario(key) {
  const meta = decodeInventoryKey(key);
  const response = await fetch(
    `${INVENTARIO_API_BASE}/inventarios/${encodeURIComponent(meta.numeroInventario)}/detalle?ubicacion=${encodeURIComponent(meta.ubicacion)}&fecha=${encodeURIComponent(meta.fechaInventario)}&tipo=${encodeURIComponent(meta.tipo)}`,
    { headers: authHeadersInventario() }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo obtener el detalle del inventario');
  }

  return data;
}

async function abrirInventario(key) {
  try {
    updateInventarioMessage('Cargando detalle del inventario pendiente...');
    const data = await obtenerDetalleInventario(key);
    renderDetalleInventario(data);
    document.getElementById('modal').style.display = 'flex';
    modalAbierto = true;
    if (data.resumen.vencido && !data.permisos?.puedeFinalizar) {
      updateInventarioMessage('Este inventario está vencido. Sólo Analista de AAFF puede finalizarlo o cancelarlo.');
    } else {
      updateInventarioMessage('');
    }
  } catch (error) {
    updateInventarioMessage(error.message || 'No se pudo abrir el inventario.');
  }
}

function cerrarInventarioModal() {
  document.getElementById('modal').style.display = 'none';
  modalAbierto = false;
}

function collectPayloadFromModal() {
  const rows = Array.from(document.querySelectorAll('#detalleBody tr'));
  return {
    ubicacion: inventarioActual.resumen.ubicacion,
    fechaInventario: inventarioActual.resumen.fechaInventario,
    tipo: inventarioActual.resumen.tipo,
    detalle: rows.map(row => ({
      id: Number(row.dataset.rowId),
      numeroClase: row.querySelector('input[data-field="numeroClase"]').value,
      descripcionClase: row.querySelector('input[data-field="descripcionClase"]').value,
      stockTeorico: row.querySelector('input[data-field="stockTeorico"]').value,
      stockFisicosAptos: row.querySelector('input[data-field="stockFisicosAptos"]').value,
      stockFisicosNoAptos: row.querySelector('input[data-field="stockFisicosNoAptos"]').value,
      numeroBaja: row.querySelector('input[data-field="numeroBaja"]').value,
      numeroAlta: row.querySelector('input[data-field="numeroAlta"]').value,
      observacion: row.querySelector('input[data-field="observacion"]').value
    })),
    firmas: {
      administrativo: document.getElementById('firma-administrativo').value,
      participante1: document.getElementById('firma-p1').value,
      participante2: document.getElementById('firma-p2').value,
      gerencia: document.getElementById('firma-gerencia').value
    }
  };
}

async function persistirInventario(action) {
  if (!inventarioActual) {
    updateInventarioMessage('No hay un inventario abierto para guardar.');
    return;
  }

  const endpoint = action === 'finalizar' ? 'finalizar' : action === 'cancelar' ? 'cancelar' : 'guardar';
  const canProceed = action === 'finalizar'
    ? inventarioActual.permisos?.puedeFinalizar
    : action === 'cancelar'
      ? inventarioActual.permisos?.puedeCancelar
      : true;

  if (!canProceed) {
    updateInventarioMessage('Sólo Analista de AAFF puede finalizar o cancelar inventarios vencidos.');
    return;
  }

  updateInventarioMessage(
    action === 'finalizar'
      ? 'Finalizando inventario y enviándolo a Reportes...'
      : action === 'cancelar'
        ? 'Cancelando inventario y enviándolo a Reportes...'
        : 'Guardando borrador del inventario...'
  );

  try {
    const response = await fetch(
      `${INVENTARIO_API_BASE}/inventarios/${encodeURIComponent(inventarioActual.resumen.numeroInventario)}/${endpoint}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeadersInventario()
        },
        body: JSON.stringify(collectPayloadFromModal())
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'No se pudo guardar el inventario');
    }

    await cargarInventariosPendientes();

    if (action === 'finalizar' || action === 'cancelar') {
      cerrarInventarioModal();
      updateInventarioMessage(
        action === 'finalizar'
          ? `El inventario ${inventarioActual.resumen.numeroInventario} quedó finalizado y ya pasa a Reportes.`
          : `El inventario ${inventarioActual.resumen.numeroInventario} quedó cancelado y ya pasa a Reportes.`
      );
      inventarioActual = null;
      return;
    }

    updateInventarioMessage('Borrador guardado correctamente.');
    const refreshed = await obtenerDetalleInventario(currentInventoryKey({
      numeroInventario: inventarioActual.resumen.numeroInventario,
      ubicacion: inventarioActual.resumen.ubicacion,
      fechaInventario: inventarioActual.resumen.fechaInventario,
      tipo: inventarioActual.resumen.tipo
    }));
    renderDetalleInventario(refreshed);
  } catch (error) {
    updateInventarioMessage(error.message || 'No se pudo persistir el inventario.');
  }
}

async function initInventarioPage() {
  renderTablaInventarios();
  try {
    await cargarFiltrosInventario();
    await cargarInventariosPendientes();
    updateInventarioMessage('');
  } catch (error) {
    renderCreateControls();
    updateInventarioMessage('No se pudo conectar la pantalla de Inventario con la base actual.');
  }
}
