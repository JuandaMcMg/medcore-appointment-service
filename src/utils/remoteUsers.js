// src/utils/remoteUsers.js
const axios = require('axios');

const BASE = (process.env.USER_SERVICE_URL || 'http://localhost:3003').replace(/\/+$/, '');

function normContact(obj) {
  if (!obj) return null;
  const email = obj.email || null;
  const fullName =
    obj.fullname ||
    [obj.firstName || obj.first_name, obj.lastName || obj.last_name].filter(Boolean).join(' ') ||
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
    console.warn(`[remoteUsers] ${st || 'ERR'} GET ${url}`, e?.response?.data || e.message);
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
    // data.user o data directo
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

    // tu handler getById devuelve patient con .user
    const patient = data.patient || data.data || data;
    if (!patient || !patient.user) continue;

    const user = patient.user;
    const contact = normContact(user);

    return {
      email: contact.email,
      fullName: contact.fullName,   // 👈 nombre normalizado
      status: patient.status || null,
      patientId: patient.id,
      userId: patient.userId,
    };
  }

  return null;
}

/*
async function getPatientInfo(patientId) {
  const res = await axios.get($(`${BASE}/users/patients/${patientId}`))
  const patient = res.data;
  return{
    patientId: patient.id,
    userId: patient.userId,
    fullname: patient.user.fullname,
    email: patient.user.email,
    phone: patient.user.phone,
    gender: patient.gender,
    age: patient.age,
  }
  
}
  */

module.exports = {
  getUserContactByUserId,
  getPatientContactByPatientId,
  //getPatientInfo
};
