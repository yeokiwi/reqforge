-- DropIndex
DROP INDEX "Membership_space_group";

-- DropIndex
DROP INDEX "Membership_space_user";

-- DropIndex
DROP INDEX "Property_searchName_kind";

-- DropIndex
DROP INDEX "Requirement_upperKey_pattern";

-- CreateTable
CREATE TABLE "CoverageTarget" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "targetPercent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoverageTarget_spaceId_idx" ON "CoverageTarget"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageTarget_spaceId_relationship_direction_key" ON "CoverageTarget"("spaceId", "relationship", "direction");

-- AddForeignKey
ALTER TABLE "CoverageTarget" ADD CONSTRAINT "CoverageTarget_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
