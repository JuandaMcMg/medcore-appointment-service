// Utilidades de tiempo para manejo de horarios y slots

function parseTimeToMinutes(hhmm) {
	if (!/^\d{2}:\d{2}$/.test(hhmm)) throw new Error('Formato de hora inválido, se espera HH:mm');
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + m;
}

function minutesToHHMM(minutes) {
	const h = Math.floor(minutes / 60).toString().padStart(2, '0');
	const m = (minutes % 60).toString().padStart(2, '0');
	return `${h}:${m}`;
}

function generateSlots(startTime, endTime, slotDuration) {
	const start = parseTimeToMinutes(startTime);
	const end = parseTimeToMinutes(endTime);
	if (end <= start) throw new Error('endTime debe ser mayor que startTime');
	const slots = [];
	for (let cursor = start; cursor + slotDuration <= end; cursor += slotDuration) {
		slots.push(minutesToHHMM(cursor));
	}
	return slots;
}

function isOverlap(aStart, aEnd, bStart, bEnd) {
	return aStart < bEnd && bStart < aEnd; // rango se solapa
}

module.exports = {
	parseTimeToMinutes,
	minutesToHHMM,
	generateSlots,
	isOverlap,
};
