import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  errorPayload,
  executePermanentStudentDeletion,
  StudentDeletionError,
  STUDENT_DEPENDENCY_TABLES
} from "./logic.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing Edge Function environment variable: ${name}`);
  return value;
}

function isAuthUserNotFound(error: { status?: number; code?: string; message?: string } | null) {
  if (!error) return false;
  return error.status === 404
    || error.code === "user_not_found"
    || /user not found/i.test(error.message || "");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Méthode non autorisée." }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization") || "";
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const body = await request.json().catch(() => ({}));
    const attemptId = crypto.randomUUID();

    const result = await executePermanentStudentDeletion({
      authorization,
      studentId: body.student_id,
      requestId: body.request_id,
      attemptId
    }, {
      async authenticate(authHeader: string) {
        const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) {
          throw new StudentDeletionError("UNAUTHENTICATED", "Jeton de connexion absent.", 401);
        }
        const { data, error } = await adminClient.auth.getUser(token);
        if (error || !data.user) {
          throw new StudentDeletionError("UNAUTHENTICATED", "Session administrateur invalide.", 401);
        }
        return data.user;
      },

      async prepareDeletion({ studentId, requestId, attemptId: currentAttemptId }) {
        const { data, error } = await callerClient.rpc("admin_prepare_student_deletion", {
          p_student_id: studentId,
          p_request_id: requestId,
          p_attempt_id: currentAttemptId
        });
        if (error) {
          const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
          throw new StudentDeletionError(
            error.code || "DELETION_PRECONDITION_FAILED",
            error.message || "Suppression refusée par les contrôles serveur.",
            status
          );
        }
        return data;
      },

      async deleteAuthUser(authUserId: string) {
        const { error } = await adminClient.auth.admin.deleteUser(authUserId, false);
        if (error) throw error;
      },

      async inspectDeletion(target: { student_id: string; auth_user_id: string }) {
        const authResult = await adminClient.auth.admin.getUserById(target.auth_user_id);
        if (authResult.error && !isAuthUserNotFound(authResult.error)) throw authResult.error;
        const authExists = !!authResult.data?.user && !isAuthUserNotFound(authResult.error);

        const studentResult = await adminClient
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("id", target.student_id);
        if (studentResult.error) throw studentResult.error;

        const dependencyResults = await Promise.all(STUDENT_DEPENDENCY_TABLES.map(async table => {
          const result = await adminClient
            .from(table)
            .select("*", { count: "exact", head: true })
            .eq("student_id", target.student_id);
          if (result.error) throw result.error;
          return [table, result.count || 0] as const;
        }));

        return {
          authExists,
          studentExists: (studentResult.count || 0) > 0,
          dependencyCounts: Object.fromEntries(dependencyResults)
        };
      },

      async markCompleted(requestId: string, state: unknown, recovered: boolean) {
        const { error } = await adminClient
          .from("admin_student_deletion_requests")
          .update({
            status: "completed",
            result: { recovered_after_interruption: recovered, verified_state: state },
            error_code: null,
            error_message: null,
            lease_expires_at: null,
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString()
          })
          .eq("request_id", requestId);
        if (error) throw error;
      },

      async markFailed(requestId: string, code: string, message: string) {
        const { error } = await adminClient
          .from("admin_student_deletion_requests")
          .update({
            status: "failed",
            error_code: code,
            error_message: String(message).slice(0, 1000),
            lease_expires_at: null,
            updated_at: new Date().toISOString()
          })
          .eq("request_id", requestId);
        if (error) throw error;
      },

      logError(message: string, error: unknown) {
        console.error(`[delete-student] ${message}`, error);
      }
    });

    return jsonResponse(result);
  } catch (error) {
    const payload = errorPayload(error);
    console.error("[delete-student] request failed", {
      code: payload.body.code,
      message: error instanceof Error ? error.message : String(error)
    });
    return jsonResponse(payload.body, payload.status);
  }
});
