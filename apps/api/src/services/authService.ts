import {
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
  type StyleId,
  type UserProfile,
  type UserStats,
} from "@chessverse/contracts";
import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";
import type { GameRepository, StoredGame, UserRecord } from "../types.js";
import { HttpError } from "../types.js";

export interface TokenPayload {
  userId: string;
  username: string;
  exp: number;
}

export class AuthService {
  private readonly secret: string;

  constructor(
    private readonly repository: GameRepository,
    secret: string = env.AUTH_SECRET,
  ) {
    this.secret = secret;
  }

  hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${derived}`;
  }

  verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(":");
    if (parts.length !== 2) {
      return false;
    }
    const salt = parts[0];
    const expectedHash = parts[1];
    if (!salt || !expectedHash) {
      return false;
    }
    const derived = scryptSync(password, salt, 64).toString("hex");
    const expectedBuf = Buffer.from(expectedHash, "hex");
    const derivedBuf = Buffer.from(derived, "hex");
    if (expectedBuf.length !== derivedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, derivedBuf);
  }

  createToken(payload: Omit<TokenPayload, "exp">, expiresInSeconds = 30 * 86400): string {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const fullPayload: TokenPayload = { ...payload, exp };
    const payloadEncoded = Buffer.from(JSON.stringify(fullPayload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.secret)
      .update(payloadEncoded)
      .digest("base64url");
    return `${payloadEncoded}.${signature}`;
  }

  verifyToken(token: string): TokenPayload | null {
    if (!token || typeof token !== "string") {
      return null;
    }
    const [payloadEncoded, signature] = token.split(".");
    if (!payloadEncoded || !signature) {
      return null;
    }

    const expectedSignature = createHmac("sha256", this.secret)
      .update(payloadEncoded)
      .digest("base64url");

    const expectedBuf = Buffer.from(expectedSignature, "utf8");
    const actualBuf = Buffer.from(signature, "utf8");

    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      return null;
    }

    try {
      const decodedJson = Buffer.from(payloadEncoded, "base64url").toString("utf8");
      const payload = JSON.parse(decodedJson) as TokenPayload;
      if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
        return null; // Expired
      }
      return payload;
    } catch {
      return null;
    }
  }

  extractUserFromAuthHeader(header?: string): TokenPayload | null {
    if (!header || !header.startsWith("Bearer ")) {
      return null;
    }
    const token = header.slice(7).trim();
    return this.verifyToken(token);
  }

  async register(input: RegisterRequest): Promise<AuthResponse> {
    const existingByUsername = await this.repository.getUserByUsernameOrEmail(input.username);
    if (existingByUsername) {
      throw new HttpError(409, "Username already taken", { field: "username" });
    }

    const existingByEmail = await this.repository.getUserByUsernameOrEmail(input.email);
    if (existingByEmail) {
      throw new HttpError(409, "Email already registered", { field: "email" });
    }

    const now = new Date().toISOString();
    const user: UserRecord = {
      id: randomUUID(),
      username: input.username,
      email: input.email.toLowerCase(),
      passwordHash: this.hashPassword(input.password),
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.saveUser(user);

    const token = this.createToken({ userId: user.id, username: user.username });
    const userProfile: UserProfile = {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      stats: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
      },
    };

    return {
      token,
      user: userProfile,
    };
  }

  async login(input: LoginRequest): Promise<AuthResponse> {
    const user = await this.repository.getUserByUsernameOrEmail(input.usernameOrEmail);
    if (!user) {
      throw new HttpError(401, "Invalid username or password");
    }

    const matches = this.verifyPassword(input.password, user.passwordHash);
    if (!matches) {
      throw new HttpError(401, "Invalid username or password");
    }

    const token = this.createToken({ userId: user.id, username: user.username });
    const profile = await this.getProfile(user.id, user);

    return {
      token,
      user: profile,
    };
  }

  async getProfile(userId: string, userRecord?: UserRecord): Promise<UserProfile> {
    const user = userRecord ?? (await this.repository.getUserById(userId));
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const games = await this.repository.getUserGames(userId);
    const stats = this.computeUserStats(games);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      stats,
    };
  }

  private computeUserStats(games: StoredGame[]): UserStats {
    let wins = 0;
    let losses = 0;
    let draws = 0;
    const styleCounts = new Map<StyleId, number>();

    for (const game of games) {
      if (game.result === "win") wins += 1;
      else if (game.result === "loss") losses += 1;
      else if (game.result === "draw") draws += 1;

      if (game.style) {
        styleCounts.set(game.style, (styleCounts.get(game.style) ?? 0) + 1);
      }
    }

    const gamesPlayed = games.length;
    const winRate = gamesPlayed > 0 ? Number(((wins / gamesPlayed) * 100).toFixed(1)) : 0;

    let favoriteStyle: StyleId | undefined = undefined;
    let maxCount = 0;
    for (const [style, count] of styleCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        favoriteStyle = style;
      }
    }

    return {
      gamesPlayed,
      wins,
      losses,
      draws,
      winRate,
      ...(favoriteStyle ? { favoriteStyle } : {}),
    };
  }
}
