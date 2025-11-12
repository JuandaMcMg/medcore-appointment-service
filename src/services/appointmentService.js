const { prisma } = require('../database/database');
const axios = require('axios');
const { parseISO, startOfDay, endOfDay, isValid } = require('date-fns');
const { parseTimeToMinutes, isOverlap } = require('../utils/time');

const USER_URL = process.env.USER_SERVICE_URL || 'http://localhost:3003';
const ACTIVE_STATES = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'RESCHEDULED'];

function parsePagination(page, limit) {
  const p = Math.max(1, parseInt(page || '1', 10));
  const l = Math.min(100, Math.max(1, parseInt(limit || '20', 10)));
  return { page: p, limit: l, skip: (p - 1) * l, take: l };
}

const ES_TO_ENUM = {
  PROGRAMADA: 'SCHEDULED',
  CANCELADA: 'CANCELLED',
  COMPLETADA: 'COMPLETED',
  REAGENDADA: 'RESCHEDULED'
};

const VALID_TRANSITIONS = {
  SCHEDULED: ['CANCELLED', 'COMPLETED', 'RESCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
  CONFIRMED: ['CANCELLED', 'COMPLETED', 'RESCHEDULED', 'IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  RESCHEDULED: ['CANCELLED', 'COMPLETED', 'CONFIRMED', 'IN_PROGRESS'],
  COMPLETED: [],
  CANCELLED: []
};

function toDayRange(dateFrom, dateTo) {
  let gte, lte;
  if (dateFrom) {
    const d = parseISO(dateFrom.length > 10 ? dateFrom : `${dateFrom}T00:00:00.000Z`);
    if (isValid(d)) gte = startOfDay(d);
  }
  if (dateTo) {
    const d = parseISO(dateTo.length > 10 ? dateTo : `${dateTo}T00:00:00.000Z`);
    if (isValid(d)) lte = endOfDay(d);
  }
  return (gte || lte) ? { gte, lte } : undefined;
}

// --- utilidades para transformar Date -> rango en minutos del día (UTC) ---
function dayKeyUTC(date) {
  // YYYY-MM-DD en UTC
  return date.toISOString().slice(0, 10);
}

function minutesOfDayUTC(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function buildRangeFrom(date, durationMin) {
  const startMin = minutesOfDayUTC(date);
  const endMin = startMin + (durationMin || 0);
  return { day: dayKeyUTC(date), startMin, endMin };
}

// --- QUERIES comunes ---
function sameDayRange(date) {
  // límites del día en UTC para filtrar en Mongo (almacenas Date UTC)
  const d = new Date(date);
  const from = startOfDay(d);
  const to = endOfDay(d);
  return { gte: from, lte: to };
}


const appErr = (message, status, code, extra = {}) => {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  e.extra = extra;
  return e;
};

function mapStatus(input) {
  if (!input) return undefined;
  const u = String(input).trim().toUpperCase();
  return ES_TO_ENUM[u] || u;
}

function parseDate(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) throw appErr('Fecha inválida', 400, 'INVALID_DATE');
  return dt;
}

// Asegura que el paciente no tenga más de 3 citas activas
async function assertPatientActiveLimit({ patientId, excludeAppointmentId = null, tx }) {
  const client = tx || prisma;
  const count = await client.appointment.count({
    where: {
      patientId,
      status: { in: ACTIVE_STATES },
      ...(excludeAppointmentId ? { NOT: { id: excludeAppointmentId } } : {})
    }
  });
  if (count >= 3) {
      throw appErr('El paciente ya cuenta con 3 citas activas', 409, 'PATIENT_ACTIVE_LIMIT');
    }
}

async function assertNoPatientSimultaneous({patientId, appointmentDate, duration, excludeAppointmentId = null, tx}) {
  const client = tx || prisma;

  // Rango del mismo día (UTC)
  const dayRange = sameDayRange(appointmentDate);
  const startMin = minutesOfDayUTC(appointmentDate);
  const endMin   = startMin + (duration || 0);

  // Citas activas del paciente en ese día
  const sameDayActives = await client.appointment.findMany({
    where: {
      patientId,
      status: { in: ACTIVE_STATES },
      appointmentDate: { gte: dayRange.gte, lte: dayRange.lte },
      ...(excludeAppointmentId ? { NOT: { id: excludeAppointmentId } } : {})
    },
    select: { id: true, appointmentDate: true, duration: true }
  });

  const clash = sameDayActives.find(a => {
    const aStart = minutesOfDayUTC(new Date(a.appointmentDate));
    const aEnd   = aStart + (a.duration || 0);
    return isOverlap(startMin, endMin, aStart, aEnd);
  });

  if (clash) {
    throw appErr(
      'El paciente ya tiene una cita activa en esa fecha y hora',
      409,
      'PATIENT_OVERLAP',
      { clashId: clash.id }
    );
  }
}

function ensureTransition(prev, next) {
  const allowed = VALID_TRANSITIONS[prev] || [];
  if (!allowed.includes(next)) {
    throw appErr(`Transición inválida: ${prev} → ${next}`, 400, 'INVALID_TRANSITION', { from: prev, to: next });
  }
}

async function resolvePatientIdsByName(patientName, authHeader) {
  if (!patientName) return [];
  try {
    const { data } = await axios.get(`${USER_URL}/users`, {
      params: { q: patientName, role: 'PACIENTE', limit: 100 },
      headers: authHeader ? { Authorization: authHeader } : {}
    });
    const users = data?.users || [];
    return users.map(u => u.id);
  } catch (e) {
    console.warn('[resolvePatientIdsByName] fallo, ignorando filtro', e.message);
    return [];
  }
}

async function getUserById(userId, authHeader) {
  try {
    const { data } = await axios.get(`${USER_URL}/users/${userId}`, {
      headers: authHeader ? { Authorization: authHeader } : {}
    });
    const u = data?.user || data; // según tu MS de usuarios
    return {
      email: u?.email || null,
      fullName: u?.fullname || `${u?.first_name || u?.firstName || ''} ${u?.last_name || u?.lastName || ''}`.trim()
    };
  } catch (e) {
    console.warn('[getUserById] fallo:', e.message);
    return null;;
  }
}

function buildOrder(orderBy, order) {
  const field = ['appointmentDate','createdAt','status','doctorId','patientId'].includes(orderBy) ? orderBy : 'appointmentDate';
  const dir = (String(order||'asc').toLowerCase() === 'desc') ? 'desc' : 'asc';
  return { [field]: dir };
}

function buildWhere({ status, doctorId, specialtyId, patientIds, patientId, dateFrom, dateTo }) {
  const where = {};
  const st = mapStatus(status);
  if (st) where.status = st;
  if (doctorId) where.doctorId = doctorId;
  if (specialtyId) where.specialtyId = specialtyId;
  if (patientId) where.patientId = patientId;
  if (patientIds && patientIds.length) where.patientId = { in: patientIds };

  const from = dateFrom ? dayStartUTC(dateFrom) : null;
  const toExcl = dateTo ? nextDayStartUTC(dateTo) : null;
  if (from || toExcl) {
    where.appointmentDate = {};
    if (from)   where.appointmentDate.gte = from;
    if (toExcl) where.appointmentDate.lt  = toExcl; // límite superior exclusivo
  }
  return where;
}

async function assertDoctorAvailability(doctorId, appointmentDate, duration) {
  const dayOfWeek = appointmentDate.getUTCDay();
  const hh = appointmentDate.getUTCHours();
  const mm = appointmentDate.getUTCMinutes();
  const slotStr = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  const schedules = await prisma.schedule.findMany({ where: { doctorId, dayOfWeek, isActive: true }, include: { blockedSlots: true } });
  if (!schedules.length) throw appErr('No hay horario configurado para el médico ese día', 409, 'NO_SCHEDULE');
  const slotMin = parseTimeToMinutes(slotStr);
  let inSchedule = false;
  for (const s of schedules) {
    const sStart = parseTimeToMinutes(s.startTime);
    const sEnd = parseTimeToMinutes(s.endTime);
    if (slotMin >= sStart && (slotMin + duration) <= sEnd) {
      inSchedule = true;
      const grid = s.slotDuration || duration;
      if ((slotMin - sStart) % grid !== 0) throw appErr('La hora no está alineada a la grilla de slotDuration', 409, 'GRID_MISALIGNED');
      const isBlocked = (s.blockedSlots || []).some(b => b.blockedDate.toISOString().slice(0,10) === appointmentDate.toISOString().slice(0,10)
        && slotMin >= parseTimeToMinutes(b.startTime) && slotMin < parseTimeToMinutes(b.endTime));
      if (isBlocked) throw appErr('La hora está bloqueada', 409, 'BLOCKED_SLOT');
      break;
    }
  }
  if (!inSchedule) throw appErr('Hora fuera del horario del médico', 409, 'OUT_OF_SCHEDULE');
  const dayStart = startOfDay(appointmentDate);
  const dayEnd = endOfDay(appointmentDate);
  const existing = await prisma.appointment.findMany({ where: { doctorId, appointmentDate: { gte: dayStart, lte: dayEnd }, status: { in: ACTIVE_STATES } } });
  for (const ap of existing) {
    const apH = ap.appointmentDate.getUTCHours();
    const apM = ap.appointmentDate.getUTCMinutes();
    const apStart = parseTimeToMinutes(`${String(apH).padStart(2,'0')}:${String(apM).padStart(2,'0')}`);
    const apEnd = apStart + ap.duration;
    const newEnd = slotMin + duration;
    if (slotMin < apEnd && apStart < newEnd) throw appErr('La hora ya está ocupada', 409, 'OVERLAPPING_APPOINTMENT');
  }
}

// Crear una nueva cita
async function svcCreateAppointment({ actorId, data }) {
  const start = parseDate(data.appointmentDate);
  const now = new Date();
  if (start.getTime() < now.getTime()) 
    throw appErr('No se puede programar en el pasado', 400, 'PAST_APPOINTMENT');
  
  const duration = typeof data.duration === 'number' ? data.duration : 30;
  //Doctor: no doble booking
  const dupDotor = await prisma.appointment.findFirst({
    where: {
      doctorId: data.doctorId,
      appointmentDate: start,
      status: { in: ACTIVE_STATES }
    },
    select: { id: true }
  }); 
  if (dupDotor) {
    throw appErr('El médico ya tiene una cita activa en esa fecha y hora', 409, 'DOCTOR_OVERLAP', { clashId: dupDotor.id });
  }

  //Asegurar disponibilidad del doctor
  await assertDoctorAvailability(data.doctorId, start, duration);
  
  //Paciente: límite 3 activas y no doble booking
  await assertPatientActiveLimit([data.patientId ]);
  await assertNoPatientSimultaneous({ patientId: data.patientId, appointmentDate: start, duration });

  const created = await prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.create({
      data: {
        patientId: data.patientId,
        doctorId: data.doctorId,
        specialtyId: data.specialtyId ?? null,
        appointmentDate: start,
        duration,
        reason: data.reason ?? null,
        notes: data.notes ?? null,
        status: 'SCHEDULED'
      }
    
    // Enviar Correo / Notificación de nueva cit  

    });
    await tx.appointmentHistory.create({
      data: {
        appointmentId: appt.id,
        action: 'CREATED',
        previousStatus: null,
        newStatus: 'SCHEDULED',
        previousData: null,
        newData: { patientId: appt.patientId, doctorId: appt.doctorId, appointmentDate: appt.appointmentDate, duration: appt.duration, reason: appt.reason, notes: appt.notes },
        changedFields: ['patientId','doctorId','appointmentDate','duration','reason','notes','status'],
        changedBy: actorId ?? null,
        changedByRole: 'SYSTEM'
      }
    });
    return appt;
  });
  return created;
}

async function svcGetAppointmentById(id) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw appErr('Cita no encontrada', 404, 'NOT_FOUND');
  return appt;
}

async function svcListAppointments(query, authHeader) {
  const { status, doctorId, specialty, specialtyId, patientName, page, limit, dateFrom, dateTo, orderBy, order } = query;
  // specialty mapping TODO
  const patientIds = await resolvePatientIdsByName(patientName, authHeader);
  const where = buildWhere({ status, doctorId, specialtyId: specialtyId, patientIds, dateFrom, dateTo });
  const { skip, take, page: p, limit: l } = parsePagination(page, limit);
  const orderObj = buildOrder(orderBy, order);
  const [items, total] = await Promise.all([
    prisma.appointment.findMany({ where, orderBy: orderObj, skip, take }),
    prisma.appointment.count({ where })
  ]);
  return { data: items, pagination: { total, pages: Math.ceil(total / l), page: p, limit: l }, filters: { status, doctorId, specialty: specialty || specialtyId, patientName, dateFrom, dateTo, orderBy: Object.keys(orderObj)[0], order: Object.values(orderObj)[0] } };
}

async function svcListByPatient(query, authHeader) {
  const { patientId, status, doctorId, specialtyId, page, limit, dateFrom, dateTo, orderBy, order } = query;
  const where = buildWhere({ status, doctorId, specialtyId, patientId, dateFrom, dateTo });
  const { skip, take, page: p, limit: l } = parsePagination(page, limit);
  const orderObj = buildOrder(orderBy, order);
  const [items, total] = await Promise.all([
    prisma.appointment.findMany({ where, orderBy: orderObj, skip, take }),
    prisma.appointment.count({ where })
  ]);
  return { data: items, pagination: { total, pages: Math.ceil(total / l), page: p, limit: l }, filters: { patientId, status, doctorId, specialty: specialtyId, dateFrom, dateTo, orderBy: Object.keys(orderObj)[0], order: Object.values(orderObj)[0] } };
}

async function svcListByDoctor(query, authHeader) {
  const { doctorId, status, specialtyId, patientName, page, limit, dateFrom, dateTo, orderBy, order } = query;
  const patientIds = await resolvePatientIdsByName(patientName, authHeader);
  const where = buildWhere({ status, doctorId, specialtyId, patientIds, dateFrom, dateTo });
  const { skip, take, page: p, limit: l } = parsePagination(page, limit);
  const orderObj = buildOrder(orderBy, order);
  const [items, total] = await Promise.all([
    prisma.appointment.findMany({ where, orderBy: orderObj, skip, take }),
    prisma.appointment.count({ where })
  ]);
  return { data: items, pagination: { total, pages: Math.ceil(total / l), page: p, limit: l }, filters: { doctorId, status, specialty: specialtyId, patientName, dateFrom, dateTo, orderBy: Object.keys(orderObj)[0], order: Object.values(orderObj)[0] } };
}

// Actualizar una cita
async function svcUpdateAppointment({ actorId, id, data }) {
  const current = await prisma.appointment.findUnique({ where: { id } });
  if (!current) throw appErr('Cita no encontrada', 404, 'NOT_FOUND');

  const duration = typeof data.duration === 'number' ? data.duration : current.duration;

  let newDate;
  if (data.appointmentDate || typeof data.duration === 'number') {
    newDate = data.appointmentDate ? parseDate(data.appointmentDate) : new Date(current.appointmentDate);
    
    const now = new Date();
    if (newDate.getTime() < now.getTime()) throw appErr('No se puede programar en el pasado', 400, 'PAST_APPOINTMENT');
    
    // Doctor libre
    if (newDate.getTime() !== new Date(current.appointmentDate).getTime()) {
      const dupDoctor = await prisma.appointment.findFirst({
        where: {
          doctorId: current.doctorId,
          appointmentDate: newDate,
          status: { in: ACTIVE_STATES },
          NOT: { id }
        },
        select: { id: true }
      });
      if (dupDoctor) throw appErr('Conflicto: el nuevo horario ya está ocupado (doctor)', 409, 'OVERLAPPING_APPOINTMENT');
    }

    // Paciente: simultánea
    await assertNoPatientSimultaneous({
      patientId: current.patientId,
      appointmentDate: newDate,
      duration,
      excludeAppointmentId: id
    });
  }
  const updateData = {
    ...(newDate ? { appointmentDate: newDate } : {}),
    ...(typeof data.duration === 'number' ? { duration: data.duration } : {}),
    ...(data.status ? { status: data.status } : {}),
    ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
    ...(typeof data.notes === 'string' ? { notes: data.notes } : {})
  };

  const updated = await prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.update({ where: { id }, data: updateData });
    await tx.appointmentHistory.create({
      data: {
        appointmentId: appt.id,
        action: 'UPDATED',
        previousStatus: current.status,
        newStatus: appt.status,
        previousData: { appointmentDate: current.appointmentDate, duration: current.duration, status: current.status, reason: current.reason, notes: current.notes },
        newData: { appointmentDate: appt.appointmentDate, duration: appt.duration, status: appt.status, reason: appt.reason, notes: appt.notes },
        changedFields: Object.keys(updateData),
        changedBy: actorId ?? null,
        changedByRole: 'SYSTEM'
      }
    });
    return appt;
  });
  return updated;
}

async function svcChangeAppointmentStatus({ id, newStatusLabel, actorId, actorRole, cancellationReason }) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw appErr('Cita no encontrada', 404, 'NOT_FOUND');

  const next = ES_TO_ENUM[(newStatusLabel || '').toUpperCase()];
  if (!next) throw appErr('Estado inválido', 400, 'INVALID_STATUS');

  if (actorRole === 'PACIENTE' && ['COMPLETED','IN_PROGRESS'].includes(next)) {
    throw appErr('No autorizado para cambiar a ese estado', 403, 'FORBIDDEN');
  }
  ensureTransition(appt.status, next);
  
  const updateData = { status: next };
  if (next === 'CANCELLED') {
    updateData.cancelledAt = new Date();
    if (cancellationReason) updateData.cancellationReason = cancellationReason;
    updateData.cancelledBy = actorId ?? null;
  }

  if (next === 'COMPLETED') updateData.completedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.appointment.update({ where: { id }, data: updateData });
    await tx.appointmentHistory.create({
      data: {
        appointmentId: u.id,
        action: 'STATUS_CHANGED',
        previousStatus: appt.status,
        newStatus: u.status,
        previousData: { status: appt.status },
        newData: { status: u.status },
        changedFields: ['status'],
        changedBy: actorId ?? null,
        changedByRole: actorRole || 'SYSTEM'
      }
    });
    return u;
  });
  return updated;
}

async function svcCancelAppointment({ id, actorId, actorRole, reason }) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw appErr('Cita no encontrada', 404, 'NOT_FOUND');
  if (['CANCELLED','COMPLETED'].includes(appt.status)) return appt;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.appointment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason || 'Cancelled via DELETE', cancelledBy: actorId ?? null } });
    await tx.appointmentHistory.create({ data: { appointmentId: u.id, action: 'CANCELLED', previousStatus: appt.status, newStatus: 'CANCELLED', previousData: { status: appt.status }, newData: { status: 'CANCELLED', cancellationReason: reason || null }, changedFields: ['status','cancelledAt','cancellationReason','cancelledBy'], changedBy: actorId ?? null, changedByRole: actorRole || 'SYSTEM' } });
    return u;
  });
  return updated;
} 
function dayStartUTC(dateStr) {
  // dateStr: "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  const [ , y, mo, d ] = m.map(Number);
  return new Date(Date.UTC(y, mo, d, 0, 0, 0, 0)); // mo ya es 2 dígitos, pero Number lo vuelve int
}

function dayStartUTC(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr||'').trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d, 0, 0, 0, 0));
}
function nextDayStartUTC(dateStr) {
  const s = dayStartUTC(dateStr);
  if (!s) return null;
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + 1, 0, 0, 0, 0));
}

async function svcListByDateRange({ dateFrom, dateTo, doctorId, patientId, status }) {
  const where = {};
  const from = dateFrom ? dayStartUTC(dateFrom) : null;        // >= 2025-12-17T00:00:00Z
  const toExcl = dateTo ? nextDayStartUTC(dateTo) : null;      //  < 2025-12-21T00:00:00Z

  if (from || toExcl) {
    where.appointmentDate = {};
    if (from)  where.appointmentDate.gte = from;
    if (toExcl) where.appointmentDate.lt  = toExcl; // límite superior EXCLUSIVO
  }

  if (doctorId)  where.doctorId = doctorId;
  if (patientId) where.patientId = patientId;
  if (status) {
    const mapped = ES_TO_ENUM[String(status).toUpperCase()] || String(status).toUpperCase();
    where.status = mapped;
  }

  const list = await prisma.appointment.findMany({ where, orderBy: { appointmentDate: 'asc' } });
  return {
    ok: true,
    data: list,
    pagination: { total: list.length, pages: 1, page: 1, limit: 20 },
    filters: { doctorId, dateFrom, dateTo, orderBy: 'appointmentDate', order: 'asc' }
  };
}


module.exports = {
  svcListAppointments,
  svcListByPatient,
  svcListByDoctor,
  svcCreateAppointment,
  svcGetAppointmentById,
  svcUpdateAppointment,
  svcChangeAppointmentStatus,
  svcCancelAppointment,
  svcListByDateRange,
  getUserById
};
