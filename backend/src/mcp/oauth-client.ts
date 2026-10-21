import { randomBytes } from "node:crypto";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";

export type OAuthState = {
  state: string;
  redirectUrl: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
  authorizationUrl?: string;
};

export function newOAuthState(redirectUrl: string): OAuthState {
  return { state: randomBytes(32).toString("base64url"), redirectUrl };
}

export function parseOAuthState(value: string): OAuthState {
  try {
    const parsed = JSON.parse(value) as OAuthState;
    if (!parsed || typeof parsed !== "object" || typeof parsed.state !== "string"
      || typeof parsed.redirectUrl !== "string") throw new Error("invalid state");
    return parsed;
  } catch {
    throw new Error("OAuth state is invalid");
  }
}

export function createOAuthProvider(
  state: OAuthState,
  persist: (state: OAuthState) => Promise<void>,
): OAuthClientProvider {
  const save = async (change: (current: OAuthState) => OAuthState) => {
    Object.assign(state, change(state));
    await persist(state);
  };
  const clientMetadata: OAuthClientMetadata = {
    redirect_uris: [state.redirectUrl],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "灵工 MCP Connector",
  };
  return {
    get redirectUrl() { return state.redirectUrl; },
    clientMetadata,
    state: () => state.state,
    clientInformation: () => state.clientInformation,
    saveClientInformation: async (clientInformation) => save((current) => ({ ...current, clientInformation })),
    tokens: () => state.tokens,
    saveTokens: async (tokens) => save((current) => ({ ...current, tokens })),
    redirectToAuthorization: async (authorizationUrl) => save((current) => ({ ...current, authorizationUrl: authorizationUrl.toString() })),
    saveCodeVerifier: async (codeVerifier) => save((current) => ({ ...current, codeVerifier })),
    codeVerifier: () => {
      if (!state.codeVerifier) throw new Error("OAuth PKCE verifier is unavailable");
      return state.codeVerifier;
    },
    saveDiscoveryState: async (discoveryState) => save((current) => ({ ...current, discoveryState })),
    discoveryState: () => state.discoveryState,
    invalidateCredentials: async (scope) => {
      if (scope === "all" || scope === "client") delete state.clientInformation;
      if (scope === "all" || scope === "tokens") delete state.tokens;
      if (scope === "all" || scope === "verifier") delete state.codeVerifier;
      if (scope === "all" || scope === "discovery") delete state.discoveryState;
      await persist(state);
    },
  };
}
