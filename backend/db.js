const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.sqlite');

// Crear tablas
db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS ubicaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      descripcion TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      legajo INTEGER,
      nombre TEXT,
      puesto TEXT,
      ubicacion_id INTEGER,
      activo INTEGER,
      FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id)
    )
  `);

  // Índices únicos para evitar duplicados
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ubicaciones_codigo ON ubicaciones(codigo)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_legajo ON usuarios(legajo)`);

  // Seed inicial (se ejecuta sin duplicar gracias a OR IGNORE)
  db.run(`INSERT OR IGNORE INTO ubicaciones (codigo, descripcion) VALUES ('700','Central')`);

  db.run(`
    INSERT OR IGNORE INTO usuarios (legajo, nombre, puesto, ubicacion_id, activo)
    VALUES (146685, 'Bruno Carabajal', 'Analista', 1, 1)
  `);

});

module.exports = db;