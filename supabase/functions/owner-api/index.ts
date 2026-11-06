
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const OWNER_ID = "cee3680c-3580-47c5-8c64-0277eac03800";

const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false }
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });
}

function validUsername(name: string) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(name);
}

function syntheticEmail(username: string) {
  return username.toLowerCase() + "@accounts.krakesmp.invalid";
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const action = body.action;

    // ==================================
    // ACCOUNT-ANTRAG
    // ==================================

    if (action === "apply") {
      const username = String(body.username || "").trim();

      if (!validUsername(username)) {
        return response({
          error: "Benutzername: 3-20 Zeichen, nur Buchstaben, Zahlen und _."
        }, 400);
      }

      const { data: existing } = await admin
        .from("ks_players")
        .select("id")
        .ilike("username", username)
        .maybeSingle();

      if (existing) {
        return response({ error: "Benutzername bereits vergeben." }, 409);
      }

      const { data: application } = await admin
        .from("ks_applications")
        .select("id")
        .ilike("username", username)
        .eq("status", "pending")
        .maybeSingle();

      if (application) {
        return response({ error: "Antrag bereits vorhanden." }, 409);
      }

      const { error } = await admin
        .from("ks_applications")
        .insert({ username });

      if (error) throw error;

      return response({
        success: true,
        message: "Antrag erfolgreich eingereicht."
      });
    }

    // ==================================
    // OWNER AUTHENTIFIZIEREN
    // ==================================

    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return response({ error: "Anmeldung erforderlich." }, 401);
    }

    const token = authHeader.slice(7);

    const { data: authData, error: authError } =
      await admin.auth.getUser(token);

    if (authError || !authData.user ||
        authData.user.id !== OWNER_ID) {
      return response({ error: "Kein Owner-Zugriff." }, 403);
    }

    // ==================================
    // ANTRÄGE UND SPIELER LADEN
    // ==================================

    if (action === "list") {
      const [applications, players, rounds] = await Promise.all([
        admin.from("ks_applications")
          .select("*")
          .eq("status", "pending")
          .order("created_at", { ascending: false }),

        admin.from("ks_players")
          .select("*")
          .order("username"),

        admin.from("ks_rounds")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200)
      ]);

      if (applications.error) throw applications.error;
      if (players.error) throw players.error;
      if (rounds.error) throw rounds.error;

      return response({
        applications: applications.data,
        players: players.data,
        rounds: rounds.data
      });
    }

    // ==================================
    // ANTRAG ABLEHNEN
    // ==================================

    if (action === "reject") {
      const { error } = await admin
        .from("ks_applications")
        .update({ status: "rejected" })
        .eq("id", body.id)
        .eq("status", "pending");

      if (error) throw error;

      return response({ success: true });
    }

    // ==================================
    // ANTRAG GENEHMIGEN
    // ==================================

    if (action === "approve") {
      const { data: application, error: appError } = await admin
        .from("ks_applications")
        .select("*")
        .eq("id", body.id)
        .eq("status", "pending")
        .single();

      if (appError || !application) {
        return response({ error: "Antrag nicht gefunden." }, 404);
      }

      const code = String(body.code || "");

      if (code.length < 12 || code.length > 128) {
        return response({
          error: "Sicherheitscode muss 12-128 Zeichen lang sein."
        }, 400);
      }

      const email = syntheticEmail(application.username);

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password: code,
          email_confirm: true,
          user_metadata: {
            username: application.username,
            account_type: "player"
          }
        });

      if (createError || !created.user) {
        throw createError || new Error("Account konnte nicht erstellt werden.");
      }

      const { error: profileError } = await admin
        .from("ks_players")
        .insert({
          id: created.user.id,
          username: application.username,
          total_profit: 0,
          total_wins: 0,
          total_losses: 0,
          total_rounds: 0,
          status: "active",
          is_banned: false
        });

      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }

      await admin
        .from("ks_applications")
        .update({ status: "approved" })
        .eq("id", application.id);

      return response({
        success: true,
        username: application.username,
        message: "Account erstellt. Sicherheitscode privat weitergeben."
      });
    }

    // ==================================
    // SPIELER AKTIONEN
    // ==================================

    if (action === "set_code") {
      const code = String(body.code || "");

      if (code.length < 12 || code.length > 128) {
        return response({ error: "Code muss 12-128 Zeichen haben." }, 400);
      }

      const { error } = await admin.auth.admin.updateUserById(
        body.id,
        { password: code }
      );

      if (error) throw error;

      return response({ success: true });
    }

    if (action === "ban" || action === "unban") {
      const updates = action === "ban"
        ? {
            is_banned: true,
            ban_reason: String(body.reason || "Owner-Bann").slice(0, 300),
            status: "banned"
          }
        : {
            is_banned: false,
            ban_reason: null,
            status: "active"
          };

      const { error } = await admin
        .from("ks_players")
        .update(updates)
        .eq("id", body.id)
        .neq("id", OWNER_ID);

      if (error) throw error;

      return response({ success: true });
    }

    if (action === "rename") {
      const username = String(body.username || "").trim();

      if (!validUsername(username)) {
        return response({ error: "Ungültiger Benutzername." }, 400);
      }

      if (body.id === OWNER_ID) {
        return response({ error: "Owner-Name hier nicht änderbar." }, 403);
      }

      const email = syntheticEmail(username);

      const { error: authUpdateError } =
        await admin.auth.admin.updateUserById(body.id, {
          email,
          email_confirm: true,
          user_metadata: { username, account_type: "player" }
        });

      if (authUpdateError) throw authUpdateError;

      const { error } = await admin
        .from("ks_players")
        .update({ username })
        .eq("id", body.id);

      if (error) throw error;

      return response({ success: true });
    }

    if (action === "delete") {
      if (body.id === OWNER_ID) {
        return response({ error: "Owner kann nicht gelöscht werden." }, 403);
      }

      const { error: roundsError } = await admin
        .from("ks_rounds")
        .delete()
        .eq("user_id", body.id);

      if (roundsError) throw roundsError;

      const { error: playerError } = await admin
        .from("ks_players")
        .delete()
        .eq("id", body.id);

      if (playerError) throw playerError;

      const { error: authDeleteError } =
        await admin.auth.admin.deleteUser(body.id);

      if (authDeleteError) throw authDeleteError;

      return response({ success: true });
    }

    // ==================================
    // RUNDE SPEICHERN / BEARBEITEN
    // ==================================

    if (action === "save_round") {
      const round = {
        user_id: body.user_id,
        game_name: String(body.game_name || "").slice(0, 100),
        stake: Number(body.stake),
        result: Number(body.result),
        won: body.won === true
      };

      if (
        !round.game_name ||
        !Number.isSafeInteger(round.stake) ||
        round.stake < 0 ||
        !Number.isSafeInteger(round.result)
      ) {
        return response({ error: "Ungültige Rundendaten." }, 400);
      }

      const result = body.id
        ? await admin.from("ks_rounds")
            .update(round).eq("id", body.id)
        : await admin.from("ks_rounds")
            .insert(round);

      if (result.error) throw result.error;

      return response({ success: true });
    }

    if (action === "delete_round") {
      const { error } = await admin
        .from("ks_rounds")
        .delete()
        .eq("id", body.id);

      if (error) throw error;

      return response({ success: true });
    }

    return response({ error: "Unbekannte Aktion." }, 400);

  } catch (error) {
    console.error(error);
    return response({
      error: error instanceof Error
        ? error.message
        : "Serverfehler"
    }, 500);
  }
});
