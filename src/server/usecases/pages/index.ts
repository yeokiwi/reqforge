// The pages use cases (slice 1): what route handlers and server components call. Each takes
// the signed-in actor and a space key, authorises against the space (07 §2.4, RD-051), finds
// the page THROUGH that space, and returns the wire types of spec 08 §3.1.
export { listPageTree, createPage, movePage, deletePage } from "./tree";
export type { PageTree, CreatePageInput, MovePageInput, DeletePageResult } from "./tree";
export { getPageView, getEditorState } from "./view";
export type { PageView, EditorState, EditorInitialState } from "./view";
export { publishPage, renamePage } from "./publish";
export type { RenamePageInput } from "./publish";
export { COPY_ATTACHMENT_BYTES_MAX, copyPage } from "./copy";
export type { CopyPageInput } from "./copy";
export { getDraft, saveDraft, discardDraft } from "./drafts";
export { listVersions, getVersion, restoreVersion, deleteVersion, compareVersions } from "./versions";
export type { VersionComparison } from "./versions";
export { setWatching, setFavourite, heartbeatPresence, listPeople } from "./social";
export type { PresenceResult } from "./social";
export { listAttachments, uploadAttachment, hideAttachment, readAttachment } from "./attachments";
export type { AttachmentUploadInput, AttachmentDownload } from "./attachments";
