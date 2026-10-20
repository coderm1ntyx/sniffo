import app from './app.js';
import { env } from './config/env.js';
app.listen(env.PORT, env.HOST, () =>
  console.log(`Sniffo API listening on http://localhost:${env.PORT}`),
);
