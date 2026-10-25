import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import { useToast } from "../components/toast";

/** Consulta GET simples: a chave da consulta é a própria URL. */
export function useApi<T>(url: string | null, opts: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [url],
    queryFn: () => api.get<T>(url!),
    enabled: !!url && opts.enabled !== false,
    refetchInterval: opts.refetchInterval,
  });
}

interface MutationOpts<R> {
  invalidate?: (string | QueryKey)[];
  success?: string | ((r: R) => string | null);
  onSuccess?: (r: R) => void;
  silent?: boolean;
}

/** Mutação com aviso de sucesso/erro e invalidação de consultas relacionadas. */
export function useAction<V, R = unknown>(fn: (v: V) => Promise<R>, opts: MutationOpts<R> = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      for (const key of opts.invalidate ?? []) {
        if (typeof key === "string") await qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(key) });
        else await qc.invalidateQueries({ queryKey: key });
      }
      const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(r);
    },
    onError: (err) => {
      if (!opts.silent) toast.error(errorMessage(err));
    },
  });
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDocumentTitle(title: string | undefined, platform = "LIFE CLASS") {
  useEffect(() => {
    if (title) document.title = `${title} · ${platform}`;
  }, [title, platform]);
}
