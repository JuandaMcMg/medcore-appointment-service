const mongoose = require("mongoose");
const { PrismaClient } = require("../generated/prisma");

const prisma = new PrismaClient();

// Configuración de conexión a MongoDB
const connectDatabase = async () => {
  try {
    const DATABASE_URL = process.env.DATABASE_URL;

    if (!DATABASE_URL) {
      throw new Error("Variable de entorno DATABASE_URL no definida");
    }

    await mongoose.connect(DATABASE_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("Conexión a MongoDB establecida correctamente");

    // Verificar la conexión a Prisma
    await prisma.$connect();
    console.log("Conexión a Prisma establecida correctamente");
  } catch (error) {
    console.error("Error al conectar a la base de datos:", error.message);
    process.exit(1);
  }
};

// Función para cerrar la conexión (útil para pruebas)
const closeDatabase = async () => {
  try {
    await mongoose.disconnect();
    await prisma.$disconnect();
    console.log("Conexión a la base de datos cerrada correctamente");
  } catch (error) {
    console.error("Error al cerrar la conexión a la base de datos:", error.message);
  }
};

module.exports = {
  connectDatabase,
  closeDatabase,
  prisma
};