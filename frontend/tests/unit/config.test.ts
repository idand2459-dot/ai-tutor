import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_PROXY_URL, resolveProxyUrl } from "@/lib/config"

describe("resolveProxyUrl", () => {
  it("falls back to the local proxy when the variable is unset", () => {
    expect(resolveProxyUrl(undefined)).toBe("http://127.0.0.1:4000")
  })

  it("falls back when the variable is empty or blank", () => {
    expect(resolveProxyUrl("")).toBe(DEFAULT_PROXY_URL)
    expect(resolveProxyUrl("  ")).toBe(DEFAULT_PROXY_URL)
  })

  it("removes trailing slashes", () => {
    expect(resolveProxyUrl("http://127.0.0.1:4100/")).toBe("http://127.0.0.1:4100")
    expect(resolveProxyUrl("http://127.0.0.1:4100//")).toBe("http://127.0.0.1:4100")
  })

  it("keeps a URL that has no trailing slash", () => {
    expect(resolveProxyUrl("http://localhost:4000")).toBe("http://localhost:4000")
  })
})

describe("PROXY_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("reads NEXT_PUBLIC_PROXY_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_PROXY_URL", "http://127.0.0.1:4100/")
    vi.resetModules()

    const { PROXY_URL } = await import("@/lib/config")

    expect(PROXY_URL).toBe("http://127.0.0.1:4100")
  })

  it("uses the fallback when NEXT_PUBLIC_PROXY_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_PROXY_URL", undefined)
    vi.resetModules()

    const { PROXY_URL } = await import("@/lib/config")

    expect(PROXY_URL).toBe(DEFAULT_PROXY_URL)
  })
})
