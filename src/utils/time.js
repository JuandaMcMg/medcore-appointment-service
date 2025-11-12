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

//FORMATEO PARA ENVIO DE NOTIFICACIONES

const TZ = 'America/Bogota';
const LOCALE = 'es-CO';

function formatDuration(minutes = 30) {
  if (!minutes || minutes <= 0) return '30 min';
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? '1 día' : `${days} días`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return `${minutes} min`;
}

function formatDateTime(iso, { locale = LOCALE, timeZone = TZ } = {}) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d).replace(',', '');
}

// Útil si luego adjuntas .ics o haces cálculos
function addMinutes(isoOrDate, minutes) {
  const d = new Date(isoOrDate);
  return new Date(d.getTime() + minutes * 60000);
}

module.exports = {
	parseTimeToMinutes,
	minutesToHHMM,
	generateSlots,
	isOverlap,
	formatDuration,
	formatDateTime,
	addMinutes,
};
