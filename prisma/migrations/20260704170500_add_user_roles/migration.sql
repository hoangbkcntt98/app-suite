CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

UPDATE "users" SET "role" = 'ADMIN' WHERE "email" = 'ddhoang123@gmail.com';
