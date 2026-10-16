import { FastifyInstance } from 'fastify';
import { registerMirandaDeviceRoutes } from './devices.js';
import { registerMirandaAccountRoutes } from './accounts.js';
import { registerMirandaMessengerRoutes } from './messenger.js';
import { registerMirandaAttachmentRoutes } from './attachments.js';
import { registerMirandaWsRoutes } from './ws.js';

export async function registerMirandaRoutes(app: FastifyInstance) {
  await registerMirandaDeviceRoutes(app);
  await registerMirandaAccountRoutes(app);
  await registerMirandaMessengerRoutes(app);
  await registerMirandaAttachmentRoutes(app);
  await registerMirandaWsRoutes(app);
}
