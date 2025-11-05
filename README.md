# MedCore Appointment Service

Microservicio para la gestión de citas médicas, horarios y colas de espera.

## 🎯 Funcionalidades Planeadas

- **Appointments**: Gestión completa de citas médicas
- **Schedules**: Administración de horarios de disponibilidad
- **Queue Management**: Sistema de turnos y cola de espera
- **Notifications**: Notificaciones automáticas

## 🏗️ Estructura

```
medcore-appointment-service/
├── prisma/
│   └── schema.prisma          # Modelos de datos
├── src/
│   ├── controllers/           # Controladores REST
│   ├── services/              # Lógica de negocio
│   ├── middlewares/           # Middlewares
│   ├── routes/                # Rutas de Express
│   ├── database/              # Configuración de BD
│   └── index.js               # Punto de entrada
└── package.json
```

## 🚀 Instalación

```bash
# Instalar dependencias
npm install

# Generar Prisma Client
npx prisma generate

# Iniciar en desarrollo
npm run dev
```

## � Variables de Entorno

Ver archivo `.env` para configuración.

## 🛠️ Tecnologías

- Node.js + Express.js
- Prisma ORM
- MongoDB
- JWT

## 📄 Licencia

MedCore © 2025
