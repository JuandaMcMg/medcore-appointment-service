// src/index.js - Punto de entrada del microservicio
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { connectDatabase } = require('./database/database');
const apiV1 = require('./routes/routes');
const swaggerUi = require('swagger-ui-express');
const YAML =require('yamljs');
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3008;

// Cargar el YAML
const queueClinicalDoc = YAML.load(
  path.join(__dirname, "swagger", "swaggerQueue.yml")
);

// Montar la documentación SOLO de este MS y SOLO de estos endpoints
app.use("/api-docs/queue", swaggerUi.serve, swaggerUi.setup(queueClinicalDoc));

// ============================================
// MIDDLEWARES
// ============================================
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// RUTAS
// ============================================


app.use((req, res, next) => {
  console.log("HEADERS RECIBIDOS:", req.headers);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'medcore-appointment-service',
    timestamp: new Date().toISOString()
  });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    message: 'MedCore Appointment Service API',
    version: '1.0.0',
    status: 'Ready for implementation'
  });
});

// Rutas v1
app.use('/api/v1', apiV1);

// ============================================
// ERROR HANDLERS
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: 'Endpoint no encontrado',
    service: 'medcore-appointment-service'
  });
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.statusCode || 500).json({
    message: err.message || 'Error interno del servidor',
    service: 'medcore-appointment-service'
  });
});

// ============================================
// START SERVER
// ============================================

(async () => {
  await connectDatabase();
  const server = app.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════════════╗
    ║   MedCore Appointment Service                     ║
    ║   Port: ${PORT}                                    ║
    ║   Status: ✓ Running                               ║
    ╚═══════════════════════════════════════════════════╝
    `);
  });
  server.on('error', (err) => {
    console.error('HTTP server error:', err);
  });
})();

module.exports = app;
