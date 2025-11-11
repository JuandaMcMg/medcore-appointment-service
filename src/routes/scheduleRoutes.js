const express = require('express');
const ctrl = require('../controllers/scheduleController');
const { verifyToken, authorizeRoles } = require('../middlewares/authMiddleware');
const router = express.Router();

// POST /api/schedules - crear horario
router.post('/schedules', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.createSchedule);

// GET /api/schedules/doctor/:doctorId - obtener horarios del médico
router.get('/schedules/doctor/:doctorId', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.getDoctorSchedules);

// PUT /api/schedules/:id - actualizar horario
router.put('/schedules/:id', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.updateSchedule);

// GET /api/appointments/doctor/:doctorId - listar citas del médico
router.get('/appointments/doctor/:doctorId', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.listDoctorAppointments);

// GET /api/schedules/available?doctorId=&date=YYYY-MM-DD - disponibilidad
router.get('/schedules/available', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR','PACIENTE'), ctrl.getAvailability);

module.exports = router;
