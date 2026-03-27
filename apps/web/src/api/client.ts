import type {
  CreateGameResponse,
  Difficulty,
  MoveRequest,
  MoveResponse,
  PlayerColor,
  PlayerMoveRequest,
  PlayerMoveResponse,
  ResignResponse,
  UndoRequest,
  UndoResponse,
} from "../contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

const buildUrl = (path: string) => (API_BASE_URL ? `${API_BASE_URL}${path}` : path);

const normalizeApiError = (message: string): string => {
  if (
    message.includes("Timed out waiting for Stockfish worker") ||
    message.includes("Engine busy, retry")
  ) {
    return "The engine is recalibrating. Please retry the move in a moment.";
  }

  return message;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  const headers = new Headers(init?.headers ?? undefined);

  if (init?.body !== undefined && init?.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    response = await fetch(buildUrl(path), {
      ...init,
      headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error("Unable to reach the Chessverse API. Start the backend server and try again.");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    throw new Error(normalizeApiError(data.error ?? "Request failed"));
  }

  return data as T;
};

export const api = {
  createGame: (payload: { playerColor: PlayerColor; difficulty: Difficulty }) =>
    request<CreateGameResponse>("/games", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getGame: (gameId: string) => request<CreateGameResponse>(`/games/${gameId}`),
  submitPlayerMove: (
    gameId: string,
    payload: PlayerMoveRequest,
    signal?: AbortSignal,
  ) =>
    request<PlayerMoveResponse>(`/games/${gameId}/player-move`, {
      method: "POST",
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    }),
  undo: (gameId: string, payload?: UndoRequest) =>
    request<UndoResponse>(`/games/${gameId}/undo`, {
      method: "POST",
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }),
  resign: (gameId: string) =>
    request<ResignResponse>(`/games/${gameId}/resign`, { method: "POST" }),
  engineMove: (payload: MoveRequest) =>
    request<MoveResponse>("/engine/move", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
