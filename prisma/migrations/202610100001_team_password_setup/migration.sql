-- Existing accounts keep their current login behavior and password hashes.
ALTER TABLE "User" ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false;
