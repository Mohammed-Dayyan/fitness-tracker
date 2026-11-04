-- Email confirmation moves from emailed links to 6-digit codes.
-- Pending links are meaningless afterwards, so the old table is dropped.
-- DropForeignKey
ALTER TABLE "email_verification_tokens" DROP CONSTRAINT "email_verification_tokens_ownerId_fkey";

-- DropTable
DROP TABLE "email_verification_tokens";

-- CreateTable
CREATE TABLE "email_otps" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_otps_ownerId_key" ON "email_otps"("ownerId");

-- CreateIndex
CREATE INDEX "email_otps_expiresAt_idx" ON "email_otps"("expiresAt");

-- AddForeignKey
ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

