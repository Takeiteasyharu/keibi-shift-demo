# Firestore analysis: Webプロフィール編集と出発確認時刻

- DB: `(default)` / Standard Edition / Native mode
- 対象: `users/{uid}`, `shiftProgress/{shiftId}/workers/{workerId}`
- users追加フィールド: `phone`（任意、0～20文字）、`updatedByUid`（office更新時）
- office更新可能項目: 氏名、電話、住所一式、最寄り駅、managedのみ連絡用メール
- office更新不可能項目: employeeNumber、branchId、inputMode、authUid、createdBy、createdAt
- 権限: activeなstaff/admin、同一支社、本人以外。staffからadminは不可
- shiftProgress追加フィールド: `departureTime`（任意、HH:mm）
- `departureAcknowledgedAt`は従来どおりserverTimestamp
- 本人更新では既存departureTimeを後続操作で変更不可
- staff更新は既存方針どおり同一支社の確定シフトだけ
- 新しいクエリなし、インデックス変更なし
- Cloud Functionsなし
