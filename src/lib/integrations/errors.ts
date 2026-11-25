import { ToolUserError } from "../tools/types";
import { redactSecrets } from "../security/crypto";
import type { OAuthProviderId } from "./providers";

const LABEL: Record<OAuthProviderId, string> = { google: "Google", microsoft: "Microsoft 365" };

/** The provider is not connected for this workspace (or tokens are missing). */
export class IntegrationNotConnectedError extends ToolUserError {
  constructor(public provider: OAuthProviderId) {
    super(`The ${LABEL[provider]} integration is not connected for this workspace. Ask an admin to connect it under Integrations; do not attempt the action another way.`);
  }
}

/** Stored authorization is no longer valid: an admin must reconnect. The agent should not retry. */
export class IntegrationReconnectRequiredError extends ToolUserError {
  constructor(public provider: OAuthProviderId, reason = "authorization expired or was revoked") {
    super(`The ${LABEL[provider]} integration needs to be reconnected by a workspace admin (${reason}). Reconnect required — do not retry this action until it is reconnected.`);
  }
}

/** A permission the action needs was not granted during consent. */
export class IntegrationScopeError extends ToolUserError {
  constructor(public provider: OAuthProviderId, what: string) {
    super(`The connected ${LABEL[provider]} account did not grant permission to ${what}. Ask an admin to reconnect the integration and accept all requested permissions.`);
  }
}

/** Error returned by a provider REST API. Message is safe to show (no tokens, redacted, truncated). */
export class ProviderApiError extends ToolUserError {
  constructor(public provider: OAuthProviderId, public status: number, public service: string, detail: string) {
    super(`${service} API error (HTTP ${status})${detail ? `: ${redactSecrets(detail).slice(0, 300)}` : ""}`);
  }
}

export function providerLabel(p: OAuthProviderId): string {
  return LABEL[p];
}
