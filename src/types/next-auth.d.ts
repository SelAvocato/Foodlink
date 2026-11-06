import type { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            role: "DONOR" | "VOLUNTEER" | "ADMIN";
            status: "ACTIVE";
        } & DefaultSession["user"];
    }

    interface User {
        id: string;
        role: "DONOR" | "VOLUNTEER" | "ADMIN";
        status: "ACTIVE";
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        id: string;
        role: "DONOR" | "VOLUNTEER" | "ADMIN";
        status: "ACTIVE";
    }
}
