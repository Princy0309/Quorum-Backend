-- CreateTable
CREATE TABLE "OrgJiraIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cloudId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "installedByUserId" TEXT NOT NULL,
    "webhookId" TEXT,
    "encryptedWebhookSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgJiraIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserJiraLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jiraAccountId" TEXT NOT NULL,
    "jiraEmail" TEXT,
    "jiraDisplayName" TEXT,
    "cloudId" TEXT NOT NULL,
    "siteUrl" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserJiraLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraTicketLink" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "jiraIssueId" TEXT NOT NULL,
    "jiraKey" TEXT NOT NULL,
    "jiraSummary" TEXT NOT NULL,
    "jiraStatus" TEXT NOT NULL,
    "statusCategory" TEXT,
    "assigneeAccountId" TEXT,
    "reporterAccountId" TEXT,
    "priority" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraTicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JiraWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgJiraIntegration_organizationId_key" ON "OrgJiraIntegration"("organizationId");

-- CreateIndex
CREATE INDEX "OrgJiraIntegration_organizationId_idx" ON "OrgJiraIntegration"("organizationId");

-- CreateIndex
CREATE INDEX "OrgJiraIntegration_cloudId_idx" ON "OrgJiraIntegration"("cloudId");

-- CreateIndex
CREATE UNIQUE INDEX "UserJiraLink_userId_key" ON "UserJiraLink"("userId");

-- CreateIndex
CREATE INDEX "UserJiraLink_userId_idx" ON "UserJiraLink"("userId");

-- CreateIndex
CREATE INDEX "UserJiraLink_jiraAccountId_idx" ON "UserJiraLink"("jiraAccountId");

-- CreateIndex
CREATE INDEX "JiraTicketLink_teamId_idx" ON "JiraTicketLink"("teamId");

-- CreateIndex
CREATE INDEX "JiraTicketLink_jiraKey_idx" ON "JiraTicketLink"("jiraKey");

-- CreateIndex
CREATE INDEX "JiraTicketLink_assigneeAccountId_idx" ON "JiraTicketLink"("assigneeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "JiraTicketLink_teamId_jiraKey_key" ON "JiraTicketLink"("teamId", "jiraKey");

-- CreateIndex
CREATE UNIQUE INDEX "JiraWebhookEvent_eventId_key" ON "JiraWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "JiraWebhookEvent_eventId_idx" ON "JiraWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "JiraWebhookEvent_createdAt_idx" ON "JiraWebhookEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "OrgJiraIntegration" ADD CONSTRAINT "OrgJiraIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgJiraIntegration" ADD CONSTRAINT "OrgJiraIntegration_installedByUserId_fkey" FOREIGN KEY ("installedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJiraLink" ADD CONSTRAINT "UserJiraLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraTicketLink" ADD CONSTRAINT "JiraTicketLink_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
