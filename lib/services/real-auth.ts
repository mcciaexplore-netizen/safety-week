import { BRANCHES } from "@/lib/mock/branches";
import type { Branch, UserRole } from "@/lib/types";
import { getSession, setSession } from "./session-store";
import { AuthError, type AuthService, type Session } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const API_URL = process.env.NEXT_PUBLIC_API_URL;

/** The web app talks to the real API whenever NEXT_PUBLIC_API_URL is set; otherwise it is the mock demo. */
export const API_MODE = !!API_URL;
/** Password sign-in through Supabase (needs all three vars). Without it, API mode uses the dev token endpoint. */
export const REAL_AUTH = !!(SUPABASE_URL && ANON_KEY && API_URL);

/** Stand-in "branch" for the central admin, who belongs to none of the five. Never sent to the API. */
export const CENTRAL_BRANCH: Branch = {
  id: "br-central", code: "SBR" as Branch["code"], name: "All branches", address: "", phone: "", email: "", active: true,
};

interface Me {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  branch: { code: string; name: string } | null;
}

/**
 * Sign-in against Supabase Auth (plain REST, no SDK), then ask OUR API who the token
 * belongs to. The branch shown in the workspace is what the SERVER answers; the branch
 * picked on the previous screen is only a hint and is checked against it.
 */
export const realAuth: AuthService = {
  async signIn({ branchId, email, password }) {
    // DEV: no Supabase yet -> the API's dev endpoint (exists only when DEV_LOGIN=true and SUPABASE_URL is unset).
    const res = REAL_AUTH
      ? await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: { apikey: ANON_KEY!, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
      : await fetch(`${API_URL}/api/v1/dev/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
    if (!res.ok) throw new AuthError(REAL_AUTH ? "Incorrect e-mail or password." : "Unknown dev user.");
    const { access_token: token } = (await res.json()) as { access_token: string };

    const meRes = await fetch(`${API_URL}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (meRes.status === 403) throw new AuthError("Your account has no access to this system. Contact MCCIA.");
    if (!meRes.ok) throw new AuthError("Could not verify your account. Please try again.");
    const me = (await meRes.json()) as Me;

    let branch: Branch | undefined = CENTRAL_BRANCH;
    if (me.role === "SUPER_ADMIN") {
      if (branchId !== CENTRAL_BRANCH.id) throw new AuthError("This is a central admin account. Use \"Central admin sign-in\".");
    } else {
      if (branchId === CENTRAL_BRANCH.id) throw new AuthError("This account is not a central admin.");
      branch = BRANCHES.find((b) => b.code === me.branch?.code);
      const picked = BRANCHES.find((b) => b.id === branchId);
      if (!branch) throw new AuthError("Your branch is not configured in this build.");
      if (picked && picked.id !== branch.id)
        throw new AuthError(`This account belongs to ${branch.name}, not ${picked.name}. Choose ${branch.name} instead.`);
    }

    const session: Session = {
      user: { id: me.id, name: me.name, email: me.email, role: me.role, branchId: branch.id },
      branch,
      signedInAt: new Date().toISOString(),
      accessToken: token,
    };
    setSession(session);
    return session;
  },

  async signOut() {
    const token = getSession()?.accessToken;
    setSession(null);
    if (token && REAL_AUTH)
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: ANON_KEY!, Authorization: `Bearer ${token}` },
      }).catch(() => {}); // ponytail: best-effort revoke; the token expires on its own anyway
  },
};
