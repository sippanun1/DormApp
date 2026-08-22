import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './env.js';
import { errorHandler } from './http/errors.js';
import { TENANT_TOKEN_HEADER } from './middleware/auth.js';
import { startLineSender } from './line/sender.js';
import { startReminderTick } from './notify/reminders.js';
import { api } from './routes/index.js';

// Belt and braces with TZ in .env: Node caches the zone on first date use.
process.env.TZ = 'Asia/Bangkok';

const app = express();

app.use(helmet());
// `exposedHeaders`: without it the browser can see the slid tenant session
// header but JavaScript cannot read it, and the session would silently keep
// running down (TENANT_TOKEN_HEADER, middleware/auth.ts).
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, exposedHeaders: [TENANT_TOKEN_HEADER] }));
// The raw bytes, kept for the LINE webhook's HMAC. Captured through the
// parser's own hook rather than by re-ordering mounts, which would change body
// parsing for every other route: LINE signs what it sent, and
// JSON.stringify(req.body) is a different byte sequence the moment a key order
// or an escape differs (routes/line.routes.ts).
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.use('/api/v1', api);

app.use((_req, res) => res.status(404).json({ error: 'ไม่พบเส้นทางที่เรียก' }));
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Amanew API on http://localhost:${env.PORT}/api/v1 (TZ=${process.env.TZ})`);
  // The LINE queue drains on a timer, never in a request: a LINE outage must
  // not roll back an invoice. No credentials means no timer at all.
  if (env.lineConfigured) startLineSender();
  else console.log('[line] not configured — the notification queue will not be drained');
  // The due/overdue tick runs whether or not LINE does. The in-app notice is
  // the record Rule 6.13 requires; LINE is only the copy of it.
  startReminderTick();
});
