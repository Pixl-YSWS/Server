import "dotenv/config";
import express from "express";
import { createServer } from "http";
import authRouter from "./routes/auth.js";
import { attachWebSocketServer } from "./ws/gameServer.js";

const app = express();
app.use(express.json());
app.use(authRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
attachWebSocketServer(httpServer);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
