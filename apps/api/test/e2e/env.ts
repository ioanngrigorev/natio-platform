/**
 * Process environment for the e2e suite. This module MUST be the first import of every e2e
 * file so that it runs before any source module reads the configuration.
 *
 * The suite drops and recreates the schema of the database it points at, so it is pinned
 * to the dedicated `natio_test` database and never to the development database.
 */
process.env.DATABASE_URL = "postgres://natio:natio@localhost:5432/natio_test";
process.env.NODE_ENV = "test";
process.env.QUEUE_DRIVER = "memory";
process.env.LOG_LEVEL ??= "silent";
process.env.COOKIE_SECURE = "false";
process.env.WEBHOOK_ALLOW_PRIVATE_URLS = "true";
process.env.NATIO_ENCRYPTION_KEY ??= "0f0e0d0c0b0a09080706050403020100ffeeddccbbaa99887766554433221100";
process.env.NATIO_SESSION_SECRET ??= "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
// Keep provider simulation snappy and webhook retries short.
process.env.PROVIDER_TIMEOUT_MS ??= "5000";
process.env.WEBHOOK_TIMEOUT_MS ??= "2000";

export const E2E_DATABASE_URL = process.env.DATABASE_URL;
