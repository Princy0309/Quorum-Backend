-- CreateEnum
CREATE TYPE "UseCase" AS ENUM ('ORGANIZATION', 'FREELANCE', 'HIRE_COLLABORATE', 'COMMUNITY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isOnboarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useCases" "UseCase"[];
