// controllers/clinicalWorkflow.controller.js
const { prisma } = require("../database/database");
const users = require("../utils/remoteUsers");
const axios = require("axios");
const { startOfDay, endOfDay } = require("date-fns");

const MEDICAL_RECORDS_URL = process.env.MEDICAL_RECORD_SERICE_URL || "http://localhost:3005/api/v1"; // ajusta puerto/ruta

// GET /api/queue/doctor/:doctorId/current
// Paciente que está siendo atendido ahora mismo (CALLED o IN_PROGRESS hoy)
const getCurrentPatient = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const authHeader = req.headers.authorization || "";

    const sod = startOfDay(new Date());
    const eod = endOfDay(new Date());

    const ticket = await prisma.queueTicket.findFirst({
      where: {
        doctorId,
        queueDate: { gte: sod, lte: eod },
        status: { in: ["IN_PROGRESS", "CALLED"] },
      },
      orderBy: [{ status: "desc" }, { ticketNumber: "asc" }], // IN_PROGRESS primero
      include: {
        appointment: true,
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: "No hay paciente en atención actualmente" });
    }

    const patientContact = await users.getPatientContactByPatientId(
      ticket.patientId,
      authHeader
    );

    // Traer historia ya creada asociada a la cita
    let medicalRecord = null;
    if (ticket.appointmentId) {
      try {
        const { data } = await axios.get(
          `${MEDICAL_RECORDS_URL}/medical-records/by-appointment/${ticket.appointmentId}`,
          authHeader ? { headers: { Authorization: authHeader } } : {}
        );
        medicalRecord = data?.data || null;
      } catch (e) {
        console.warn("[getCurrentPatient] No se encontró historia asociada a la cita", e.message);
      }
    }

    return res.json({
      doctorId,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        position: ticket.position,
        estimatedWaitTime: ticket.estimatedWaitTime,
      },
      appointment: ticket.appointment || null,
      patient: patientContact || null,
      medicalRecord, // puede venir null si todavía no se ha creado
    });
  } catch (error) {
    console.error("getCurrentPatient error:", error);
    return res.status(500).json({ message: "Error obteniendo paciente actual" });
  }
};

// GET /api/queue/doctor/:doctorId/confirmed
// Lista de citas CONFIRMED del doctor (por defecto hoy en adelante)
const getConfirmedAppointments = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const authHeader = req.headers.authorization || "";

    const from = req.query.dateFrom || new Date().toISOString().slice(0, 10);
    const to = req.query.dateTo || null;

    const where = {
      doctorId,
      status: "CONFIRMED",
      appointmentDate: {},
    };

    const sod = startOfDay(new Date(from));
    where.appointmentDate.gte = sod;

    if (to) {
      const eod = endOfDay(new Date(to));
      where.appointmentDate.lte = eod;
    }

    const items = await prisma.appointment.findMany({
      where,
      orderBy: { appointmentDate: "asc" },
    });

    // Enriquecer con nombres de pacientes
    for (const appt of items) {
      appt.patientContact = await users.getPatientContactByPatientId(
        appt.patientId,
        authHeader
      );
    }

    return res.json({
      doctorId,
      total: items.length,
      items,
    });
  } catch (error) {
    console.error("getConfirmedAppointments error:", error);
    return res.status(500).json({ message: "Error listando citas confirmadas" });
  }
};

// GET /api/queue/doctor/:doctorId/history
// Historial de pacientes atendidos por el doctor (consulta al MS de historias)
const getDoctorHistory = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const authHeader = req.headers.authorization || "";

    const page = req.query.page || 1;
    const limit = req.query.limit || 20;

    const url = `${MEDICAL_RECORDS_URL}/medical-records?physicianId=${doctorId}&page=${page}&limit=${limit}`;

    const { data } = await axios.get(
      url,
      authHeader ? { headers: { Authorization: authHeader } } : {}
    );

    return res.json({
      doctorId,
      ...data,
    });
  } catch (error) {
    console.error("getDoctorHistory error:", error);
    return res.status(500).json({ message: "Error obteniendo historial del doctor" });
  }
};

module.exports = {
  getCurrentPatient,
  getConfirmedAppointments,
  getDoctorHistory,
};
