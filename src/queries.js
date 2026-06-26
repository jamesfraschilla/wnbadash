import { useQuery } from "@tanstack/react-query";
import {
  fetchGame,
  fetchGamesByDate,
  fetchMinutes,
} from "./api.js";

const normalizeKeyValue = (value, fallback = "all") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

export const queryKeys = {
  gamesByDate: (dateInput) => ["games", normalizeKeyValue(dateInput)],
  game: (gameId, segment = null) => [
    "game",
    normalizeKeyValue(gameId),
    normalizeKeyValue(segment),
  ],
  minutes: (gameId) => ["minutes", normalizeKeyValue(gameId)],
};

export function useGamesByDate(dateInput, options = {}) {
  return useQuery(gamesByDateQueryOptions(dateInput, options));
}

export function gamesByDateQueryOptions(dateInput, options = {}) {
  return {
    queryKey: queryKeys.gamesByDate(dateInput),
    queryFn: () => fetchGamesByDate(dateInput),
    enabled: Boolean(dateInput) && (options.enabled ?? true),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    ...options,
  };
}

export function useGame(gameId, options = {}) {
  return useQuery(gameQueryOptions(gameId, options));
}

export function gameQueryOptions(gameId, options = {}) {
  const {
    segment = null,
    ...queryOptions
  } = options;

  return {
    queryKey: queryKeys.game(gameId, segment),
    queryFn: () => fetchGame(gameId, segment),
    enabled: Boolean(gameId) && (queryOptions.enabled ?? true),
    staleTime: 30_000,
    ...queryOptions,
  };
}

export function useMinutes(gameId, options = {}) {
  return useQuery(minutesQueryOptions(gameId, options));
}

export function minutesQueryOptions(gameId, options = {}) {
  return {
    queryKey: queryKeys.minutes(gameId),
    queryFn: () => fetchMinutes(gameId),
    enabled: Boolean(gameId) && (options.enabled ?? true),
    ...options,
  };
}
