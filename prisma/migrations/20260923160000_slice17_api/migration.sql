-- Slice 17 — REST API and webhooks. spec: 08-api-surface.md; RD-065 (token scopes),
-- RD-066 (thin events), RD-067 (transactional outbox, retry, dead letter).

-- CreateEnum
CREATE TYPE "WebhookDeliveryState" AS ENUM ('PENDING', 'DELIVERED', 'DEAD');
ALTER TABLE "ApiToken" ADD COLUMN     "spaceKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recordId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "state" "WebhookDeliveryState" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Webhook_spaceId_active_idx" ON "Webhook"("spaceId", "active");
-- CreateIndex
CREATE INDEX "WebhookEvent_spaceId_createdAt_idx" ON "WebhookEvent"("spaceId", "createdAt");
-- CreateIndex
CREATE INDEX "WebhookDelivery_state_nextAttemptAt_idx" ON "WebhookDelivery"("state", "nextAttemptAt");
-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_state_idx" ON "WebhookDelivery"("webhookId", "state");
-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");
-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
