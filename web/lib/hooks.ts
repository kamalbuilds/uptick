"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchVault } from "./keeper";

export const useVaultStats = (id: string) =>
  useQuery({ queryKey: ["vault", id], queryFn: () => fetchVault(id), refetchInterval: 30_000 });
