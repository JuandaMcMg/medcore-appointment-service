const { prisma } = require('../database/database');
const { parseTimeToMinutes } = require('../utils/time');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
function validateObjectId(id, fieldName = 'id') {
  if (!OBJECT_ID_REGEX.test(id)) {
    const err = new Error(`Valor inválido para ${fieldName}`);
    err.statusCode = 400; throw err;
  }
}

async function assertDoctorAvailability(doctorId, appointmentDate, duration) {
  // 1) existe schedule activo para el día y hora
  const dayOfWeek = appointmentDate.getUTCDay();
  const hh = appointmentDate.getUTCHours();
  const mm = appointmentDate.getUTCMinutes();
  const timeStr = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  const schedules = await prisma.schedule.findMany({ where: { doctorId, dayOfWeek, isActive: true } });
  const slotM = parseTimeToMinutes(timeStr);
  const fitsInSchedule = schedules.some(s => {
    const sStart = parseTimeToMinutes(s.startTime);
    const sEnd = parseTimeToMinutes(s.endTime);
    return slotM >= sStart && (slotM + duration) <= sEnd;
  });
  if (!fitsInSchedule) {
    const err = new Error('Hora fuera del horario del médico'); err.statusCode = 409; throw err;
  }

  // 2) no existe cita que se solape (excluye CANCELLED/NO_SHOW)
  const dayStart = new Date(Date.UTC(appointmentDate.getUTCFullYear(), appointmentDate.getUTCMonth(), appointmentDate.getUTCDate(), 0, 0, 0));
  const dayEnd = new Date(Date.UTC(appointmentDate.getUTCFullYear(), appointmentDate.getUTCMonth(), appointmentDate.getUTCDate(), 23, 59, 59, 999));
  const taken = await prisma.appointment.findMany({ where: { doctorId, appointmentDate: { gte: dayStart, lte: dayEnd }, status: { notIn: ['CANCELLED','NO_SHOW'] } } });
  const slotKey = timeStr;
  const conflict = taken.find(ap => {
    const apH = ap.appointmentDate.getUTCHours();
    const apM = ap.appointmentDate.getUTCMinutes();
    const apStartM = parseTimeToMinutes(`${String(apH).padStart(2,'0')}:${String(apM).padStart(2,'0')}`);
    const apEndM = apStartM + ap.duration;
    const newEnd = slotM + duration;
    return (slotM < apEndM && apStartM < newEnd);
  });
  if (conflict) { const err = new Error('La hora ya está ocupada'); err.statusCode = 409; throw err; }

  // 3) no está dentro de bloqueos
  const schedulesWithBlocks = await prisma.schedule.findMany({ where: { doctorId, dayOfWeek, isActive: true }, include: { blockedSlots: true } });
  const inBlocked = schedulesWithBlocks.some(s => (s.blockedSlots || []).some(b => b.blockedDate.toISOString().startsWith(dayStart.toISOString().slice(0,10)) && slotM >= parseTimeToMinutes(b.startTime) && slotM < parseTimeToMinutes(b.endTime)));
  if (inBlocked) { const err = new Error('La hora está bloqueada'); err.statusCode = 409; throw err; }
}

async function createAppointment({ patientId, doctorId, specialtyId, appointmentDate, duration = 30, reason }, currentUser) {
  validateObjectId(doctorId,'doctorId');
  validateObjectId(patientId,'patientId');
  if (specialtyId) validateObjectId(specialtyId,'specialtyId');
  const date = new Date(appointmentDate);
  if (Number.isNaN(date.getTime())) { const err = new Error('appointmentDate inválida'); err.statusCode = 400; throw err; }
  if (duration <= 0) { const err = new Error('duration debe ser > 0'); err.statusCode = 400; throw err; }

  // Regla: un médico solo agenda sus propias citas, a menos que sea ADMIN
  if (currentUser?.role !== 'ADMINISTRADOR' && currentUser?.id !== doctorId) {
    const err = new Error('No puedes crear citas para otros médicos'); err.statusCode = 403; throw err;
  }

  await assertDoctorAvailability(doctorId, date, duration);

  const appointment = await prisma.appointment.create({
    data: {
      patientId, doctorId, specialtyId: specialtyId || null,
      appointmentDate: date,
      duration,
      reason: reason || null,
      status: 'SCHEDULED',
    }
  });

  await prisma.appointmentHistory.create({
    data: {
      appointmentId: appointment.id,
      action: 'CREATED',
      newStatus: 'SCHEDULED',
      newData: { patientId, doctorId, appointmentDate: date.toISOString(), duration, reason },
      changedBy: currentUser?.id || null,
      changedByRole: currentUser?.role || null,
      ipAddress: null,
      userAgent: null,
    }
  });

  return appointment;
}

async function updateAppointmentStatus(id, newStatus, currentUser) {
  validateObjectId(id,'id');
  const exists = await prisma.appointment.findUnique({ where: { id } });
  if (!exists) { const err = new Error('Cita no encontrada'); err.statusCode = 404; throw err; }
  if (currentUser?.role !== 'ADMINISTRADOR' && currentUser?.id !== exists.doctorId) {
    const err = new Error('No puedes modificar citas de otros médicos'); err.statusCode = 403; throw err;
  }
  const prev = exists.status;
  const updated = await prisma.appointment.update({ where: { id }, data: { status: newStatus } });
  await prisma.appointmentHistory.create({
    data: {
      appointmentId: id,
      action: 'STATUS_CHANGED',
      previousStatus: prev,
      newStatus,
      changedBy: currentUser?.id || null,
      changedByRole: currentUser?.role || null,
    }
  });
  return updated;
}

module.exports = { createAppointment, updateAppointmentStatus };
