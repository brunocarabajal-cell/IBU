const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());


// 🔹 Obtener usuarios con ubicación
app.get('/usuarios', (req, res) => {
  db.all(`
    SELECT u.*, ub.codigo, ub.descripcion
    FROM usuarios u
    LEFT JOIN ubicaciones ub ON u.ubicacion_id = ub.id
  `, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error al obtener usuarios' });
    }
    res.json(rows);
  });
});


// 🔹 Obtener usuario por legajo (clave para navbar)
app.get('/usuarios/:legajo', (req, res) => {
  const legajo = req.params.legajo;

  db.get(`
    SELECT u.nombre, u.puesto, ub.codigo
    FROM usuarios u
    LEFT JOIN ubicaciones ub ON u.ubicacion_id = ub.id
    WHERE u.legajo = ?
  `, [legajo], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Error al obtener usuario' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(row);
  });
});


// 🔹 Crear usuario
app.post('/usuarios', (req, res) => {
  const { legajo, nombre, puesto, ubicacion_id } = req.body;

  db.run(`
    INSERT INTO usuarios (legajo, nombre, puesto, ubicacion_id, activo)
    VALUES (?, ?, ?, ?, 1)
  `, [legajo, nombre, puesto, ubicacion_id], function(err) {
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
  const { id } = req.params;
  const { nombre, puesto, ubicacion_id } = req.body;

  db.run(`
    UPDATE usuarios 
    SET nombre = ?, puesto = ?, ubicacion_id = ?
    WHERE id = ?
  `, [nombre, puesto, ubicacion_id, id], function(err) {

    if (err) {
      return res.status(500).json({ error: 'Error al editar usuario' });
    }

    res.json({ ok: true });
  });
});

// 🔐 Login
app.post('/login', (req, res) => {
  const { legajo, password } = req.body;

  db.get(`
    SELECT u.nombre, u.puesto, ub.codigo
    FROM usuarios u
    LEFT JOIN ubicaciones ub ON u.ubicacion_id = ub.id
    WHERE u.legajo = ? AND u.activo = 1
  `, [legajo], (err, row) => {

    if (err) {
      return res.status(500).json({ error: 'Error en login' });
    }

    if (!row) {
      return res.status(401).json({ error: 'Usuario no válido' });
    }

    res.json(row);
  });
});

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});