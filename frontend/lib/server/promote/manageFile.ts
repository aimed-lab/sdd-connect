// Rules and wording for "Manage file" (/files/<slug>/edit) and the "Your
// files" list on /files. Pure, so the screens and `npm test` share them.
//
// Wording rule for the file sharing screens: "Public" and "Hidden", "Make
// public" and "Hide". Never "Published", "Unpublished", "Draft" or "Publish".

/** The line at the top of the Manage screen. */
export function fileStatusLine(isPublic: boolean): string {
  return isPublic ? "Public. Anyone with the link can download it." : "Hidden. Only you can see this.";
}

/** The tag on a "Your files" row. */
export function fileVisibilityTag(isPublic: boolean): "Public" | "Hidden" {
  return isPublic ? "Public" : "Hidden";
}

/** The button that switches visibility. */
export function visibilityButtonLabel(isPublic: boolean): "Hide" | "Make public" {
  return isPublic ? "Hide" : "Make public";
}

export const LAST_FILE_MESSAGE = "A public file page needs at least one file.";

/** Whether a file can be removed. A public file page (no body text) must
 *  keep at least one file; a hidden one, or a Promote post with text, can
 *  lose its last file. `fileCount` is the files attached right now. */
export function canRemoveFile(state: {
  isPublic: boolean;
  hasBody: boolean;
  fileCount: number;
}): { ok: true } | { ok: false; message: string } {
  if (state.isPublic && !state.hasBody && state.fileCount <= 1) {
    return { ok: false, message: LAST_FILE_MESSAGE };
  }
  return { ok: true };
}

/** The in-page delete confirmation for a file page. */
export const DELETE_FILE_CONFIRM = {
  heading: "Delete this file page?",
  message: "The files and the link will stop working. This can't be undone.",
  confirm: "Delete",
} as const;

/** The one line shown on /files after a delete (/files?deleted=1). */
export const FILE_DELETED_NOTICE = "The file page was deleted.";

/** The in-page confirmation before removing a file that has finished
 *  uploading. A file still uploading is cancelled without asking. */
export const REMOVE_FILE_CONFIRM = {
  heading: "Remove this file?",
  message: "People with the link won't be able to download it any more.",
  confirm: "Remove",
} as const;

/** Whether removing this file row asks first: only once it is attached. */
export function removeNeedsConfirm(status: string): boolean {
  return status === "done";
}
