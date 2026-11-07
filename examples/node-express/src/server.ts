import express from 'express';
import { router } from './routes.js';

const app = express();
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  // Enable HSTS only behind TLS in production:
  // res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(router);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`passwordless-auth example listening on :${PORT}`);
});
