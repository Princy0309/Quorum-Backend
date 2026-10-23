-- AlterTable
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
