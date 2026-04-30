import { supabase } from "./supabaseClient.js";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
}

async function getCurrentAccessToken() {
  requireSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session?.access_token || "";
}

export async function requestGameAnalysis({ gameId, game, minutesData, range }) {
  requireSupabase();
  const accessToken = await getCurrentAccessToken();
  const { data, error } = await supabase.functions.invoke("wnba-game-analysis", {
    body: {
      accessToken,
      gameId,
      game,
      minutesData,
      range,
    },
  });

  if (error) {
    throw new Error(error.message || "Unable to generate analysis.");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}
