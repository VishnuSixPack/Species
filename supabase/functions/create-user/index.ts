// supabase/functions/create-user/index.ts
//
// Creates a user by INVITE — no password is ever set by the admin.
// The invited person receives an email, clicks it, and chooses their own
// password on set-password.html. Clicking the link is the email verification.
//
// Deploy:  supabase functions deploy create-user

import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE_URL = "https://species-3r1.pages.dev";

const CORS = {
  "Access-Control-Allow-Origin": SITE_URL, // not "*" — this endpoint mutates state
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Roles permitted to create other users at all.
const CAN_CREATE = ["admin", "operator", "company_admin"];
// Roles that only a platform-level admin may hand out.
const PRIVILEGED = ["admin", "operator"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // ---------------------------------------------------------------
    // 1. Identify the caller. Without this block the function is an
    //    open user-creation endpoint for anyone who knows the URL.
    // ---------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not signed in" }, 401);

    const asCaller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user: caller }, error: callerErr } = await asCaller.auth.getUser();
    if (callerErr || !caller) return json({ error: "Session is not valid" }, 401);

    // ---------------------------------------------------------------
    // 2. Check what the caller is allowed to do.
    // ---------------------------------------------------------------
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: profile } = await admin
      .from("profiles")
      .select("role, company_id, is_suspended")
      .eq("id", caller.id)
      .single();

    if (!profile || profile.is_suspended || !CAN_CREATE.includes(profile.role)) {
      return json({ error: "You do not have permission to add users" }, 403);
    }

    // ---------------------------------------------------------------
    // 3. Validate input.
    // ---------------------------------------------------------------
    const body = await req.json().catch(() => ({}));

    const email = String(body.email ?? "").trim().toLowerCase();
    const firstName = String(body.first_name ?? "").trim();
    const lastName = String(body.last_name ?? "").trim();
    const position = body.position ? String(body.position).trim() : null;

    let role = String(body.role ?? "user").trim();
    let companyId = body.company_id ?? null;

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      return json({ error: "Enter a valid email address" }, 400);
    }
    if (!firstName || !lastName) {
      return json({ error: "First and last name are required" }, 400);
    }

    // A company admin can only add people to their own company, and cannot
    // mint platform-level roles. Enforced here, not in the browser.
    if (profile.role === "company_admin") {
      companyId = profile.company_id;
      if (PRIVILEGED.includes(role)) {
        return json({ error: "You cannot assign that role" }, 403);
      }
    }
    if (!companyId) return json({ error: "Select a company" }, 400);

    // ---------------------------------------------------------------
    // 4. Invite. This sends the email and creates the auth user in one
    //    step. No password crosses the wire, and the address must be
    //    reachable or the person can never sign in.
    // ---------------------------------------------------------------
    const { data: invited, error: inviteErr } = await admin.auth.admin
      .inviteUserByEmail(email, {
        data: {
          first_name: firstName,
          last_name: lastName,
          company_id: companyId,
          role,
          position,
        },
        redirectTo: `${SITE_URL}/set-password.html`,
      });

    if (inviteErr) {
      const msg = /already/i.test(inviteErr.message)
        ? "That email already has an account"
        : inviteErr.message;
      return json({ error: msg }, 400);
    }

    // ---------------------------------------------------------------
    // 5. Mirror into profiles. If this fails, remove the auth user so
    //    you don't accumulate orphans like the ones sitting in the
    //    dashboard right now.
    // ---------------------------------------------------------------
    const { error: profileErr } = await admin.from("profiles").upsert({
      id: invited.user.id,
      first_name: firstName,
      last_name: lastName,
      email,
      company_id: companyId,
      role,
      position,
      status: "invited",
      is_suspended: false,
    }, { onConflict: "id" });

    if (profileErr) {
      await admin.auth.admin.deleteUser(invited.user.id);
      return json({ error: `Could not save profile: ${profileErr.message}` }, 500);
    }

    return json({
      ok: true,
      user_id: invited.user.id,
      email,
      message: `Invite sent to ${email}`,
    });
  } catch (e) {
    console.error("create-user failed:", e);
    return json({ error: "Something went wrong creating the user" }, 500);
  }
});