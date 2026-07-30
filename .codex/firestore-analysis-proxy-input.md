# Firestore analysis: Web利用者の勤務希望代理入力

- 対象DB: `(default)` / Standard Edition / Native mode
- 対象コレクション: `availability/{date_uid}`, `users/{uid}`, `userRoles/{uid}`
- 読み取り: staff/adminは同一branchIdのavailability/users/userRolesを既存Rulesで取得
- 書き込み: `availability/{date_uid}`を`setDoc`で全項目保存
- 既存監査: `updatedByUid`, `updatedByType`, `updatedAfterDeadline`, `updatedAt`
- 追加監査: `updatedByRole`, `updateReason`, `updateReasonNote`
- 代理入力許可: 操作者がactiveなstaff/admin、対象が同一branchIdかつactive、本人以外
- role階層: staffからadminへの代理入力は禁止、adminは同一branchIdの管理対象を許可
- スキーマ: updateReasonは定義済み5値、その他の場合のみ1～200文字、通常は空文字
- 互換性: 既存の`updatedByType == "staff"`データは読み取り可能。新規代理入力は`proxy`を使用
- インデックス: 新しいクエリは追加しないため変更不要
