const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController.js');
const { verifyToken, authorizeRoles } = require('../middlewares/authMiddleware.js');

router.use(verifyToken);

// Crear nueva cita para paciente
// POST http://localhost:3007/api/v1/appointments/:patientId
router.post('/:patientId', authorizeRoles('ADMINISTRADOR','PACIENTE'), appointmentController.createAppointment);

// Obtener cita por ID
// GET http://localhost:3007/api/v1/appointments/by-id/:id
router.get('/by-id/:id', authorizeRoles('ADMINISTRADOR', 'PACIENTE', 'MEDICO'), appointmentController.getAppointmentById);

// Actualizar cita (fecha/hora/estado/reason/notes/duration)
// PUT http://localhost:3007/api/v1/appointments/:id
router.put('/:id', authorizeRoles('ADMINISTRADOR', 'PACIENTE', 'MEDICO'), appointmentController.updateAppointment);

// Cambiar estado de la cita
// PATCH http://localhost:3007/api/v1/appointments/status/:id
router.patch('/status/:id', authorizeRoles('ADMINISTRADOR','PACIENTE','MEDICO'), appointmentController.patchAppointmentStatus);

// Cancelar (soft)
// DELETE http://localhost:3007/api/v1/appointments/:id
router.delete('/:id', authorizeRoles('ADMINISTRADOR','PACIENTE','MEDICO'), appointmentController.deleteAppointment);

// Busqueda avanzada general
// GET /api/v1/appointments?status=&doctorId=&specialty=&patientName=&page=&limit=&dateFrom=&dateTo=
router.get('/', authorizeRoles('ADMINISTRADOR','PACIENTE','MEDICO'), appointmentController.listAppointments);

// Listas citas de un paciente
// GET http://localhost:3007/api/v1/appointments/patient/:patientId
router.get('/patient/:patientId', authorizeRoles('ADMINISTRADOR', 'PACIENTE'), appointmentController.listAppointmentsByPatient);

// Listar citas de un médico
// GET http://localhost:3007/api/v1/appointments/doctor/:doctorId
router.get('/doctor/:doctorId', authorizeRoles('ADMINISTRADOR', 'MEDICO'), appointmentController.listAppointmentsByDoctor);

// Listado por rango de fechas (y filtros opcionales)
// GET http://localhost:3007/api/v1/appointments/range?dateFrom&dateTo&doctorId&patientId&status
router.get('/range', authorizeRoles('ADMINISTRADOR', 'PACIENTE', 'MEDICO'), appointmentController.listAppointmentsByDateRange);

module.exports = router;
