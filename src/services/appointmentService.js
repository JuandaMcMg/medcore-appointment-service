const { prisma } = require('../database/database');
const axios = require('axios');
const { parseISO, startOfDay, endOfDay, isValid } = require('date-fns');
const { parseTimeToMinutes } = require('../utils/time');

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
  REAGENDADA: 'RESCHEDULED',
  CONFIRMADA: 'CONFIRMED'
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
  const dr = toDayRange(dateFrom, dateTo);
  if (dr) where.appointmentDate = dr;
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

async function svcCreateAppointment({ actorId, data }) {
  const start = parseDate(data.appointmentDate);
  const now = new Date();
  if (start.getTime() < now.getTime()) throw appErr('No se puede programar en el pasado', 400, 'PAST_APPOINTMENT');
  await assertDoctorAvailability(data.doctorId, start, data.duration || 30);
  const created = await prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.create({
      data: {
        patientId: data.patientId,
        doctorId: data.doctorId,
        specialtyId: data.specialtyId ?? null,
        appointmentDate: start,
        duration: data.duration ?? 30,
        reason: data.reason ?? null,
        notes: data.notes ?? null,
        status: 'SCHEDULED'
      }
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
  const {
    patientId,
    status,
    doctorId,
    specialtyId,
    page,
    limit,
    dateFrom,
    dateTo,
    orderBy,
    order,
  } = query;

  // 1️⃣ Construcción del filtro y orden
  const where = buildWhere({
    status,
    doctorId,
    specialtyId,
    patientId,
    dateFrom,
    dateTo,
  });

  const { skip, take, page: p, limit: l } = parsePagination(page, limit);
  const orderObj = buildOrder(orderBy, order);

  // 2️⃣ Consultar las citas
  const [items, total] = await Promise.all([
    prisma.appointment.findMany({ where, orderBy: orderObj, skip, take }),
    prisma.appointment.count({ where }),
  ]);

  if (items.length === 0) {
    return {
      data: [],
      pagination: { total: 0, pages: 0, page: p, limit: l },
      filters: { patientId, status, doctorId, specialty: specialtyId, dateFrom, dateTo, orderBy, order },
    };
  }

  // 3️⃣ Extraer IDs únicos
  const doctorIds = [...new Set(items.map(c => c.doctorId))];
  const specialtyIds = [...new Set(items.filter(c => c.specialtyId).map(c => c.specialtyId))];

  // 4️⃣ Consultar microservicios externos
  let doctors = [];
  let specialties = [];

  try {
    const [doctorsRes, specialtiesRes] = await Promise.all([
      axios.post("http://localhost:3003/api/v1/users/batch", { ids: doctorIds }, {
        headers: { Authorization: authHeader },
      }),
      /*axios.post("http://localhost:3006/api/v1/specialties/batch", { ids: specialtyIds }, {
        headers: { Authorization: authHeader },
      }),*/
    ]);

    doctors = doctorsRes.data?.data || [];
    specialties = specialtiesRes.data?.data || [];
  } catch (err) {
    console.error("⚠️ Error consultando doctores/especialidades:", err.message);
  }

  // 5️⃣ Combinar los datos (enriquecer las citas)
  const enrichedItems = items.map(cita => ({
    ...cita,
    doctor: doctors.find(d => d.id === cita.doctorId) || null,
    specialty: specialties.find(s => s.id === cita.specialtyId) || null,
  }));

  // 6️⃣ Retornar respuesta formateada
  return {
    data: enrichedItems,
    pagination: {
      total,
      pages: Math.ceil(total / l),
      page: p,
      limit: l,
    },
    filters: {
      patientId,
      status,
      doctorId,
      specialty: specialtyId,
      dateFrom,
      dateTo,
      orderBy: Object.keys(orderObj)[0],
      order: Object.values(orderObj)[0],
    },
  };
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

async function svcUpdateAppointment({ actorId, id, data }) {
  const current = await prisma.appointment.findUnique({ where: { id } });
  if (!current) throw appErr('Cita no encontrada', 404, 'NOT_FOUND');
  let newDate;
  if (data.appointmentDate) {
    newDate = parseDate(data.appointmentDate);
    const now = new Date();
    if (newDate.getTime() < now.getTime()) throw appErr('No se puede programar en el pasado', 400, 'PAST_APPOINTMENT');
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

function safeDayStart(s) {
  if (!s) return null;
  const d = parseISO(s.length > 10 ? s : `${s}T00:00:00.000Z`);
  if (!isValid(d)) return null;
  return startOfDay(d);
}
function safeDayEnd(s) {
  if (!s) return null;
  const d = parseISO(s.length > 10 ? s : `${s}T00:00:00.000Z`);
  if (!isValid(d)) return null;
  return endOfDay(d);
}

async function svcListByDateRange({ dateFrom, dateTo, doctorId, patientId, status }) {
  const where = {};
  const from = safeDayStart(dateFrom);
  const to = safeDayEnd(dateTo);
  if (from || to) {
    where.appointmentDate = {};
    if (from) where.appointmentDate.gte = from;
    if (to) where.appointmentDate.lte = to;
  }
  if (doctorId) where.doctorId = doctorId;
  if (patientId) where.patientId = patientId;
  if (status) {
    const mapped = ES_TO_ENUM[String(status).toUpperCase()] || String(status).toUpperCase();
    where.status = mapped;
  }
  const list = await prisma.appointment.findMany({ where, orderBy: { appointmentDate: 'asc' } });
  return { filters: { dateFrom, dateTo, doctorId, patientId, status }, total: list.length, items: list };
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
};
