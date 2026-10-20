// Evidence on a nonconformance: photos of the defect, investigation records, proof that an action was carried out. Added while the NCR is
// worked on; never removed once an action refers to it, so what the verification rested on stays with it.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { recordEvent } from "../common.js";
import { loadNonconformance } from "./nc-commands.js";
import { NC, ncError, need, text, uuid } from "./nc-rules.js";

const ENTITY = "quality.nonconformance";
const TYPES = Object.freeze({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", csv: "text/csv", txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

export async function prepareNonconformanceEvidenceUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName, 240))?.[1] ?? "").toLowerCase();
  if (!TYPES[extension]) throw ncError(400, "QUALITY_NC_INVALID", "Upload a photo, a PDF, or a CSV, text, Excel or Word file.");
  return prepareFileUpload({ fileName, mimeType: TYPES[extension], bytes, maximumBytes: 15 * 1024 * 1024, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}
export async function uploadNonconformanceEvidence(client, c, ncId, input = {}, options = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, ncId);
  if (["CLOSED", "CANCELLED"].includes(row.status)) throw ncError(409, "QUALITY_NC_STATE", "A closed NCR takes no new evidence: reopen it first.");
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: ENTITY, entityId: row.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await recordEvent(client, c, "nonconformance", row.id, "quality.nonconformance.file_added", { fileId: file.id, note: file.fileName });
  return { id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: Number(file.sizeBytes ?? 0) };
}
export async function removeNonconformanceEvidence(client, c, ncId, fileIdValue) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, ncId);
  if (["CLOSED", "CANCELLED", "RESOLVED"].includes(row.status)) throw ncError(409, "QUALITY_NC_STATE", "Evidence stays once the NCR is resolved.");
  const fileId = uuid(fileIdValue, "File");
  const used = (await client.query(`SELECT 1 FROM tenant.quality_nonconformance_actions WHERE nonconformance_id = $1 AND $2 = ANY(evidence_file_ids)`, [row.id, fileId])).rows[0];
  if (used) throw ncError(409, "QUALITY_NC_STATE", "A completed action refers to this file.");
  await archiveFile(client, { organizationId: c.organizationId, entityType: ENTITY, entityId: row.id, fileId, actorUserId: c.userId ?? null });
  return { removed: true };
}
export async function readNonconformanceEvidence(client, c, ncId, fileIdValue, options = {}) {
  need(c, NC.view, NC.manage);
  const row = await loadNonconformance(client, c, ncId);
  const meta = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, ENTITY, row.id, uuid(fileIdValue, "File")])).rows[0];
  if (!meta) throw ncError(404, "QUALITY_NC_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: ENTITY, entityId: row.id, fileId: meta.id }, options);
  return { fileName: meta.file_name, mimeType: meta.mime_type, body: content.body };
}
export async function listNonconformanceEvidence(client, c, ncId) {
  need(c, NC.view, NC.manage);
  const row = await loadNonconformance(client, c, ncId);
  return listFiles(client, { organizationId: c.organizationId, entityType: ENTITY, entityId: row.id });
}
