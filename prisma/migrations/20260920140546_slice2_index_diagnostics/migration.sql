-- CreateTable
CREATE TABLE "IndexDiagnostic" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "key" TEXT,
    "relatedDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexDiagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndexDiagnostic_documentId_idx" ON "IndexDiagnostic"("documentId");

-- CreateIndex
CREATE INDEX "IndexDiagnostic_relatedDocumentId_idx" ON "IndexDiagnostic"("relatedDocumentId");

-- CreateIndex
CREATE INDEX "IndexDiagnostic_code_idx" ON "IndexDiagnostic"("code");

-- AddForeignKey
ALTER TABLE "IndexDiagnostic" ADD CONSTRAINT "IndexDiagnostic_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexDiagnostic" ADD CONSTRAINT "IndexDiagnostic_relatedDocumentId_fkey" FOREIGN KEY ("relatedDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
