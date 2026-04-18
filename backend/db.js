const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.sqlite');
const inventorySeedPath = path.join(__dirname, 'data', 'inventarios_seed.json');
const usersSeedPath = path.join(__dirname, 'data', 'usuarios_seed.json');

function seedProrrogasIfNeeded() {
  db.get(`SELECT COUNT(*) AS total FROM prorroga_solicitudes`, [], (countErr, row) => {
    if (countErr) {
      console.error('Error al verificar solicitudes de prórroga', countErr);
      return;
    }

    if ((row?.total || 0) > 0) {
      return;
    }

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
      WHERE prorroga = 'Si'
      GROUP BY numero_inventario, fecha_inventario, ubicacion, tipo
      ORDER BY fecha_inventario, numero_inventario, ubicacion
    `, [], (seedErr, rows) => {
      if (seedErr) {
        console.error('Error al preparar el seed de prórrogas', seedErr);
        return;
      }

      if (rows.length === 0) {
        return;
      }

      const insert = db.prepare(`
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
          gerencia_nombre,
          gerencia_estado,
          gerencia_observacion,
          gerencia_fecha,
          aaff_nombre,
          aaff_estado,
          aaff_observacion,
          aaff_fecha,
          estado,
          etapa_actual,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      rows.forEach(item => {
        insert.run([
          item.numero_inventario,
          item.fecha_inventario,
          item.ubicacion,
          item.tipo,
          item.descripcion,
          'Prórroga existente en base inicial',
          item.fecha_inventario,
          null,
          'Base Inicial',
          'Administrativo',
          'Solicitud reconstruida desde la base histórica de inventarios.',
          'Base Inicial',
          'Aprobada',
          'Circuito aprobado migrado desde la base actual.',
          item.fecha_inventario,
          'Base Inicial',
          'Aprobada',
          'Prórroga ya vigente al momento de inicializar la gestión.',
          item.fecha_inventario,
          'Aprobada',
          'Finalizada'
        ]);
      });
      insert.finalize(finalizeErr => {
        if (finalizeErr) {
          console.error('Error al finalizar el seed de prórrogas', finalizeErr);
        }
      });
    });
  });
}

function seedInventoriesIfNeeded() {
  db.get(`SELECT COUNT(*) AS total FROM inventario_detalles`, [], (countErr, row) => {
    if (countErr) {
      console.error('Error al verificar inventarios iniciales', countErr);
      return;
    }

    if ((row?.total || 0) > 0) {
      seedProrrogasIfNeeded();
      return;
    }

    if (!fs.existsSync(inventorySeedPath)) {
      console.warn('No se encontro el seed de inventarios en', inventorySeedPath);
      seedProrrogasIfNeeded();
      return;
    }

    const seed = JSON.parse(fs.readFileSync(inventorySeedPath, 'utf8'));
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
        modulo,
        calificacion,
        prorroga,
        gerente_asignado,
        observacion_parte,
        numero_baja,
        administrativo,
        participante_1,
        participante_2,
        gerente_firma
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      seed.forEach(item => {
        insert.run([
          item.inventoryNumber,
          item.location,
          item.grouping,
          item.inventoryDate,
          item.classNumber,
          item.classDescription,
          item.theoreticalStock,
          item.physicalSuitableStock,
          item.physicalUnsuitableStock,
          item.difference,
          item.status,
          item.type,
          item.module,
          item.calification,
          item.extension,
          item.managerAssigned,
          item.note,
          item.dropNumber,
          item.administrative,
          item.participant1,
          item.participant2,
          item.managerSignature
        ]);
      });
      insert.finalize(finalizeErr => {
        if (finalizeErr) {
          console.error('Error al finalizar el seed de inventarios', finalizeErr);
          return db.run('ROLLBACK');
        }

        db.run('COMMIT', commitErr => {
          if (commitErr) {
            console.error('Error al confirmar el seed de inventarios', commitErr);
            return;
          }

          seedProrrogasIfNeeded();
        });
      });
    });
  });
}

function refreshUsersFromSeed() {
  if (!fs.existsSync(usersSeedPath)) {
    console.warn('No se encontro el seed de usuarios en', usersSeedPath);
    return;
  }

  const rawSeed = JSON.parse(fs.readFileSync(usersSeedPath, 'utf8'));
  const dedupedSeed = [];
  const seenLegajos = new Set();

  rawSeed.forEach(user => {
    if (seenLegajos.has(user.legajo)) {
      return;
    }

    seenLegajos.add(user.legajo);
    dedupedSeed.push(user);
  });

  const uniqueLocations = new Map();

  dedupedSeed.forEach(user => {
    if (user.ubicacionCodigo) {
      uniqueLocations.set(user.ubicacionCodigo, user.ubicacionDescripcion || user.ubicacionCodigo);
    }
  });

  db.serialize(() => {
    db.run('DELETE FROM usuarios');
    db.run('DELETE FROM ubicaciones');

    uniqueLocations.forEach((descripcion, codigo) => {
      db.run(`
        INSERT OR IGNORE INTO ubicaciones (codigo, descripcion)
        VALUES (?, ?)
      `, [codigo, descripcion], err => {
        if (err) {
          console.error('Error al insertar ubicación', codigo, err);
        }
      });
    });

    dedupedSeed.forEach(user => {
      db.run(`
        INSERT OR REPLACE INTO usuarios (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        user.legajo,
        user.nombre,
        user.puestoOriginal,
        user.perfil,
        user.perfilDescripcion,
        user.ubicacionCodigo,
        JSON.stringify(user.ubicacionCodigos || (user.ubicacionCodigo ? [user.ubicacionCodigo] : [])),
        user.ubicacionDescripcion,
        JSON.stringify(user.ubicacionDescripciones || (user.ubicacionDescripcion ? [user.ubicacionDescripcion] : [])),
        user.ubicacionOrigen,
        user.accesoTotalUbicaciones,
        user.activo
      ], err => {
        if (err) {
          console.error('Error al insertar usuario', user.legajo, err);
        }
      });
    });
  });
}

// Crear tablas
db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS ubicaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      descripcion TEXT
    )
  `);

  db.run(`DROP TABLE IF EXISTS usuarios`);
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      legajo INTEGER,
      nombre TEXT,
      puesto TEXT,
      perfil TEXT,
      perfil_descripcion TEXT,
      ubicacion_codigo TEXT,
      ubicacion_codigos TEXT,
      ubicacion_descripcion TEXT,
      ubicacion_descripciones TEXT,
      ubicacion_origen TEXT,
      acceso_total_ubicaciones INTEGER DEFAULT 0,
      activo INTEGER,
      UNIQUE(legajo)
    )
  `);

  // Índices únicos para evitar duplicados
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ubicaciones_codigo ON ubicaciones(codigo)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_legajo ON usuarios(legajo)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_usuarios_perfil ON usuarios(perfil)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_usuarios_ubicacion_codigo ON usuarios(ubicacion_codigo)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS inventario_detalles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_inventario TEXT NOT NULL,
      ubicacion TEXT,
      agrupacion TEXT,
      fecha_inventario TEXT,
      numero_clase TEXT,
      descripcion_clase TEXT,
      stock_teorico INTEGER DEFAULT 0,
      stock_fisicos_aptos INTEGER DEFAULT 0,
      stock_fisicos_no_aptos INTEGER DEFAULT 0,
      diferencia INTEGER DEFAULT 0,
      estado TEXT,
      tipo TEXT,
      modulo TEXT,
      calificacion TEXT,
      prorroga TEXT,
      gerente_asignado TEXT,
      observacion_parte TEXT,
      numero_baja TEXT,
      administrativo TEXT,
      participante_1 TEXT,
      participante_2 TEXT,
      gerente_firma TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prorroga_solicitudes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_inventario TEXT NOT NULL,
      fecha_inventario TEXT,
      ubicacion TEXT NOT NULL,
      tipo TEXT,
      descripcion TEXT,
      motivo TEXT NOT NULL,
      fecha_limite_prorroga TEXT NOT NULL,
      solicitante_legajo INTEGER,
      solicitante_nombre TEXT,
      solicitante_perfil TEXT,
      solicitante_observacion TEXT,
      gerencia_legajo INTEGER,
      gerencia_nombre TEXT,
      gerencia_estado TEXT DEFAULT 'Pendiente',
      gerencia_observacion TEXT,
      gerencia_fecha TEXT,
      aaff_legajo INTEGER,
      aaff_nombre TEXT,
      aaff_estado TEXT DEFAULT 'Pendiente',
      aaff_observacion TEXT,
      aaff_fecha TEXT,
      estado TEXT NOT NULL,
      etapa_actual TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_inventario_numero ON inventario_detalles(numero_inventario)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_inventario_fecha ON inventario_detalles(fecha_inventario)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_inventario_ubicacion ON inventario_detalles(ubicacion)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_inventario_estado ON inventario_detalles(estado)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_inventario_tipo ON inventario_detalles(tipo)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_prorrogas_estado ON prorroga_solicitudes(estado)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_prorrogas_ubicacion ON prorroga_solicitudes(ubicacion)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_prorrogas_inventario ON prorroga_solicitudes(numero_inventario)`, () => {
    refreshUsersFromSeed();
    seedInventoriesIfNeeded();
  });

});

module.exports = db;
