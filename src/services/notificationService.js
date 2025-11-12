// services/notificationService.js
const {
  getUserContactByUserId,
  getPatientContactByPatientId,
} = require('../utils/remoteUsers');

const {
  sendNewAppointmentEmail,
  sendCancelledAppointmentEmail,
  sendRescheduledAppointmentEmail,
  sendRecordatoryAppointmentEmail,
} = require('../config/emailConfig');

// NUEVA CITA
async function notifyAppointmentCreated({ appt, authHeader }) {
  // Paciente por patientId
  const p = await getPatientContactByPatientId(appt.patientId, authHeader);
  if (!p || !p.email) {
    return { success: false, error: new Error('Paciente sin email/usuario') };
  }

  // Médico por userId (doctorId)
  let doctorName = 'Médico';
  const doc = await getUserContactByUserId(appt.doctorId, authHeader);
  if (doc?.fullName) doctorName = doc.fullName;

  const extras = { patientName: p.fullName || 'Paciente', doctorName };
  return await sendNewAppointmentEmail(p.email, appt, extras);
}

// CANCELACIÓN
async function notifyAppointmentCancelled({ appt, authHeader }) {
  const p = await getPatientContactByPatientId(appt.patientId, authHeader);
  if (!p || !p.email) {
    console.warn('[notifyAppointmentCancelled] omitido: paciente sin email/usuario');
    return { success: false, skipped: true, reason: 'NO_EMAIL' };
  }
  let doctorName = 'Médico';
  const doc = await getUserContactByUserId(appt.doctorId, authHeader);
  if (doc?.fullName) doctorName = doc.fullName;

  const extras = {
    patientName: p.fullName || 'Paciente',
    doctorName,
    cancellationReason: appt.cancellationReason || null,
  };
  return await sendCancelledAppointmentEmail(p.email, appt, extras);
}

// REAGENDAMIENTO
async function notifyAppointmentRescheduled({ previousAppt, newAppt, authHeader }) {
  const p = await getPatientContactByPatientId(newAppt.patientId, authHeader);
  if (!p || !p.email) {
    console.warn('[notifyAppointmentRescheduled] omitido: paciente sin email/usuario');
    return { success: false, skipped: true, reason: 'NO_EMAIL' };
  }
  let doctorName = 'Médico';
  const doc = await getUserContactByUserId(newAppt.doctorId, authHeader);
  if (doc?.fullName) doctorName = doc.fullName;

  const extras = { patientName: p.fullName || 'Paciente', doctorName };
  return await sendRescheduledAppointmentEmail(p.email, newAppt, previousAppt.appointmentDate, extras);
}

// RECORDATORIO
async function notifyAppointmentReminder({ appt, hoursBefore = 24, authHeader }) {
  const p = await getPatientContactByPatientId(appt.patientId, authHeader);
  if (!p || !p.email) {
    console.warn('[notifyAppointmentReminder] omitido: paciente sin email/usuario');
    return { success: false, skipped: true, reason: 'NO_EMAIL' };
  }
  let doctorName = 'Médico';
  const doc = await getUserContactByUserId(appt.doctorId, authHeader);
  if (doc?.fullName) doctorName = doc.fullName;

  const extras = { patientName: p.fullName || 'Paciente', doctorName };
  return await sendRecordatoryAppointmentEmail(p.email, appt, hoursBefore, extras);
}

module.exports = {
  notifyAppointmentCreated,
  notifyAppointmentCancelled,
  notifyAppointmentRescheduled,
  notifyAppointmentReminder,
};
