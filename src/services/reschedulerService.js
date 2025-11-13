// Rescheduler service: move affected appointments when schedule changes
const { prisma } = require('../database/database');
const scheduleService = require('./scheduleService');

function addDays(date, d) {
  const n = new Date(date);
  n.setUTCDate(n.getUTCDate() + d);
  return n;
}
function toHhmm(date) {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
function cmpTime(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function timeInRange(t, start, end) { return cmpTime(t, start) >= 0 && cmpTime(t, end) < 0; }
function dayOfWeekUTC(date) { return date.getUTCDay(); }

// Compute lost windows between old and updated schedule (time strings "HH:mm")
function computeLostWindows(oldSched, newSched) {
  const windows = [];
  if (!oldSched || !newSched) return windows;
  if (oldSched.dayOfWeek !== newSched.dayOfWeek) {
    windows.push({ dayOfWeek: oldSched.dayOfWeek, start: oldSched.startTime, end: oldSched.endTime });
    return windows;
  }
  if (cmpTime(newSched.startTime, oldSched.startTime) > 0) {
    windows.push({ dayOfWeek: oldSched.dayOfWeek, start: oldSched.startTime, end: newSched.startTime });
  }
  if (cmpTime(newSched.endTime, oldSched.endTime) < 0) {
    windows.push({ dayOfWeek: oldSched.dayOfWeek, start: newSched.endTime, end: oldSched.endTime });
  }
  return windows;
}

async function findNextSlot({ doctorId, startDate, duration = 30, horizonDays = 14 }) {
  for (let d = 0; d <= horizonDays; d++) {
    const date = addDays(startDate, d);
    const dateStr = date.toISOString().slice(0, 10);
    let availability;
    try {
      availability = await scheduleService.getAvailability(doctorId, dateStr);
    } catch (_) { continue; }
    if (!Array.isArray(availability) || availability.length === 0) continue;
    const slot = availability.find(s => s.available === true);
    if (slot) {
      const [hh, mm] = slot.time.split(':').map(Number);
      const newDate = new Date(`${dateStr}T00:00:00.000Z`);
      newDate.setUTCHours(hh, mm, 0, 0);
      return newDate;
    }
  }
  return null;
}

async function rescheduleAppointmentsInWindows({ doctorId, windows, fromDateUTC = new Date(), horizonDays = 30 }) {
  if (!windows || !windows.length) return { processed: 0, moved: 0, notFoundSlot: 0 };

  const dayStart = new Date(Date.UTC(fromDateUTC.getUTCFullYear(), fromDateUTC.getUTCMonth(), fromDateUTC.getUTCDate(), 0, 0, 0, 0));
  const toDate = addDays(fromDateUTC, horizonDays);

  const affected = await prisma.appointment.findMany({
    where: {
      doctorId,
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
      appointmentDate: { gte: dayStart, lt: toDate }
    },
    orderBy: { appointmentDate: 'asc' }
  });

  let moved = 0, notFoundSlot = 0;

  for (const appt of affected) {
    const apptDate = new Date(appt.appointmentDate);
    const apptDow = dayOfWeekUTC(apptDate);
    const apptTime = toHhmm(apptDate);

    const hit = windows.some(w => w.dayOfWeek === apptDow && timeInRange(apptTime, w.start, w.end));
    if (!hit) continue;

    const newStart = await findNextSlot({ doctorId, startDate: apptDate, duration: appt.duration || 30, horizonDays: 14 });

    if (newStart) {
      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({ where: { id: appt.id }, data: { appointmentDate: newStart, status: 'RESCHEDULED', isRescheduled: true } });
        await tx.appointmentHistory.create({
          data: {
            appointmentId: appt.id,
            action: 'RESCHEDULED',
            previousStatus: appt.status,
            newStatus: 'RESCHEDULED',
            previousData: { appointmentDate: appt.appointmentDate },
            newData: { appointmentDate: newStart },
            changedFields: ['appointmentDate', 'status'],
            changedBy: null,
            changedByRole: 'SYSTEM'
          }
        });
      });
      moved += 1;
    } else {
      await prisma.appointmentHistory.create({
        data: {
          appointmentId: appt.id,
          action: 'RESCHEDULE_ATTEMPT',
          previousStatus: appt.status,
          newStatus: appt.status,
          previousData: { appointmentDate: appt.appointmentDate },
          newData: {},
          changedFields: [],
          changedBy: null,
          changedByRole: 'SYSTEM'
        }
      });
      notFoundSlot += 1;
    }
  }

  return { processed: affected.length, moved, notFoundSlot };
}

module.exports = { computeLostWindows, rescheduleAppointmentsInWindows };

async function rescheduleOutOfScheduleAppointments({ doctorId, fromDateUTC = new Date(), horizonDays = 30 }) {
  const dayStart = new Date(Date.UTC(fromDateUTC.getUTCFullYear(), fromDateUTC.getUTCMonth(), fromDateUTC.getUTCDate(), 0, 0, 0, 0));
  const toDate = addDays(fromDateUTC, horizonDays);
  const appts = await prisma.appointment.findMany({
    where: { doctorId, status: { in: ['SCHEDULED', 'CONFIRMED'] }, appointmentDate: { gte: dayStart, lt: toDate } },
    orderBy: { appointmentDate: 'asc' }
  });
  let moved = 0, skipped = 0;
  for (const appt of appts) {
    const dt = new Date(appt.appointmentDate);
    const dow = dt.getUTCDay();
    const hhmm = toHhmm(dt);
    const schedules = await prisma.schedule.findMany({ where: { doctorId, dayOfWeek: dow, isActive: true } });
    const fits = schedules.some(s => timeInRange(hhmm, s.startTime, s.endTime));
    if (fits) { skipped += 1; continue; }
    const newStart = await findNextSlot({ doctorId, startDate: dt, duration: appt.duration || 30, horizonDays: 14 });
    if (!newStart) continue;
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id: appt.id }, data: { appointmentDate: newStart, status: 'RESCHEDULED', isRescheduled: true } });
      await tx.appointmentHistory.create({ data: { appointmentId: appt.id, action: 'RESCHEDULED', previousStatus: appt.status, newStatus: 'RESCHEDULED', previousData: { appointmentDate: appt.appointmentDate }, newData: { appointmentDate: newStart }, changedFields: ['appointmentDate','status'], changedBy: null, changedByRole: 'SYSTEM' } });
    });
    moved += 1;
  }
  return { processed: appts.length, moved, skipped };
}

module.exports.rescheduleOutOfScheduleAppointments = rescheduleOutOfScheduleAppointments;