import { createClient } from "@supabase/supabase-js";

const allowedDomain = (process.env.VITE_ALLOWED_EMAIL_DOMAIN || "monumentalsports.com")
  .replace(/^@/, "")
  .toLowerCase();

function getAdminClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin env vars are missing.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function requireAdmin(adminClient, req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return { error: "Missing authorization token.", status: 401 };
  }

  const { data: userData, error: authError } = await adminClient.auth.getUser(token);
  if (authError || !userData?.user?.id) {
    return { error: "Unable to verify session.", status: 401 };
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id,role,status")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "admin" || profile.status !== "active") {
    return { error: "Admin access required.", status: 403 };
  }

  return { adminUserId: profile.id };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let adminClient;
  try {
    adminClient = getAdminClient();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }

  const permission = await requireAdmin(adminClient, req);
  if (permission.error) {
    return res.status(permission.status).json({ error: permission.error });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!["invite", "create_user"].includes(body.action)) {
      return res.status(400).json({ error: "Unsupported admin action." });
    }

    const email = normalizeEmail(body.email);
    if (!email || !email.endsWith(`@${allowedDomain}`)) {
      return res.status(400).json({ error: `Use an @${allowedDomain} email address.` });
    }

    const role = body.role === "admin" ? "admin" : "coach";
    const displayName = String(body.displayName || "").trim() || null;
    const teamScopes = Array.from(
      new Set(
        (Array.isArray(body.teamScopes) ? body.teamScopes : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );
    const redirectTo = typeof body.redirectTo === "string" && body.redirectTo
      ? body.redirectTo
      : undefined;

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
      return res.status(400).json({ error: inviteError.message });
    }

    if (body.action === "create_user") {
      const password = String(body.password || "");
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
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
        return res.status(400).json({ error: createUserError.message });
      }

      return res.status(200).json({
        invite: inviteRow,
        authUser: createdUser?.user || null,
      });
    }

    const { data: inviteResult, error: authInviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        display_name: displayName,
      },
    });

    if (authInviteError) {
      return res.status(400).json({ error: authInviteError.message });
    }

    return res.status(200).json({
      invite: inviteRow,
      authUser: inviteResult?.user || null,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unable to process admin request." });
  }
}
