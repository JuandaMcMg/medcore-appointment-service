const service = require('../services/appointmentService');

exports.create = async (req, res, next) => {
  try {
    const ap = await service.createAppointment(req.body, req.user);
    res.status(201).json(ap);
  } catch (e) { next(e); }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) { const err = new Error('status requerido'); err.statusCode = 400; throw err; }
    const ap = await service.updateAppointmentStatus(id, status, req.user);
    res.json(ap);
  } catch (e) { next(e); }
};
