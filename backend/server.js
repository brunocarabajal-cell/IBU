const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-User-Legajo']
}));
app.use(express.json());

const INVENTORY_TYPE_DEFINITIONS = [
  { label: 'Inventario por Cronograma', aliases: ['Inventario por Cronograma', 'Cronograma'] },
  { label: 'Auditoria de Inventario', aliases: ['Auditoria de Inventario', 'Eq/Inven'] },
  { label: 'Inventario de Clases', aliases: ['Inventario de Clases'] },
  { label: 'Rebalance de Cronograma por Prorroga', aliases: ['Rebalance de Cronograma por Prorroga'] }
];

function getInventoryTypeOptions() {
  return INVENTORY_TYPE_DEFINITIONS.map(item => item.label);
}

function normalizeInventoryTypeLabel(value) {
  const normalized = String(value || '').trim();
  const definition = INVENTORY_TYPE_DEFINITIONS.find(item => item.aliases.includes(normalized));
  return definition ? definition.label : normalized;
}

function expandInventoryTypeAliases(values) {
  const expanded = new Set();
  values.forEach(value => {
    const normalized = String(value || '').trim();
    const definition = INVENTORY_TYPE_DEFINITIONS.find(item => item.aliases.includes(normalized));
    if (definition) {
      definition.aliases.forEach(alias => expanded.add(alias));
    } else if (normalized) {
      expanded.add(normalized);
    }
  });
  return [...expanded];
}

function isCronogramaType(value) {
  return ['Cronograma', 'Inventario por Cronograma'].includes(value);
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function buildDetailFilters(query) {
  const conditions = [];
  const params = [];

  if (query.inventario) {
    conditions.push(`numero_inventario LIKE ?`);
    params.push(`%${query.inventario.trim()}%`);
  }

  const ubicaciones = toArray(query.ubicacion);
  if (ubicaciones.length > 0) {
    conditions.push(`ubicacion IN (${ubicaciones.map(() => '?').join(',')})`);
    params.push(...ubicaciones);
  }

  const tipos = expandInventoryTypeAliases(toArray(query.tipo));
  if (tipos.length > 0) {
    conditions.push(`tipo IN (${tipos.map(() => '?').join(',')})`);
    params.push(...tipos);
  }

  if (query.desde) {
    conditions.push(`fecha_inventario >= ?`);
    params.push(query.desde);
  }

  if (query.hasta) {
    conditions.push(`fecha_inventario <= ?`);
    params.push(query.hasta);
  }

  return { conditions, params };
}

function buildWhereClause(conditions) {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

function reportStatusCase(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `
    CASE
      WHEN SUM(CASE WHEN ${prefix}estado = 'Pendiente' THEN 1 ELSE 0 END) > 0 THEN 'Pendiente'
      WHEN SUM(CASE WHEN ${prefix}estado = 'Reclamado' THEN 1 ELSE 0 END) > 0 THEN 'Reclamado'
      WHEN SUM(CASE WHEN ${prefix}prorroga = 'Si' THEN 1 ELSE 0 END) > 0 THEN 'Prórroga'
      WHEN SUM(CASE WHEN COALESCE(${prefix}estado, '') <> '' THEN 1 ELSE 0 END) > 0 THEN 'Completo'
      ELSE 'Sin estado'
    END
  `;
}

function findUserByLegajo(legajo, callback) {
  db.get(`
    SELECT
      id,
      legajo,
      nombre,
      puesto,
      perfil,
      perfil_descripcion,
      ubicacion_codigo,
      ubicacion_codigos,
      ubicacion_descripcion,
      ubicacion_descripciones,
      ubicacion_origen,
      acceso_total_ubicaciones,
      activo
    FROM usuarios
    WHERE legajo = ?
  `, [legajo], callback);
}

function getRequesterUser(req, callback) {
  const rawLegajo = req.header('X-User-Legajo') || req.query.legajoUsuario;

  if (!rawLegajo) {
    return callback(null, null);
  }

  findUserByLegajo(rawLegajo, (err, row) => {
    if (err) return callback(err);
    if (!row) {
      return callback(null, {
        invalid: true,
        acceso_total_ubicaciones: 0,
        ubicacion_codigo: null
      });
    }

    callback(null, row);
  });
}

function applyLocationVisibility(conditions, params, user, columnName = 'ubicacion') {
  if (!user || Number(user.acceso_total_ubicaciones) === 1) {
    return;
  }

  const userLocations = parseLocationCodes(user);
  if (userLocations.length === 0) {
    conditions.push('1 = 0');
    return;
  }

  conditions.push(`${columnName} IN (${userLocations.map(() => '?').join(',')})`);
  params.push(...userLocations);
}

function parseJsonArray(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function parseLocationCodes(row) {
  const values = parseJsonArray(row.ubicacion_codigos);
  if (values.length > 0) return values;
  return row.ubicacion_codigo ? [row.ubicacion_codigo] : [];
}

function parseLocationDescriptions(row) {
  const values = parseJsonArray(row.ubicacion_descripciones);
  if (values.length > 0) return values;
  return row.ubicacion_descripcion ? [row.ubicacion_descripcion] : [];
}

function isActivosFijos(user) {
  return user?.perfil === 'Analista de AAFF';
}

function isAdminOrGerencia(user) {
  return ['Administrativo', 'Gerencia'].includes(user?.perfil);
}

function isAssignableByAdminGerencia(profile) {
  return ['Administrativo', 'Gerencia', 'Administrativo Predio', 'Sumador'].includes(profile);
}

function canEditUser(requester, target) {
  if (!requester || requester.invalid || !target) return false;
  if (isActivosFijos(requester)) return true;
  if (isAdminOrGerencia(requester) && isAssignableByAdminGerencia(target.perfil)) return true;
  return false;
}

function canAssignProfile(requester, targetProfile) {
  if (!requester || requester.invalid) return false;
  if (targetProfile === 'Analista de AAFF') {
    return isActivosFijos(requester);
  }

  if (isActivosFijos(requester)) return true;
  if (isAdminOrGerencia(requester)) {
    return isAssignableByAdminGerencia(targetProfile);
  }

  return false;
}

function getAvailableProfiles() {
  return [
    { perfil: 'Administrativo', perfil_descripcion: 'Administrativo con acceso restringido a sus ubicaciones' },
    { perfil: 'Gerencia', perfil_descripcion: 'Gerencia con acceso restringido a sus ubicaciones' },
    { perfil: 'Administrativo Predio', perfil_descripcion: 'Administrativo de predio con acceso restringido a sus ubicaciones' },
    { perfil: 'Sumador', perfil_descripcion: 'Sumador con acceso restringido a sus ubicaciones' },
    { perfil: 'Contador', perfil_descripcion: 'Contador con acceso restringido a sus ubicaciones' },
    { perfil: 'Analista de AAFF', perfil_descripcion: 'Analista de Activos Fijos con acceso a todas las ubicaciones' }
  ];
}

function getProrrogaMotivos() {
  return [
    'Planificación Errónea',
    'Faltante de Personal',
    'Complejidad de Análisis',
    'Complejidad de Conteo',
    'Diferencias por Regularizar'
  ];
}

function canCreateProrroga(user) {
  return ['Administrativo', 'Administrativo Predio', 'Analista de AAFF'].includes(user?.perfil);
}

function canApproveGerencia(user) {
  return user?.perfil === 'Gerencia' || isActivosFijos(user);
}

function canApproveAaff(user) {
  return isActivosFijos(user);
}

function isProrrogaClosed(row) {
  return ['Aprobada', 'Rechazada', 'Cancelada'].includes(row?.estado);
}

function buildProrrogaStages(row) {
  const gerenciaEstado = row.gerencia_estado || (row.estado === 'Pendiente Gerencia' ? 'Pendiente' : 'Sin acción');
  const aaffEstado = row.aaff_estado || (
    row.estado === 'Pendiente Gerencia'
      ? 'En espera'
      : row.estado === 'Pendiente AAFF'
        ? 'Pendiente'
        : 'Sin acción'
  );

  return [
    {
      orden: 1,
      participante: 'Solicitante',
      perfil: row.solicitante_perfil || 'Administrativo',
      nombre: row.solicitante_nombre || 'Sin asignar',
      estado: row.estado === 'Cancelada' ? 'Cancelada' : 'Cargada',
      fecha: row.created_at,
      observacion: row.solicitante_observacion || row.motivo
    },
    {
      orden: 2,
      participante: 'Gerencia',
      perfil: 'Gerencia',
      nombre: row.gerencia_nombre || 'Pendiente',
      estado: gerenciaEstado,
      fecha: row.gerencia_fecha,
      observacion: row.gerencia_observacion || ''
    },
    {
      orden: 3,
      participante: 'Analista de AAFF',
      perfil: 'Analista de AAFF',
      nombre: row.aaff_nombre || 'Pendiente',
      estado: aaffEstado,
      fecha: row.aaff_fecha,
      observacion: row.aaff_observacion || ''
    }
  ];
}

function mapProrrogaRow(row, requester) {
  const canApprove =
    (canApproveGerencia(requester) && row.estado === 'Pendiente Gerencia') ||
    (canApproveAaff(requester) && row.estado === 'Pendiente AAFF');
  const canReject = canApprove;

  return {
    id: row.id,
    numeroInventario: row.numero_inventario,
    fechaInventario: row.fecha_inventario,
    fechaLimiteProrroga: row.fecha_limite_prorroga,
    descripcion: row.descripcion,
    tipo: row.tipo,
    ubicacion: row.ubicacion,
    motivo: row.motivo,
    solicitanteLegajo: row.solicitante_legajo,
    solicitanteNombre: row.solicitante_nombre,
    solicitantePerfil: row.solicitante_perfil,
    observacionSolicitante: row.solicitante_observacion || '',
    estado: row.estado,
    etapaActual: row.etapa_actual,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    gerencia: {
      legajo: row.gerencia_legajo,
      nombre: row.gerencia_nombre,
      estado: row.gerencia_estado || 'Pendiente',
      observacion: row.gerencia_observacion || '',
      fecha: row.gerencia_fecha
    },
    activosFijos: {
      legajo: row.aaff_legajo,
      nombre: row.aaff_nombre,
      estado: row.aaff_estado || 'Pendiente',
      observacion: row.aaff_observacion || '',
      fecha: row.aaff_fecha
    },
    etapas: buildProrrogaStages(row),
    permisos: {
      puedeAprobar: canApprove,
      puedeRechazar: canReject
    }
  };
}

function mapUserRow(row) {
  if (!row) return null;

  const ubicacionCodigos = parseLocationCodes(row);
  const ubicacionDescripciones = parseLocationDescriptions(row);
  return {
    id: row.id,
    legajo: row.legajo,
    nombre: row.nombre,
    puesto: row.puesto,
    perfil: row.perfil,
    perfilDescripcion: row.perfil_descripcion,
    codigo: row.ubicacion_codigo,
    ubicacion: row.ubicacion_codigo,
    ubicacionDescripcion: row.ubicacion_descripcion,
    ubicacionCodigos,
    ubicacionDescripciones,
    ubicacionOrigen: row.ubicacion_origen,
    accesoTotalUbicaciones: Number(row.acceso_total_ubicaciones) === 1,
    activo: Number(row.activo) === 1
  };
}

function canManageInventarios(user) {
  return !!user && !user.invalid && !!user.legajo;
}

function canManageExpiredInventory(user) {
  return isActivosFijos(user);
}

function getInventoryAgeDays(fechaInventario) {
  if (!fechaInventario) return 0;

  const today = new Date();
  const inventoryDate = new Date(`${fechaInventario}T00:00:00`);
  if (Number.isNaN(inventoryDate.getTime())) {
    return 0;
  }

  today.setHours(0, 0, 0, 0);
  inventoryDate.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - inventoryDate.getTime()) / 86400000);
  return diff < 0 ? 0 : diff;
}

function isInventoryExpired(fechaInventario) {
  return getInventoryAgeDays(fechaInventario) > 30;
}

function canUseLocation(user, ubicacion) {
  if (!user || user.invalid) return false;
  if (Number(user.acceso_total_ubicaciones) === 1) return true;
  return parseLocationCodes(user).includes(ubicacion);
}

function getVisibleInventoryLocations(user) {
  if (!user || user.invalid) return [];
  if (Number(user.acceso_total_ubicaciones) === 1) {
    return null;
  }

  return parseLocationCodes(user);
}

function sanitizeInteger(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function nextInventoryNumber(callback) {
  db.get(`
    SELECT COALESCE(MAX(CAST(numero_inventario AS INTEGER)), 0) + 1 AS next_number
    FROM inventario_detalles
    WHERE numero_inventario GLOB '[0-9]*'
  `, [], (err, row) => {
    if (err) {
      callback(err);
      return;
    }

    callback(null, String(row?.next_number || 1));
  });
}

function fetchInventoryRows(requester, identifiers, callback) {
  const conditions = [
    'numero_inventario = ?',
    'ubicacion = ?',
    'fecha_inventario = ?',
    `tipo IN (${expandInventoryTypeAliases([identifiers.tipo]).map(() => '?').join(',')})`
  ];
  const expandedTypes = expandInventoryTypeAliases([identifiers.tipo]);
  const params = [
    identifiers.numeroInventario,
    identifiers.ubicacion,
    identifiers.fechaInventario,
    ...expandedTypes
  ];
  applyLocationVisibility(conditions, params, requester, 'ubicacion');

  db.all(`
    SELECT *
    FROM inventario_detalles
    ${buildWhereClause(conditions)}
    ORDER BY id
  `, params, callback);
}

function saveInventoryRows({ requester, identifiers, payload, targetState }, callback) {
  const { detalle = [], firmas = {} } = payload || {};

  if (!Array.isArray(detalle) || detalle.length === 0) {
    callback({ status: 400, error: 'No se recibieron filas para guardar el inventario' });
    return;
  }

  fetchInventoryRows(requester, identifiers, (fetchErr, rows) => {
    if (fetchErr) {
      callback({ status: 500, error: 'Error al obtener el inventario para guardar' });
      return;
    }

    if (rows.length === 0) {
      callback({ status: 404, error: 'Inventario no encontrado para este usuario' });
      return;
    }

    if (['Completo', 'Reclamado'].includes(targetState) && isInventoryExpired(rows[0].fecha_inventario) && !canManageExpiredInventory(requester)) {
      callback({ status: 403, error: 'Sólo Analista de AAFF puede finalizar o cancelar inventarios vencidos' });
      return;
    }

    const rowMap = new Map(rows.map(row => [Number(row.id), row]));
    const providedIds = detalle.map(item => Number(item.id));
    const allIdsValid = providedIds.every(id => rowMap.has(id));

    if (!allIdsValid || providedIds.length !== rows.length) {
      callback({ status: 400, error: 'Las filas enviadas no coinciden con el inventario seleccionado' });
      return;
    }

    const administrativo = (firmas.administrativo || '').trim() || rows[0].administrativo || requester.nombre || '';
    const participante1 = (firmas.participante1 || '').trim();
    const participante2 = (firmas.participante2 || '').trim();
    const gerencia = (firmas.gerencia || '').trim();

    const update = db.prepare(`
      UPDATE inventario_detalles
      SET numero_clase = ?,
          descripcion_clase = ?,
          stock_teorico = ?,
          stock_fisicos_aptos = ?,
          stock_fisicos_no_aptos = ?,
          diferencia = ?,
          numero_baja = ?,
          numero_alta = ?,
          observacion_parte = ?,
          administrativo = ?,
          participante_1 = ?,
          participante_2 = ?,
          gerente_firma = ?,
          estado = ?
      WHERE id = ?
    `);

    let hasFailure = false;
    let pending = detalle.length;

    detalle.forEach(item => {
      const stockTeorico = sanitizeInteger(item.stockTeorico);
      const stockFisicosAptos = sanitizeInteger(item.stockFisicosAptos);
      const stockFisicosNoAptos = sanitizeInteger(item.stockFisicosNoAptos);
      const diferencia = stockFisicosAptos + stockFisicosNoAptos - stockTeorico;

      update.run([
        String(item.numeroClase || '').trim() || rowMap.get(Number(item.id)).numero_clase || '',
        String(item.descripcionClase || '').trim() || rowMap.get(Number(item.id)).descripcion_clase || '',
        stockTeorico,
        stockFisicosAptos,
        stockFisicosNoAptos,
        diferencia,
        String(item.numeroBaja || '').trim(),
        String(item.numeroAlta || '').trim(),
        String(item.observacion || '').trim(),
        administrativo,
        participante1,
        participante2,
        gerencia,
        targetState,
        Number(item.id)
      ], updateErr => {
        if (hasFailure) {
          return;
        }

        if (updateErr) {
          hasFailure = true;
          update.finalize(() => callback({ status: 500, error: 'Error al guardar las filas del inventario' }));
          return;
        }

        pending -= 1;
        if (pending === 0) {
          update.finalize(finalizeErr => {
            if (finalizeErr) {
              callback({ status: 500, error: 'Error al cerrar la actualización del inventario' });
              return;
            }
            callback(null, { ok: true });
          });
        }
      });
    });
  });
}

app.get('/dashboard/resumen', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario del dashboard' });
    }

    const statusExpr = reportStatusCase('d');
    const currentYear = String(new Date().getFullYear());
    const conditions = [];
    const params = [];
    applyLocationVisibility(conditions, params, requester, 'd.ubicacion');
    const whereClause = buildWhereClause(conditions);

    const reportesCte = `
      WITH reportes AS (
        SELECT
          d.numero_inventario,
          d.fecha_inventario,
          d.ubicacion,
          d.tipo,
          ${statusExpr} AS estado_resumen,
          COUNT(*) AS cantidad_clases,
          SUM(d.stock_teorico) AS stock_teorico,
          SUM(d.stock_fisicos_aptos + d.stock_fisicos_no_aptos) AS stock_fisico,
          SUM(d.diferencia) AS diferencia_total
        FROM inventario_detalles d
        ${whereClause}
        GROUP BY d.numero_inventario, d.fecha_inventario, d.ubicacion, d.tipo
      )
    `;

    db.all(`${reportesCte}
      SELECT
        COUNT(*) AS total_reportes,
        SUM(CASE WHEN estado_resumen = 'Pendiente' THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN estado_resumen = 'Completo' AND substr(COALESCE(fecha_inventario, ''), 1, 4) = ? THEN 1 ELSE 0 END) AS completos,
        SUM(CASE WHEN diferencia_total <> 0 AND substr(COALESCE(fecha_inventario, ''), 1, 4) = ? THEN 1 ELSE 0 END) AS con_diferencias
      FROM reportes
    `, [...params, currentYear, currentYear], (metricsErr, metricsRows) => {
      if (metricsErr) {
        return res.status(500).json({ error: 'Error al obtener el resumen del dashboard' });
      }

      const prorrogaConditions = [`estado IN ('Pendiente Gerencia', 'Pendiente AAFF')`];
      const prorrogaParams = [];
      applyLocationVisibility(prorrogaConditions, prorrogaParams, requester, 'ubicacion');

      db.get(`
        SELECT COUNT(*) AS prorrogas_pendientes
        FROM prorroga_solicitudes
        ${buildWhereClause(prorrogaConditions)}
      `, prorrogaParams, (prorrogasErr, prorrogasRow) => {
        if (prorrogasErr) {
          return res.status(500).json({ error: 'Error al obtener las prórrogas pendientes del dashboard' });
        }

        db.all(`${reportesCte}
          SELECT
            numero_inventario,
            fecha_inventario,
            ubicacion,
            tipo,
            estado_resumen,
            cantidad_clases,
            diferencia_total
          FROM reportes
          WHERE estado_resumen = 'Completo'
          ORDER BY fecha_inventario DESC, numero_inventario DESC, ubicacion ASC
          LIMIT 6
        `, params, (latestErr, latestRows) => {
          if (latestErr) {
            return res.status(500).json({ error: 'Error al obtener los últimos reportes del dashboard' });
          }

          latestRows.forEach(row => {
            row.tipo = normalizeInventoryTypeLabel(row.tipo);
          });

          db.all(`${reportesCte}
          SELECT
            substr(fecha_inventario, 1, 7) AS periodo,
            SUM(diferencia_total) AS total,
            COUNT(*) AS cantidad_inventarios
          FROM reportes
          WHERE COALESCE(fecha_inventario, '') <> ''
            AND tipo IN ('Cronograma', 'Inventario por Cronograma')
            AND estado_resumen = 'Completo'
          GROUP BY substr(fecha_inventario, 1, 7)
          ORDER BY periodo DESC
          LIMIT 12
        `, params, (seriesErr, seriesRows) => {
          if (seriesErr) {
            return res.status(500).json({ error: 'Error al obtener la serie del dashboard' });
          }

          const metrics = metricsRows[0] || {};
          res.json({
            metricas: {
              totalReportes: metrics.total_reportes || 0,
              pendientes: metrics.pendientes || 0,
              prorrogas: prorrogasRow?.prorrogas_pendientes || 0,
              completos: metrics.completos || 0,
              conDiferencias: metrics.con_diferencias || 0
            },
            ultimosReportes: latestRows,
            evolucionMensual: seriesRows.reverse()
          });
        });
      });
      });
    });
  });
});

app.get('/reportes/filtros', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de reportes' });
    }

    const visibilityConditions = [`COALESCE(ubicacion, '') <> ''`];
    const visibilityParams = [];
    applyLocationVisibility(visibilityConditions, visibilityParams, requester, 'ubicacion');

    db.serialize(() => {
      db.all(`
        SELECT DISTINCT ubicacion
        FROM inventario_detalles
        ${buildWhereClause(visibilityConditions)}
        ORDER BY ubicacion
      `, visibilityParams, (ubiErr, ubicacionesRows) => {
      if (ubiErr) {
        return res.status(500).json({ error: 'Error al obtener filtros de reportes' });
      }

      db.all(`
        SELECT DISTINCT tipo
        FROM inventario_detalles
        WHERE COALESCE(tipo, '') <> ''
        ORDER BY tipo
      `, [], (tipoErr, tiposRows) => {
        if (tipoErr) {
          return res.status(500).json({ error: 'Error al obtener filtros de reportes' });
        }

        db.all(`
          SELECT estado_resumen
          FROM (
            SELECT
              numero_inventario,
              ubicacion,
              fecha_inventario,
              tipo,
              ${reportStatusCase()} AS estado_resumen
            FROM inventario_detalles
            ${buildWhereClause(visibilityConditions)}
            GROUP BY numero_inventario, ubicacion, fecha_inventario, tipo
          )
          WHERE estado_resumen <> 'Pendiente'
          GROUP BY estado_resumen
          ORDER BY estado_resumen
        `, visibilityParams, (estadoErr, estadosRows) => {
          if (estadoErr) {
            return res.status(500).json({ error: 'Error al obtener filtros de reportes' });
          }

          res.json({
            ubicaciones: ubicacionesRows.map(row => row.ubicacion),
            tipos: [...new Set(tiposRows.map(row => normalizeInventoryTypeLabel(row.tipo)).filter(Boolean))],
            estados: estadosRows.map(row => row.estado_resumen)
          });
        });
      });
      });
    });
  });
});

app.get('/reportes', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de reportes' });
    }

    const { conditions, params } = buildDetailFilters(req.query);
    applyLocationVisibility(conditions, params, requester, 'ubicacion');

    const estados = toArray(req.query.estado);
    const statusConditions = [`estado_resumen <> 'Pendiente'`];
    if (estados.length > 0) {
      statusConditions.push(`estado_resumen IN (${estados.map(() => '?').join(',')})`);
    }

    const sql = `
      WITH inventarios_agrupados AS (
        SELECT
          numero_inventario,
          fecha_inventario,
          ubicacion,
          tipo,
          ${reportStatusCase()} AS estado_resumen,
          SUM(stock_teorico) AS stock_teorico,
          SUM(stock_fisicos_aptos + stock_fisicos_no_aptos) AS stock_fisico,
          SUM(diferencia) AS diferencia,
          COUNT(*) AS cantidad_clases
        FROM inventario_detalles
        ${buildWhereClause(conditions)}
        GROUP BY numero_inventario, fecha_inventario, ubicacion, tipo
      )
      SELECT
        numero_inventario,
        fecha_inventario,
        ubicacion,
        tipo,
        estado_resumen AS estado,
        stock_teorico,
        stock_fisico,
        diferencia,
        cantidad_clases,
        CASE
          WHEN cantidad_clases = 1 THEN '1 clase relevada'
          ELSE cantidad_clases || ' clases relevadas'
        END AS descripcion
      FROM inventarios_agrupados
      WHERE ${statusConditions.join(' AND ')}
      ORDER BY fecha_inventario DESC, CAST(numero_inventario AS INTEGER) DESC
    `;

    db.all(sql, [...params, ...estados], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Error al obtener reportes' });
      }

      rows.forEach(row => {
        row.tipo = normalizeInventoryTypeLabel(row.tipo);
      });
      res.json(rows);
    });
  });
});

app.get('/reportes/:numeroInventario/detalle', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de reportes' });
    }

    const { numeroInventario } = req.params;
    const { ubicacion, fecha, tipo } = req.query;

    if (!ubicacion || !fecha || !tipo) {
      return res.status(400).json({ error: 'Faltan filtros para identificar el reporte' });
    }

    const expandedTypes = expandInventoryTypeAliases([tipo]);
    const conditions = [
      'numero_inventario = ?',
      'ubicacion = ?',
      'fecha_inventario = ?',
      `tipo IN (${expandedTypes.map(() => '?').join(',')})`
    ];
    const params = [numeroInventario, ubicacion, fecha, ...expandedTypes];
    applyLocationVisibility(conditions, params, requester, 'ubicacion');

    db.all(`
      SELECT
        numero_inventario,
        fecha_inventario,
        ubicacion,
        tipo,
        estado,
        numero_clase,
        descripcion_clase,
        stock_teorico,
        stock_fisicos_aptos,
        stock_fisicos_no_aptos,
        diferencia,
        numero_baja,
        numero_alta,
        observacion_parte,
        administrativo,
        participante_1,
        participante_2,
        gerente_firma
      FROM inventario_detalles
      ${buildWhereClause(conditions)}
      ORDER BY CAST(numero_clase AS INTEGER), numero_clase
    `, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Error al obtener detalle del reporte' });
      }

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Reporte no encontrado' });
      }

      const encabezado = rows[0];
      res.json({
        resumen: {
          numeroInventario: encabezado.numero_inventario,
          fechaInventario: encabezado.fecha_inventario,
          ubicacion: encabezado.ubicacion,
          tipo: normalizeInventoryTypeLabel(encabezado.tipo),
          estado: encabezado.estado
        },
        detalle: rows.map(row => ({
          numeroClase: row.numero_clase,
          descripcionClase: row.descripcion_clase,
          stockTeorico: row.stock_teorico,
          stockFisicosAptos: row.stock_fisicos_aptos,
          stockFisicosNoAptos: row.stock_fisicos_no_aptos,
          diferencia: row.diferencia,
          numeroBaja: row.numero_baja,
          numeroAlta: row.numero_alta,
          observacion: row.observacion_parte || row.estado || ''
        })),
        firmas: {
          administrativo: encabezado.administrativo || 'Sin asignar',
          participante1: encabezado.participante_1 || 'Sin asignar',
          participante2: encabezado.participante_2 || 'Sin asignar',
          gerencia: encabezado.gerente_firma || 'Sin asignar'
        }
      });
    });
  });
});

app.get('/inventarios/filtros', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de inventarios' });
    }

    if (!canManageInventarios(requester)) {
      return res.status(403).json({ error: 'Necesitás una sesión válida para gestionar inventarios' });
    }

    const visibleLocations = getVisibleInventoryLocations(requester);
    const locationConditions = [`COALESCE(codigo, '') <> ''`];
    const locationParams = [];
    if (visibleLocations && visibleLocations.length > 0) {
      locationConditions.push(`codigo IN (${visibleLocations.map(() => '?').join(',')})`);
      locationParams.push(...visibleLocations);
    } else if (visibleLocations && visibleLocations.length === 0) {
      locationConditions.push('1 = 0');
    }

    db.all(`
      SELECT codigo, descripcion
      FROM ubicaciones
      ${buildWhereClause(locationConditions)}
      ORDER BY codigo
    `, locationParams, (locationsErr, rows) => {
      if (locationsErr) {
        return res.status(500).json({ error: 'Error al obtener filtros de inventarios' });
      }

      res.json({
        ubicaciones: rows,
        tipos: getInventoryTypeOptions()
      });
    });
  });
});

app.get('/inventarios', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de inventarios' });
    }

    if (!canManageInventarios(requester)) {
      return res.status(403).json({ error: 'Necesitás una sesión válida para consultar inventarios pendientes' });
    }

    const conditions = [`estado = 'Pendiente'`];
    const params = [];
    applyLocationVisibility(conditions, params, requester, 'ubicacion');

    db.all(`
      SELECT
        numero_inventario,
        fecha_inventario,
        ubicacion,
        COALESCE(MAX(agrupacion), '') AS agrupacion,
        tipo,
        COUNT(*) AS cantidad_clases
      FROM inventario_detalles
      ${buildWhereClause(conditions)}
      GROUP BY numero_inventario, fecha_inventario, ubicacion, tipo
      ORDER BY fecha_inventario DESC, CAST(numero_inventario AS INTEGER) DESC
    `, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Error al obtener los inventarios pendientes' });
      }

      res.json(rows.map(row => ({
        numeroInventario: row.numero_inventario,
        fechaInventario: row.fecha_inventario,
        dias: getInventoryAgeDays(row.fecha_inventario),
        ubicacion: row.ubicacion,
        descripcion: row.agrupacion || (row.cantidad_clases === 1 ? '1 clase relevada' : `${row.cantidad_clases} clases relevadas`),
        tipo: normalizeInventoryTypeLabel(row.tipo),
        cantidadClases: row.cantidad_clases,
        estado: isInventoryExpired(row.fecha_inventario) ? 'Vencido' : 'Pendiente'
      })));
    });
  });
});

app.post('/inventarios', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de inventarios' });
    }

    if (!canManageInventarios(requester)) {
      return res.status(403).json({ error: 'Necesitás una sesión válida para crear inventarios' });
    }

    const descripcion = String(req.body?.descripcion || '').trim();
    const ubicacion = String(req.body?.ubicacion || '').trim();
    const tipo = normalizeInventoryTypeLabel(req.body?.tipo);
    const fechaInventario = String(req.body?.fechaInventario || '').trim();
    const cantidadClases = sanitizeInteger(req.body?.cantidadClases, 0);

    if (!descripcion || !ubicacion || !tipo || !fechaInventario || cantidadClases <= 0) {
      return res.status(400).json({ error: 'Faltan datos obligatorios para crear el inventario' });
    }

    if (!getInventoryTypeOptions().includes(tipo)) {
      return res.status(400).json({ error: 'El tipo de inventario seleccionado no es válido' });
    }

    if (!canUseLocation(requester, ubicacion)) {
      return res.status(403).json({ error: 'No tenés acceso a la ubicación seleccionada' });
    }

    nextInventoryNumber((numberErr, numeroInventario) => {
      if (numberErr) {
        return res.status(500).json({ error: 'Error al generar el número de inventario' });
      }

      const insert = db.prepare(`
        INSERT INTO inventario_detalles (
          numero_inventario,
          ubicacion,
          agrupacion,
          fecha_inventario,
          numero_clase,
          descripcion_clase,
          stock_teorico,
          stock_fisicos_aptos,
          stock_fisicos_no_aptos,
          diferencia,
          estado,
          tipo,
          administrativo
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'Pendiente', ?, ?)
      `);

      let pending = cantidadClases;
      let hasFailure = false;

      for (let index = 1; index <= cantidadClases; index += 1) {
        insert.run([
          numeroInventario,
          ubicacion,
          descripcion,
          fechaInventario,
          String(index),
          `Clase ${index}`,
          tipo,
          requester.nombre || ''
        ], insertErr => {
          if (hasFailure) {
            return;
          }

          if (insertErr) {
            hasFailure = true;
            insert.finalize(() => {
              res.status(500).json({ error: 'Error al crear el inventario' });
            });
            return;
          }

          pending -= 1;
          if (pending === 0) {
            insert.finalize(finalizeErr => {
              if (finalizeErr) {
                return res.status(500).json({ error: 'Error al crear el inventario' });
              }

              res.status(201).json({
                numeroInventario,
                fechaInventario,
                ubicacion,
                descripcion,
                tipo,
                cantidadClases,
                estado: 'Pendiente'
              });
            });
          }
        });
      }
    });
  });
});

app.get('/inventarios/:numeroInventario/detalle', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de inventarios' });
    }

    if (!canManageInventarios(requester)) {
      return res.status(403).json({ error: 'Necesitás una sesión válida para consultar el detalle del inventario' });
    }

    const identifiers = {
      numeroInventario: req.params.numeroInventario,
      ubicacion: String(req.query.ubicacion || '').trim(),
      fechaInventario: String(req.query.fecha || '').trim(),
      tipo: String(req.query.tipo || '').trim()
    };

    if (!identifiers.ubicacion || !identifiers.fechaInventario || !identifiers.tipo) {
      return res.status(400).json({ error: 'Faltan filtros para identificar el inventario' });
    }

    fetchInventoryRows(requester, identifiers, (fetchErr, rows) => {
      if (fetchErr) {
        return res.status(500).json({ error: 'Error al obtener el detalle del inventario' });
      }

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Inventario no encontrado' });
      }

      const encabezado = rows[0];
      res.json({
        resumen: {
          numeroInventario: encabezado.numero_inventario,
          fechaInventario: encabezado.fecha_inventario,
          dias: getInventoryAgeDays(encabezado.fecha_inventario),
          ubicacion: encabezado.ubicacion,
          descripcion: encabezado.agrupacion || '',
          tipo: normalizeInventoryTypeLabel(encabezado.tipo),
          estado: isInventoryExpired(encabezado.fecha_inventario) ? 'Vencido' : encabezado.estado,
          estadoBase: encabezado.estado,
          vencido: isInventoryExpired(encabezado.fecha_inventario)
        },
        detalle: rows.map(row => ({
          id: row.id,
          numeroClase: row.numero_clase,
          descripcionClase: row.descripcion_clase,
          stockTeorico: row.stock_teorico,
          stockFisicosAptos: row.stock_fisicos_aptos,
          stockFisicosNoAptos: row.stock_fisicos_no_aptos,
          diferencia: row.diferencia,
          numeroBaja: row.numero_baja || '',
          numeroAlta: row.numero_alta || '',
          observacion: row.observacion_parte || ''
        })),
        firmas: {
          administrativo: encabezado.administrativo || '',
          participante1: encabezado.participante_1 || '',
          participante2: encabezado.participante_2 || '',
          gerencia: encabezado.gerente_firma || ''
        },
        permisos: {
          puedeGuardar: canManageInventarios(requester),
          puedeFinalizar: !isInventoryExpired(encabezado.fecha_inventario) || canManageExpiredInventory(requester),
          puedeCancelar: !isInventoryExpired(encabezado.fecha_inventario) || canManageExpiredInventory(requester)
        }
      });
    });
  });
});

app.put('/inventarios/:numeroInventario/guardar', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de inventarios' });
    }

    if (!canManageInventarios(requester)) {
      return res.status(403).json({ error: 'Necesitás una sesión válida para guardar inventarios' });
    }

    saveInventoryRows({
      requester,
      identifiers: {
        numeroInventario: req.params.numeroInventario,
        ubicacion: String(req.body?.ubicacion || '').trim(),
        fechaInventario: String(req.body?.fechaInventario || '').trim(),
        tipo: String(req.body?.tipo || '').trim()
      },
      payload: req.body,
      targetState: 'Pendiente'
    }, (saveErr) => {
      if (saveErr) {
        return res.status(saveErr.status || 500).json({ error: saveErr.error });
      }

      res.json({ ok: true });
    });
  });
});

app.put('/inventarios/:numeroInventario/finalizar', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de inventarios' });
    }

    if (!canManageInventarios(requester)) {
      return res.status(403).json({ error: 'Necesitás una sesión válida para finalizar inventarios' });
    }

    saveInventoryRows({
      requester,
      identifiers: {
        numeroInventario: req.params.numeroInventario,
        ubicacion: String(req.body?.ubicacion || '').trim(),
        fechaInventario: String(req.body?.fechaInventario || '').trim(),
        tipo: String(req.body?.tipo || '').trim()
      },
      payload: req.body,
      targetState: 'Completo'
    }, (saveErr) => {
      if (saveErr) {
        return res.status(saveErr.status || 500).json({ error: saveErr.error });
      }

      res.json({ ok: true });
    });
  });
});

app.put('/inventarios/:numeroInventario/cancelar', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de inventarios' });
    }

    if (!canManageInventarios(requester)) {
      return res.status(403).json({ error: 'Necesitás una sesión válida para cancelar inventarios' });
    }

    saveInventoryRows({
      requester,
      identifiers: {
        numeroInventario: req.params.numeroInventario,
        ubicacion: String(req.body?.ubicacion || '').trim(),
        fechaInventario: String(req.body?.fechaInventario || '').trim(),
        tipo: String(req.body?.tipo || '').trim()
      },
      payload: req.body,
      targetState: 'Reclamado'
    }, (saveErr) => {
      if (saveErr) {
        return res.status(saveErr.status || 500).json({ error: saveErr.error });
      }

      res.json({ ok: true });
    });
  });
});

app.get('/prorrogas/filtros', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de prórrogas' });
    }

    const conditions = [`estado = 'Pendiente'`];
    const params = [];
    applyLocationVisibility(conditions, params, requester, 'ubicacion');

    db.all(`
        SELECT
          numero_inventario,
          fecha_inventario,
          ubicacion,
          tipo,
          CASE
          WHEN COUNT(*) = 1 THEN '1 clase relevada'
          ELSE COUNT(*) || ' clases relevadas'
        END AS descripcion
      FROM inventario_detalles
      ${buildWhereClause(conditions)}
      GROUP BY numero_inventario, fecha_inventario, ubicacion, tipo
      ORDER BY fecha_inventario DESC, CAST(numero_inventario AS INTEGER) DESC, ubicacion ASC
    `, params, (inventoryErr, inventarios) => {
      if (inventoryErr) {
        return res.status(500).json({ error: 'Error al obtener inventarios para prórrogas' });
      }

      db.all(`
        SELECT DISTINCT estado
        FROM prorroga_solicitudes
        ${buildWhereClause(conditions)}
        ORDER BY estado
      `, params, (statusErr, estadosRows) => {
        if (statusErr) {
          return res.status(500).json({ error: 'Error al obtener estados de prórrogas' });
        }

        res.json({
          motivos: getProrrogaMotivos(),
          estados: estadosRows.map(row => row.estado),
          inventarios: inventarios.map(row => ({
            numeroInventario: row.numero_inventario,
            fechaInventario: row.fecha_inventario,
            ubicacion: row.ubicacion,
            tipo: normalizeInventoryTypeLabel(row.tipo),
            descripcion: row.descripcion,
            etiqueta: `${row.numero_inventario} | ${row.ubicacion} | ${row.fecha_inventario || 'Sin fecha'} | ${normalizeInventoryTypeLabel(row.tipo) || 'Sin tipo'}`
          }))
        });
      });
    });
  });
});

app.get('/prorrogas', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de prórrogas' });
    }

    const conditions = [];
    const params = [];

    if (req.query.estado) {
      conditions.push('estado = ?');
      params.push(req.query.estado);
    } else {
      conditions.push(`estado IN ('Pendiente Gerencia', 'Pendiente AAFF')`);
    }

    applyLocationVisibility(conditions, params, requester, 'ubicacion');

    db.all(`
      SELECT *
      FROM prorroga_solicitudes
      ${buildWhereClause(conditions)}
      ORDER BY datetime(created_at) DESC, id DESC
    `, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Error al obtener las solicitudes de prórroga' });
      }

      res.json(rows.map(row => mapProrrogaRow(row, requester)));
    });
  });
});

app.post('/prorrogas', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de prórrogas' });
    }

    if (!canCreateProrroga(requester)) {
      return res.status(403).json({ error: 'Sólo Administrativo o Administrativo Predio pueden cargar solicitudes' });
    }

    const {
      numeroInventario,
      fechaInventario,
      ubicacion,
      tipo,
      motivo,
      fechaLimiteProrroga,
      observacion
    } = req.body;

    if (!numeroInventario || !fechaInventario || !ubicacion || !tipo || !motivo || !fechaLimiteProrroga) {
      return res.status(400).json({ error: 'Faltan datos obligatorios para cargar la solicitud' });
    }

    const inventoryConditions = [
      'numero_inventario = ?',
      'fecha_inventario = ?',
      'ubicacion = ?',
      `tipo IN (${expandInventoryTypeAliases([tipo]).map(() => '?').join(',')})`,
      `estado = 'Pendiente'`
    ];
    const inventoryParams = [numeroInventario, fechaInventario, ubicacion, ...expandInventoryTypeAliases([tipo])];
    applyLocationVisibility(inventoryConditions, inventoryParams, requester, 'ubicacion');

    db.get(`
      SELECT
        numero_inventario,
        fecha_inventario,
        ubicacion,
        tipo,
        CASE
          WHEN COUNT(*) = 1 THEN '1 clase relevada'
          ELSE COUNT(*) || ' clases relevadas'
        END AS descripcion
      FROM inventario_detalles
      ${buildWhereClause(inventoryConditions)}
      GROUP BY numero_inventario, fecha_inventario, ubicacion, tipo
    `, inventoryParams, (inventoryErr, inventario) => {
      if (inventoryErr) {
        return res.status(500).json({ error: 'Error al validar el inventario seleccionado' });
      }

      if (!inventario) {
        return res.status(404).json({ error: 'Sólo se pueden solicitar prórrogas sobre inventarios pendientes o vencidos' });
      }

      db.get(`
        SELECT id
        FROM prorroga_solicitudes
        WHERE numero_inventario = ?
          AND fecha_inventario = ?
          AND ubicacion = ?
          AND tipo IN (${expandInventoryTypeAliases([tipo]).map(() => '?').join(',')})
          AND estado IN ('Pendiente Gerencia', 'Pendiente AAFF')
      `, [numeroInventario, fechaInventario, ubicacion, ...expandInventoryTypeAliases([tipo])], (duplicateErr, duplicateRow) => {
        if (duplicateErr) {
          return res.status(500).json({ error: 'Error al validar duplicados de prórroga' });
        }

        if (duplicateRow) {
          return res.status(409).json({ error: 'Ya existe una solicitud pendiente para ese inventario' });
        }

        db.run(`
          INSERT INTO prorroga_solicitudes (
            numero_inventario,
            fecha_inventario,
            ubicacion,
            tipo,
            descripcion,
            motivo,
            fecha_limite_prorroga,
            solicitante_legajo,
            solicitante_nombre,
            solicitante_perfil,
            solicitante_observacion,
            gerencia_estado,
            aaff_estado,
            estado,
            etapa_actual,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', 'Pendiente', 'Pendiente Gerencia', 'Gerencia', datetime('now'), datetime('now'))
        `, [
          numeroInventario,
          fechaInventario,
          ubicacion,
          tipo,
          inventario.descripcion,
          motivo,
          fechaLimiteProrroga,
          requester.legajo,
          requester.nombre,
          requester.perfil,
          observacion || ''
        ], function(insertErr) {
          if (insertErr) {
            return res.status(500).json({ error: 'Error al crear la solicitud de prórroga' });
          }

          res.status(201).json({ id: this.lastID });
        });
      });
    });
  });
});

app.get('/prorrogas/:id', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario de prórrogas' });
    }

    const conditions = ['id = ?'];
    const params = [req.params.id];
    applyLocationVisibility(conditions, params, requester, 'ubicacion');

    db.get(`
      SELECT *
      FROM prorroga_solicitudes
      ${buildWhereClause(conditions)}
    `, params, (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Error al obtener el detalle de la solicitud' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Solicitud no encontrada' });
      }

      res.json(mapProrrogaRow(row, requester));
    });
  });
});

app.put('/prorrogas/:id/aprobar', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario actual' });
    }

    const conditions = ['id = ?'];
    const params = [req.params.id];
    applyLocationVisibility(conditions, params, requester, 'ubicacion');

    db.get(`
      SELECT *
      FROM prorroga_solicitudes
      ${buildWhereClause(conditions)}
    `, params, (rowErr, row) => {
      if (rowErr) {
        return res.status(500).json({ error: 'Error al obtener la solicitud a aprobar' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Solicitud no encontrada' });
      }

      const observacion = req.body?.observacion || '';

      if (row.estado === 'Pendiente Gerencia' && canApproveGerencia(requester)) {
        return db.run(`
          UPDATE prorroga_solicitudes
          SET gerencia_legajo = ?,
              gerencia_nombre = ?,
              gerencia_estado = 'Aprobada',
              gerencia_observacion = ?,
              gerencia_fecha = datetime('now'),
              estado = 'Pendiente AAFF',
              etapa_actual = 'Analista de AAFF',
              updated_at = datetime('now')
          WHERE id = ?
        `, [requester.legajo, requester.nombre, observacion, row.id], function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Error al aprobar la etapa de gerencia' });
          }

          res.json({ ok: true });
        });
      }

      if (row.estado === 'Pendiente AAFF' && canApproveAaff(requester)) {
        return db.run(`
          UPDATE prorroga_solicitudes
          SET aaff_legajo = ?,
              aaff_nombre = ?,
              aaff_estado = 'Aprobada',
              aaff_observacion = ?,
              aaff_fecha = datetime('now'),
              estado = 'Aprobada',
              etapa_actual = 'Finalizada',
              updated_at = datetime('now')
          WHERE id = ?
        `, [requester.legajo, requester.nombre, observacion, row.id], function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Error al aprobar la etapa de activos fijos' });
          }

          res.json({ ok: true });
        });
      }

      res.status(403).json({ error: 'No tenés permisos para aprobar esta solicitud en la etapa actual' });
    });
  });
});

app.put('/prorrogas/:id/rechazar', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al resolver el usuario actual' });
    }

    const conditions = ['id = ?'];
    const params = [req.params.id];
    applyLocationVisibility(conditions, params, requester, 'ubicacion');

    db.get(`
      SELECT *
      FROM prorroga_solicitudes
      ${buildWhereClause(conditions)}
    `, params, (rowErr, row) => {
      if (rowErr) {
        return res.status(500).json({ error: 'Error al obtener la solicitud a rechazar' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Solicitud no encontrada' });
      }

      const observacion = req.body?.observacion || '';

      if (row.estado === 'Pendiente Gerencia' && canApproveGerencia(requester)) {
        return db.run(`
          UPDATE prorroga_solicitudes
          SET gerencia_legajo = ?,
              gerencia_nombre = ?,
              gerencia_estado = 'Rechazada',
              gerencia_observacion = ?,
              gerencia_fecha = datetime('now'),
              estado = 'Rechazada',
              etapa_actual = 'Finalizada',
              updated_at = datetime('now')
          WHERE id = ?
        `, [requester.legajo, requester.nombre, observacion, row.id], function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Error al rechazar la solicitud desde gerencia' });
          }

          res.json({ ok: true });
        });
      }

      if (row.estado === 'Pendiente AAFF' && canApproveAaff(requester)) {
        return db.run(`
          UPDATE prorroga_solicitudes
          SET aaff_legajo = ?,
              aaff_nombre = ?,
              aaff_estado = 'Rechazada',
              aaff_observacion = ?,
              aaff_fecha = datetime('now'),
              estado = 'Rechazada',
              etapa_actual = 'Finalizada',
              updated_at = datetime('now')
          WHERE id = ?
        `, [requester.legajo, requester.nombre, observacion, row.id], function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Error al rechazar la solicitud desde activos fijos' });
          }

          res.json({ ok: true });
        });
      }

      res.status(403).json({ error: 'No tenés permisos para rechazar esta solicitud en la etapa actual' });
    });
  });
});


app.get('/usuarios/filtros', (req, res) => {
  db.serialize(() => {
    db.all(`
      SELECT DISTINCT ubicacion_codigo AS codigo, ubicacion_descripcion AS descripcion
      FROM usuarios
      WHERE COALESCE(ubicacion_codigo, '') <> ''
      ORDER BY ubicacion_codigo
    `, [], (ubiErr, ubicaciones) => {
      if (ubiErr) {
        return res.status(500).json({ error: 'Error al obtener filtros de usuarios' });
      }

      const perfiles = getAvailableProfiles();
      res.json({ ubicaciones, perfiles });
    });
  });
});

// 🔹 Obtener usuarios con filtros
app.get('/usuarios', (req, res) => {
  const conditions = [];
  const params = [];

  if (req.query.legajo) {
    conditions.push('CAST(legajo AS TEXT) LIKE ?');
    params.push(`%${req.query.legajo.trim()}%`);
  }

  if (req.query.nombre) {
    conditions.push('UPPER(nombre) LIKE ?');
    params.push(`%${req.query.nombre.trim().toUpperCase()}%`);
  }

  const ubicaciones = toArray(req.query.ubicacion);
  if (ubicaciones.length > 0) {
    conditions.push(`ubicacion_codigo IN (${ubicaciones.map(() => '?').join(',')})`);
    params.push(...ubicaciones);
  }

  const perfiles = toArray(req.query.perfil);
  if (perfiles.length > 0) {
    conditions.push(`perfil IN (${perfiles.map(() => '?').join(',')})`);
    params.push(...perfiles);
  }

  if (req.query.activo === '1' || req.query.activo === '0') {
    conditions.push('activo = ?');
    params.push(req.query.activo);
  }

  db.all(`
    SELECT
      id,
      legajo,
      nombre,
      puesto,
      perfil,
      perfil_descripcion,
      ubicacion_codigo,
      ubicacion_codigos,
      ubicacion_descripcion,
      ubicacion_descripciones,
      ubicacion_origen,
      acceso_total_ubicaciones,
      activo
    FROM usuarios
    ${buildWhereClause(conditions)}
    ORDER BY nombre
  `, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error al obtener usuarios' });
    }

    res.json(rows.map(mapUserRow));
  });
});

// 🔹 Obtener usuario por legajo
app.get('/usuarios/:legajo', (req, res) => {
  findUserByLegajo(req.params.legajo, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Error al obtener usuario' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(mapUserRow(row));
  });
});

// 🔹 Crear usuario manual
app.post('/usuarios', (req, res) => {
  const {
    legajo,
    nombre,
    puesto,
    perfil,
    perfilDescripcion,
    ubicacionCodigo,
    ubicacionCodigos,
    ubicacionDescripcion,
    ubicacionDescripciones,
    ubicacionOrigen,
    accesoTotalUbicaciones
  } = req.body;

  db.run(`
    INSERT INTO usuarios (
      legajo,
      nombre,
      puesto,
      perfil,
      perfil_descripcion,
      ubicacion_codigo,
      ubicacion_codigos,
      ubicacion_descripcion,
      ubicacion_descripciones,
      ubicacion_origen,
      acceso_total_ubicaciones,
      activo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `, [
    legajo,
    nombre,
    puesto,
    perfil,
    perfilDescripcion,
    ubicacionCodigo,
    JSON.stringify(ubicacionCodigos || (ubicacionCodigo ? [ubicacionCodigo] : [])),
    ubicacionDescripcion,
    JSON.stringify(ubicacionDescripciones || (ubicacionDescripcion ? [ubicacionDescripcion] : [])),
    ubicacionOrigen,
    accesoTotalUbicaciones ? 1 : 0
  ], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error al crear usuario' });
    }
    res.status(201).json({ id: this.lastID });
  });
});

// 🔹 Desactivar usuario
app.put('/usuarios/:id/desactivar', (req, res) => {
  const { id } = req.params;

  db.run(`
    UPDATE usuarios SET activo = 0 WHERE id = ?
  `, [id], function(err) {

    if (err) {
      return res.status(500).json({ error: 'Error al desactivar usuario' });
    }

    res.json({ ok: true });
  });
});

// 🔹 Activar usuario
app.put('/usuarios/:id/activar', (req, res) => {
  const { id } = req.params;

  db.run(`
    UPDATE usuarios SET activo = 1 WHERE id = ?
  `, [id], function(err) {

    if (err) {
      return res.status(500).json({ error: 'Error al activar usuario' });
    }

    res.json({ ok: true });
  });
});

// 🔹 Editar usuario
app.put('/usuarios/:id', (req, res) => {
  getRequesterUser(req, (userErr, requester) => {
    if (userErr) {
      return res.status(500).json({ error: 'Error al validar el usuario actual' });
    }

    const { id } = req.params;
    const {
      nombre,
      puesto,
      perfil,
      perfilDescripcion,
      ubicacionCodigo,
      ubicacionCodigos,
      ubicacionDescripcion,
      ubicacionDescripciones,
      ubicacionOrigen,
      accesoTotalUbicaciones
    } = req.body;

    db.get(`
      SELECT *
      FROM usuarios
      WHERE id = ?
    `, [id], (targetErr, targetRow) => {
      if (targetErr) {
        return res.status(500).json({ error: 'Error al obtener el usuario a editar' });
      }

      if (!targetRow) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      if (!canEditUser(requester, targetRow)) {
        return res.status(403).json({ error: 'No tenés permisos para modificar este usuario' });
      }

      if (!canAssignProfile(requester, perfil)) {
        return res.status(403).json({ error: 'No tenés permisos para asignar ese perfil' });
      }

      db.run(`
        UPDATE usuarios 
        SET nombre = ?,
            puesto = ?,
            perfil = ?,
            perfil_descripcion = ?,
            ubicacion_codigo = ?,
            ubicacion_codigos = ?,
            ubicacion_descripcion = ?,
            ubicacion_descripciones = ?,
            ubicacion_origen = ?,
            acceso_total_ubicaciones = ?
        WHERE id = ?
      `, [
        nombre,
        puesto,
        perfil,
        perfilDescripcion,
        ubicacionCodigo,
        JSON.stringify(ubicacionCodigos || (ubicacionCodigo ? [ubicacionCodigo] : [])),
        ubicacionDescripcion,
        JSON.stringify(ubicacionDescripciones || (ubicacionDescripcion ? [ubicacionDescripcion] : [])),
        ubicacionOrigen,
        accesoTotalUbicaciones ? 1 : 0,
        id
      ], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error al editar usuario' });
        }

        res.json({ ok: true });
      });
    });
  });
});

// 🔐 Login
app.post('/login', (req, res) => {
  const { legajo, password } = req.body;

  findUserByLegajo(legajo, (err, row) => {

    if (err) {
      return res.status(500).json({ error: 'Error en login' });
    }

    if (!row || Number(row.activo) !== 1) {
      return res.status(401).json({ error: 'Usuario no válido' });
    }

    res.json(mapUserRow(row));
  });
});

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
