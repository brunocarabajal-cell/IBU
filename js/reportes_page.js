const API_BASE = typeof getApiBase === 'function' ? getApiBase() : 'http://127.0.0.1:3000';
let invValor = '';
let estadoValor = [];
let ubiValor = [];
let tipoValor = [];
let desdeValor = '';
let hastaValor = '';
let resultados = [];
let primeraBusqueda = false;
const detalleCache = new Map();

function authHeaders() {
  try {
    const user = JSON.parse(localStorage.getItem('ibu_user')) || {};
    return user.legajo ? { 'X-User-Legajo': String(user.legajo) } : {};
  } catch (error) {
    return {};
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatFecha(value) {
  if (!value) return '-';
  const fecha = new Date(`${value}T00:00:00`);
  return Number.isNaN(fecha.getTime()) ? value : fecha.toLocaleDateString('es-AR');
}

function estadoClass(estado) {
  if (estado === 'Completo') return 'status-ok';
  if (estado === 'Pendiente' || estado === 'Prórroga') return 'status-pend';
  if (estado === 'Reclamado') return 'status-cancel';
  return '';
}

function renderTabla(data = resultados) {
  const tbody = document.querySelector('#tabla tbody');
  tbody.innerHTML = '';

  if (!primeraBusqueda) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Seleccionar filtros para buscar</td></tr>';
    return;
  }

  if (data.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No se encontraron resultados para los filtros seleccionados.</td></tr>';
    return;
  }

  data.forEach(item => {
    const diffClass = item.diferencia > 0 ? 'diff-pos' : item.diferencia < 0 ? 'diff-neg' : '';
    const tr = document.createElement('tr');
    const detalleId = encodeURIComponent(`${item.numero_inventario}|${item.ubicacion}|${item.fecha_inventario}|${item.tipo}`);
    tr.innerHTML = `
      <td>${escapeHtml(item.numero_inventario)}</td>
      <td>${escapeHtml(formatFecha(item.fecha_inventario))}</td>
      <td>${escapeHtml(item.ubicacion || '-')}</td>
      <td>${escapeHtml(item.descripcion)}</td>
      <td class="${estadoClass(item.estado)}">${escapeHtml(item.estado || '-')}</td>
      <td>${escapeHtml(item.stock_teorico)}</td>
      <td>${escapeHtml(item.stock_fisico)}</td>
      <td class="${diffClass}">${escapeHtml(item.diferencia)}</td>
      <td>
        <button class="action" onclick="detalle('${detalleId}')">Detalles</button>
        <span class="pdf" onclick="exportarDetallePDF('${detalleId}')">
          <img src="../assets/PDF_icon.png" style="width:16px;vertical-align:middle;" alt="PDF">
        </span>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function updateHelperText(message) {
  document.getElementById('helper-text').innerText = message;
}

async function cargarFiltros() {
  try {
    const res = await fetch(`${API_BASE}/reportes/filtros`, {
      headers: authHeaders()
    });
    if (!res.ok) throw new Error();
    const filtros = await res.json();

    select_mult('#select-estado', {
      options: filtros.estados || [],
      placeholder: 'Todos',
      multiple: true,
      onChange: v => estadoValor = Array.isArray(v) ? v : []
    });

    select_mult('#select-ubi', {
      options: filtros.ubicaciones || [],
      placeholder: 'Todas',
      multiple: true,
      onChange: v => ubiValor = Array.isArray(v) ? v : []
    });

    select_mult('#select-tipo', {
      options: filtros.tipos || [],
      placeholder: 'Todos',
      multiple: true,
      onChange: v => tipoValor = Array.isArray(v) ? v : []
    });
  } catch (error) {
    updateHelperText('No se pudieron cargar los filtros desde el backend. Verificá que el servidor esté levantado en el puerto 3000.');
  }
}

async function buscarReportes() {
  primeraBusqueda = true;
  updateHelperText('Buscando información en la base inicial de inventarios...');

  const params = new URLSearchParams();
  if (invValor.trim()) params.append('inventario', invValor.trim());
  estadoValor.forEach(v => params.append('estado', v));
  ubiValor.forEach(v => params.append('ubicacion', v));
  tipoValor.forEach(v => params.append('tipo', v));
  if (desdeValor) params.append('desde', desdeValor);
  if (hastaValor) params.append('hasta', hastaValor);

  try {
    const res = await fetch(`${API_BASE}/reportes?${params.toString()}`, {
      headers: authHeaders()
    });
    if (!res.ok) throw new Error();
    resultados = await res.json();
    renderTabla(resultados);
    updateHelperText(resultados.length > 0
      ? `Se encontraron ${resultados.length} inventario(s) para los filtros aplicados.`
      : 'No hubo coincidencias para los filtros aplicados.');
  } catch (error) {
    resultados = [];
    renderTabla(resultados);
    updateHelperText('No se pudo consultar la base de reportes. Verificá que el backend esté corriendo.');
  }
}

async function exportCSV() {
  if (resultados.length === 0) {
    updateHelperText('Primero necesitás realizar una búsqueda con resultados para exportar.');
    return;
  }

  updateHelperText('Preparando exportación detallada por clases de activos...');

  try {
    const detailEntries = await Promise.all(
      resultados.map(async item => {
        const detalleId = encodeURIComponent(`${item.numero_inventario}|${item.ubicacion}|${item.fecha_inventario}|${item.tipo}`);
        const data = await obtenerDetalle(detalleId);
        return { resumen: item, detalleData: data };
      })
    );

    const headers = [
      'Numero Inventario',
      'Fecha Inventario',
      'Ubicacion',
      'Tipo',
      'Estado',
      'Numero Clase',
      'Descripcion Clase',
      'Stock Teorico',
      'Fisico Apto',
      'Fisico No Apto',
      'Diferencia',
      'Nro Baja',
      'Nro Alta',
      'Observacion',
      'Administrativo',
      'Participante 1',
      'Participante 2',
      'Gerencia'
    ];

    const rows = detailEntries.flatMap(({ resumen, detalleData }) =>
      detalleData.detalle.map(item => [
        resumen.numero_inventario,
        formatFecha(resumen.fecha_inventario),
        resumen.ubicacion || '',
        resumen.tipo || '',
        resumen.estado || '',
        item.numeroClase || '',
        item.descripcionClase || '',
        item.stockTeorico,
        item.stockFisicosAptos,
        item.stockFisicosNoAptos,
        item.diferencia,
        item.numeroBaja || '',
        '',
        item.observacion || '',
        detalleData.firmas.administrativo || '',
        detalleData.firmas.participante1 || '',
        detalleData.firmas.participante2 || '',
        detalleData.firmas.gerencia || ''
      ])
    );

    const csvContent = [headers, ...rows]
      .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'reportes_inventario_detallado.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    updateHelperText(`Se exportaron ${rows.length} filas detalladas de clases de activos.`);
  } catch (error) {
    updateHelperText('No se pudo generar la exportación detallada de clases.');
  }
}

async function detalle(detalleId) {
  try {
    const data = await obtenerDetalle(detalleId);

    document.getElementById('detN').innerText = data.resumen.numeroInventario;
    document.getElementById('detFecha').innerText = formatFecha(data.resumen.fechaInventario);
    document.getElementById('detDesc').innerText = data.detalle.length === 1 ? data.detalle[0].descripcionClase : `${data.detalle.length} clases relevadas`;
    document.getElementById('detTipo').innerText = data.resumen.tipo || '-';
    document.getElementById('firmaAdmin').innerText = data.firmas.administrativo;
    document.getElementById('firmaP1').innerText = data.firmas.participante1;
    document.getElementById('firmaP2').innerText = data.firmas.participante2;
    document.getElementById('firmaGerencia').innerText = data.firmas.gerencia;

    const tbody = document.getElementById('detalleTabla');
    tbody.innerHTML = '';

    data.detalle.forEach(item => {
      const tr = document.createElement('tr');
      const diffClass = item.diferencia > 0 ? 'diff-pos' : item.diferencia < 0 ? 'diff-neg' : '';
      tr.innerHTML = `
        <td>${escapeHtml(item.numeroClase || '-')}</td>
        <td>${escapeHtml(item.descripcionClase || '-')}</td>
        <td>${escapeHtml(item.stockTeorico)}</td>
        <td>${escapeHtml(item.stockFisicosAptos)}</td>
        <td>${escapeHtml(item.stockFisicosNoAptos)}</td>
        <td class="${diffClass}">${escapeHtml(item.diferencia)}</td>
        <td>${escapeHtml(item.numeroBaja || '-')}</td>
        <td>-</td>
        <td>${escapeHtml(item.observacion || '-')}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('modal').style.display = 'flex';
  } catch (error) {
    updateHelperText('No se pudo cargar el detalle del inventario seleccionado.');
  }
}

async function obtenerDetalle(detalleId) {
  const [numeroInventario, ubicacion, fechaInventario, tipoInventario] = decodeURIComponent(detalleId).split('|');
  const cacheKey = `${numeroInventario}|${ubicacion}|${fechaInventario}|${tipoInventario}`;

  if (detalleCache.has(cacheKey)) {
    return detalleCache.get(cacheKey);
  }

  const response = await fetch(`${API_BASE}/reportes/${encodeURIComponent(numeroInventario)}/detalle?ubicacion=${encodeURIComponent(ubicacion)}&fecha=${encodeURIComponent(fechaInventario)}&tipo=${encodeURIComponent(tipoInventario)}`, {
    headers: authHeaders()
  });

  if (!response.ok) throw new Error();
  const data = await response.json();
  detalleCache.set(cacheKey, data);
  return data;
}

function buildPrintHtml(data) {
  const tituloDetalle = data.detalle.length === 1
    ? (data.detalle[0].descripcionClase || '-')
    : `${data.detalle.length} clases relevadas`;
  const totals = data.detalle.reduce((acc, item) => {
    acc.stockTeorico += Number(item.stockTeorico) || 0;
    acc.stockFisicosAptos += Number(item.stockFisicosAptos) || 0;
    acc.stockFisicosNoAptos += Number(item.stockFisicosNoAptos) || 0;
    acc.diferencia += Number(item.diferencia) || 0;
    return acc;
  }, {
    stockTeorico: 0,
    stockFisicosAptos: 0,
    stockFisicosNoAptos: 0,
    diferencia: 0
  });
  const rows = data.detalle.map(item => `
    <tr>
      <td>${escapeHtml(item.numeroClase || '-')}</td>
      <td>${escapeHtml(item.descripcionClase || '-')}</td>
      <td class="num">${escapeHtml(item.stockTeorico)}</td>
      <td class="num">${escapeHtml(item.stockFisicosAptos)}</td>
      <td class="num">${escapeHtml(item.stockFisicosNoAptos)}</td>
      <td class="num ${Number(item.diferencia) > 0 ? 'diff-pos' : Number(item.diferencia) < 0 ? 'diff-neg' : ''}">${escapeHtml(item.diferencia)}</td>
      <td class="num">${escapeHtml(item.numeroBaja || '-')}</td>
      <td class="num">-</td>
      <td>${escapeHtml(item.observacion || '-')}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8">
    <title>Inventario ${escapeHtml(data.resumen.numeroInventario)}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:24px;color:#1A1A2E}
      h1{font-size:22px;margin-bottom:20px;text-align:center}
      .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;font-size:13px}
      .meta div{padding:10px;border:1px solid #D9DDF0;border-radius:10px}
      .meta strong{display:block;color:#4B4EFC;margin-bottom:4px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #D9DDF0;padding:8px;text-align:left;vertical-align:top}
      th{background:#F3F5FF;color:#3340D6}
      .num{text-align:center}
      .diff-pos{color:#2E7D32;font-weight:700}
      .diff-neg{color:#C62828;font-weight:700}
      .total-row td{background:#ECEFF6;font-weight:700}
      .firmas{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:28px}
      .firma{border-top:1px solid #AEB7E3;padding-top:10px;font-size:12px;text-align:center}
      .firma strong{display:block;color:#4B4EFC;margin-bottom:6px}
    </style>
  </head>
  <body>
    <h1>Inventario de Bienes de Uso: ${escapeHtml(tituloDetalle)}</h1>
    <div class="meta">
      <div><strong>N° Inventario</strong>${escapeHtml(data.resumen.numeroInventario)}</div>
      <div><strong>Fecha</strong>${escapeHtml(formatFecha(data.resumen.fechaInventario))}</div>
      <div><strong>Ubicación</strong>${escapeHtml(data.resumen.ubicacion || '-')}</div>
      <div><strong>Tipo</strong>${escapeHtml(data.resumen.tipo || '-')}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>N° Clase</th>
          <th>Descripción</th>
          <th>Teórico</th>
          <th>Físico Apto</th>
          <th>Físico No Apto</th>
          <th>Diferencia</th>
          <th>N° Baja</th>
          <th>N° Alta</th>
          <th>Observaciones</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td colspan="2">Total</td>
          <td class="num">${totals.stockTeorico}</td>
          <td class="num">${totals.stockFisicosAptos}</td>
          <td class="num">${totals.stockFisicosNoAptos}</td>
          <td class="num ${totals.diferencia > 0 ? 'diff-pos' : totals.diferencia < 0 ? 'diff-neg' : ''}">${totals.diferencia}</td>
          <td class="num">-</td>
          <td class="num">-</td>
          <td>-</td>
        </tr>
      </tbody>
    </table>
    <div class="firmas">
      <div class="firma"><strong>Administrativo</strong>${escapeHtml(data.firmas.administrativo || '-')}</div>
      <div class="firma"><strong>Participante</strong>${escapeHtml(data.firmas.participante1 || '-')}</div>
      <div class="firma"><strong>Participante</strong>${escapeHtml(data.firmas.participante2 || '-')}</div>
      <div class="firma"><strong>Gerencia</strong>${escapeHtml(data.firmas.gerencia || '-')}</div>
    </div>
  </body>
  </html>`;
}

async function exportarDetallePDF(detalleId) {
  try {
    const data = await obtenerDetalle(detalleId);
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) {
      updateHelperText('El navegador bloqueó la ventana para exportar el PDF.');
      return;
    }

    popup.document.open();
    popup.document.write(buildPrintHtml(data));
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 250);
  } catch (error) {
    updateHelperText('No se pudo exportar el detalle del inventario en PDF.');
  }
}

function initReportesPage() {
  if (window.__reportesInitialized) {
    return;
  }
  window.__reportesInitialized = true;

  const inputInv = crearInput({
    placeholder: 'Ej: 204',
    onChange: v => invValor = v
  });
  inputInv.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      buscarReportes();
    }
  });
  document.getElementById('input-inv').appendChild(inputInv);

  const inputDesde = crearInputDate({ onChange: v => desdeValor = v });
  document.getElementById('input-desde').appendChild(inputDesde);

  const inputHasta = crearInputDate({ onChange: v => hastaValor = v });
  document.getElementById('input-hasta').appendChild(inputHasta);

  const btnBuscar = crearBotonPrincipal({ texto: 'Buscar', onClick: () => buscarReportes() });
  document.getElementById('btn-buscar').appendChild(btnBuscar);

  const btnExcel = crearBotonPrincipal({ texto: '', onClick: () => exportCSV() });
  const imgExcel = document.createElement('img');
  imgExcel.src = '../assets/excel.png';
  imgExcel.style.width = '18px';
  imgExcel.style.height = '18px';
  imgExcel.alt = 'Exportar';
  btnExcel.appendChild(imgExcel);
  document.getElementById('btn-excel').appendChild(btnExcel);

  renderTabla();
  cargarFiltros();
}
