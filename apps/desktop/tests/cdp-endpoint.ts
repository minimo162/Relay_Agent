export const DEFAULT_RELAY_CDP_ENDPOINT = "http://127.0.0.1:9360";

export function relayCdpEndpointFromEnv(): string {
  return process.env.CDP_ENDPOINT || DEFAULT_RELAY_CDP_ENDPOINT;
}
