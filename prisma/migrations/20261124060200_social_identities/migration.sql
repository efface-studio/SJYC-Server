CREATE TABLE "SocialIdentity" (
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "provider" "OAuthProvider" NOT NULL,
 "subject" TEXT NOT NULL,
 PRIMARY KEY ("userId","provider"),
 UNIQUE ("provider","subject")
);
