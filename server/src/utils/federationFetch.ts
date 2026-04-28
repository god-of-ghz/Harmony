/**
 * federationFetch — Scoped HTTPS Agent for Server-to-Server Requests
 *
 * Replaces the global `NODE_TLS_REJECT_UNAUTHORIZED = '0'` anti-pattern.
 * Uses a Node.js https.Agent that skips certificate verification ONLY for
 * outbound server-to-server (federation) requests made by the Node.js process.
 *
 * This has zero effect on browser clients — browsers enforce TLS trust natively.
 * For production deployments with valid CA-signed certs, set
 * FEDERATION_REJECT_UNAUTHORIZED=true to re-enable full certificate validation.
 *
 * TODO [VISION:V1] This function currently does NO identity verification of the
 * peer server. The vision (HARMONY_VISION.md) requires that federationFetch
 * verifies the peer's Ed25519 fingerprint on every request against the stored
 * fingerprint in the `trusted_servers` table. This prevents a compromised DNS
 * or MITM attack from redirecting federation traffic to an impostor server.
 * Implementation: after the fetch completes, call /api/federation/key on the peer,
 * compute its fingerprint, and compare against the pinned value. Reject on mismatch.
 * This is a V1 feature — do NOT attempt during alpha/beta stabilization work.
 */

import https from 'https';

// In production with real certs, operators can enforce strict TLS validation for
// outbound federation requests by setting this env var to "true".
const rejectUnauthorized = process.env.FEDERATION_REJECT_UNAUTHORIZED === 'true';

const federationAgent = new https.Agent({ rejectUnauthorized });

export type FederationFetchOptions = Omit<RequestInit, 'agent'> & {
    signal?: AbortSignal;
};

/**
 * A drop-in replacement for `fetch()` for all server-to-server (federation) HTTP calls.
 * Attaches a scoped https.Agent that handles self-signed certs in local dev
 * WITHOUT poisoning the global process TLS configuration.
 */
export async function federationFetch(url: string, options: FederationFetchOptions = {}): Promise<Response> {
    return fetch(url, {
        ...options,
        // @ts-ignore — Node.js fetch accepts `agent` as an undocumented extension
        agent: url.startsWith('https') ? federationAgent : undefined,
    });
}

