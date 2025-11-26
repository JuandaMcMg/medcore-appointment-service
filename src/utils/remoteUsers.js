// src/utils/remoteUsers.js
const axios = require('axios');

const BASE = (process.env.USER_SERVICE_URL || 'http://localhost:3003').replace(/\/+$/, '');

function normContact(obj) {
  if (!obj) return null;
  const email = obj.email || null;
  const fullName =
    obj.fullname ||
    [obj.firstName || obj.first_name, obj.lastName || obj.last_name]
      .filter(Boolean)
      .join(' ') ||
    obj.name ||
    null;
  return { email, fullName };
}

async function tryGet(url, authHeader) {
  try {
    const { data } = await axios.get(url, {
      headers: authHeader ? { Authorization: authHeader } : {},
      timeout: 6000,
    });
    return data;
  } catch (e) {
    const st = e?.response?.status;
    console.warn(
      `[remoteUsers] ${st || 'ERR'} GET ${url}`,
      e?.response?.data || e.message
    );
    return null;
  }
}

/** Usuario por userId (para médicos u otros usuarios) */
async function getUserContactByUserId(userId, authHeader) {
  const candidates = [
    `${BASE}/api/v1/users/${userId}`,
    `${BASE}/users/${userId}`,
    `${BASE}/api/users/${userId}`,
  ];
  for (const url of candidates) {
    const data = await tryGet(url, authHeader);
    if (!data) continue;
    const u = data.user || data.data || data;
    const contact = normContact(u);
    if (contact?.email || contact?.fullName) return contact;
  }
  return null;
}

/** Paciente por patientId → toma email y fullname desde patient.user */
async function getPatientContactByPatientId(patientId, authHeader) {
  const candidates = [
    `${BASE}/api/v1/users/patients/${patientId}`, // ruta real del ms-users
    `${BASE}/users/patients/${patientId}`,        // backups
    `${BASE}/api/v1/patients/${patientId}`,
  ];

  for (const url of candidates) {
    const data = await tryGet(url, authHeader);
    if (!data) continue;

    const patient = data.patient || data.data || data;
    if (!patient || !patient.user) continue;

    const user = patient.user;
    const contact = normContact(user);

    return {
      email: contact.email,
      fullName: contact.fullName,
      status: patient.status || null,
      patientId: patient.id,
      userId: patient.userId,
    };
  }

  return null;
}

/**
 * Verificar si un médico tiene una cierta especialidad (por specialtyId)
 */
async function doctorHasSpecialty(doctorId, specialtyId, authHeader) {
  if (!doctorId || !specialtyId) return false;

  // 1) Intentar con GET /api/v1/users/doctors/:id
  const urlDoctor = `${BASE}/api/v1/users/doctors/${doctorId}`;
  const data = await tryGet(urlDoctor, authHeader);

  if (data) {
    const doc = data.doctor || data.data || data;
    const affiliations = doc.affiliations || doc.userDeptRoles || [];

    const has = affiliations.some(a =>
      a.specialtyId === specialtyId ||
      a.specialty?.id === specialtyId
    );

    if (has) return true;
  }

  // 2) Fallback a listado de doctores con afiliaciones
  const urlList = `${BASE}/api/v1/users/doctors-with-affiliations`;
  const dataList = await tryGet(urlList, authHeader);
  if (dataList) {
    const list = dataList.doctors || dataList.data || [];
    const doctor = list.find(d => d.id === doctorId);
    if (!doctor) return false;

    const affiliations = doctor.affiliations || doctor.userDeptRoles || [];
    const has = affiliations.some(a =>
      a.specialtyId === specialtyId ||
      a.specialty?.id === specialtyId
    );
    if (has) return true;
  }

  return false;
}

/**
 * 🔍 Obtener info de una especialidad a partir de su ID
 * usando el endpoint del user-service:
 *   GET /api/users/by-specialty?specialtyId=...
 */
async function getSpecialtyById(specialtyId, authHeader) {
  if (!specialtyId) return null;

  try {
    const { data } = await axios.get(
      `${BASE}/api/users/by-specialty`,
      {
        params: { specialtyId },
        headers: authHeader ? { Authorization: authHeader } : {},
        timeout: 6000,
      }
    );

    const doctors = data?.doctors || [];
    if (!doctors.length) {
      // No hay ningún médico con esa especialidad
      return null;
    }

    // Buscamos en los médicos la especialidad con ese ID
    for (const doctor of doctors) {
      const specs = doctor.specialties || [];
      const found = specs.find((s) => s.id === specialtyId);
      if (found) {
        return {
          id: found.id,
          name: found.name, // ya viene en mayúsculas por normUpper
        };
      }
    }

    return null;
  } catch (e) {
    console.warn(
      '[remoteUsers.getSpecialtyById] fallo:',
      e.response?.data || e.message
    );
    return null;
  }
}

module.exports = {
  getUserContactByUserId,
  getPatientContactByPatientId,
  doctorHasSpecialty,
  getSpecialtyById,
};
