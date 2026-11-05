/**
 * Private file storage for uploads (proof documents and food, pickup and handover photos).
 * The database stores only the object key. Files are shown through short-lived signed URLs.
 *
 * This module has no Supabase or environment imports, so it is easy to test. The real client
 * is passed in by the caller. Validate type and size with src/contracts/image.ts before uploading.
 */

export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";
const FOLDERS = ["proofs", "food", "pickup", "handover"] as const;
export type UploadFolder = (typeof FOLDERS)[number];

type StorageResult<T> = { data: T | null; error: { message: string } | null };

/** The small part of a Supabase Storage bucket this module uses. */
export interface StorageBucket {
    upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean },
    ): Promise<StorageResult<{ path: string }>>;
    createSignedUrl(path: string, expiresIn: number): Promise<StorageResult<{ signedUrl: string }>>;
    remove(paths: string[]): Promise<StorageResult<unknown>>;
}

const EXTENSIONS: Record<ImageContentType, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

const KEY_PATTERN = new RegExp(
    `^(${FOLDERS.join("|")})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$`,
);

export const DEFAULT_SIGNED_URL_SECONDS = 300;
const MAX_SIGNED_URL_SECONDS = 3600;

export function isValidObjectKey(key: string): boolean {
    return KEY_PATTERN.test(key);
}

/** A random name, so the original file name (and anything in it) is never stored. */
export function newObjectKey(folder: UploadFolder, contentType: ImageContentType): string {
    // The types are not enough at runtime: values can arrive from a request body or a cast.
    if (!(FOLDERS as readonly string[]).includes(folder)) throw new Error(`Unsupported upload folder: ${String(folder)}`);
    if (!Object.hasOwn(EXTENSIONS, contentType)) throw new Error(`Unsupported content type: ${String(contentType)}`);
    return `${folder}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`;
}

export function createStorage(bucket: StorageBucket) {
    return {
        /** Uploads an image under a random key and returns the key to save in the database. */
        async uploadImage(input: { folder: UploadFolder; contentType: ImageContentType; data: Uint8Array }): Promise<{ key: string }> {
            if (input.data.byteLength === 0) throw new Error("Cannot upload an empty file");
            const key = newObjectKey(input.folder, input.contentType);
            const { error } = await bucket.upload(key, input.data, { contentType: input.contentType, upsert: false });
            if (error) throw new Error(`Storage upload failed: ${error.message}`);
            return { key };
        },

        /** A temporary link to a private file. Only call this after the caller's role and ownership checks. */
        async getSignedUrl(key: string, expiresInSeconds: number = DEFAULT_SIGNED_URL_SECONDS): Promise<string> {
            if (!isValidObjectKey(key)) throw new Error("Invalid storage key");
            if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_SIGNED_URL_SECONDS) {
                throw new Error(`Signed URL lifetime must be 1 to ${MAX_SIGNED_URL_SECONDS} seconds`);
            }
            const { data, error } = await bucket.createSignedUrl(key, expiresInSeconds);
            if (error || !data) throw new Error(`Storage signed URL failed: ${error?.message ?? "no URL returned"}`);
            return data.signedUrl;
        },

        /** Removes a file, for example when the database insert fails after the upload. */
        async removeObject(key: string): Promise<void> {
            if (!isValidObjectKey(key)) throw new Error("Invalid storage key");
            const { error } = await bucket.remove([key]);
            if (error) throw new Error(`Storage remove failed: ${error.message}`);
        },
    };
}
export type Storage = ReturnType<typeof createStorage>;