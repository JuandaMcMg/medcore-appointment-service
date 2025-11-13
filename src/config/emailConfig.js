const nodemailer = require("nodemailer");
const path = require("path");
const time = require("../utils/time");
const fs = require("fs");

// Configuración de Nodemailer
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,           // 465 = SSL/TLS
  secure: true,        // true para 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function line(label, value) {
  if (value == null || value === "") return "";
  return `<p style="margin:4px 0; color:#333;">
    <strong>${label}:</strong>
    <span style="color:#111;">${value}</span>
  </p>`;
}

function baseWrap(content, tone = "green") {
  // tonos
  const gradients = {
    green: "linear-gradient(135deg, #E6F9F0, #D0F2E0)",
    blue: "linear-gradient(135deg, #E6F5FB, #D0EBF9)",
    red: "linear-gradient(135deg, #FDE8E8, #FAD1D1)",
  };
  return `
  <div style="font-family: Arial, sans-serif; background-color: #F9FAFB; padding: 30px;">
    <div style="max-width: 600px; margin: 0 auto; background: ${gradients[tone] || gradients.green}; border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,0.1); padding: 30px;">
      <div style="text-align:center;">
        <img src="cid:medcore-logo" alt="MedCore Logo" style="width: 80px; margin-bottom: 16px;" />
      </div>
      ${content}
      <p style="font-size: 12px; color: #777; margin-top: 24px; text-align:center;">
        © 2025 MedCore. Todos los derechos reservados.
      </p>
    </div>
  </div>`;
}

// Plantillas HTML de citas
function NewAppointmentTemplate(vars) {
  const {
    patientName = "Paciente",
    doctorName,
    specialtyName,
    location,
    appointmentDateISO,
    durationMin = 30,
    reason,
    ticketNumber,
  } = vars;

  const chip = `
    <div style="background: linear-gradient(90deg, #88D4AB, #6ECF97); color:#fff; padding: 14px; border-radius: 8px; margin: 12px 0;">
      <div style="font-size:16px;"><strong>${time.formatDateTime(appointmentDateISO)}</strong></div>
      <div style="font-size:13px; opacity:0.95;">Duración: ${time.formatDuration(durationMin)}</div>
    </div>`;

  const body = `
    <h2 style="color:#222; text-align:center; margin:0 0 8px;">¡Cita creada exitosamente!</h2>
    <p style="color:#444; text-align:center; margin:0 0 16px;">Hola <strong>${patientName}</strong>, tu cita ha sido programada.</p>
    ${chip}
    ${line("Médico", doctorName)}
    ${line("Especialidad", specialtyName)}
    ${line("Lugar", location)}
    ${line("Motivo", reason)}
    ${line("Turno", ticketNumber ? `#${String(ticketNumber).padStart(3, "0")}` : "")}
    <p style="color:#555; margin-top:12px;">Por favor llega 10 minutos antes. Si necesitas reprogramar o cancelar, puedes hacerlo desde la plataforma.</p>
  `;
  return baseWrap(body, "green");
}

function CancelledAppointmentTempleate(vars) {
  const {
    patientName = "Paciente",
    doctorName,
    specialtyName,
    location,
    appointmentDateISO,
    reason,
    cancellationReason,
  } = vars;

  const chip = `
    <div style="background: linear-gradient(90deg, #FCA5A5, #F87171); color:#fff; padding: 14px; border-radius: 8px; margin: 12px 0;">
      <div style="font-size:16px;"><strong>${time.formatDateTime(appointmentDateISO)}</strong></div>
    </div>`;

  const body = `
    <h2 style="color:#B91C1C; text-align:center; margin:0 0 8px;">Tu cita ha sido cancelada</h2>
    <p style="color:#444; text-align:center; margin:0 0 16px;">Hola <strong>${patientName}</strong>, la siguiente cita fue cancelada.</p>
    ${chip}
    ${line("Médico", doctorName)}
    ${line("Especialidad", specialtyName)}
    ${line("Lugar", location)}
    ${line("Motivo original", reason)}
    ${line("Motivo de cancelación", cancellationReason)}
  `;
  return baseWrap(body, "red");
}

function RescheduledAppointmentTemplate(vars) {
  const {
    patientName = "Paciente",
    doctorName,
    specialtyName,
    location,
    appointmentDateISO,
    previousDateISO, // requerido para mostrar "anterior"
    durationMin = 30,
    reason,
  } = vars;

  const prev = line("Fecha y hora anterior", previousDateISO ? formatDateTime(previousDateISO) : "");
  const chip = `
    <div style="background: linear-gradient(90deg, #7DC3E8, #5BB0DB); color:#fff; padding: 14px; border-radius: 8px; margin: 12px 0;">
      <div style="font-size:16px;"><strong>${time.formatDateTime(appointmentDateISO)}</strong></div>
      <div style="font-size:13px; opacity:0.95;">Duración: ${time.formatDuration(durationMin)}</div>
    </div>`;

  const body = `
    <h2 style="color:#1F2937; text-align:center; margin:0 0 8px;">Tu cita fue reagendada</h2>
    <p style="color:#444; text-align:center; margin:0 0 16px;">Hola <strong>${patientName}</strong>, hemos ajustado la fecha y hora de tu cita.</p>
    ${prev}
    ${chip}
    ${line("Médico", doctorName)}
    ${line("Especialidad", specialtyName)}
    ${line("Lugar", location)}
    ${line("Motivo", reason)}
  `;
  return baseWrap(body, "blue");
}

function ReminderAppointmentTemplate(vars) {
  const {
    patientName = "Paciente",
    doctorName,
    specialtyName,
    location,
    appointmentDateISO,
    durationMin = 30,
    reason,
    hoursBefore = 24,
  } = vars;

  const chip = `
    <div style="background: linear-gradient(90deg, #88D4AB, #6ECF97); color:#fff; padding: 14px; border-radius: 8px; margin: 12px 0;">
      <div style="font-size:16px;"><strong>${time.formatDateTime(appointmentDateISO)}</strong></div>
      <div style="font-size:13px; opacity:0.95;">Duración: ${time.formatDuration(durationMin)}</div>
    </div>`;

  const body = `
    <h2 style="color:#1F2937; text-align:center; margin:0 0 8px;">Recordatorio de cita</h2>
    <p style="color:#444; text-align:center; margin:0 0 16px;">Hola <strong>${patientName}</strong>, este es un recordatorio ${hoursBefore ? `(${hoursBefore} h antes)` : ""} de tu cita.</p>
    ${chip}
    ${line("Médico", doctorName)}
    ${line("Especialidad", specialtyName)}
    ${line("Lugar", location)}
    ${line("Motivo", reason)}
  `;
  return baseWrap(body, "green");
}


function mapAppointmentToTemplateVars(appointment, extras = {}) {
  const {
    patientName = "Paciente",
    doctorName = "Médico",
    specialtyName = null,
    previousDateISO = null,
    hoursBefore = 24,
    ticketNumber = null,
    cancellationReason = null,
  } = extras;

  return {
    patientName,
    doctorName,
    specialtyName,
    appointmentDateISO:
    appointment?.appointmentDate?.toISOString?.() || appointment?.appointmentDate,
    durationMin: appointment?.duration ?? 30,
    reason: appointment?.reason || null,
    ticketNumber,
    previousDateISO,
    hoursBefore,
    cancellationReason,
  };
}

// Función para enviar emai de nueva cita 
const sendNewAppointmentEmail = async (email, userId, appointment, extras = {}) => {
    // Ruta al archivo del logo
    const logoPath = path.join(__dirname, '../../public/images/logo.png');
    const vars = mapAppointmentToTemplateVars(appointment, extras);
    const mailOptions = {
        from: process.env.SMTP_USER,
        to: email, // Aquí debería ir el email del usuario
        subject: 'Nueva Cita Programada',
        html : NewAppointmentTemplate('newAppointment', vars),
        attachments: [
            {
                filename: 'logo.png',
                path: logoPath,
                cid: 'logo' // same cid value as in the html img src
            }
        ]
    };
    try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Correo de creacion de citas enviado:", info.response);
    return { success: true, info };
  } catch (error) {
    console.error("❌ Error al enviar email de creacion de citas :", error);
    return { success: false, error };
  }
}
// Funcion para enviar email de cita cancelada 
const sendCancelledAppointmentEmail = async (email, appointment, extras = {}) => {
    // Ruta al archivo del logo
    const logoPath = path.join(__dirname, '../../public/images/logo.png');
    const vars = mapAppointmentToTemplateVars(appointment, extras);
    const mailOptions = {
        from: process.env.SMTP_USER,
        to: email, // Aquí debería ir el email del usuario
        subject: 'Cita Cancelada Correctamente',
        html : CancelledAppointmentTemplate('cancelledAppointment', vars),
        attachments: [
            {
                filename: 'logo.png',
                path: logoPath,
                cid: 'logo' // same cid value as in the html img src
            }
        ]
    };
      try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Correo de cancelación de citas enviado:", info.response);
    return { success: true, info };
  } catch (error) {
    console.error("❌ Error al enviar email de cancelación de citas :", error);
    return { success: false, error };
  }
}
// Funcipon para enviar email Reagendamiento automático si hay conflicto de horario
// Reagendamiento → notificación con nueva fecha y hora
const sendRescheduledAppointmentEmail = async (email, newAppointment, previousDateISO, extras = {}) => {
    // Ruta al archivo del logo
    const logoPath = path.join(__dirname, '../../public/images/logo.png');
    const vars = mapAppointmentToTemplateVars(newAppointment, {...extras, previousDateISO });
    const mailOptions = {
        from: process.env.SMTP_USER,
        to: email, // Aquí debería ir el email del usuario
        subject: 'Cita Reagendada Correctamente',
        html : RescheduledAppointmentTemplate('rescheduledAppointment', vars),
        attachments: [
            {
                filename: 'logo.png',
                path: logoPath,
                cid: 'logo' // same cid value as in the html img src
            }
        ]
    };
      try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Correo de reagendamiento de citas enviado:", info.response);
    return { success: true, info };
  } catch (error) {
    console.error("❌ Error al enviar email de reagendamiento de citas :", error);
    return { success: false, error };
  }
}
//Funcion para enviar email de recordatorio automático 24h antes de la cita
const sendRecordatoryAppointmentEmail = async (email, appointment, hoursBefore=24, extras = {}) => {
    // Ruta al archivo del logo
    const logoPath = path.join(__dirname, '../../public/images/logo.png');
    const vars = mapAppointmentToTemplateVars(appointment, {...extras, hoursBefore });
    const mailOptions = {
        from: process.env.SMTP_USER,
        to: email, // Aquí debería ir el email del usuario
        subject: 'Recordatorio de Cita Próxima',
        html : loadEmailTemplate('recordatoryAppointment', appointmentDetails),
        attachments: [
            {
                filename: 'logo.png',
                path: logoPath,
                cid: 'logo' // same cid value as in the html img src
            }
        ]
    };
      try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Correo de recordatorio de citas enviado:", info.response);
    return { success: true, info };
  } catch (error) {
    console.error("❌ Error al enviar email de recordatorio de citas :", error);
    return { success: false, error };
  }
}

module.exports = {
    sendNewAppointmentEmail,
    sendCancelledAppointmentEmail,
    sendRescheduledAppointmentEmail,
    sendRecordatoryAppointmentEmail
};