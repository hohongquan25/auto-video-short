/**
 * The edition sold to customers (`pnpm build:retail`): Gemini is the only AI,
 * there is no Claude, link download, Google Drive or n8n, and the app needs a
 * licence key. The build fixes this at "retail"; when running from source,
 * STUDIO_EDITION=retail tries the edition out.
 */
export const RETAIL = process.env.STUDIO_EDITION === "retail";
