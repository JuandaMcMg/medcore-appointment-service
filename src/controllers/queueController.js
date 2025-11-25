const queueService = require('../services/queue.service');

function ok(res, data, code = 200) {
  return res.status(code).json({ data });
}
function fail(res, error, code = 400) {
  const status = error?.statusCode || code;
  return res.status(status).json({ error: { code: error?.code || 'BAD_REQUEST', message: error?.message || String(error) }});
}

// POST /queue/join
async function joinQueue(req, res) {
  try {
    const actorId = req.user?.id;          // paciente autenticado o admin
    const { doctorId, appointmentId } = req.body || {};
    if (!doctorId) throw { code: 'DOCTOR_ID_REQUIRED', message: 'doctorId es requerido', statusCode: 422 };

    const r = await queueService.joinQueue({
      actorId,
      doctorId,
      patientId: req.body?.patientId || req.user?.id, // si es admin puede mandar patientId, si es paciente tomamos su id
      appointmentId: appointmentId || null
    });

    return ok(res, r, 201);
  } catch (e) { return fail(res, e); }
};

// GET /queue/doctor/:doctorId/current
// GET /queue/doctor/:doctorId/current
async function getDoctorCurrentQueue(req, res) {
  try {
    const authHeader =
      req.headers.authorization ||
      req.headers.Authorization ||
      null;

    const r = await queueService.getDoctorCurrentQueue({
      doctorId: req.params.doctorId,
      authHeader,           // 👈 se reenvía al ms-users
    });

    return ok(res, r);
  } catch (e) {
    return fail(res, e);
  }
};


// POST /queue/doctor/:doctorId/call-next
async function callNextForDoctor(req, res) {
  try {
    const r = await queueService.callNextForDoctor({ doctorId: req.params.doctorId, actorId: req.user?.id });
    return ok(res, r);
  } catch (e) { return fail(res, e); }
};

// PUT /queue/ticket/:ticketId/complete
async function completeTicket(req, res) {
  try {
    const r = await queueService.completeTicket({ ticketId: req.params.ticketId, actorId: req.user?.id });
    return ok(res, r);
  } catch (e) { return fail(res, e); }
};

// GET /queue/ticket/:ticketId/position
async function getTicketPosition(req, res) {
  try {
    const r = await queueService.getTicketPosition({ ticketId: req.params.ticketId });
    return ok(res, r);
  } catch (e) { return fail(res, e); }
};

module.exports = {
    joinQueue,
    getDoctorCurrentQueue,
    callNextForDoctor,
    completeTicket,
    getTicketPosition
};