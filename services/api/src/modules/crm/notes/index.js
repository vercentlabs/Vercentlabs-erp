// CRM Notes: what the team knows about a lead, account, contact or
// opportunity — formatted, optionally titled and pinned, with every edit
// kept. A note is persistent knowledge, not a discussion thread.
export { ATTACHMENT_PERMISSIONS, NOTE_PERMISSIONS, RECORD_TYPES, contentCan, recordVisible } from "./access.js";
export {
  createNote, deleteNote, getNote, listContentHistory, listNoteVersions, listNotes, searchNotes, pinNote, setNotePinned, unpinNote, updateNote,
} from "./records.js";
export { noteHtmlToText, sanitizeNoteHtml } from "./sanitize.js";
