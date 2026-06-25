import "dotenv/config";
import express from "express";
import { createServer } from "http";
import authRouter from "./routes/auth.js";
import { attachWebSocketServer } from "./ws/gameServer.js";

const app = express();
app.use(express.json());
app.use(authRouter);

app.get("/", (_req, res) => res.json({ name: "pixl-server", status: "ok" }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
attachWebSocketServer(httpServer);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = "0.0.0.0";
httpServer.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});
