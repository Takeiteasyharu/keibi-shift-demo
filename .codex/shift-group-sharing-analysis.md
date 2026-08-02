# Shift group sharing analysis

## Target data and queries

- Collection: `shiftGroups/{autoId}`.
- Staff query: `branchId == currentRole.branchId`, `date == selectedDate`, `shiftType == selectedType`.
- Admin selected-branch query: the same query with the selected branch ID.
- Admin all-branches query: `date == selectedDate`, `shiftType == selectedType`.
- The group query uses `onSnapshot`. Profile names are read once from `users` for the same selected scope.

## Schema used by sharing

- Scope: `branchId`.
- Workflow: `status` (`draft` or `confirmed`).
- Creator: `createdBy`; optional denormalized `createdByName`.
- Last editor: required `updatedByUid`, required `updatedByName`.
- Timestamps: immutable `createdAt`, current `updatedAt`.

## Authorization and lifecycle

- Role authority comes from `userRoles/{request.auth.uid}`, not submitted group data.
- Active staff may access only groups matching their role branch; active admin may access every branch.
- Guards cannot write groups. Assigned guards retain the existing limited read required by their confirmed-shift screen.
- On update, `branchId`, `createdBy`, `createdByName`, and `createdAt` are immutable.
- `updatedByUid` must equal `request.auth.uid`; `updatedByName` must equal `users/{uid}.name`.
- The listener is replaced on date/type/branch context changes and stopped on logout, account changes, and leaving the shift-builder screen.
