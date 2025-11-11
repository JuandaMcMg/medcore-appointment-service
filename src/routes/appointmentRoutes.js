const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController.js');
const {verifyToken, authorizeRoles } = require('../middlewares/authMiddleware.js');

router.use(verifyToken)

// POST http://localhost:3007/api/v1/appointments/:patientId
// Crear nueva cita para paciente
router.post('/:patientId', authorizeRoles("ADMINISTRADOR","PACIENTE"), appointmentController.createAppointment);

// GET http://localhost:3007/api/v1/appointments/:id
// Obtener cita por ID
router.get('/by-id/:id', authorizeRoles('ADMINISTRADOR', 'PACIENTE', 'MEDICO'),appointmentController.getAppointmentById);

// PUT http://localhost:3007/api/v1/appointments/:id
//Actualizar cita (fecha, hora, estado, reason, notes, duration)
router.put('/:id', authorizeRoles('ADMINISTRADOR', 'PACIENTE', 'MEDICO'), appointmentController.updateAppointment);

// PATCH http://localhost:3007/api/v1/appointments/status/:id
router.patch( '/status/:id', authorizeRoles('ADMINISTRADOR','PACIENTE','MEDICO'), appointmentController.patchAppointmentStatus);

// DELETE http://localhost:3007/api/v1/appointments/:id  (soft cancel)
router.delete( '/:id', authorizeRoles('ADMINISTRADOR','PACIENTE','MEDICO'), appointmentController.deleteAppointment);

//BUSQUEDA AVANZADA 

// GET /api/v1/appointments?status=&doctorId=&specialty=&patientName=&page=&limit=&dateFrom=&dateTo=
router.get(
  '/',
  authorizeRoles('ADMINISTRADOR','PACIENTE','MEDICO'),
  appointmentController.listAppointments
);

// GET http://localhost:3007/api/v1/appointments/patient/:patientId
// Listas citas de un paciente
router.get('/patient/:patientId', authorizeRoles('ADMINISTRADOR', 'PACIENTE'), appointmentController.listAppointmentsByPatient);

// GET http://localhost:3007/api/v1/appointments/doctor/:doctorId
//Listar citas de un médico
router.get('/doctor/:doctorId', authorizeRoles('ADMINISTRADOR', 'MEDICO'), appointmentController.listAppointmentsByDoctor);
    
//GET http://localhost:3007/api/v1/appointments?dateFrom&dateTo&doctorId&patientId&status
// Listado por rango de fechas (y filtros opcionales)
router.get( '/', authorizeRoles('ADMINISTRADOR', 'PACIENTE', 'MEDICO'), appointmentController.listAppointmentsByDateRange);

module.exports = router;
