-- Refresh tokens were bcrypt hashes of JWTs. bcrypt only reads the first
-- 72 bytes, which are identical for every token of a user, so stored rows
-- could not tell tokens apart. Existing sessions are discarded; users must
-- log in again.
DELETE FROM "refresh_tokens";

DROP INDEX "refresh_tokens_token_idx";
ALTER TABLE "refresh_tokens" DROP COLUMN "token";

ALTER TABLE "refresh_tokens"
  ADD COLUMN "tokenHash" VARCHAR(64) NOT NULL,
  ADD COLUMN "familyId" UUID NOT NULL,
  ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");
