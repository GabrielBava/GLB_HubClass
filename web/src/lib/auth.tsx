import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setCsrfToken } from "./api";
import type { Role } from "../../../shared/domain";

export interface Me {
  authenticated: true;
  csrfToken: string;
  sessionExpiresAt: string;
  mfa: { required: boolean; enabled: boolean; satisfied: boolean };
  user: { id: string; code: string; name: string; email: string; role: Role; jobTitle: string | null; team: string | null; department: string | null };
  onboardingCompleted: boolean;
  termsAccepted: boolean;
  currentTermsVersion: string | null;
  leader: { areas: { id: string; name: string }[]; teams: { id: string; name: string }[] } | null;
  canManageContent: boolean;
}

type MeResponse = Me | { authenticated: false };

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  /** A sessão expirou durante o uso (não foi um logout voluntário). */
  expired: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/api/auth/me"),
    staleTime: 60_000,
    retry: 1,
  });
  const me = data && data.authenticated ? data : null;
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setCsrfToken(me?.csrfToken ?? null);
  }, [me?.csrfToken]);

  useEffect(() => {
    const onUnauthorized = () => {
      setExpired(true);
      qc.setQueryData(["me"], { authenticated: false });
    };
    const onRecheck = () => void refetch();
    window.addEventListener("lc:unauthorized", onUnauthorized);
    window.addEventListener("lc:mfa-required", onRecheck);
    window.addEventListener("lc:terms-required", onRecheck);
    return () => {
      window.removeEventListener("lc:unauthorized", onUnauthorized);
      window.removeEventListener("lc:mfa-required", onRecheck);
      window.removeEventListener("lc:terms-required", onRecheck);
    };
  }, [qc, refetch]);

  const logout = async () => {
    setExpired(false);
    try {
      await api.post("/api/auth/logout");
    } finally {
      setCsrfToken(null);
      qc.clear();
      qc.setQueryData(["me"], { authenticated: false });
    }
  };

  return <AuthContext.Provider value={{ me, loading: isLoading, expired, refresh: refetch, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider ausente");
  return ctx;
}

export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("Usuário não autenticado");
  return me;
}

export const isLeaderOrAdmin = (me: Me | null) => me?.user.role === "leader" || me?.user.role === "admin";
