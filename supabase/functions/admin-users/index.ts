import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedDomain = (Deno.env.get("VITE_ALLOWED_EMAIL_DOMAIN") || "monumentalsports.com")
  .replace(/^@/, "")
  .toLowerCase();

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTeamScopes(values: unknown) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase function secrets are missing.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function requireAdmin(adminClient: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  let token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    const cloned = req.clone();
    const body = await cloned.json().catch(() => ({}));
    token = typeof body?.accessToken === "string" ? body.accessToken : "";
  }
  if (!token) {
    return { error: "Missing authorization token.", status: 401 } as const;
  }

  const { data: userData, error: authError } = await adminClient.auth.getUser(token);
  if (authError || !userData?.user?.id) {
    return { error: "Unable to verify session.", status: 401 } as const;
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id,role,status")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "admin" || profile.status !== "active") {
    return { error: "Admin access required.", status: 403 } as const;
  }

  return { adminUserId: profile.id } as const;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let adminClient;
  try {
    adminClient = getAdminClient();
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : "Configuration error" });
  }

  const permission = await requireAdmin(adminClient, req);
  if ("error" in permission) {
    return jsonResponse(permission.status, { error: permission.error });
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (!["invite", "create_user"].includes(String(body?.action || ""))) {
      return jsonResponse(400, { error: "Unsupported admin action." });
    }

    const email = normalizeEmail(body?.email);
    if (!email || !email.endsWith(`@${allowedDomain}`)) {
      return jsonResponse(400, { error: `Use an @${allowedDomain} email address.` });
    }

    const role = body?.role === "admin" ? "admin" : "coach";
    const displayName = String(body?.displayName || "").trim() || null;
    const teamScopes = normalizeTeamScopes(body?.teamScopes);

    const { data: inviteRow, error: inviteError } = await adminClient
      .from("account_invites")
      .upsert({
        email,
        display_name: displayName,
        role,
        team_scopes: teamScopes,
        status: "pending",
        invited_by: permission.adminUserId,
      }, {
        onConflict: "email",
      })
      .select("*")
      .single();

    if (inviteError) {
      return jsonResponse(400, { error: inviteError.message });
    }

    if (body.action === "create_user") {
      const password = String(body?.password || "");
      if (password.length < 8) {
        return jsonResponse(400, { error: "Password must be at least 8 characters." });
      }

      const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
        },
      });

      if (createUserError) {
        return jsonResponse(400, { error: createUserError.message });
      }

      return jsonResponse(200, {
        invite: inviteRow,
        authUser: createdUser?.user || null,
      });
    }

    const redirectTo = typeof body?.redirectTo === "string" && body.redirectTo
      ? body.redirectTo
      : undefined;

    const { data: inviteResult, error: authInviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        display_name: displayName,
      },
    });

    if (authInviteError) {
      return jsonResponse(400, { error: authInviteError.message });
    }

    return jsonResponse(200, {
      invite: inviteRow,
      authUser: inviteResult?.user || null,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Unable to process admin request.",
    });
  }
});
