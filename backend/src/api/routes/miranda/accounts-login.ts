/**
 * T2 Miranda, этап B (вариант B) — собственный вход для аккаунтов точек/
 * касс (телефон+пароль), независимый от employee_id/t2_session. Зеркало
 * /auth/login (api/routes/auth/session.ts): тот же dual rate-limit,
 * timing-safe сравнение с DUMMY_PASSWORD_HASH, аудит по хэшу телефона —
 * но пишет в отдельную cookie/таблицу (corporate_account_sessions), без
 * MFA и без очереди device-approval (осознанное решение продукта, §B
 * плана).
 */
import { createHash } from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { verifyPassword, DUMMY_PASSWORD_HASH } from '../../../auth/password.js';
import { normalizePhone } from '../../../utils/phone.js';
import * as mirandaRepo from '../../../data/repositories/miranda-accounts.js';
import * as pointSessionsRepo from '../../../data/repositories/corporate-account-sessions.js';
import { record as recordAudit } from '../../../data/repositories/audit.js';
import { consume, ipDimension, identityDimension } from '../../../security/rate-limit.js';

const isProd = () => process.env.RAILWAY_ENVIRONMENT === 'production';

const LoginBody = Type.Object({
  phone: Type.String({ minLength: 5, maxLength: 32 }),
  password: Type.String({ minLength: 1, maxLength: 200 })
});
type LoginBody = Static<typeof LoginBody>;

function deviceFromRequest(request: FastifyRequest): { userAgent: string | null; ip: string | null } {
  return {
    userAgent: (request.headers['user-agent'] as string) || null,
    ip: request.ip || null
  };
}

function setPointSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(pointSessionsRepo.POINT_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60
  });
}

export async function registerMirandaAccountLoginRoutes(app: FastifyInstance) {
  app.post(
    '/miranda/accounts/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (req: any) => {
            const raw = req.body?.phone;
            const norm = raw ? normalizePhone(String(raw)) : null;
            return norm ? `miranda_login:${createHash('sha256').update(norm).digest('hex')}` : req.ip;
          }
        }
      },
      schema: { body: LoginBody }
    },
    async (request, reply) => {
      const b = request.body as LoginBody;
      const phone = normalizePhone(String(b.phone || ''));

      const phoneHash = phone
        ? createHash('sha256').update(phone).digest('hex')
        : createHash('sha256').update('unknown').digest('hex');
      const rl = await consume(
        [
          ipDimension('miranda_login', request.ip, 30, 300),
          identityDimension('miranda_login', phoneHash, 10, 300)
        ],
        request.log
      );
      if (!rl.allowed) {
        return reply.code(429).send({ error: 'rate_limited', message: 'Слишком много попыток входа — попробуйте позже' });
      }

      // orgId неизвестен до поиска аккаунта — поиск идёт по всем сетям, но
      // UNIQUE(org_id, phone) гарантирует не больше одного совпадения,
      // так что эта неоднозначность не открывает межсетевой доступ.
      const account = phone ? await mirandaRepo.findPointAccountByAnyOrgPhone(phone) : null;
      const passwordOk = await verifyPassword(b.password, account?.password_hash || DUMMY_PASSWORD_HASH);
      if (!account || !account.password_hash || !passwordOk) {
        if (account) {
          await recordAudit({
            orgId: account.org_id,
            actorEmployeeId: null,
            actorTelegramId: null,
            action: 'miranda.point_login_failed',
            targetType: 'corporate_account',
            targetId: String(account.id),
            targetOrgId: account.org_id
          }).catch(() => {});
        }
        return reply.code(401).send({ error: 'invalid_credentials', message: 'Неверный телефон или пароль' });
      }
      if (!account.is_active) {
        return reply.code(403).send({ error: 'not_active', message: 'Аккаунт отключён' });
      }

      const token = await pointSessionsRepo.create(account.id, deviceFromRequest(request));
      setPointSessionCookie(reply, token);
      await recordAudit({
        orgId: account.org_id,
        actorEmployeeId: null,
        actorTelegramId: null,
        action: 'miranda.point_login_success',
        targetType: 'corporate_account',
        targetId: String(account.id),
        targetOrgId: account.org_id
      }).catch(() => {});
      return reply.code(200).send({
        ok: true,
        corporateAccountId: account.id,
        accountName: account.account_name
      });
    }
  );

  app.post('/miranda/accounts/logout', async (request, reply) => {
    const token = request.cookies?.[pointSessionsRepo.POINT_COOKIE_NAME];
    if (token) {
      await pointSessionsRepo.revoke(token);
    }
    reply.clearCookie(pointSessionsRepo.POINT_COOKIE_NAME, { path: '/' });
    return reply.code(200).send({ ok: true });
  });
}
