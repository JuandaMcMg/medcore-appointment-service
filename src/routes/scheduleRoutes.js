const express = require('express');
const ctrl = require('../controllers/scheduleController');
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');
const router = express.Router();

// POST /api/schedules - crear horario
router.post('/schedules', authMiddleware, requireRole('MEDICO','ADMINISTRADOR'), ctrl.createSchedule);

// GET /api/schedules/doctor/:doctorId - obtener horarios del médico
router.get('/schedules/doctor/:doctorId', authMiddleware, requireRole('MEDICO','ADMINISTRADOR'), ctrl.getDoctorSchedules);

// PUT /api/schedules/:id - actualizar horario
router.put('/schedules/:id', authMiddleware, requireRole('MEDICO','ADMINISTRADOR'), ctrl.updateSchedule);

// GET /api/appointments/doctor/:doctorId - listar citas del médico
router.get('/appointments/doctor/:doctorId', authMiddleware, requireRole('MEDICO','ADMINISTRADOR'), ctrl.listDoctorAppointments);

// GET /api/schedules/available?doctorId=&date=YYYY-MM-DD - disponibilidad
router.get('/schedules/available', authMiddleware, requireRole('MEDICO','ADMINISTRADOR','PACIENTE'), ctrl.getAvailability);

module.exports = router;
