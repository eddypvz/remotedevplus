import { COOKIE } from '../server-shared.js';

export default async function authRoutes(app, { auth, cfg }) {
  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const { username, password } = req.body || {};
    const { token, user } = await auth.login({
      username, password, ip: req.ip, userAgent: req.headers['user-agent'],
    });
    reply.setCookie(COOKIE, token, {
      path: cfg.basePath,
      httpOnly: true,
      sameSite: 'lax',
      /*
       * Sin TLS el navegador descartaría una cookie `secure`, y el modo A
       * (HTTP en loopback) dejaría de funcionar. Pero detrás de un proxy que
       * termina TLS, el agente habla HTTP y el navegador HTTPS: mirar solo la
       * config propia dejaría la cookie sin marcar en una conexión que sí es
       * segura. Por eso también se mira el protocolo real del request, que
       * Fastify deduce de `X-Forwarded-Proto` cuando se confía en el proxy.
       */
      secure: !!cfg.tls || (cfg.trustProxy && req.protocol === 'https'),
      maxAge: cfg.sessionTtlDays * 86400,
    });
    return { user };
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    auth.logout(req.cookies?.[COOKIE]);
    reply.clearCookie(COOKIE, { path: cfg.basePath });
    return { ok: true };
  });

  // Punto de entrada de la SPA: dice si hay que hacer login, si hay que crear
  // el primer usuario, o quién soy y qué puedo ver.
  app.get('/api/auth/me', { config: { public: true } }, async (req) => {
    if (!auth.hasUsers()) {
      return {
        setup: true,
        hint: 'No hay usuarios. Cree el primero: npm run user -- add <nombre> --admin',
      };
    }
    if (!req.user) return { authenticated: false };
    return {
      authenticated: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        displayName: req.user.displayName,
        permissions: req.user.permissions,
        roots: req.user.roots,
      },
    };
  });
}
