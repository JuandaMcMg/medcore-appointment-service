const service = require('../services/scheduleService');

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
		const updated = await service.updateSchedule(id, req.body, req.user);
		send(res, updated);
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
