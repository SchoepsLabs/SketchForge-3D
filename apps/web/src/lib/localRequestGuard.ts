/**
 * Same localhost/dev-only gate the SketchForge MCP route applies, factored out
 * so new local-only routes (the assistant dock backend) enforce it identically
 * instead of drifting their own copy.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type LocalRequestRejection = {
  status: 404 | 403;
  error: string;
};

export function isLocalRequest(request: Request) {
  const requestUrl = new URL(request.url);
  if (!LOCAL_HOSTS.has(requestUrl.hostname)) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.origin !== requestUrl.origin || !LOCAL_HOSTS.has(originUrl.hostname)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

/** Returns the rejection to send, or null when the request may proceed. */
export function rejectNonLocalRequest(request: Request, featureName: string): LocalRequestRejection | null {
  if (process.env.NODE_ENV === "production") {
    return { status: 404, error: `${featureName} is only available in local development.` };
  }
  if (!isLocalRequest(request)) {
    return { status: 403, error: `${featureName} only accepts localhost requests.` };
  }
  return null;
}
