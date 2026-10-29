import { useCallback, useEffect, useState } from "react";
import type { LoginRequest, RegisterRequest, UserProfile } from "@chessverse/contracts";
import { api, getStoredAuthToken, setStoredAuthToken } from "../api/client.js";

export interface UseAuthReturn {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

export const useAuth = (): UseAuthReturn => {
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken());
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    const currentToken = getStoredAuthToken();
    if (!currentToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const profile = await api.getMe();
      setUser(profile);
    } catch {
      // Token expired or invalid
      setStoredAuthToken(null);
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const login = useCallback(
    async (input: LoginRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.login(input);
        setStoredAuthToken(res.token);
        setToken(res.token);
        setUser(res.user);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to sign in";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const register = useCallback(
    async (input: RegisterRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.register(input);
        setStoredAuthToken(res.token);
        setToken(res.token);
        setUser(res.user);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to register";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    setStoredAuthToken(null);
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  return {
    user,
    token,
    isLoading,
    error,
    login,
    register,
    logout,
    refreshProfile,
  };
};
