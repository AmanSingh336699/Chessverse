import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";

export interface WsMessage {
  type:
    | "move-request"
    | "move-response"
    | "analysis-update"
    | "engine-thinking"
    | "sync-request"
    | "sync-response"
    | "error"
    | "ping"
    | "pong";
  eventId: string;
  gameId?: string;
  payload: Record<string, unknown>;
}

const connections = new Map<string, Set<WebSocket>>();

const processedEvents = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;

function cleanupDedupMap(): void {
  const now = Date.now();
  for (const [eventId, timestamp] of processedEvents) {
    if (now - timestamp > DEDUP_TTL_MS) {
      processedEvents.delete(eventId);
    }
  }
}

// Run cleanup every 30s
setInterval(cleanupDedupMap, 30_000).unref();

export function isDuplicate(eventId: string): boolean {
  if (processedEvents.has(eventId)) {
    return true;
  }
  processedEvents.set(eventId, Date.now());
  return false;
}

export function broadcastToGame(gameId: string, message: WsMessage): void {
  const conns = connections.get(gameId);
  if (!conns) return;

  const data = JSON.stringify(message);
  for (const ws of conns) {
    if (ws.readyState === 1 /* WebSocket.OPEN */) {
      ws.send(data);
    }
  }
}

export function sendThinking(gameId: string, status: "started" | "progress" | "completed"): void {
  broadcastToGame(gameId, {
    type: "engine-thinking",
    eventId: randomUUID(),
    gameId,
    payload: { status, timestamp: Date.now() },
  });
}

export function sendAnalysisUpdate(
  gameId: string,
  moveNumber: number,
  analysis: Record<string, unknown>,
): void {
  broadcastToGame(gameId, {
    type: "analysis-update",
    eventId: randomUUID(),
    gameId,
    payload: { moveNumber, analysis, timestamp: Date.now() },
  });
}

export function registerWebSocketRoutes(
  app: FastifyInstance,
  logger: Logger,
  handlers: {
    onMoveRequest?: (gameId: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
    onSyncRequest?: (gameId: string, lastMoveNumber: number) => Promise<Record<string, unknown>>;
  },
): void {
  // @ts-expect-error - websocket plugin adds get method variant
  app.get("/ws/game/:gameId", { websocket: true }, (socket: WebSocket, request: { params: { gameId: string } }) => {
    const gameId = request.params.gameId;
    logger.info({ gameId }, "WebSocket connection established");

    // Register connection
    if (!connections.has(gameId)) {
      connections.set(gameId, new Set());
    }
    connections.get(gameId)!.add(socket);

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as WsMessage;

        // Deduplication check
        if (message.eventId && isDuplicate(message.eventId)) {
          socket.send(JSON.stringify({
            type: "error",
            eventId: message.eventId,
            payload: { error: "Duplicate event", code: "DUPLICATE" },
          }));
          return;
        }

        void handleMessage(socket, gameId, message, logger, handlers);
      } catch (error) {
        logger.warn({ error, gameId }, "Invalid WebSocket message");
        socket.send(JSON.stringify({
          type: "error",
          eventId: randomUUID(),
          payload: { error: "Invalid message format" },
        }));
      }
    });

    socket.addEventListener("close", () => {
      const conns = connections.get(gameId);
      if (conns) {
        conns.delete(socket);
        if (conns.size === 0) {
          connections.delete(gameId);
        }
      }
      logger.info({ gameId }, "WebSocket connection closed");
    });

    // Send ping periodically
    const pingInterval = setInterval(() => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({
          type: "ping",
          eventId: randomUUID(),
          payload: { timestamp: Date.now() },
        }));
      }
    }, 30_000);

    socket.addEventListener("close", () => {
      clearInterval(pingInterval);
    });
  });
}

async function handleMessage(
  socket: WebSocket,
  gameId: string,
  message: WsMessage,
  logger: Logger,
  handlers: {
    onMoveRequest?: (gameId: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
    onSyncRequest?: (gameId: string, lastMoveNumber: number) => Promise<Record<string, unknown>>;
  },
): Promise<void> {
  switch (message.type) {
    case "move-request": {
      if (!handlers.onMoveRequest) break;
      try {
        sendThinking(gameId, "started");
        const result = await handlers.onMoveRequest(gameId, message.payload);
        socket.send(JSON.stringify({
          type: "move-response",
          eventId: randomUUID(),
          gameId,
          payload: result,
        } satisfies WsMessage));
        sendThinking(gameId, "completed");
      } catch (error) {
        socket.send(JSON.stringify({
          type: "error",
          eventId: randomUUID(),
          gameId,
          payload: {
            error: error instanceof Error ? error.message : "Engine error",
            originalEventId: message.eventId,
          },
        }));
      }
      break;
    }

    case "sync-request": {
      if (!handlers.onSyncRequest) break;
      try {
        const lastMoveNumber = (message.payload.lastMoveNumber as number) ?? 0;
        const state = await handlers.onSyncRequest(gameId, lastMoveNumber);
        socket.send(JSON.stringify({
          type: "sync-response",
          eventId: randomUUID(),
          gameId,
          payload: state,
        } satisfies WsMessage));
      } catch (error) {
        socket.send(JSON.stringify({
          type: "error",
          eventId: randomUUID(),
          gameId,
          payload: { error: error instanceof Error ? error.message : "Sync error" },
        }));
      }
      break;
    }

    case "ping": {
      socket.send(JSON.stringify({
        type: "pong",
        eventId: randomUUID(),
        payload: { timestamp: Date.now() },
      }));
      break;
    }

    default:
      logger.debug({ type: message.type, gameId }, "Unknown WebSocket message type");
  }
}
