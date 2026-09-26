/**
 * The tokens and cookies of one SchoolSoft session, in memory: the app's
 * access and refresh token with the access token's expiry, and the webview
 * cookies the token was exchanged for. It sends nothing; the auth strategy
 * fills it and the backends read it.
 */
export class SessionTokens {
  private access: string | null = null;
  private refresh: string | null = null;
  /** Unix SECONDS, as the token endpoint and the JWT `exp` say it. */
  private expiry: number | null = null;
  private cookies: string | null = null;

  constructor(
    readonly school: string,
    private readonly now: () => number = Date.now,
  ) {}

  get accessToken(): string | null {
    return this.access;
  }

  get refreshToken(): string | null {
    return this.refresh;
  }

  /** When the access token expires (Unix seconds); null when unknown. */
  get expiresAt(): number | null {
    return this.expiry;
  }

  /** `JSESSIONID=…; hash=…; usertype=…` once the exchange has run, else null. */
  get cookieHeader(): string | null {
    return this.cookies;
  }

  /** True from the expiry second on; an unknown expiry is not an expired token. */
  get isAccessTokenExpired(): boolean {
    return this.expiry !== null && Math.floor(this.now() / 1000) >= this.expiry;
  }

  /** Adopt an access token; a refresh token or expiry that is not given keeps the one held. */
  setAccessToken(accessToken: string, refreshToken?: string, expiresAt?: number): void {
    this.access = accessToken;
    if (refreshToken !== undefined) this.refresh = refreshToken;
    if (expiresAt !== undefined) this.expiry = expiresAt;
  }

  /** Adopt the webview cookies the cookie exchange returned. */
  setSessionCookies(jsessionid: string, hash: string, usertype = "1"): void {
    this.cookies = `JSESSIONID=${jsessionid}; hash=${hash}; usertype=${usertype}`;
  }
}
