import { NextResponse } from "next/server";
import { donorRegistrationSchema } from "@/contracts/registration";
import { registerDonor } from "@/server/registration/register-donor";
import { prismaRegistrationStore } from "@/server/registration/prisma-registration-store";
import { createServerStorage } from "@/server/storage";

export const runtime = "nodejs";

function invalidRequest(message: string) {
    return NextResponse.json({ error: "INVALID_REQUEST", message }, { status: 400 });
}

export async function POST(request: Request) {
    const form = await request.formData();
    const proof = form.get("proof");
    const addressValue = form.get("address");

    if (!(proof instanceof File) || typeof addressValue !== "string") {
        return invalidRequest("Send an address JSON value and a proof image.");
    }

    let address: unknown;
    try {
        address = JSON.parse(addressValue.toString());
    } catch {
        return invalidRequest("Address must be valid JSON.");
    }

    const parsed = donorRegistrationSchema.safeParse({
        donorType: form.get("donorType"),
        businessName: form.get("businessName") ?? undefined,
        fullName: form.get("fullName"),
        contactNumber: form.get("contactNumber"),
        email: form.get("email"),
        address,
        password: form.get("password"),
        consent: form.get("consent") === "true",
    });

    if (!parsed.success) {
        return invalidRequest("Some registration fields are invalid.");
    }

    const result = await registerDonor(
        { store: prismaRegistrationStore, storage: createServerStorage() },
        parsed.data,
        new Uint8Array(await proof.arrayBuffer()),
    );

    if (!result.ok) {
        if (result.error === "EMAIL_TAKEN") {
            return NextResponse.json({ error: result.error, message: "Email is already registered." }, { status: 409 });
        }
        return invalidRequest("Proof must be a JPEG, PNG, or WebP image up to 5 MB.");
    }

    return NextResponse.json(
        { userId: result.userId, status: "PENDING", message: "Registration submitted for review." },
        { status: 201 },
    );
}