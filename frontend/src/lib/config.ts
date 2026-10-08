export const DEFAULT_PROXY_URL = "http://127.0.0.1:4000"

// Returns the proxy base URL without a trailing slash, so callers can append `/api/...`.
export function resolveProxyUrl(value: string | undefined): string {
  const url = value?.trim() || DEFAULT_PROXY_URL
  return url.replace(/\/+$/, "")
}

// Next.js inlines NEXT_PUBLIC_* at build time, so the variable is read by its literal name.
// It is public by design and never holds a secret.
export const PROXY_URL = resolveProxyUrl(process.env.NEXT_PUBLIC_PROXY_URL)
