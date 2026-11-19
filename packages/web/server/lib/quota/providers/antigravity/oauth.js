import { z } from 'zod';

// Installed-app client already used by the Antigravity auth plugin.
// Keeping this in git is fine: for an installed application Google expects
// the client ID and secret to be embedded in the source, and "the client
// secret is obviously not treated as a secret"
// (https://developers.google.com/identity/protocols/oauth2#installed).
const ANTIGRAVITY_CLIENT = {
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  clientSecret: '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',
};

const tokenResponse = z.object({ access_token: z.string().trim().min(1) });
const oauthError = z.object({ error: z.enum(['unauthorized_client', 'invalid_grant', 'invalid_client']) });

const exchange = async (refreshToken) => {
  let status = null;
  const signal = AbortSignal.timeout(15000);
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT.clientId,
        client_secret: ANTIGRAVITY_CLIENT.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      redirect: 'error',
      signal,
    });
    status = response.status;
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { ok: false, status, error: response.ok ? 'invalid_response' : 'http' };
      }
      throw error;
    }
    if (!response.ok) {
      return { ok: false, status, error: oauthError.safeParse(data).data?.error ?? 'http' };
    }
    const token = tokenResponse.safeParse(data);
    if (!token.success) return { ok: false, status, error: 'invalid_response' };
    return { ok: true, accessToken: token.data.access_token };
  } catch (error) {
    return { ok: false, status, error: signal.aborted || error?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
};

/**
 * Exchange an Antigravity refresh token for an access token.
 * The credential has no reliable client marker, so the probe stays on the
 * Antigravity client only: the Gemini CLI client is not used by the plugin.
 */
export const refreshAntigravityAccessToken = async (refreshToken) => exchange(refreshToken);
