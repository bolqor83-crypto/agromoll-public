-- v0.7.0-B (ADR-036): доказательства споров переезжают из base64 в БД
-- на S3-совместимое хранилище. В БД остаётся только ссылка.
--
-- fileUrl хранит одну из двух форм:
--   s3://<objectKey>           — файл в хранилище (ключ без бакета);
--   data:<mime>;base64,<data>  — fallback для случаев, когда хранилище
--                                недоступно (лимит 500 КБ на входе).
--
-- Существующие строки конвертируются в data:-URL: они были загружены
-- по старому протоколу, файла в S3 для них не существует, а терять
-- доказательства закрытых кейсов нельзя (журнал — источник правды,
-- ADR-033). Объём ≤ 2 МБ на строку — data:-форма валидна.

ALTER TABLE "dispute_evidence" ADD COLUMN "fileUrl" TEXT;

UPDATE "dispute_evidence"
SET "fileUrl" = 'data:' || "mimeType" || ';base64,' || "dataBase64";

ALTER TABLE "dispute_evidence" ALTER COLUMN "fileUrl" SET NOT NULL;

ALTER TABLE "dispute_evidence" DROP COLUMN "dataBase64";
