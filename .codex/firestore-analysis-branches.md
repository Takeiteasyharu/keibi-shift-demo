# Firestore analysis: branch management and account approval

Target: `(default)`, Standard edition, Native mode, `asia-northeast1`.

## Collections and access paths

- `branches/{branchId}`: branch master (`name`, `active`, timestamps). Only admin writes.
- `employeeNumbers/{employeeNumber}`: private unique-number mapping. Client reads are denied.
- `users/{uid}`: profile/PII. Pending registration has `requestedBranchId` and no `branchId`.
- `userRoles/{uid}`: role and account workflow. New accounts are fixed to `guard/pending`; admin transitions to `approved` or `rejected`.
- `availability/{date_uid}`: full availability/audit data. Owner, same-branch staff, and admin only.
- `shiftCandidateProfiles/{uid}`: sanitized cross-branch staffing profile; no address/email/phone.
- `shiftCandidateAvailability/{date_uid}`: sanitized cross-branch availability used only by office shift candidate selection.
- `shiftCandidateAssignments/{shiftGroupId_uid}`: sanitized placement index used to prevent cross-branch duplicate placement.
- Existing `staffRequests`, `shiftGroups`, `shiftMemberProfiles`, `shiftProgress` paths remain in use.

## Queries added

- `userRoles where accountStatus == pending` (admin realtime approval list).
- `availability where date == selectedDate` (admin all-branch management view).
- `shiftCandidateAvailability where date == selectedDate` (staff optional cross-branch candidates).
- `shiftCandidateAssignments where date == selectedDate and shiftType == selectedType`.
- `shiftCandidateAssignments where shiftGroupId == groupId` for synchronization.
- Admin all-branch lists use collection reads; staff queries retain `branchId == own branch`.

## Authority and state transitions

- The authenticated user's role document is the authority source; request data never grants admin/staff.
- Self-registration can only create `guard`, `pending`, a valid `requestedBranchId`, and no formal `branchId`.
- Only admin can transition `pending -> approved/rejected`.
- Approval atomically sets matching branch values on `users`, `userRoles`, the private employee number mapping, and the sanitized shift profile.
- Existing `active` and new `approved` are both treated as operational to preserve compatibility.
- Legacy admin branch fields are removed atomically on first admin login; admin view selection is local UI state, not membership.
- Legacy operational guard/staff documents missing `branchId` are atomically normalized to `kokubunji` by an admin; existing formal branch values are never overwritten.

## Security review notes

- Default recursive rule remains deny-all.
- Guard cannot list or edit other users.
- Staff retains PII access only within its own branch.
- Cross-branch shift candidate reads use sanitized collections rather than cross-branch `users` documents.
- Cross-branch assignment index exposes only scheduling identifiers/title needed to prevent duplicates.
- All new writable documents enforce allowed keys, types, string limits, timestamps, and immutable IDs.
