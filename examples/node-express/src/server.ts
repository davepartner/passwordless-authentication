import express from 'express';
import { router } from './routes.js';

const app = express();
app.use(express.json());
app.use(router);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`passwordless-auth example listening on :${PORT}`);
});
