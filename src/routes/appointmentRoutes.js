const express = require('express');
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/appointmentController');
const router = express.Router();

router.post('/appointments', authMiddleware, requireRole('MEDICO','ADMINISTRADOR'), ctrl.create);
router.put('/appointments/:id/status', authMiddleware, requireRole('MEDICO','ADMINISTRADOR'), ctrl.updateStatus);

module.exports = router;
