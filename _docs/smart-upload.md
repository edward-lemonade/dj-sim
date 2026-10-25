# Smart Track Upload

Design and implementation checklist for a staged, duplicate-aware upload flow on
the Tracks page. Do not upload selected files until the user confirms the final
Upload action.

## Goals

- Clicking **Upload** opens a modal instead of immediately opening the file picker.
- Let users choose multiple audio files through the system file picker or drag
  and drop them into the modal.
- Show the selected files in a scrollable list. Each row shows the track name
  and artist when metadata is available, a duplicate warning when it matches a
  track in the user's library, and an **X** action to remove it from the batch.
- The modal's **Upload** button starts the batch.
- If the batch contains duplicates, ask whether to upload all tracks, only new
  tracks, or go back to edit the batch.

## Existing context

- The current Upload button and hidden multi-file input are in
  [`frontend/src/pages/tracks/components/TrackLibrary.tsx`](../frontend/src/pages/tracks/components/TrackLibrary.tsx).
- [`frontend/src/hooks/useTrackUpload.ts`](../frontend/src/hooks/useTrackUpload.ts)
  currently parses and uploads each chosen file immediately. Refactor this
  flow so metadata can be prepared and duplicates identified before calling
  `uploadTrack`.
- [`frontend/src/hooks/useTrackLibrary.ts`](../frontend/src/hooks/useTrackLibrary.ts)
  provides the current user's library tracks for duplicate comparison.
- Reuse the shared Dialog components from
  [`frontend/src/components/ui/dialog.tsx`](../frontend/src/components/ui/dialog.tsx).
  For dark modal styling, follow the collaboration dialog in
  [`frontend/src/components/StudioTopbar.tsx`](../frontend/src/components/StudioTopbar.tsx).
  The simpler custom overlay in
  [`frontend/src/components/ExitConfirmModal.tsx`](../frontend/src/components/ExitConfirmModal.tsx)
  is another precedent for the dark surface, dimmed backdrop, and accessible
  dialog labeling.

## Flow

1. User clicks **Upload** in the Tracks library toolbar.
2. Open the upload modal. Its drop area also opens a hidden `audio/*`, multiple
   file input when clicked.
3. On file selection or drop, prepare track metadata locally and add each file
   to the modal's pending batch. Do not create library rows or issue upload
   requests yet.
4. Match each prepared file to the user's existing library by both artist and
   song title. Compare case-insensitively after trimming and collapsing
   whitespace. A match on only one field is not a duplicate. Display a warning
   icon and clear duplicate label for matches.
5. The pending batch is a scrollable list. Removing a row removes only that
   file from the pending batch; it does not delete a library track.
6. On **Upload**:
   - With no duplicates, upload every remaining file.
   - With one or more duplicates, open a confirmation dialog with **Upload all**,
     **Upload new only**, and **Go back**.
   - **Upload all** includes duplicates. **Upload new only** skips the rows
     marked as duplicates. **Go back** closes the confirmation and returns to
     the editable file list without losing the batch.
7. After a choice that starts uploads, close the dialogs and use the existing
   upload progress, success, and error behavior for each file. Keep failures
   visible through the existing toast/library error behavior; do not silently
   report a successful batch if some uploads fail.

## UI notes

- Keep the modal consistent with the dark Tracks page and shared Dialog
  component. Use a titled dialog with an accessible description.
- Keep the dialog header and footer visible while the file list scrolls.
- Disable the final Upload action while files are still being prepared or when
  the pending list is empty.
- Each remove control needs an accessible name that includes the track/file
  name. The duplicate warning must have text or an accessible label; do not rely
  on color or the icon alone.
- If metadata parsing fails for a selected file, show its filename and an
  actionable error in the list so it can be removed. Do not upload a file that
  could not be prepared.
- Reset the native file input after selection so the same file can be selected
  again if it was removed.
- If **Upload new only** would include no files, disable that action and explain
  that all selected tracks are duplicates.
- Duplicate matching is against the user's existing library, not other files
  selected in the same batch.

## TODOs (execution checklist)

Check items off as implementation lands.

### 1. Stage selected files

- [x] Replace the immediate file-picker action in the Tracks toolbar with a
  modal trigger.
- [x] Add a hidden multiple `audio/*` input and a clickable, keyboard-accessible
  drop area; support drag/drop and reset the input after each selection.
- [x] Refactor the upload hook into preparation and upload phases. Preparation
  reads metadata without uploading or adding a pending library row.
- [x] Track pending files with stable IDs, preparation state, metadata, errors,
  and duplicate status. Support removing an item from the batch.
- [x] Handle invalid/non-audio files and metadata-read failures explicitly in
  the pending list.

### 2. Detect duplicates and review batch

- [x] Compare prepared artist + title against existing library tracks using
  case-insensitive, trimmed, whitespace-collapsed values for both fields.
- [x] Mark matching rows with an accessible duplicate warning.
- [x] Render the selected-file list in a bounded, vertically scrollable area
  with visible per-row remove controls.
- [x] Disable the final Upload button for an empty batch or while preparation
  is pending.

### 3. Confirm duplicate policy and upload

- [x] When duplicates exist, show a second confirmation dialog with **Upload
  all**, **Upload new only**, and **Go back** actions.
- [x] Ensure **Go back** preserves the staged batch, and **Upload new only**
  excludes only rows marked as duplicates.
- [x] Disable or explain **Upload new only** when every staged row is a
  duplicate.
- [x] On confirmation, upload the selected batch through existing metadata,
  waveform, progress, library-state, and toast behavior.
- [x] Close the dialogs when uploads begin and retain explicit per-file errors
  for failed uploads.

### 4. Verify

- [ ] Verify picker selection, repeated selection after removal, drag/drop,
  list scrolling, and removal.
- [ ] Verify duplicate matching requires both artist and title and is
  insensitive to case and extra whitespace.
- [ ] Verify all three duplicate-confirmation actions, including an all-duplicate
  batch and returning to edit without losing files.
- [ ] Verify uploads do not start before confirmation and existing upload
  progress, success, and failure behavior remains intact.
