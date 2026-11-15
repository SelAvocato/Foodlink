import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Login</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/register/donor" className="text-primary hover:underline">
          Join as a donor
        </Link>{" "}
        or{" "}
        <Link href="/register/volunteer" className="text-primary hover:underline">
          Volunteer with us
        </Link>
      </p>
    </main>
  );
}