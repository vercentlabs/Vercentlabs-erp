// Projects — Comments and Collaboration: contextual discussion on a project, a task or a milestone — one level of replies, mentions of
// people who can already see the record, files, edit history and soft deletion, follow/mute, read markers, My Work's mentions and unread
// discussions, search, reports and the project timeline. Access is always the record's own; a comment never changes the record.
export { COMMENT as COMMENT_PERMISSION_KEYS, COMMENT_MESSAGES, PARENT_LABEL as COMMENT_PARENT_LABEL, PARENT_TYPES as COMMENT_PARENT_TYPES, parentAccess as validateCommentParentAccess } from "./comment-rules.js";
export {
  attachFileToComment, createComment, editComment, markDiscussionRead, removeCommentAttachment, replyToComment, saveCommentSettings, softDeleteComment, subscribeToDiscussion,
  uploadCommentAttachment,
} from "./comment-commands.js";
export {
  COLLABORATION_REPORTS, exportCollaboration, getCollaborationInbox, getCollaborationReport, getCommentHistory, getCommentSettings, getCommentsForRecord, getDiscussionCounts,
  getFollowedDiscussions, getMyMentions, getProjectCollaborationTimeline, getRecentDiscussions, getReferenceableFiles, getUnreadDiscussions, readCommentAttachment,
  resolveEligibleMentions, searchAuthorizedComments,
} from "./comment-read.js";
