export type AntigravityOAuthRefreshFailure = {
  ok: false;
  status: number | null;
  error:
    | 'unauthorized_client'
    | 'invalid_grant'
    | 'invalid_client'
    | 'http'
    | 'network'
    | 'timeout'
    | 'invalid_response';
};

export type AntigravityOAuthRefreshResult =
  | { ok: true; accessToken: string }
  | AntigravityOAuthRefreshFailure;

export function refreshAntigravityAccessToken(
  refreshToken: string
): Promise<AntigravityOAuthRefreshResult>;
