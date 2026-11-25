CREATE TABLE "MutedNotification" (
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" "NotificationKind" NOT NULL,
  PRIMARY KEY ("userId", "kind")
);
