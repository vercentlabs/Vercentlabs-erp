import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

// The signup in progress, by an opaque token in an httpOnly cookie (only its hash is stored); it lasts as long as the signup (24 hours).
const NAME = "vercentlabs_signup";
export async function readSignupToken() {
  return (await cookies()).get(NAME)?.value ?? null;
}
export function setSignupCookie(response: NextResponse, token: string) {
  response.cookies.set(NAME, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 24 * 3600 });
}
export function clearSignupCookie(response: NextResponse) {
  response.cookies.set(NAME, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(0) });
}
