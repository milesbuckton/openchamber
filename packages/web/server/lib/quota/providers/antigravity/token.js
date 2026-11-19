import { asNonEmptyString } from '../../utils/index.js';

/**
 * Split a stored refresh token into the token itself and the project context
 * the plugin packs into it. Both the Antigravity plugin and the Gemini CLI
 * use the pipe-packed shape "token|project|managedProject".
 */
export const parseAntigravityRefreshToken = (rawRefreshToken) => {
  const refreshToken = asNonEmptyString(rawRefreshToken);
  if (!refreshToken) {
    return { refreshToken: null, projectId: null, managedProjectId: null };
  }

  const [rawToken = '', rawProject = '', rawManagedProject = ''] = refreshToken.split('|');
  return {
    refreshToken: asNonEmptyString(rawToken),
    projectId: asNonEmptyString(rawProject),
    managedProjectId: asNonEmptyString(rawManagedProject),
  };
};
