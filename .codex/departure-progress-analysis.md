# 出発連絡・当日の勤務 Firestore分析（2026-08-04）

- 打刻対象: `availability/{date_uid}` の当日○。日勤・夜勤を独立判定する。
- 進捗: `attendanceProgress/{date}/{shiftType}/{workerUid}`。出発時間確認、出発、上番、下番を同一文書へ保存。
- 本人読み書き: 対象確定勤務の本人UIDだけ。順序は確認→出発→上番→下番で、既存時刻は変更不可。
- 内勤者読み書き: activeなstaff/adminだけ。staffは確定勤務の支社と同一支社、adminは既存仕様の範囲。
- 状態フィールド: `departureAcknowledgedAt`, `departureTime`, `departedAt`, `startedAt`, `finishedAt`。
- 監査フィールド: `createdAt`, `updatedAt`, `updatedByUid`, `updatedByName`, `updatedByType`。
- リアルタイム: 内勤者画面は対象日の勤務希望を購読し、○の勤務者の進捗文書も購読する。
- 管理表連携: 当日の勤務希望セルが○のときだけ打刻連絡導線を表示する。編集モード中は無効化する。

# 2026-08-04 attendance time input addendum
- `attendanceProgress/{date}/{shiftType}/{workerUid}` adds optional `finishedTime`, constrained to 00:00 through 24:55 in five-minute steps.
- `finishedAt` remains the server-side audit timestamp; `finishedTime` stores the user-selected off-duty time for display.
- Create still permits only departure acknowledgement. Updates preserve the acknowledgement -> departure -> start -> finish sequence.
- Existing ownership, office-branch, worker UID, and availability-circle validation remain required.
