import type {
  AuthResponse,
  CreateGameRequest,
  CreateGameResponse,
  Difficulty,
  GameHistoryResponse,
  LoginRequest,
  MoveRequest,
  MoveResponse,
  PlayerColor,
  PlayerMoveRequest,
  PlayerMoveResponse,
  RegisterRequest,
  ResignResponse,
  StyleId,
  UndoRequest,
  UndoResponse,
  UserProfile,
} from "@chessverse/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

const buildUrl = (path: string) => (API_BASE_URL ? `${API_BASE_URL}${path}` : path);

export const AUTH_STORAGE_KEY = "chessverse_auth_token";

export const getStoredAuthToken = (): string | null => {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const setStoredAuthToken = (token: string | null): void => {
  try {
    if (token) {
      localStorage.setItem(AUTH_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in private browsing
  }
};

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

  const token = getStoredAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
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
  createGame: (payload: CreateGameRequest) =>
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
  offerDraw: (gameId: string) =>
    request<{ accepted: boolean; game: CreateGameResponse }>(`/games/${gameId}/draw-offer`, { method: "POST" }),
  engineMove: (payload: MoveRequest) =>
    request<MoveResponse>("/engine/move", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  register: (payload: RegisterRequest) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload: LoginRequest) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getMe: () => request<UserProfile>("/auth/me"),
  getHistory: () => request<GameHistoryResponse>("/games/history"),
};
