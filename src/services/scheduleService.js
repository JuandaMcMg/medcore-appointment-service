const { prisma } = require('../database/database');
const { parseTimeToMinutes, generateSlots, isOverlap } = require('../utils/time');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

function validateObjectId(id, fieldName = 'id') {
	if (!OBJECT_ID_REGEX.test(id)) {
		const err = new Error(`Valor inválido para ${fieldName}`);
		err.statusCode = 400;
		throw err;
	}
}

async function createSchedule(data, currentUser) {
	const { doctorId, dayOfWeek, startTime, endTime, slotDuration } = data;
	validateObjectId(doctorId, 'doctorId');
	// ownership: si no es admin, debe ser su propio ID
	if (currentUser?.role !== 'ADMINISTRADOR' && currentUser?.id !== doctorId) {
		const err = new Error('No puedes crear horarios para otros médicos'); err.statusCode = 403; throw err;
	}
	if (dayOfWeek < 0 || dayOfWeek > 6) {
		const err = new Error('dayOfWeek debe estar entre 0 y 6');
		err.statusCode = 400; throw err;
	}
	try { parseTimeToMinutes(startTime); parseTimeToMinutes(endTime); } catch (e) { e.statusCode = 400; throw e; }
	if (slotDuration && slotDuration <= 0) {
		const err = new Error('slotDuration debe ser > 0'); err.statusCode = 400; throw err;
	}
	const startM = parseTimeToMinutes(startTime);
	const endM = parseTimeToMinutes(endTime);
	if (endM <= startM) { const err = new Error('endTime debe ser mayor que startTime'); err.statusCode = 400; throw err; }

	// Validar solapamiento con horarios existentes
	const existing = await prisma.schedule.findMany({ where: { doctorId, dayOfWeek, isActive: true } });
	for (const s of existing) {
		const sStart = parseTimeToMinutes(s.startTime);
		const sEnd = parseTimeToMinutes(s.endTime);
		if (isOverlap(startM, endM, sStart, sEnd)) {
			const err = new Error('El horario se solapa con uno existente');
			err.statusCode = 409; throw err;
		}
	}

	const schedule = await prisma.schedule.create({ data: { doctorId, dayOfWeek, startTime, endTime, slotDuration: slotDuration || 30 } });
	return schedule;
}

async function getDoctorSchedules(doctorId, currentUser) {
	validateObjectId(doctorId, 'doctorId');
	if (currentUser?.role !== 'ADMINISTRADOR' && currentUser?.id !== doctorId) {
		const err = new Error('No puedes ver horarios de otros médicos'); err.statusCode = 403; throw err;
	}
	return prisma.schedule.findMany({ where: { doctorId }, include: { blockedSlots: true } });
}

async function updateSchedule(id, updates, currentUser) {
	validateObjectId(id, 'id');
	const schedule = await prisma.schedule.findUnique({ where: { id } });
	if (!schedule) { const err = new Error('Horario no encontrado'); err.statusCode = 404; throw err; }
	if (currentUser?.role !== 'ADMINISTRADOR' && currentUser?.id !== schedule.doctorId) {
		const err = new Error('No puedes actualizar horarios de otros médicos'); err.statusCode = 403; throw err;
	}

	// Si se cambian horas, validar que no solape con otros
	const newStart = updates.startTime || schedule.startTime;
	const newEnd = updates.endTime || schedule.endTime;
	try { parseTimeToMinutes(newStart); parseTimeToMinutes(newEnd); } catch (e) { e.statusCode = 400; throw e; }
	const nStartM = parseTimeToMinutes(newStart);
	const nEndM = parseTimeToMinutes(newEnd);
	if (nEndM <= nStartM) { const err = new Error('endTime debe ser mayor que startTime'); err.statusCode = 400; throw err; }
	const others = await prisma.schedule.findMany({ where: { doctorId: schedule.doctorId, dayOfWeek: schedule.dayOfWeek, id: { not: id }, isActive: true } });
	for (const s of others) {
		const sStart = parseTimeToMinutes(s.startTime);
		const sEnd = parseTimeToMinutes(s.endTime);
		if (isOverlap(nStartM, nEndM, sStart, sEnd)) { const err = new Error('Nuevo rango se solapa con otro horario'); err.statusCode = 409; throw err; }
	}

	return prisma.schedule.update({ where: { id }, data: updates });
}

async function listDoctorAppointments(doctorId, currentUser) {
	validateObjectId(doctorId, 'doctorId');
	if (currentUser?.role !== 'ADMINISTRADOR' && currentUser?.id !== doctorId) {
		const err = new Error('No puedes ver citas de otros médicos'); err.statusCode = 403; throw err;
	}
	return prisma.appointment.findMany({ where: { doctorId }, orderBy: { appointmentDate: 'asc' } });
}

async function getAvailability(doctorId, dateISO) {
	validateObjectId(doctorId, 'doctorId');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) { const err = new Error('Formato de fecha inválido (YYYY-MM-DD)'); err.statusCode = 400; throw err; }
	const date = new Date(`${dateISO}T00:00:00.000Z`);
	const dayOfWeek = date.getUTCDay();
	const schedules = await prisma.schedule.findMany({ where: { doctorId, dayOfWeek, isActive: true }, include: { blockedSlots: true } });
	if (!schedules.length) return [];

	const dayStart = new Date(date);
	const dayEnd = new Date(date);
	dayEnd.setUTCHours(23,59,59,999);

	// Appointments del día
	const appointments = await prisma.appointment.findMany({
		where: {
			doctorId,
			appointmentDate: { gte: dayStart, lte: dayEnd },
			status: { notIn: ['CANCELLED', 'NO_SHOW'] },
		},
	});

	const taken = new Set();
	for (const ap of appointments) {
		const dt = ap.appointmentDate; // ya es Date
		const hh = dt.getUTCHours().toString().padStart(2,'0');
		const mm = dt.getUTCMinutes().toString().padStart(2,'0');
		taken.add(`${hh}:${mm}`);
	}

	// Construir bloqueos
	const blockedRanges = [];
	for (const sch of schedules) {
		for (const b of sch.blockedSlots) {
			if (b.blockedDate.toISOString().startsWith(dateISO)) {
				blockedRanges.push({
					start: parseTimeToMinutes(b.startTime),
					end: parseTimeToMinutes(b.endTime),
				});
			}
		}
	}

	const availability = [];
	for (const sch of schedules) {
		const slots = generateSlots(sch.startTime, sch.endTime, sch.slotDuration);
		for (const slot of slots) {
			const slotM = parseTimeToMinutes(slot);
			let available = true;
			let reason = undefined;
			if (taken.has(slot)) { available = false; reason = 'APPOINTMENT'; }
			else {
				for (const br of blockedRanges) {
					if (slotM >= br.start && slotM < br.end) { available = false; reason = 'BLOCKED'; break; }
				}
			}
			availability.push({ time: slot, available, reason });
		}
	}

	return availability.sort((a,b)=> a.time.localeCompare(b.time));
}

module.exports = {
	createSchedule,
	getDoctorSchedules,
	updateSchedule,
	listDoctorAppointments,
	getAvailability,
};
