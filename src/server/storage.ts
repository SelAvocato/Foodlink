import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env.server";
import { withTimeout } from "@/lib/fetch-timeout";
import { createStorage, type StorageBucket } from "@/lib/storage";

const STORAGE_TIMEOUT_MS = 15_000;

export function createServerStorage() {
    const env = getEnv();
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: withTimeout(fetch, STORAGE_TIMEOUT_MS) },
    });
    const bucket = client.storage.from(env.SUPABASE_STORAGE_BUCKET);

    const storageBucket: StorageBucket = {
        upload: async (path, body, options) => {
            const result = await bucket.upload(path, body, options);
            return {
                data: result.data ? { path: result.data.path } : null,
                error: result.error ? { message: result.error.message } : null,
            };
        },
        createSignedUrl: async (path, expiresIn) => {
            const result = await bucket.createSignedUrl(path, expiresIn);
            return {
                data: result.data ? { signedUrl: result.data.signedUrl } : null,
                error: result.error ? { message: result.error.message } : null,
            };
        },
        remove: async (paths) => {
            const result = await bucket.remove(paths);
            return {
                data: result.data,
                error: result.error ? { message: result.error.message } : null,
            };
        },
    };

    return createStorage(storageBucket);
}