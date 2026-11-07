import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const publicAuth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

function validPassword(password: string) {
  return password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}
async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
async function rateLimit(req: Request, username: string, action: string, limit: number, windowMinutes: number) {
  const ip = req.headers.get("cf-connecting-ip") ??
    (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const key = await sha256(ip + ":" + username.toLowerCase());
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await admin.from("auth_attempts")
    .select("id", { count: "exact", head: true })
    .eq("key_hash", key).eq("action", action).gte("attempted_at", since);
  if (error) throw error;
  if ((count ?? 0) >= limit) return false;
  const { error: insertError } = await admin.from("auth_attempts")
    .insert({ key_hash: key, action });
  if (insertError) throw insertError;
  // Keep this short-lived log bounded.
  await admin.from("auth_attempts").delete()
    .lt("attempted_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  return true;
}
async function checkPermission(userId: string, permission: string) {
  const { data: userRoles, error: roleError } = await admin.from("user_roles")
    .select("role_id").eq("user_id", userId);
  if (roleError) throw roleError;
  const roleIds = (userRoles ?? []).map((x: { role_id: string }) => x.role_id);
  if (!roleIds.length) return false;
  const { data: rolePermissions, error: permissionError } = await admin.from("role_permissions")
    .select("permission_id").in("role_id", roleIds);
  if (permissionError) throw permissionError;
  const permissionIds = (rolePermissions ?? []).map((x: { permission_id: string }) => x.permission_id);
  if (!permissionIds.length) return false;
  const { data: permissions, error: namesError } = await admin.from("permissions")
    .select("name").in("id", permissionIds);
  if (namesError) throw namesError;
  return (permissions ?? []).some((x: { name: string }) => x.name === permission);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action = String(body.action ?? "");
    const username = String(body.username ?? "").trim().toLowerCase();

    if (action === "signup") {
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        return json({ error: "Der Benutzername muss 3–20 Zeichen lang sein (Buchstaben, Zahlen, _)." }, 400);
      }
      const password = String(body.password ?? "");
      if (!validPassword(password)) {
        return json({ error: "Das Passwort benötigt mindestens 12 Zeichen sowie Groß-/Kleinbuchstaben, Zahl und Sonderzeichen." }, 400);
      }
      if (!await rateLimit(req, username, "signup", 3, 60)) {
        return json({ error: "Zu viele Registrierungsversuche. Bitte später erneut versuchen." }, 429);
      }
      const { data: existing, error: lookupError } = await admin.from("profiles")
        .select("id").eq("username", username).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) return json({ error: "Dieser Benutzername ist bereits vergeben." }, 409);

      const email = username + "@accounts.krake.invalid";
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { username },
        app_metadata: { auth_method: "username_password" },
      });
      if (error) {
        if (/already.*registered|already.*exists/i.test(error.message)) {
          return json({ error: "Dieser Benutzername ist bereits vergeben." }, 409);
        }
        throw error;
      }
      return json({ ok: true, user_id: data.user.id, username, message: "Account erstellt. Du kannst dich jetzt anmelden." });
    }

    if (action === "login") {
      if (!/^[a-z0-9_]{3,20}$/.test(username)) return json({ error: "Benutzername oder Passwort falsch." }, 401);
      const password = String(body.password ?? "");
      if (!password || password.length > 256) return json({ error: "Benutzername oder Passwort falsch." }, 401);
      if (!await rateLimit(req, username, "login", 8, 5)) {
        return json({ error: "Zu viele Login-Versuche. Bitte 5 Minuten warten." }, 429);
      }
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("id,username").eq("username", username).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return json({ error: "Benutzername oder Passwort falsch." }, 401);
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
      if (userError || !userData.user?.email) return json({ error: "Benutzername oder Passwort falsch." }, 401);

      const { data: authData, error: authError } = await publicAuth.auth.signInWithPassword({
        email: userData.user.email, password,
      });
      if (authError || !authData.session) return json({ error: "Benutzername oder Passwort falsch." }, 401);
      return json({
        ok: true,
        session: {
          access_token: authData.session.access_token,
          refresh_token: authData.session.refresh_token,
          expires_at: authData.session.expires_at,
          token_type: authData.session.token_type,
        },
      });
    }

    if (action === "admin_reset_password") {
      const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!bearer) return json({ error: "Nicht angemeldet." }, 401);
      const { data: caller, error: callerError } = await admin.auth.getUser(bearer);
      if (callerError || !caller.user) return json({ error: "Nicht angemeldet." }, 401);
      if (!await checkPermission(caller.user.id, "users.edit")) return json({ error: "Keine Berechtigung." }, 403);
      const targetId = String(body.user_id ?? "");
      const newPassword = String(body.new_password ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({ error: "Ungültiger Account." }, 400);
      if (!validPassword(newPassword)) return json({ error: "Neues Passwort erfüllt die Sicherheitsregeln nicht." }, 400);
      const { error } = await admin.auth.admin.updateUserById(targetId, { password: newPassword });
      if (error) throw error;
      await admin.from("audit_logs").insert({
        actor_user_id: caller.user.id, target_user_id: targetId,
        action: "admin_reset_password", metadata: { via: "krake-auth" },
      });
      return json({ ok: true, message: "Passwort wurde zurückgesetzt." });
    }

    return json({ error: "Unbekannte Aktion." }, 400);
  } catch (error) {
    console.error("krake-auth error", error);
    return json({ error: "Serverfehler. Bitte später erneut versuchen." }, 500);
  }
});