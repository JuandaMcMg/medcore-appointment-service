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

    console.log("BODY recibido en joinQueue:", req.body);
    console.log("Usuario autenticado (req.user):", req.user);

    const actorId = req.user?.id;
    const { doctorId, appointmentId } = req.body || {};

    console.log("doctorId:", doctorId);
    console.log("appointmentId:", appointmentId);
    console.log("actorId:", actorId);
    console.log("patientId detectado:", req.body?.patientId || req.user?.id);

    if (!doctorId)
      throw { code: 'DOCTOR_ID_REQUIRED', message: 'doctorId es requerido', statusCode: 422 };

    const r = await queueService.joinQueue({
      actorId,
      doctorId,
      patientId: req.body?.patientId || req.user?.id,
      appointmentId: appointmentId || null
    });

    console.log("Resultado joinQueue:", r);

    return ok(res, r, 201);

  } catch (e) {
    console.error("Error en joinQueue:", e);
    return fail(res, e);
  }
}


// GET /api/v1/queue/doctor/:doctorId/current?date=2025-11-13&includeFinished=true
async function getDoctorCurrentQueue(req, res) {
  try {
    const { date, includeFinished } = req.query;

    const day = date ? new Date(date) : new Date();
    const includeFinishedBool =
      String(includeFinished || '').toLowerCase() === 'true';

    const r = await queueService.getDoctorCurrentQueue({
      doctorId: req.params.doctorId,
      day,
      includeFinished: includeFinishedBool,
    });

    return res.status(200).json({ data: r });
  } catch (e) {
    console.error(e);
    return res.status(e.statusCode || 401).json({
      error: { code: e.code || 'SERVER_ERROR', message: e.message || 'Error' },
    });
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


async function cancelTicket(req, res) {
  try {
    const r = await queueService.CancelTicket({ ticketId: req.params.ticketId });
    return ok(res, r);
  } catch (e) { return fail(res, e); }
};

//+++
// PUT /queue/ticket/:ticketId/call
async function callTicket(req, res) {
  try {
    const r = await queueService.callTicket({
      ticketId: req.params.ticketId,
    });

    return ok(res, r);
  } catch (e) {
    return fail(res, e);
  }
}

// PUT /queue/ticket/:ticketId/start
async function startTicket(req, res) {
  try {
    const r = await queueService.startTicket({
      ticketId: req.params.ticketId,
      actorId: req.user?.id
    });

    return ok(res, r);
  } catch (e) {
    return fail(res, e);
  }
}

async function exitQueue(req, res) {
  try {
    return ok(res, {
      message: "Salida de la cola registrada solo en front."
    });
  } catch (e) {
    return fail(res, e);
  }
}

// PUT /queue/ticket/:ticketId/no-show
async function markNoShow(req, res) {
  try {
    const r = await queueService.markNoShow({
      ticketId: req.params.ticketId,
      actorId: req.user?.id
    });

    return ok(res, r);
  } catch (e) {
    return fail(res, e);
  }

  
}



module.exports = {
    joinQueue,
    getDoctorCurrentQueue,
    callNextForDoctor,
    completeTicket,
    getTicketPosition,
    cancelTicket,
    startTicket,
    callTicket,
    exitQueue,
    markNoShow,
};