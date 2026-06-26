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

function snapshotForScene(scene: string, exceptUserId?: string) {
  return Array.from(players.values())
    .filter((p) => p.scene === scene && p.userId !== exceptUserId)
    .map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      posX: p.posX,
      posY: p.posY,
      direction: p.direction,
    }));
}

// Position is now stored per (user, scene), so saving upserts the row for the
// player's *current* scene rather than overwriting a single global position.
async function persist(p: ConnectedPlayer) {
  const { error } = await supabase
    .from("player_state")
    .upsert(
      {
        user_id: p.userId,
        scene: p.scene,
        pos_x: p.posX,
        pos_y: p.posY,
        direction: p.direction,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,scene" },
    );

  if (error) console.error("Failed to persist player_state", error);
}

// Loads the saved position for one specific scene, or null if the player has
// never been there before (caller then spawns them at the scene's default).
async function loadSceneState(
  userId: string,
  scene: string,
): Promise<PlayerStateRow | null> {
  const { data, error } = await supabase
    .from("player_state")
    .select("*")
    .eq("user_id", userId)
    .eq("scene", scene)
    .limit(1);

  if (error) console.error("Failed to load scene state", error);
  return (data && (data[0] as PlayerStateRow)) ?? null;
}

export function attachWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    console.log("New WS connection attempt from", req.socket.remoteAddress);
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    const session = token ? verifySessionToken(token) : null;

    if (!session) {
      console.log("Connection rejected: invalid/missing token");
      ws.close(4001, "Unauthorized");
      return;
    }

    console.log(
      "Connection authorized for userId:",
      session.userId,
      "name:",
      session.displayName,
    );

    let player: ConnectedPlayer | null = null;

    (async () => {
      // Default to the player's most recently active scene/position.
      const { data: stateRows, error } = await supabase
        .from("player_state")
        .select("*")
        .eq("user_id", session.userId)
        .order("updated_at", { ascending: false })
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

      console.log(
        "Player registered. Scene:",
        player.scene,
        "| All active players:",
        Array.from(players.values()).map((p) => `${p.displayName}(${p.scene})`),
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
          players: snapshotForScene(player.scene, player.userId),
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
        const leaving = player;
        const oldScene = leaving.scene;
        const newScene = msg.scene;

        void (async () => {
          // Save where the player was standing in the scene they're leaving so
          // it's there when they come back.
          await persist(leaving);

          broadcastToScene(
            oldScene,
            { type: "player_left", userId: leaving.userId },
            leaving.userId,
          );

          // Move into the new scene at its own saved position. If there's no
          // saved position yet, tell the client to use the scene's spawn point.
          const saved = await loadSceneState(leaving.userId, newScene);
          leaving.scene = newScene;
          let spawnAtDefault = false;
          if (saved) {
            leaving.posX = saved.pos_x;
            leaving.posY = saved.pos_y;
            leaving.direction = saved.direction;
          } else {
            spawnAtDefault = true;
            leaving.direction = "bottom";
          }

          console.log(
            leaving.displayName,
            "changed scene:",
            oldScene,
            "->",
            newScene,
            spawnAtDefault ? "(default spawn)" : "(restored position)",
            "| players now in",
            newScene,
            ":",
            snapshotForScene(newScene).map((p) => p.displayName),
          );

          ws.send(
            JSON.stringify({
              type: "init",
              you: {
                userId: leaving.userId,
                displayName: leaving.displayName,
                posX: leaving.posX,
                posY: leaving.posY,
              },
              spawnAtDefault,
              players: snapshotForScene(newScene, leaving.userId),
            }),
          );

          broadcastToScene(
            newScene,
            {
              type: "player_joined",
              userId: leaving.userId,
              displayName: leaving.displayName,
              posX: leaving.posX,
              posY: leaving.posY,
              direction: leaving.direction,
            },
            leaving.userId,
          );
        })().catch(console.error);
      }
    });

    ws.on("close", () => {
      if (!player) return;
      console.log(player.displayName, "disconnected from scene:", player.scene);
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
