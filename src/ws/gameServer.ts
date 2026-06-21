import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { verifySessionToken } from "../auth/session.js";
import { supabase, type PlayerStateRow } from "../db/client.js";

interface ConnectedPlayer {
  ws: WebSocket;
  userId: string;
  displayName: string;
  scene: string;
  posX: number;
  posY: number;
  direction: string;
  lastSaved: number;
}

const players = new Map<string, ConnectedPlayer>();

const SAVE_INTERVAL_MS = 5000;

function broadcastToScene(
  scene: string,
  message: object,
  exceptUserId?: string,
) {
  const payload = JSON.stringify(message);
  for (const [userId, p] of players) {
    if (userId === exceptUserId) continue;
    if (p.scene !== scene) continue;
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
  }
}

function snapshotForScene(scene: string) {
  return Array.from(players.values())
    .filter((p) => p.scene === scene)
    .map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      posX: p.posX,
      posY: p.posY,
      direction: p.direction,
    }));
}

async function persist(p: ConnectedPlayer) {
  const { error } = await supabase
    .from("player_state")
    .update({
      scene: p.scene,
      pos_x: p.posX,
      pos_y: p.posY,
      direction: p.direction,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", p.userId);

  if (error) console.error("Failed to persist player_state", error);
}

export function attachWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    const session = token ? verifySessionToken(token) : null;

    if (!session) {
      ws.close(4001, "Unauthorized");
      return;
    }

    let player: ConnectedPlayer | null = null;

    (async () => {
      const { data: stateRows, error } = await supabase
        .from("player_state")
        .select("*")
        .eq("user_id", session.userId)
        .limit(1);

      if (error) console.error("Failed to load player_state", error);

      const state = (stateRows && stateRows[0]) as PlayerStateRow | undefined;

      player = {
        ws,
        userId: session.userId,
        displayName: session.displayName,
        scene: state?.scene ?? "village",
        posX: state?.pos_x ?? 0,
        posY: state?.pos_y ?? 0,
        direction: state?.direction ?? "bottom",
        lastSaved: Date.now(),
      };
      players.set(session.userId, player);

      ws.send(
        JSON.stringify({
          type: "init",
          you: {
            userId: player.userId,
            displayName: player.displayName,
            posX: player.posX,
            posY: player.posY,
          },
          players: snapshotForScene(player.scene),
        }),
      );

      broadcastToScene(
        player.scene,
        {
          type: "player_joined",
          userId: player.userId,
          displayName: player.displayName,
          posX: player.posX,
          posY: player.posY,
          direction: player.direction,
        },
        player.userId,
      );
    })();

    ws.on("message", (raw) => {
      if (!player) return;
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "move") {
        player.posX = msg.posX;
        player.posY = msg.posY;
        player.direction = msg.direction ?? player.direction;

        broadcastToScene(
          player.scene,
          {
            type: "player_moved",
            userId: player.userId,
            posX: player.posX,
            posY: player.posY,
            direction: player.direction,
          },
          player.userId,
        );

        const now = Date.now();
        if (now - player.lastSaved > SAVE_INTERVAL_MS) {
          player.lastSaved = now;
          persist(player).catch(console.error);
        }
      }

      if (msg.type === "change_scene") {
        const oldScene = player.scene;
        player.scene = msg.scene;

        broadcastToScene(
          oldScene,
          { type: "player_left", userId: player.userId },
          player.userId,
        );

        ws.send(
          JSON.stringify({
            type: "init",
            you: {
              userId: player.userId,
              displayName: player.displayName,
              posX: player.posX,
              posY: player.posY,
            },
            players: snapshotForScene(player.scene),
          }),
        );

        broadcastToScene(
          player.scene,
          {
            type: "player_joined",
            userId: player.userId,
            displayName: player.displayName,
            posX: player.posX,
            posY: player.posY,
            direction: player.direction,
          },
          player.userId,
        );

        persist(player).catch(console.error);
      }
    });

    ws.on("close", () => {
      if (!player) return;
      players.delete(player.userId);
      persist(player).catch(console.error);
      broadcastToScene(player.scene, {
        type: "player_left",
        userId: player.userId,
      });
    });
  });

  return wss;
}
