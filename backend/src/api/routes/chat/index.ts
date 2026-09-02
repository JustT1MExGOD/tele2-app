import { FastifyInstance } from 'fastify';
import { registerChatMessageRoutes } from './messages.js';
import { registerChatAttachmentRoutes } from './attachments.js';
import { registerChatWsRoutes } from './ws.js';

export async function registerChatRoutes(app: FastifyInstance) {
  await registerChatMessageRoutes(app);
  await registerChatAttachmentRoutes(app);
  await registerChatWsRoutes(app);
}
