import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_IMAGE_BYTES } from "@/contracts/image";
import { volunteerRegistrationSchema } from "@/contracts/registration";
import { registerVolunteer } from "@/server/registration/register-volunteer";
import { prismaRegistrationStore } from "@/server/registration/prisma-registration-store";
import { createServerStorage } from "@/server/storage";

export const runtime = "nodejs";

// Vercel rejects request bodies over 4.5 MB before this code runs, so signup proofs are limited to 4 MB.
const MAX_PROOF_BYTES = Math.min(MAX_IMAGE_BYTES, 4 * 1024 * 1024);
const PROOF_MESSAGE = "Proof must be a JPEG, PNG, or WebP image up to 4 MB.";

function invalidRequest(message: string, details?: unknown) {
    return NextResponse.json({ error: "INVALID_REQUEST", message, details }, { status: 400 });
}

export async function POST(request: Request) {
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return invalidRequest("Send the registration as multipart form data.");
    }

    const proof = form.get("proof");
    const addressValue = form.get("address");

    if (!(proof instanceof File) || typeof addressValue !== "string") {
        return invalidRequest("Send an address JSON value and a proof image.");
    }
    if (proof.size === 0 || proof.size > MAX_PROOF_BYTES) {
        return invalidRequest(PROOF_MESSAGE);
    }

    let address: unknown;
    try {
        address = JSON.parse(addressValue);
    } catch {
        return invalidRequest("Address must be valid JSON.");
    }

    // Only send availability when it is text. Never pass null to the schema.
    const availability = form.get("availability");
    const parsed = volunteerRegistrationSchema.safeParse({
        fullName: form.get("fullName"),
        contactNumber: form.get("contactNumber"),
        email: form.get("email"),
        address,
        ...(typeof availability === "string" ? { availability } : {}),
        password: form.get("password"),
        consent: form.get("consent") === "true",
    });

    if (!parsed.success) {
        return invalidRequest("Some registration fields are invalid.", z.flattenError(parsed.error));
    }

    const result = await registerVolunteer(
        { store: prismaRegistrationStore, storage: createServerStorage() },
        parsed.data,
        new Uint8Array(await proof.arrayBuffer()),
    );

    if (!result.ok) {
        if (result.error === "EMAIL_TAKEN") {
            return NextResponse.json({ error: result.error, message: "Email is already registered." }, { status: 409 });
        }
        return invalidRequest(PROOF_MESSAGE);
    }

    return NextResponse.json(
        { userId: result.userId, status: "PENDING", message: "Registration submitted for review." },
        { status: 201 },
    );
}
