const express = require('express');
const router = express.Router();
const queueController = require('../controllers/queueController.js');
const {verifyToken, authorizeRoles } = require('../middlewares/authMiddleware.js');

router.use(verifyToken)

// POST http://localhost:3007/api/v1/queue/join
// UNIRSE A LA COLA DE ESPERA
router.post('/join', authorizeRoles("ADMINISTRADOR","PACIENTE"), queueController.joinQueue);

// GET http://localhost:3007/api/v1/queue/doctor/:doctorId/current
//Ver la cola de espera del médico
router.get('/doctor/:doctorId/current', authorizeRoles('ADMINISTRADOR', 'MEDICO'), queueController.getDoctorCurrentQueue);

// GET http://localhost:3007/api/v1/queue/doctor/:doctorId/call-next
//Llamar al siguiente paciente en la cola de espera del médico
router.post('/doctor/:doctorId/call-next', authorizeRoles('ADMINISTRADOR', 'MEDICO'), queueController.callNextForDoctor);

// GET http://localhost:3007/api/v1/queue/ticket/:ticketId/complete
//Marcar como atendido al paciente actual
router.put('/ticket/:ticketId/complete', authorizeRoles('ADMINISTRADOR', 'MEDICO'), queueController.completeTicket);

// GET http://localhost:3007/api/v1/queue/ticket/:ticketId/position
//Ver posición en la cola de espera
router.get('/ticket/:ticketId/position', authorizeRoles('ADMINISTRADOR', 'MEDICO',"PACIENTE"), queueController.getTicketPosition);


module.exports = router;
