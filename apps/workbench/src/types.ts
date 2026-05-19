export type StatusResponse = {
  schemaVersion?: string;
  app: string;
  version: string;
  ready: boolean;
  checks: ReadonlyArray<{
    name: string;
    ready: boolean;
    detail: string;
    required?: boolean;
    state?: string | null;
  }>;
};

export type RelayManifestResponse = {
  schemaVersion: "RelayHtmlToolManifest.v1";
  app: string;
  version: string;
  baseUrl: string;
  auth: {
    type: "launch-token";
    queryParameter: "token";
    header: "X-Relay-Token";
  };
  cors: {
    localHtmlTools: boolean;
    allowedOrigins: string[];
  };
  endpoints: Array<{
    method: string;
    path: string;
    purpose: string;
  }>;
};
