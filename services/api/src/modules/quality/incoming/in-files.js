// Evidence on an inspection: photos of samples, certificates, laboratory reports. Added while the inspection is worked on (or by a
// reviewer); never removed once the inspection is completed, so what the decision rested on stays with it.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { recordEvent } from "../common.js";
import { loadIncoming } from "./in-commands.js";
import { has, inError, need, permsOf, text, uuid } from "./in-rules.js";

const ENTITY = "quality.inspection";
const TYPES = Object.freeze({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", csv: "text/csv", txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

export async function prepareInspectionEvidenceUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName, 240))?.[1] ?? "").toLowerCase();
  if (!TYPES[extension]) throw inError(400, "QUALITY_INCOMING_EVIDENCE_MISSING", "Upload a photo, a PDF, or a CSV, text, Excel or Word file.");
  return prepareFileUpload({ fileName, mimeType: TYPES[extension], bytes, maximumBytes: 15 * 1024 * 1024, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}
export async function uploadInspectionEvidence(client, c, inspectionId, input = {}, options = {}) {
  const row = await loadIncoming(client, c, inspectionId);
  if (!has(c, permsOf(row).record) && !has(c, permsOf(row).review)) throw inError(403, "QUALITY_INCOMING_ACCESS_DENIED");
  if (row.workflow_status === "CANCELLED") throw inError(409, "QUALITY_INCOMING_STATE");
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: ENTITY, entityId: row.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await recordEvent(client, c, "inspection", row.id, "quality.incoming.file_added", { fileId: file.id, fileName: file.fileName });
  return { id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: Number(file.sizeBytes ?? 0) };
}
export async function removeInspectionEvidence(client, c, inspectionId, fileIdValue) {
  const row = await loadIncoming(client, c, inspectionId);
  need(c, permsOf(row).record);
  if (!["PENDING", "ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(row.workflow_status)) throw inError(409, "QUALITY_INCOMING_STATE", "Evidence stays once the results are submitted.");
  const fileId = uuid(fileIdValue, "File");
  const used = (await client.query(`SELECT 1 FROM tenant.quality_inspection_observations WHERE inspection_id = $1 AND is_current AND $2 = ANY(evidence_file_ids)`, [row.id, fileId])).rows[0];
  if (used) throw inError(409, "QUALITY_INCOMING_STATE", "A recorded result refers to this file; record that result without it first.");
  await archiveFile(client, { organizationId: c.organizationId, entityType: ENTITY, entityId: row.id, fileId, actorUserId: c.userId ?? null });
  return { removed: true };
}
export async function readInspectionEvidence(client, c, inspectionId, fileIdValue, options = {}) {
  const row = await loadIncoming(client, c, inspectionId);
  need(c, permsOf(row).view);
  const meta = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, ENTITY, row.id, uuid(fileIdValue, "File")])).rows[0];
  if (!meta) throw inError(404, "QUALITY_INCOMING_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: ENTITY, entityId: row.id, fileId: meta.id }, options);
  return { fileName: meta.file_name, mimeType: meta.mime_type, body: content.body };
}
export async function listInspectionEvidence(client, c, inspectionId) {
  const row = await loadIncoming(client, c, inspectionId);
  need(c, permsOf(row).view);
  return listFiles(client, { organizationId: c.organizationId, entityType: ENTITY, entityId: row.id });
}
