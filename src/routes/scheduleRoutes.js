const express = require('express');
const ctrl = require('../controllers/scheduleController');
const { verifyToken, authorizeRoles } = require('../middlewares/authMiddleware');
const router = express.Router();

// Base: /api/v1/schedules

// POST /api/v1/schedules - crear horario
router.post('/', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.createSchedule);

// GET /api/v1/schedules/doctor/:doctorId - obtener horarios del médico
router.get('/doctor/:doctorId', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.getDoctorSchedules);

// PUT /api/v1/schedules/:id - actualizar horario
router.put('/:id', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.updateSchedule);

// GET /api/v1/schedules/available?doctorId=&date=YYYY-MM-DD - disponibilidad
router.get('/available', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR','PACIENTE'), ctrl.getAvailability);

// DELETE /api/v1/schedules/:id - eliminar horario (dispara rescheduler)
router.delete('/:id', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.deleteSchedule);

// POST /api/v1/schedules/reschedule/doctor/:doctorId - trigger manual de rescheduler para el médico
router.post('/reschedule/doctor/:doctorId', verifyToken, authorizeRoles('MEDICO','ADMINISTRADOR'), ctrl.runReschedulerForDoctor);

module.exports = router;
