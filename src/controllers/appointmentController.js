// src/controllers/appointmentController.js
const apointmentService = require('../services/appointmentService');

const jsonErr = (res, status, code, message, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message, ...extra });

const actorFromReq = (req) => req.user?.id || null;

function pickQuery(req) {
  const {
    status, doctorId, specialty, specialtyId, patientName,
    page, limit, dateFrom, dateTo, orderBy, order
  } = req.query;
  return { status, doctorId, specialty, specialtyId, patientName, page, limit, dateFrom, dateTo, orderBy, order };
}


async function listAppointments(req, res) {
  try {
    const data = await apointmentService.svcListAppointments(pickQuery(req), req.headers.authorization || '');
    res.json({ ok:true, ...data });
  } catch (e) {
    console.error('[listAppointments]', e);
    jsonErr(res, e.status||400, e.code||'ERROR_LIST_APPOINTMENTS', e.message);
  }
}

// POST /appointments/:patientId
async function createAppointment(req, res) {
  try {
    const patientId = req.params.patientId;
    const actorId = actorFromReq(req);
    const payload = req.body;

    if (!payload?.doctorId) return jsonErr(res, 400, 'VALIDATION_ERROR', 'doctorId es requerido');
    if (!payload?.appointmentDate) return jsonErr(res, 400, 'VALIDATION_ERROR', 'appointmentDate es requerido');

    const appt = await apointmentService.svcCreateAppointment({
      actorId,
      data: {
        patientId,
        doctorId: payload.doctorId,
        specialtyId: payload.specialtyId ?? null,
        appointmentDate: payload.appointmentDate,
        duration: payload.duration ?? 30,
        reason: payload.reason ?? null,
        notes: payload.notes ?? null
      }
    });

    return res.status(201).json({ ok: true, data: appt });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message, e.extra);
    console.error(e);
    return jsonErr(res, 400, 'ERROR_CREATING_APPOINTMENT', 'Error no se pudo crear la cita');
  }
}

// GET /appointments/by-id/:id
async function getAppointmentById(req, res) {
  try {
    const appt = await apointmentService.svcGetAppointmentById(req.params.id);
    return res.json({ ok: true, data: appt });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    console.error(e);
    return jsonErr(res, 400, 'ERROR_APPOINTMENT_BYID', 'Error lisndo cita por ID');
  }
}

// GET /appointments/patient/:patientId
async function listAppointmentsByPatient(req, res) {
  try {
    const q = pickQuery(req);
    q.patientId = req.params.patientId;
    const listAppointmentsByPatient = await apointmentService.svcListByPatient(q, req.headers.authorization || '');
    return res.json({ ok: true, ...listAppointmentsByPatient });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    console.error('[listAppointmentsByPatient]',e);
    return jsonErr(res, 500, 'ERROR_LIST_APPOINTMENTS_BY_PATIENT', `Error listando citas del paciente ${req.params.patientId}`);
  }
}

// GET /appointments/doctor/:doctorId
async function listAppointmentsByDoctor(req, res) {
  try {
    const q = pickQuery(req);
    q.doctorId = req.params.doctorId;
    const listAppointmentsByDoctor = await apointmentService.svcListByDoctor(q, req.headers.authorization || '');
    return res.json({ ok: true, ...listAppointmentsByDoctor });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    console.error('[listAppointmentsByDoctor]',e);
    return jsonErr(res, 500, 'ERROR_LIST_APPOINTMENTS_BY_DOCTOR', 'Error listando citas del médico ' + req.params.doctorId);
  }
}

// PUT /appointments/:id
async function updateAppointment(req, res) {
  try {
    const actorId = actorFromReq(req);
    const appt = await apointmentService.svcUpdateAppointment({
      actorId,
      id: req.params.id,
      data: req.body || {}
    });
        //Si la cita es completada no deja actualizar más
    if (appt.status === 'COMPLETED') {
      return jsonErr(res, 400, 'ERROR_APPOINTMENT_STATUS', 'No se puede actualizar una cita completada');
    }
    return res.json({ ok: true, data: appt });

  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    console.error(e);
    return jsonErr(res, 406, 'ERROR_UPDATING_APPOINTMENT', 'Error actualizando la cita ' + req.params.id);
  }
}

async function listAppointmentsByDateRange(req, res) {
  try {
    const { dateFrom, dateTo, doctorId, patientId, status } = req.query;
    const data = await apointmentService.svcListByDateRange({ dateFrom, dateTo, doctorId, patientId, status });
    return res.json({ ok: true, data });
  } catch (e) {
    console.error('[appointments range] error:', e);
    return jsonErr(res, e.status || 400, e.code || 'INTERNAL_ERROR', e.message);
  }
}

async function patchAppointmentStatus(req, res) {
  try {
    const { status, cancellationReason } = req.body || {};
    if (!status) return jsonErr(res, 400, 'VALIDATION_ERROR', 'status es requerido');

    const actor = actorFromReq(req);
    const appt = await apointmentService.svcChangeAppointmentStatus({
      id: req.params.id,
      newStatusLabel: status, // etiqueta en español
      actorId: actor.id,
      actorRole: actor.role,
      cancellationReason
    });

    return res.json({ ok: true, data: appt });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message, e.extra);
    console.error(e);
    return jsonErr(res, 400, 'ERROR_APPOINTMENT_STATUS', 'Error cambiando el estado de la cita ' + req.params.id);
  }
}

async function deleteAppointment(req, res) {
  try {
    const { reason } = req.body || {};
    const actor = actorFromReq(req);
    const appt = await apointmentServicesvcCancelAppointment({
      id: req.params.id,
      actorId: actor.id,
      actorRole: actor.role,
      reason
    });
    return res.json({ ok: true, data: appt, message: 'Cita cancelada' });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    console.error(e);
    return jsonErr(res, 404, 'ERROR_DELETE_APPOINTMENT', 'Error eliminando la cita ' + req.params.id);
  }
}




module.exports = {
  createAppointment,
  getAppointmentById,
  listAppointments,
  listAppointmentsByPatient,
  listAppointmentsByDoctor,
  updateAppointment,
  listAppointmentsByDateRange,
  patchAppointmentStatus,
  deleteAppointment
};
