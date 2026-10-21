CREATE UNIQUE INDEX IF NOT EXISTS "CommunityChannel_communityId_lower_name_key" ON "CommunityChannel"("communityId", lower("name"));
