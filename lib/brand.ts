/**
 * The product name, in ONE place. Renaming the app is a change here (plus
 * the README/CLAUDE.md prose); every page, title and export reads this.
 *
 * Browser storage keys and the backup file tag deliberately do NOT use this
 * (see lib/client/store.ts and lib/client/backup.ts): renaming the product
 * must never make someone's saved leagues or backups unreadable.
 */
export const APP_NAME = "Seasonsmith";
export const APP_TAGLINE = "League and tournament scheduling for any sport";
