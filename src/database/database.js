// Prisma MongoDB connection (sin dependencia de Mongoose)
const { PrismaClient } = require('../generated/prisma');

const LOG_LEVEL = process.env.NODE_ENV === 'development'
  ? ['query', 'info', 'warn', 'error']
  : ['error'];

const prisma = new PrismaClient({ log: LOG_LEVEL });
let isConnected = false;

async function connectDatabase() {
  if (isConnected) return true;
  try {
    await prisma.$connect();
    try { if (prisma.$runCommandRaw) await prisma.$runCommandRaw({ ping: 1 }); } catch (_) {}
    isConnected = true;
    console.log('✓ Database (Prisma MongoDB) conectada');
    return true;
  } catch (err) {
    console.error('✗ Error de conexión a la base de datos:', err.message || err);
    process.exit(1);
  }
}

async function disconnectDatabase() {
  try { await prisma.$disconnect(); } catch (_) {} finally {
    isConnected = false;
    console.log('Database desconectada');
  }
}

process.on('SIGINT', async () => { await disconnectDatabase(); process.exit(0); });
process.on('SIGTERM', async () => { await disconnectDatabase(); process.exit(0); });
process.on('beforeExit', async () => { await disconnectDatabase(); });

module.exports = { prisma, connectDatabase, disconnectDatabase };