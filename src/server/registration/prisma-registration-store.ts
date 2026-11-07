import { prisma } from "@/server/db";
import { DuplicateEmailError, type RegistrationStore, type RegistrationTx } from "./register-donor";

function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function createTransactionAdapter(tx: typeof prisma): RegistrationTx {
    return {
        async insertAddress(row) {
            return tx.addresses.create({
                data: {
                    street_line1: row.streetLine1,
                    street_line2: row.streetLine2,
                    barangay: row.barangay,
                    city: row.city,
                    province_or_state: row.provinceOrState,
                    postal_code: row.postalCode,
                    country_code: row.countryCode,
                    latitude: row.latitude,
                    longitude: row.longitude,
                },
                select: { id: true },
            });
        },
        async insertUser(row) {
            try {
                return await tx.users.create({
                    data: {
                        role: row.role,
                        status: row.status,
                        full_name: row.fullName,
                        email: row.email,
                        contact_number: row.contactNumber,
                        donor_type: row.donorType,
                        business_name: row.businessName,
                        address_id: row.addressId,
                    },
                    select: { id: true },
                });
            } catch (error) {
                if (isUniqueViolation(error)) throw new DuplicateEmailError("email already registered");
                throw error;
            }
        },
        async insertCredentials(row) {
            await tx.user_credentials.create({
                data: { user_id: row.userId, password_hash: row.passwordHash },
            });
        },
        async insertConsent(row) {
            await tx.user_consents.create({
                data: {
                    user_id: row.userId,
                    consent_type: row.consentType,
                    policy_version: row.policyVersion,
                },
            });
        },
        async insertDocument(row) {
            const documentType = await tx.document_types.findUnique({
                where: { code: row.documentTypeCode },
                select: { id: true },
            });
            if (!documentType) throw new Error(`Missing document type: ${row.documentTypeCode}`);

            await tx.user_documents.create({
                data: {
                    user_id: row.userId,
                    document_type_id: documentType.id,
                    storage_key: row.storageKey,
                    original_filename: row.originalFilename,
                    mime_type: row.mimeType,
                    size_bytes: BigInt(row.sizeBytes),
                },
            });
        },
    };
}

export const prismaRegistrationStore: RegistrationStore = {
    async emailExists(email) {
        const user = await prisma.users.findFirst({
            where: { email, deleted_at: null },
            select: { id: true },
        });
        return user !== null;
    },
    async transaction(work) {
        return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as typeof prisma)));
    },
};