const { PrismaClient, QueueStatus } = require('../generated/prisma'); // <- ajusta la ruta si tu build genera en otro lugar
const prisma = new PrismaClient();

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}
function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23,59,59,999);
  return x;
}

async function averageServiceMinutes(doctorId) {
  // Últimos 50 completados con tiempos válidos
  const completed = await prisma.queueTicket.findMany({
    where: {
      doctorId,
      status: 'COMPLETED',
      startedAt: { not: null },
      completedAt: { not: null },
    },
    orderBy: { completedAt: 'desc' },
    take: 50,
    select: { startedAt: true, completedAt: true }
  });

  if (!completed.length) return 15; // fallback (min)
  const mins = completed.map(t => (t.completedAt - t.startedAt) / (1000*60)).filter(n => n > 0);
  if (!mins.length) return 15;
  const avg = mins.reduce((a,b)=>a+b,0) / mins.length;
  return Math.max(5, Math.round(avg)); // mínimo razonable 5 min
}

async function nextTicketNumberToday(doctorId) {
  const sod = startOfDay();
  const eod = endOfDay();

  const last = await prisma.queueTicket.findFirst({
    where: { doctorId, queueDate: { gte: sod, lte: eod } },
    orderBy: [{ ticketNumber: 'desc' }, { createdAt: 'desc' }],
    select: { ticketNumber: true }
  });

  return (last?.ticketNumber || 0) + 1;
}

async function countAhead(doctorId, createdAt) {
  const sod = startOfDay(createdAt || new Date());
  const eod = endOfDay(createdAt || new Date());
  const n = await prisma.queueTicket.count({
    where: {
      doctorId,
      queueDate: { gte: sod, lte: eod },
      status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] },
      createdAt: { lt: createdAt } // los que entraron antes
    }
  });
  return n;
}

/* Asegura que el Doctor no tenga más de 10 turnos y no este completado
async function queuedoctorLimit({ doctorId }) {
  const count = await prisma.queueTicket.count({
	where: {
		doctorId,
		status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] }
	}
  });
  console.log(`El doctor tiene ${count} pacientes en la cola de espera`);
  if (count >= 5 ) {
	  const error = new Error(
      error.statusCode=429,
      message='Cola llena: El doctor ya tiene el número máximo de pacientes en espera');
    throw error;
	}
}*/

exports.joinQueue = async ({ actorId, doctorId, patientId, appointmentId }) => {
  const sod = startOfDay();
  const eod = endOfDay();

  // =============================
  // 1. Buscar ticket existente
  // =============================
  const exists = await prisma.queueTicket.findFirst({
    where: {
      doctorId,
      patientId,
      queueDate: { gte: sod, lte: eod },
      status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] }
    },
    select: { id: true, status: true, ticketNumber: true }
  });

  // =============================
  // 2. Función para CONFIRMAR cita
  // =============================
  async function confirmAppointment() {
    if (!appointmentId) return;

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: "CONFIRMED",
        doctorId: doctorId,
      }
    });
  }

  // =============================
  // 3. CASO: Ticket duplicado
  // =============================
  if (exists) {
    // confirmar cita aunque sea duplicado
    await confirmAppointment();

    // obtener posición actual
    const posInfo = await exports.getTicketPosition({ ticketId: exists.id });

    return {
      ...posInfo,
      duplicate: true
    };
  }

  // =============================
  // 4. CASO: Crear ticket nuevo
  // =============================
  const number = await nextTicketNumberToday(doctorId);

  const ticket = await prisma.queueTicket.create({
    data: {
      doctorId,
      patientId,
      appointmentId: appointmentId || null,
      ticketNumber: number,
      queueDate: new Date(),
      status: 'WAITING'
    },
  });

  // calcular ahead y ETA
  const ahead = await countAhead(doctorId, ticket.createdAt);
  const avgMin = await averageServiceMinutes(doctorId);
  const eta = ahead * avgMin;

  // guardar estimación
  const updated = await prisma.queueTicket.update({
    where: { id: ticket.id },
    data: {
      estimatedWaitTime: eta,
      position: ahead + 1
    }
  });

  // confirmar cita cuando se crea ticket
  await confirmAppointment();

  return {
    ticketId: updated.id,
    ticketNumber: updated.ticketNumber,
    position: updated.position,
    estimatedWaitTime: updated.estimatedWaitTime,
    status: updated.status,
    duplicate: false
  };
};

exports.getDoctorCurrentQueue = async ({ doctorId, day = new Date(), includeFinished = false }) => {
  const sod = startOfDay(day);
  const eod = endOfDay(day);


  const where = {
    doctorId,
    queueDate: { gte: sod, lte: eod },
  };

  // Por defecto solo la cola “activa”
  if (!includeFinished) {
    where.status = { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] };
  }

  const [tickets, avgMin] = await Promise.all([
    prisma.queueTicket.findMany({
      where,
      orderBy: [{ ticketNumber: 'asc' }],
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        patientId: true,
        appointmentId: true,
        queueDate: true,
        createdAt: true,
        calledAt: true,
        startedAt: true,
        completedAt: true,
        position: true,
        estimatedWaitTime: true,
      }
    }),
    averageServiceMinutes(doctorId)
  ]);

  const now = new Date();

  // calcular cuánto tiempo ha esperado cada ticket
  const queue = tickets.map((t) => {
    const base = t.queueDate || t.createdAt; // cuándo entró a la cola

    let endRef = now;
    if (t.status === 'WAITING') {
      endRef = now;                       // sigue esperando
    } else if (t.status === 'CALLED') {
      endRef = t.calledAt || now;         // espera hasta que lo llamaron
    } else if (t.status === 'IN_PROGRESS') {
      endRef = t.startedAt || now;        // espera hasta que empezó la atención
    } else {
      // COMPLETED / CANCELLED / NO_SHOW: esperamos hasta que salió del flujo
      endRef = t.startedAt || t.calledAt || t.completedAt || now;
    }

    let waitingMinutes = null;
    if (base) {
      waitingMinutes = Math.max(
        0,
        Math.round((endRef.getTime() - base.getTime()) / (1000 * 60))
      );
    }

    return {
      ...t,
      waitingMinutes, //tiempo que ha esperado esa persona
    };
  });

  return {
    doctorId,
    date: sod,
    averageServiceMinutes: avgMin,
    size: queue.length,
    queue
  };
};

exports.callNextForDoctor = async ({ doctorId, actorId }) => {
  const sod = startOfDay(); const eod = endOfDay();

  // Tomar el primer WAITING por número de ticket
  const next = await prisma.queueTicket.findFirst({
    where: {
      doctorId,
      queueDate: { gte: sod, lte: eod },
      status: 'WAITING'
    },
    orderBy: [{ ticketNumber: 'asc' }]
  });

  if (!next) throw { code: 'EMPTY_QUEUE', message: 'No hay pacientes en espera', statusCode: 404 };

  // marcar como CALLED; si el médico inicia, podría ponerse IN_PROGRESS después
  const called = await prisma.queueTicket.update({
    where: { id: next.id },
    data: { status: 'CALLED', calledAt: new Date() }
  });

  // Recalcular posiciones/ETA del resto
  const rest = await prisma.queueTicket.findMany({
    where: {
      doctorId,
      queueDate: { gte: sod, lte: eod },
      status: { in: ['WAITING'] }
    },
    orderBy: [{ ticketNumber: 'asc' }]
  });

  const avgMin = await averageServiceMinutes(doctorId);
  await Promise.all(rest.map((t, idx) =>
    prisma.queueTicket.update({
      where: { id: t.id },
      data: { position: idx + 2, estimatedWaitTime: (idx + 1) * avgMin }
    })
  ));

  return { ticketId: called.id, ticketNumber: called.ticketNumber, status: called.status, calledAt: called.calledAt };
};

exports.completeTicket = async ({ ticketId, actorId }) => {
  // Si aún no estaba "IN_PROGRESS", marcamos inicio ahora
  const current = await prisma.queueTicket.findUnique({ where: { id: ticketId }});
  if (!current) throw { code: 'TICKET_NOT_FOUND', message: 'Ticket no existe', statusCode: 404 };

  const now = new Date();
  const startedAt = current.startedAt || current.calledAt || now;

  const done = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: { status: 'COMPLETED', startedAt, completedAt: now }
  });

  // Ajustar posiciones del resto (una persona menos delante)
  const sod = startOfDay(); const eod = endOfDay();
  const avgMin = await averageServiceMinutes(done.doctorId);

  const waiting = await prisma.queueTicket.findMany({
    where: {
      doctorId: done.doctorId,
      queueDate: { gte: sod, lte: eod },
      status: { in: ['WAITING'] }
    },
    orderBy: [{ ticketNumber: 'asc' }]
  });

  await Promise.all(waiting.map((t, idx) =>
    prisma.queueTicket.update({
      where: { id: t.id },
      data: { position: idx + 1, estimatedWaitTime: idx * avgMin }
    })
  ));

  return { ticketId: done.id, status: done.status, completedAt: done.completedAt };
};

exports.getTicketPosition = async ({ ticketId }) => {
  const t = await prisma.queueTicket.findUnique({
    where: { id: ticketId },
    include: {
      appointment: {
        select: { status: true }
      }
    }
  });

  if (!t) throw { code: 'TICKET_NOT_FOUND', message: 'Ticket no existe', statusCode: 404 };

  const ahead = await countAhead(t.doctorId, t.createdAt);
  const avgMin = await averageServiceMinutes(t.doctorId);

  const position = Math.max(1, (t.status === 'WAITING') ? ahead + 1 : 1);
  const eta = (position - 1) * avgMin;

  await prisma.queueTicket.update({
    where: { id: t.id },
    data: { position, estimatedWaitTime: eta }
  });

  return {
    ticketId: t.id,
    doctorId: t.doctorId,
    ticketNumber: t.ticketNumber,
    status: t.status,                     // estado del ticket (WAITING, CALLED, etc.)
    appointmentStatus: t.appointment?.status || null,   // <<--- AGREGADO
    position,
    estimatedWaitTime: eta
  };
};

//**
exports.callTicket = async ({ ticketId }) => {
  const current = await prisma.queueTicket.findUnique({ where: { id: ticketId }});
  if (!current) throw { code: 'TICKET_NOT_FOUND', message: 'Ticket no existe', statusCode: 404 };

  const now = new Date();

  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: {
      status: 'CALLED',
      calledAt: now
    }
  });

  return {
    ticketId: updated.id,
    status: updated.status,
    calledAt: updated.calledAt
  };
};



exports.startTicket = async ({ ticketId }) => {
  const current = await prisma.queueTicket.findUnique({ where: { id: ticketId }});
  if (!current) throw { code: 'TICKET_NOT_FOUND', message: 'Ticket no existe', statusCode: 404 };

  const now = new Date();

  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: {
      status: 'IN_PROGRESS',
      startedAt: now
    }
  });

  return {
    ticketId: updated.id,
    status: updated.status,
    startedAt: updated.startedAt
  };
};

exports.markNoShow = async ({ ticketId, actorId }) => {
  // 1. Verificar que el ticket exista
  const current = await prisma.queueTicket.findUnique({
    where: { id: ticketId }
  });

  if (!current) {
    throw {
      code: 'TICKET_NOT_FOUND',
      message: 'Ticket no existe',
      statusCode: 404
    };
  }

  // 2. Fecha/hora de marcado como NO SHOW
  const now = new Date();

  // 3. Actualizar ticket a estado NO_SHOW
  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: {
      status: 'NO_SHOW',
      noShowAt: now,
      updatedBy: actorId || null
    }
  });

  // 4. Respuesta limpia
  return {
    ticketId: updated.id,
    status: updated.status,
    noShowAt: updated.noShowAt
  };
};

// queue.service.js

exports.cancelTicket = async ({ ticketId, actorId }) => {
  // 1️⃣ Verificar que el ticket exista
  const current = await prisma.queueTicket.findUnique({
    where: { id: ticketId },
  });

  if (!current) {
    throw {
      code: 'TICKET_NOT_FOUND',
      message: 'Ticket no existe',
      statusCode: 404,
    };
  }

  // 2️⃣ Fecha/hora de cancelación
  const now = new Date();

  // 3️⃣ Actualizar ticket a estado CANCELLED
  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      updatedBy: actorId || null,
    },
  });

  // 4️⃣ Respuesta limpia
  return {
    ticketId: updated.id,
    status: updated.status,
    cancelledAt: updated.cancelledAt,
  };
};


exports.CancelTicket = async ({ ticketId }) => {  
const t = await prisma.queueTicket.findUnique({ where: { id: ticketId }});
  if (!t) throw { code: 'TICKET_NOT_FOUND', message: 'Ticket no existe', statusCode: 404 };

  const canceled = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: { status: 'CANCELLED', completedAt: new Date() }
  }); 

  return { ticketId: canceled.id, status: canceled.status, completedAt: canceled.completedAt };
};