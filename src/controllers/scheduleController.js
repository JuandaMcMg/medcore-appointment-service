const service = require('../services/scheduleService');
const { prisma } = require('../database/database');
const { computeLostWindows, rescheduleAppointmentsInWindows, rescheduleOutOfScheduleAppointments } = require('../services/reschedulerService');

function send(res, data, status=200) { res.status(status).json(data); }

exports.createSchedule = async (req, res, next) => {
	try {
		const schedule = await service.createSchedule(req.body, req.user);
		send(res, schedule, 201);
	} catch (e) { next(e); }
};

exports.getDoctorSchedules = async (req, res, next) => {
	try {
		const { doctorId } = req.params;
		const schedules = await service.getDoctorSchedules(doctorId, req.user);
		send(res, schedules);
	} catch (e) { next(e); }
};

exports.updateSchedule = async (req, res, next) => {
	try {
		const { id } = req.params;
		// capturar antiguo para calcular ventanas perdidas
		const old = await prisma.schedule.findUnique({ where: { id } });
		const updated = await service.updateSchedule(id, req.body, req.user);
		send(res, updated);

		// disparar rescheduler asíncrono
		if (old) {
			setImmediate(async () => {
				try {
					const lost = computeLostWindows(old, updated);
					if (lost.length) {
						await rescheduleAppointmentsInWindows({ doctorId: updated.doctorId, windows: lost, fromDateUTC: new Date(), horizonDays: 30 });
					}
				} catch (err) { console.error('[rescheduler:updateSchedule]', err); }
			});
		}
	} catch (e) { next(e); }
};

exports.deleteSchedule = async (req, res, next) => {
	try {
		const { id } = req.params;
		// obtener y borrar usando service (que valida ownership)
		const deleted = await service.deleteSchedule(id, req.user);
		send(res, { ok: true });

		// rescheduler: toda la ventana del horario eliminado
		if (deleted) {
			setImmediate(async () => {
				try {
					const lost = [{ dayOfWeek: deleted.dayOfWeek, start: deleted.startTime, end: deleted.endTime }];
					await rescheduleAppointmentsInWindows({ doctorId: deleted.doctorId, windows: lost, fromDateUTC: new Date(), horizonDays: 30 });
				} catch (err) { console.error('[rescheduler:deleteSchedule]', err); }
			});
		}
	} catch (e) { next(e); }
};

exports.runReschedulerForDoctor = async (req, res, next) => {
	try {
		const { doctorId } = req.params;
		if (!doctorId) { const err = new Error('doctorId requerido'); err.statusCode = 400; throw err; }
		const result = await rescheduleOutOfScheduleAppointments({ doctorId, fromDateUTC: new Date(), horizonDays: 30 });
		return send(res, { ok: true, result });
	} catch (e) { next(e); }
};

exports.listDoctorAppointments = async (req, res, next) => {
	try {
		const { doctorId } = req.params;
		const appointments = await service.listDoctorAppointments(doctorId, req.user);
		send(res, appointments);
	} catch (e) { next(e); }
};

exports.getAvailability = async (req, res, next) => {
	try {
		const { doctorId, date } = req.query;
		if (!doctorId || !date) {
			const err = new Error('Parámetros doctorId y date son requeridos'); err.statusCode = 400; throw err;
		}
		const availability = await service.getAvailability(doctorId, date);
		send(res, availability);
	} catch (e) { next(e); }
};
