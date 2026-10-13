import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { Pool } from 'pg';
import { Server } from 'socket.io';
import { z } from 'zod';

dotenv.config();
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) dotenv.config({ path: resolve(process.cwd(), '../../.env') });

const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
}).parse({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? process.env.POSTGRES_URL });

const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined });
const sessionCookie = env.NODE_ENV === 'production' ? '__Host-ls_session' : 'ls_session';
const sessionMaxAge = 30 * 24 * 60 * 60 * 1000;
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const deriveKey = (password: string, salt: Buffer, length: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, length, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error); else resolve(key as Buffer);
  });
});
const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, 64);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};
const verifyPassword = async (password: string, encoded: string) => {
  const [algorithm, n, r, p, saltEncoded, keyEncoded] = encoded.split('$');
  if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1' || !saltEncoded || !keyEncoded) return false;
  try {
    const salt = Buffer.from(saltEncoded, 'base64url');
    const expected = Buffer.from(keyEncoded, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await deriveKey(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch { return false; }
};

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: env.WEB_ORIGIN, credentials: true }, maxHttpBufferSize: 32_000 });
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use((_req, res, next) => { res.setHeader('X-Request-Id', randomUUID()); next(); });

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const credentialSchema = z.object({ email: z.string().email().max(254).transform((email) => email.trim().toLowerCase()), password: z.string().min(12).max(128) });
const issueSession = async (userId: string) => {
  const token = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [userId, hashToken(token)]);
  return token;
};
const setSessionCookie = (res: express.Response, token: string) => res.cookie(sessionCookie, token, {
  httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: sessionMaxAge,
});
const clearSessionCookie = (res: express.Response) => res.clearCookie(sessionCookie, {
  httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
});
const userQuery = `SELECT u.id, u.email, u.display_name AS "displayName"
  FROM auth_sessions s JOIN users u ON u.id = s.user_id
  WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`;
type SessionUser = { id: string; email: string; displayName: string };
type AuthRequest = express.Request & { user: SessionUser };
const requireAuth: express.RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.[sessionCookie];
    if (!token) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Giriş yapman gerekiyor.' } }); return; }
    const result = await pool.query(userQuery, [hashToken(token)]);
    if (!result.rowCount) { clearSessionCookie(res); res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Oturum süresi dolmuş.' } }); return; }
    (req as AuthRequest).user = result.rows[0] as SessionUser;
    next();
  } catch (error) { next(error); }
};
const requireCouple = async (userId: string, res: express.Response) => {
  const result = await pool.query(
    `SELECT c.id, c.relationship_start_date AS "relationshipStartDate", c.created_at AS "createdAt",
      (SELECT count(*)::int FROM couple_members cm2 WHERE cm2.couple_id = c.id) AS "memberCount"
     FROM couple_members cm JOIN couples c ON c.id = cm.couple_id
     WHERE cm.user_id = $1 AND c.deleted_at IS NULL LIMIT 1`, [userId],
  );
  if (!result.rowCount) { res.status(409).json({ error: { code: 'COUPLE_REQUIRED', message: 'Önce bir çift alanı oluştur veya daveti kabul et.' } }); return null; }
  return result.rows[0] as { id: string; relationshipStartDate: string | null; createdAt: string; memberCount: number };
};
const routeBody = <T extends z.ZodTypeAny>(schema: T, body: unknown) => schema.parse(body);

const memoryInput = z.object({ title: z.string().trim().min(1).max(160), body: z.string().max(10000).default(''), happenedAt: z.string().datetime().optional().nullable(), visibility: z.enum(['shared', 'private']).default('shared') });
const letterInput = z.object({ title: z.string().max(160).default(''), body: z.string().min(1).max(20000), status: z.enum(['draft', 'sent']).default('draft') });
const bucketInput = z.object({ title: z.string().trim().min(1).max(240), notes: z.string().max(2000).default('') });

app.use('/api/v1/couples', requireAuth);
app.post('/api/v1/couples', async (req, res, next) => {
  const userId = (req as AuthRequest).user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT couple_id FROM couple_members WHERE user_id = $1', [userId]);
    if (existing.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: { code: 'ALREADY_PAIRED', message: 'Zaten bir çift alanındasın.' } }); return; }
    const couple = await client.query('INSERT INTO couples DEFAULT VALUES RETURNING id, relationship_start_date AS "relationshipStartDate", created_at AS "createdAt"');
    await client.query('INSERT INTO couple_members (couple_id, user_id) VALUES ($1, $2)', [couple.rows[0].id, userId]);
    await client.query('COMMIT');
    res.status(201).json({ data: { couple: { ...couple.rows[0], memberCount: 1 }, partner: null } });
  } catch (error) { await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
});

app.get('/api/v1/couples/me', async (req, res, next) => {
  try {
    const userId = (req as AuthRequest).user.id;
    const couple = await requireCouple(userId, res); if (!couple) return;
    const partner = await pool.query(
      `SELECT u.id, u.display_name AS "displayName" FROM couple_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.couple_id = $1 AND cm.user_id <> $2 LIMIT 1`, [couple.id, userId],
    );
    res.json({ data: { couple, partner: partner.rows[0] ?? null } });
  } catch (error) { next(error); }
});

app.patch('/api/v1/couples/me', async (req, res, next) => {
  try {
    const input = z.object({ relationshipStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).parse(req.body);
    const couple = await requireCouple((req as AuthRequest).user.id, res); if (!couple) return;
    const result = await pool.query('UPDATE couples SET relationship_start_date = $1, updated_at = now() WHERE id = $2 RETURNING id, relationship_start_date AS "relationshipStartDate"', [input.relationshipStartDate, couple.id]);
    res.json({ data: { couple: result.rows[0] } });
  } catch (error) { next(error); }
});

app.post('/api/v1/couples/invitations', async (req, res, next) => {
  try {
    const userId = (req as AuthRequest).user.id;
    const couple = await requireCouple(userId, res); if (!couple) return;
    if (couple.memberCount >= 2) { res.status(409).json({ error: { code: 'COUPLE_FULL', message: 'Bu çift alanında zaten iki kişi var.' } }); return; }
    const token = randomBytes(24).toString('base64url');
    await pool.query('INSERT INTO couple_invitations (couple_id, invited_by, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval \'7 days\')', [couple.id, userId, hashToken(token)]);
    res.status(201).json({ data: { token, expiresInDays: 7 } });
  } catch (error) { next(error); }
});

app.post('/api/v1/couples/invitations/accept', async (req, res, next) => {
  const userId = (req as AuthRequest).user.id;
  const tokenInput = z.object({ token: z.string().min(20).max(100) }).safeParse(req.body);
  if (!tokenInput.success) { res.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'Davet kodu geçersiz.' } }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT couple_id FROM couple_members WHERE user_id = $1', [userId]);
    if (current.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: { code: 'ALREADY_PAIRED', message: 'Zaten bir çift alanındasın.' } }); return; }
    const invitation = await client.query(
      `SELECT i.id, i.couple_id AS "coupleId" FROM couple_invitations i JOIN couples c ON c.id = i.couple_id
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND c.deleted_at IS NULL FOR UPDATE OF i`, [hashToken(tokenInput.data.token)],
    );
    if (!invitation.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: { code: 'INVALID_INVITATION', message: 'Davet kodu geçersiz veya süresi dolmuş.' } }); return; }
    const count = await client.query('SELECT count(*)::int AS count FROM couple_members WHERE couple_id = $1', [invitation.rows[0].coupleId]);
    if (count.rows[0].count >= 2) { await client.query('ROLLBACK'); res.status(409).json({ error: { code: 'COUPLE_FULL', message: 'Bu davet artık kullanılamıyor.' } }); return; }
    await client.query('INSERT INTO couple_members (couple_id, user_id) VALUES ($1, $2)', [invitation.rows[0].coupleId, userId]);
    await client.query('UPDATE couple_invitations SET accepted_at = now() WHERE id = $1', [invitation.rows[0].id]);
    await client.query('COMMIT');
    res.json({ data: { ok: true } });
  } catch (error) { await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
});

app.use('/api/v1/memories', requireAuth);
app.get('/api/v1/memories', async (req, res, next) => {
  try {
    const couple = await requireCouple((req as AuthRequest).user.id, res); if (!couple) return;
    const result = await pool.query(
      `SELECT id, created_by AS "createdBy", title, body, happened_at AS "happenedAt", visibility, created_at AS "createdAt"
       FROM memories WHERE couple_id = $1 AND deleted_at IS NULL AND (visibility = 'shared' OR created_by = $2)
       ORDER BY COALESCE(happened_at, created_at) DESC LIMIT 100`, [couple.id, (req as AuthRequest).user.id],
    );
    res.json({ data: { items: result.rows } });
  } catch (error) { next(error); }
});
app.post('/api/v1/memories', async (req, res, next) => {
  try {
    const input = routeBody(memoryInput, req.body); const userId = (req as AuthRequest).user.id;
    const couple = await requireCouple(userId, res); if (!couple) return;
    const result = await pool.query(
      `INSERT INTO memories (couple_id, created_by, title, body, happened_at, visibility)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_by AS "createdBy", title, body, happened_at AS "happenedAt", visibility, created_at AS "createdAt"`,
      [couple.id, userId, input.title, input.body, input.happenedAt ?? null, input.visibility],
    );
    res.status(201).json({ data: { item: result.rows[0] } });
  } catch (error) { next(error); }
});
app.delete('/api/v1/memories/:id', async (req, res, next) => {
  try {
    const userId = (req as unknown as AuthRequest).user.id; const couple = await requireCouple(userId, res); if (!couple) return;
    const result = await pool.query('UPDATE memories SET deleted_at = now() WHERE id = $1 AND couple_id = $2 AND created_by = $3 AND deleted_at IS NULL', [req.params.id, couple.id, userId]);
    if (!result.rowCount) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Anı bulunamadı.' } }); return; }
    res.json({ data: { ok: true } });
  } catch (error) { next(error); }
});

app.use('/api/v1/letters', requireAuth);
app.get('/api/v1/letters', async (req, res, next) => {
  try {
    const userId = (req as unknown as AuthRequest).user.id; const couple = await requireCouple(userId, res); if (!couple) return;
    const result = await pool.query(
      `SELECT id, author_id AS "authorId", title, body, status, sent_at AS "sentAt", created_at AS "createdAt"
       FROM letters WHERE couple_id = $1 AND deleted_at IS NULL AND (author_id = $2 OR status = 'sent') ORDER BY created_at DESC LIMIT 100`, [couple.id, userId],
    );
    res.json({ data: { items: result.rows } });
  } catch (error) { next(error); }
});
app.post('/api/v1/letters', async (req, res, next) => {
  try {
    const input = routeBody(letterInput, req.body); const userId = (req as AuthRequest).user.id;
    const couple = await requireCouple(userId, res); if (!couple) return;
    const result = await pool.query(
      `INSERT INTO letters (couple_id, author_id, title, body, status, sent_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $5='sent' THEN now() ELSE NULL END)
       RETURNING id, author_id AS "authorId", title, body, status, sent_at AS "sentAt", created_at AS "createdAt"`, [couple.id, userId, input.title, input.body, input.status],
    );
    res.status(201).json({ data: { item: result.rows[0] } });
  } catch (error) { next(error); }
});
app.delete('/api/v1/letters/:id', async (req, res, next) => {
  try {
    const userId = (req as unknown as AuthRequest).user.id; const couple = await requireCouple(userId, res); if (!couple) return;
    const result = await pool.query('UPDATE letters SET deleted_at = now() WHERE id = $1 AND couple_id = $2 AND author_id = $3 AND deleted_at IS NULL', [req.params.id, couple.id, userId]);
    if (!result.rowCount) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Mektup bulunamadı.' } }); return; }
    res.json({ data: { ok: true } });
  } catch (error) { next(error); }
});

app.use('/api/v1/bucket-items', requireAuth);
app.get('/api/v1/bucket-items', async (req, res, next) => {
  try {
    const couple = await requireCouple((req as unknown as AuthRequest).user.id, res); if (!couple) return;
    const result = await pool.query(
      `SELECT id, created_by AS "createdBy", title, notes, status, completed_by AS "completedBy", completed_at AS "completedAt", created_at AS "createdAt"
       FROM bucket_items WHERE couple_id = $1 AND deleted_at IS NULL ORDER BY (status = 'done'), created_at DESC LIMIT 100`, [couple.id],
    );
    res.json({ data: { items: result.rows } });
  } catch (error) { next(error); }
});
app.post('/api/v1/bucket-items', async (req, res, next) => {
  try {
    const input = routeBody(bucketInput, req.body); const userId = (req as AuthRequest).user.id;
    const couple = await requireCouple(userId, res); if (!couple) return;
    const result = await pool.query(
      `INSERT INTO bucket_items (couple_id, created_by, title, notes) VALUES ($1,$2,$3,$4)
       RETURNING id, created_by AS "createdBy", title, notes, status, completed_by AS "completedBy", completed_at AS "completedAt", created_at AS "createdAt"`, [couple.id, userId, input.title, input.notes],
    );
    res.status(201).json({ data: { item: result.rows[0] } });
  } catch (error) { next(error); }
});
app.patch('/api/v1/bucket-items/:id', async (req, res, next) => {
  try {
    const status = z.object({ status: z.enum(['open', 'done']) }).parse(req.body).status; const userId = (req as unknown as AuthRequest).user.id;
    const couple = await requireCouple(userId, res); if (!couple) return;
    const result = await pool.query(
      `UPDATE bucket_items SET status = $1, completed_by = CASE WHEN $1='done' THEN $2::uuid ELSE NULL END, completed_at = CASE WHEN $1='done' THEN now() ELSE NULL END, updated_at = now()
       WHERE id=$3 AND couple_id=$4 AND deleted_at IS NULL
       RETURNING id, created_by AS "createdBy", title, notes, status, completed_by AS "completedBy", completed_at AS "completedAt", created_at AS "createdAt"`, [status, userId, req.params.id, couple.id],
    );
    if (!result.rowCount) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Liste maddesi bulunamadı.' } }); return; }
    res.json({ data: { item: result.rows[0] } });
  } catch (error) { next(error); }
});
app.delete('/api/v1/bucket-items/:id', async (req, res, next) => {
  try {
    const couple = await requireCouple((req as unknown as AuthRequest).user.id, res); if (!couple) return;
    const result = await pool.query('UPDATE bucket_items SET deleted_at=now() WHERE id=$1 AND couple_id=$2 AND deleted_at IS NULL', [req.params.id, couple.id]);
    if (!result.rowCount) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Liste maddesi bulunamadı.' } }); return; }
    res.json({ data: { ok: true } });
  } catch (error) { next(error); }
});

app.use('/api/v1/chat', requireAuth);
app.get('/api/v1/chat/messages', async (req, res, next) => {
  try {
    const couple = await requireCouple((req as unknown as AuthRequest).user.id, res); if (!couple) return;
    const result = await pool.query(
      `SELECT id, sender_id AS "senderId", client_id AS "clientId", body, created_at AS "createdAt" FROM chat_messages
       WHERE couple_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [couple.id],
    );
    res.json({ data: { items: result.rows.reverse() } });
  } catch (error) { next(error); }
});
app.post('/api/v1/chat/messages', async (req, res, next) => {
  try {
    const userId = (req as AuthRequest).user.id;
    const input = z.object({ clientId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).parse(req.body);
    const couple = await requireCouple(userId, res); if (!couple) return;
    const result = await pool.query(
      `INSERT INTO chat_messages (couple_id, sender_id, client_id, body) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sender_id, client_id) DO UPDATE SET body = chat_messages.body
       RETURNING id, sender_id AS "senderId", client_id AS "clientId", body, created_at AS "createdAt"`,
      [couple.id, userId, input.clientId, input.body],
    );
    const message = result.rows[0];
    io.to(`couple:${couple.id}`).emit('chat:message', message);
    res.status(201).json({ data: { item: message } });
  } catch (error) { next(error); }
});

app.use('/api/v1/games', requireAuth);
app.get('/api/v1/games', async (req, res, next) => {
  try {
    const couple = await requireCouple((req as AuthRequest).user.id, res); if (!couple) return;
    const result = await pool.query('SELECT id, game_type AS "gameType", status, state, version, created_at AS "createdAt" FROM game_sessions WHERE couple_id=$1 ORDER BY created_at DESC LIMIT 20', [couple.id]);
    res.json({ data: { games: result.rows } });
  } catch (error) { next(error); }
});
app.get('/api/v1/games/:id', async (req, res, next) => {
  try {
    const couple = await requireCouple((req as unknown as AuthRequest).user.id, res); if (!couple) return;
    const result = await pool.query('SELECT id, game_type AS "gameType", status, state, version, created_at AS "createdAt" FROM game_sessions WHERE id=$1 AND couple_id=$2', [req.params.id, couple.id]);
    if (!result.rowCount) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Oyun bulunamadı.' } }); return; }
    res.json({ data: { game: result.rows[0] } });
  } catch (error) { next(error); }
});
app.post('/api/v1/games', async (req, res, next) => {
  try {
    const userId = (req as AuthRequest).user.id; const couple = await requireCouple(userId, res); if (!couple) return;
    const members = await pool.query('SELECT user_id FROM couple_members WHERE couple_id=$1 ORDER BY joined_at, user_id LIMIT 2', [couple.id]);
    const players = members.rows.map((row: { user_id: string }) => row.user_id);
    if (players.length < 2) { res.status(409).json({ error: { code: 'PARTNER_REQUIRED', message: 'Oyuna başlamak için partnerini davet et.' } }); return; }
    const state = { board: Array(9).fill(null), players, turn: players[0], winner: null };
    const result = await pool.query(
      `INSERT INTO game_sessions (couple_id, game_type, state, created_by) VALUES ($1,'tic_tac_toe',$2,$3)
       RETURNING id, game_type AS "gameType", status, state, version, created_at AS "createdAt"`, [couple.id, state, userId],
    );
    res.status(201).json({ data: { game: result.rows[0] } });
  } catch (error) { next(error); }
});

app.get('/api/v1/health/live', (_req, res) => res.json({ data: { status: 'ok' } }));
app.get('/api/v1/health/ready', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ data: { status: 'ok' } }); }
  catch { res.status(503).json({ error: { code: 'NOT_READY', message: 'Service is not ready.' } }); }
});

app.post('/api/v1/auth/register', authLimiter, async (req, res, next) => {
  try {
    const input = credentialSchema.extend({ displayName: z.string().trim().min(1).max(80) }).parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) ON CONFLICT (email_normalized) WHERE deleted_at IS NULL DO NOTHING RETURNING id, email, display_name AS "displayName"',
        [input.email, passwordHash, input.displayName],
      );
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: { code: 'EMAIL_IN_USE', message: 'Bu e-posta adresiyle bir hesap zaten var.' } });
        return;
      }
      const token = randomBytes(32).toString('base64url');
      await client.query('INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [inserted.rows[0].id, hashToken(token)]);
      await client.query('COMMIT');
      setSessionCookie(res, token);
      res.status(201).json({ data: { user: inserted.rows[0] } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  } catch (error) { next(error); }
});

app.post('/api/v1/auth/login', authLimiter, async (req, res, next) => {
  try {
    const input = credentialSchema.parse(req.body);
    const result = await pool.query('SELECT id, email, password_hash, display_name AS "displayName" FROM users WHERE email_normalized = $1 AND deleted_at IS NULL', [input.email]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'E-posta veya parola hatalı.' } });
      return;
    }
    setSessionCookie(res, await issueSession(user.id));
    res.json({ data: { user: { id: user.id, email: user.email, displayName: user.displayName } } });
  } catch (error) { next(error); }
});

app.get('/api/v1/auth/me', async (req, res, next) => {
  try {
    const token = req.cookies?.[sessionCookie];
    if (!token) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Giriş yapılmamış.' } }); return; }
    const result = await pool.query(userQuery, [hashToken(token)]);
    if (!result.rowCount) { clearSessionCookie(res); res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Oturum süresi dolmuş.' } }); return; }
    res.json({ data: { user: result.rows[0] } });
  } catch (error) { next(error); }
});

app.post('/api/v1/auth/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[sessionCookie];
    if (token) await pool.query('UPDATE auth_sessions SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
    clearSessionCookie(res);
    res.json({ data: { ok: true } });
  } catch (error) { next(error); }
});

app.use('/api/v1', (_req, res) => res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Bu özellik henüz hazır değil.' } }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Bilgileri kontrol edip tekrar deneyin.', details: error.flatten().fieldErrors } }); return; }
  console.error('Request failed', error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Bir hata oluştu.' } });
});

type ChasePoint = { x: number; y: number };
type ChaseSession = { id: string; status: 'active' | 'completed'; catcherId: string; runnerId: string; positions: Record<string, ChasePoint>; winner: string | null; version: number };
const chaseSessions = new Map<string, ChaseSession>();
io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie ?? '';
    const pair = cookieHeader.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${sessionCookie}=`));
    const token = pair ? decodeURIComponent(pair.slice(sessionCookie.length + 1)) : '';
    if (!token) { next(new Error('Oturum açman gerekiyor.')); return; }
    const user = await pool.query(userQuery, [hashToken(token)]);
    if (!user.rowCount) { next(new Error('Oturumun sona ermiş.')); return; }
    const membership = await pool.query('SELECT couple_id AS id FROM couple_members WHERE user_id=$1', [user.rows[0].id]);
    if (!membership.rowCount) { next(new Error('Önce partnerini davet et.')); return; }
    socket.data.user = user.rows[0] as SessionUser;
    socket.data.coupleId = membership.rows[0].id as string;
    socket.join(`couple:${membership.rows[0].id}`);
    socket.join(`user:${user.rows[0].id}`);
    next();
  } catch { next(new Error('Canlı bağlantı kurulamadı.')); }
});

const ackError = (ack: ((value: unknown) => void) | undefined, code: string, message: string) => ack?.({ ok: false, error: { code, message } });
const winLines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
io.on('connection', (socket) => {
  const user = socket.data.user as SessionUser;
  const coupleId = socket.data.coupleId as string;
  const room = `couple:${coupleId}`;

  const currentChase = chaseSessions.get(coupleId);
  if (currentChase) socket.emit('game:chase:state', currentChase);

  socket.on('game:chase:start', async (_raw: unknown, ack?: (value: unknown) => void) => {
    try {
      const members = await pool.query('SELECT user_id FROM couple_members WHERE couple_id=$1 ORDER BY joined_at, user_id LIMIT 2', [coupleId]);
      const partnerId = members.rows.find((member: { user_id: string }) => member.user_id !== user.id)?.user_id as string | undefined;
      if (!partnerId) { ackError(ack, 'PARTNER_REQUIRED', 'Oyuna başlamak için partnerin çift alanına katılmalı.'); return; }
      const onlinePlayers = await io.in(room).fetchSockets();
      if (!onlinePlayers.some((online) => (online.data.user as SessionUser | undefined)?.id === partnerId)) {
        ackError(ack, 'PARTNER_OFFLINE', 'Oyuna başlamak için partnerin de LoveSpace’te çevrimiçi olmalı.'); return;
      }
      const state: ChaseSession = {
        id: randomUUID(), status: 'active', catcherId: user.id, runnerId: partnerId,
        positions: { [user.id]: { x: 1, y: 2 }, [partnerId]: { x: 7, y: 3 } }, winner: null, version: 0,
      };
      chaseSessions.set(coupleId, state);
      io.to(room).emit('game:chase:state', state);
      ack?.({ ok: true, data: state });
    } catch { ackError(ack, 'GAME_FAILED', 'Oyun başlatılamadı. Tekrar dene.'); }
  });

  socket.on('game:chase:move', (raw: unknown, ack?: (value: unknown) => void) => {
    const parsed = z.object({ x: z.number().int().min(0).max(8), y: z.number().int().min(0).max(5) }).safeParse(raw);
    if (!parsed.success) { ackError(ack, 'INVALID_MOVE', 'Hamle geçersiz.'); return; }
    const state = chaseSessions.get(coupleId);
    if (!state || state.status !== 'active' || !state.positions[user.id]) { ackError(ack, 'GAME_NOT_ACTIVE', 'Önce partnerinle yeni bir oyun başlat.'); return; }
    const from = state.positions[user.id]; const next = parsed.data;
    if (Math.abs(from.x - next.x) + Math.abs(from.y - next.y) !== 1) { ackError(ack, 'INVALID_MOVE', 'Bir seferde yalnızca bir kare ilerleyebilirsin.'); return; }
    state.positions[user.id] = next;
    if (state.positions[state.catcherId].x === state.positions[state.runnerId].x && state.positions[state.catcherId].y === state.positions[state.runnerId].y) {
      state.status = 'completed'; state.winner = state.catcherId;
    }
    state.version += 1;
    io.to(room).emit('game:chase:state', state);
    ack?.({ ok: true, data: state });
  });

  socket.on('chat:send', async (raw: unknown, ack?: (value: unknown) => void) => {
    const parsed = z.object({ clientId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).safeParse(raw);
    if (!parsed.success) { ackError(ack, 'INVALID_MESSAGE', 'Mesaj boş olamaz ve 4.000 karakteri geçemez.'); return; }
    try {
      const active = await pool.query('SELECT 1 FROM auth_sessions WHERE refresh_token_hash=$1 AND revoked_at IS NULL AND expires_at>now()', [hashToken(socket.handshake.headers.cookie?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1) ?? '')]);
      if (!active.rowCount) { ackError(ack, 'UNAUTHENTICATED', 'Oturumun sona ermiş.'); socket.disconnect(true); return; }
      const result = await pool.query(
        `INSERT INTO chat_messages (couple_id,sender_id,client_id,body) VALUES ($1,$2,$3,$4)
         ON CONFLICT (sender_id,client_id) DO UPDATE SET body=chat_messages.body
         RETURNING id, sender_id AS "senderId", client_id AS "clientId", body, created_at AS "createdAt"`, [coupleId, user.id, parsed.data.clientId, parsed.data.body],
      );
      io.to(room).emit('chat:message', result.rows[0]);
      ack?.({ ok: true, data: result.rows[0] });
    } catch { ackError(ack, 'CHAT_FAILED', 'Mesaj gönderilemedi. Tekrar dene.'); }
  });

  socket.on('reaction:send', async (raw: unknown, ack?: (value: unknown) => void) => {
    const allowed = ['❤️','💖','💕','💘','😍','🥰','😘'];
    const parsed = z.object({ clientId: z.string().uuid(), emoji: z.string().refine((value) => allowed.includes(value)) }).safeParse(raw);
    if (!parsed.success) { ackError(ack, 'INVALID_REACTION', 'Bu tepki kullanılamıyor.'); return; }
    try {
      const authCookie = socket.handshake.headers.cookie?.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${sessionCookie}=`));
      const token = authCookie ? decodeURIComponent(authCookie.slice(sessionCookie.length + 1)) : '';
      const active = await pool.query('SELECT 1 FROM auth_sessions WHERE refresh_token_hash=$1 AND revoked_at IS NULL AND expires_at>now()', [hashToken(token)]);
      if (!active.rowCount) { ackError(ack, 'UNAUTHENTICATED', 'Oturumun sona ermiş.'); socket.disconnect(true); return; }
      const result = await pool.query(
        `INSERT INTO reactions (couple_id,user_id,client_id,emoji) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id,client_id) DO NOTHING RETURNING id, user_id AS "userId", client_id AS "clientId", emoji, created_at AS "createdAt"`, [coupleId, user.id, parsed.data.clientId, parsed.data.emoji],
      );
      if (result.rowCount) io.to(room).emit('reaction:new', result.rows[0]);
      ack?.({ ok: true });
    } catch { ackError(ack, 'REACTION_FAILED', 'Tepki gönderilemedi.'); }
  });

  socket.on('game:move', async (raw: unknown, ack?: (value: unknown) => void) => {
    const parsed = z.object({ gameId: z.string().uuid(), cell: z.number().int().min(0).max(8) }).safeParse(raw);
    if (!parsed.success) { ackError(ack, 'INVALID_MOVE', 'Hamle geçersiz.'); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT id,state,version,status FROM game_sessions WHERE id=$1 AND couple_id=$2 FOR UPDATE', [parsed.data.gameId, coupleId]);
      if (!found.rowCount) { await client.query('ROLLBACK'); ackError(ack, 'GAME_NOT_FOUND', 'Oyun bulunamadı.'); return; }
      const game = found.rows[0] as { id: string; state: { board: (string | null)[]; players: string[]; turn: string; winner: string | null }; version: number; status: string };
      if (game.status !== 'active' || game.state.turn !== user.id || !game.state.players.includes(user.id) || game.state.board[parsed.data.cell] !== null) {
        await client.query('ROLLBACK'); ackError(ack, 'MOVE_NOT_ALLOWED', 'Şu anda bu hamleyi yapamazsın.'); return;
      }
      const board = [...game.state.board]; board[parsed.data.cell] = game.state.players[0] === user.id ? 'X' : 'O';
      const line = winLines.find(([a,b,c]) => board[a] !== null && board[a] === board[b] && board[b] === board[c]);
      const winner = line ? user.id : null;
      const nextTurn = winner || board.every(Boolean) ? user.id : game.state.players.find((player) => player !== user.id)!;
      const state = { ...game.state, board, winner, turn: nextTurn };
      const status = winner || board.every(Boolean) ? 'completed' : 'active';
      await client.query('UPDATE game_sessions SET state=$1, version=version+1, status=$2, updated_at=now(), completed_at=CASE WHEN $2=\'completed\' THEN now() ELSE NULL END WHERE id=$3', [state, status, game.id]);
      await client.query('COMMIT');
      const updated = { id: game.id, state, version: game.version + 1, status };
      io.to(room).emit('game:state', updated);
      ack?.({ ok: true, data: updated });
    } catch {
      await client.query('ROLLBACK'); ackError(ack, 'GAME_FAILED', 'Hamle kaydedilemedi.');
    } finally { client.release(); }
  });
});

httpServer.listen(env.PORT, () => console.info(`LoveSpace API listening on ${env.PORT}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => httpServer.close(() => { io.close(); void pool.end().finally(() => process.exit(0)); }));
}
