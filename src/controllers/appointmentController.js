const apointmentService = require('../services/appointmentService');
const notificationService = require('../services/notificationService');

const jsonErr = (res, status, code, message, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message, ...extra });

const actorFromReq = (req) => ({ id: req.user?.id, role: req.user?.role });

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
    jsonErr(res, e.status||400, e.code||'ERROR_LIST_APPOINTMENTS', e.message);
  }
}

async function createAppointment(req, res) {
  try {
    const patientId = req.params.patientId;
    const actor = actorFromReq(req);
    const payload = req.body;
    if (!payload?.doctorId) return jsonErr(res, 400, 'VALIDATION_ERROR', 'doctorId es requerido');
    if (!payload?.appointmentDate) return jsonErr(res, 400, 'VALIDATION_ERROR', 'appointmentDate es requerido');
    const appt = await apointmentService.svcCreateAppointment({
      actorId: actor.id,
      authHeader: req.headers.authorization || '',
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
    // Dispara correo (no bloquea la respuesta si falla)
    notificationService.notifyAppointmentCreated({ appt, authHeader: req.headers.authorization || '' })
      .catch(err => console.warn('[notifyAppointmentCreated] fallo:', err?.message));

    return res.status(201).json({
      message: "Cita creada exitosamente verifique su correo para más detalles",
      ok: true, data: appt
    });
  } catch (e) {
    console.error('[CREATE APPOINTMENT] error', {
      code: e.code, status: e.status, msg: e.message, stack: e.stack
    }); // 👈 te mostrará en terminal

    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message, e.extra);
    return jsonErr(res, 400, 'ERROR_CREATING_APPOINTMENT', 'Error no se pudo crear la cita');
  }
}
async function getAppointmentById(req, res) {
  try {
    const appt = await apointmentService.svcGetAppointmentById(req.params.id);
    return res.json({ ok: true, data: appt });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    return jsonErr(res, 404, 'ERROR_APPOINTMENT_BYID', 'Cita no encontrada');
  }
}

async function listAppointmentsByPatient(req, res) {
  try {
    const q = pickQuery(req);
    q.patientId = req.params.patientId;
    const data = await apointmentService.svcListByPatient(q, req.headers.authorization || '');
    return res.json({ ok: true, ...data });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    return jsonErr(res, 500, 'ERROR_LIST_APPOINTMENTS_BY_PATIENT', 'Error listando citas del paciente');
  }
}

async function listAppointmentsByDoctor(req, res) {
  try {
    const q = pickQuery(req);
    q.doctorId = req.params.doctorId;
    const data = await apointmentService.svcListByDoctor(q, req.headers.authorization || '');
    return res.json({ ok: true, ...data });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    return jsonErr(res, 500, 'ERROR_LIST_APPOINTMENTS_BY_DOCTOR', 'Error listando citas del médico');
  }
}

async function updateAppointment(req, res) {
  try {
    const actor = actorFromReq(req);
    const appt = await apointmentService.svcUpdateAppointment({ actorId: actor.id, id: req.params.id, data: req.body || {} });
    if (appt.status === 'COMPLETED') {
      return jsonErr(res, 400, 'ERROR_APPOINTMENT_STATUS', 'No se puede actualizar una cita completada');
    }
    return res.json({ ok: true, data: appt });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    return jsonErr(res, 406, 'ERROR_UPDATING_APPOINTMENT', 'Error actualizando la cita');
  }
}

async function listAppointmentsByDateRange(req, res) {
  try {
    const { dateFrom, dateTo, doctorId, patientId, status } = req.query;
    const data = await apointmentService.svcListByDateRange({ dateFrom, dateTo, doctorId, patientId, status });
    return res.json({ ok: true, data });
  } catch (e) {
    return jsonErr(res, e.status || 400, e.code || 'INTERNAL_ERROR', e.message);
  }
}

async function patchAppointmentStatus(req, res) {
  try {
    const { status, cancellationReason } = req.body || {};
    if (!status) return jsonErr(res, 400, 'VALIDATION_ERROR', 'status es requerido');
    const actor = actorFromReq(req);
    const appt = await apointmentService.svcChangeAppointmentStatus({ id: req.params.id, newStatusLabel: status, actorId: actor.id, actorRole: actor.role, cancellationReason });
    return res.json({ ok: true, data: appt });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message, e.extra);
    return jsonErr(res, 400, 'ERROR_APPOINTMENT_STATUS', 'Error cambiando el estado de la cita');
  }
}

async function deleteAppointment(req, res) {
  try {
    const { reason } = req.body || {};
    const actor = actorFromReq(req);

    // 🔹 Cancelar la cita
    const appt = await apointmentService.svcCancelAppointment({
      id: req.params.id,
      actorId: actor.id,
      actorRole: actor.role,
      reason
    });

    // 🔹 Cancelar ticket en la cola si existe
    if (appt.queueTicketId) {
      await queueService.cancelTicket({
        ticketId: appt.queueTicketId,
        actorId: actor.id
      });
    }

    // 🔹 Notificar al paciente
    notificationService.notifyAppointmentCancelled({
      appt,
      authHeader: req.headers.authorization || ''
    });

    return res.json({ ok: true, data: appt, message: 'Cita cancelada' });
  } catch (e) {
    if (e.status && e.code) return jsonErr(res, e.status, e.code, e.message);
    return jsonErr(res, 404, 'ERROR_DELETE_APPOINTMENT', 'Error eliminando la cita');
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
  deleteAppointment,
};
