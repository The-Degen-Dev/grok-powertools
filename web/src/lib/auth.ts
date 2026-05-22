import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const googleId = process.env.AUTH_GOOGLE_ID;
const googleSecret = process.env.AUTH_GOOGLE_SECRET;
const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === "production"
    ? undefined
    : "local-dev-grok-power-tools-auth-secret");

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: authSecret,
  providers:
    googleId && googleSecret
      ? [
          Google({
            clientId: googleId,
            clientSecret: googleSecret,
          }),
        ]
      : [],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
