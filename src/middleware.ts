import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = ["/login", "/signup"];

/**
 * Edge gate for pages: redirects visitors without a session cookie to /login.
 * Real session validation happens server-side on every API call and page data fetch.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get("nexus_session")?.value);
  if (PUBLIC_PAGES.some((p) => pathname.startsWith(p))) {
    return hasSession ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (!hasSession) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
