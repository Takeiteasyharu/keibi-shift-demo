# 内勤者希望付き新規登録フロー分析

## 対象データ

- `users/{uid}`: 氏名、警備員番号、住所、電話、連絡先メール、希望支社。PIIを含む。
- `userRoles/{uid}`: `role`, `accountStatus`, `requestedBranchId`, 正式 `branchId` と監査日時。
- `employeeNumbers/{number}`: UIDと承認状態の対応。
- `staffRequests/{uid}`: `uid`, `employeeNumber`, `name`, `branchId`, `status`, 作成・更新・審査情報。
- `shiftCandidateProfiles/{uid}`: 承認済み利用者の最小限のシフト候補情報。

## 現在の認証・登録

- Firebase Authは警備員番号由来の内部メールとパスワードを使用する。
- 登録時にAuthユーザーを作り、同一バッチで `employeeNumbers`, `users`, `userRoles` を作成する。
- 新規登録時の権限は必ず `role: guard`, `accountStatus: pending`。利用者自身は特権roleを指定できない。

## 今回追加する遷移

- 通常登録: 従来どおり `userRoles: guard/pending`。新規アカウント承認へ表示。
- 内勤希望登録: 上記に加え `staffRequests/{uid}: pending` を同一バッチ作成。内勤者申請だけへ表示。
- 内勤承認: adminだけが同一バッチで申請を `approved`、roleを `staff`、accountStatusを `approved`、正式支社を確定する。
- 内勤却下: adminだけが申請を `rejected`。roleは `guard/pending` のまま維持し、新規アカウント承認へ表示する。
- 却下後の通常承認: 既存処理で `guard/approved` として確定する。

## クエリ

- 新規アカウント承認: `userRoles where accountStatus == pending`。各UIDの `users` と `staffRequests` を個別取得して振り分ける。
- 内勤者申請: admin全支社時は `staffRequests` 全件、支社選択時は `where branchId == selectedBranch`。

## セキュリティ前提

- 登録者は自分のUIDの申請だけ作成できる。
- 申請内容の氏名・番号・希望支社は同一バッチの `users` / `userRoles` と一致させる。
- 登録者は `staff` roleや `approved` 状態を自己付与できない。
- 承認・却下は稼働中adminだけが実行できる。
- 審査ではUID、申請内容、作成日時を変更できない。
- PIIを含む `users` の既存読み取り権限は変更しない。

## Devil's Advocate確認

- 未認証作成: `isOwner(uid)` により拒否。
- 他人名義の申請: 文書ID・`data.uid`・Auth UID一致、および同一バッチのusers情報一致により拒否。
- 自己staff化: 登録者が作成できるuserRolesは既存の `guard/pending` のみ。staffへの更新はadmin専用のため拒否。
- 任意支社注入: `staffRequests.branchId` は `userRoles.requestedBranchId` と `users.requestedBranchId` の両方に一致必須。
- スキーマ汚染・巨大文字列: `isValidRequest` の `hasOnly`、番号形式、氏名・支社長制限により拒否。
- 作成日時改ざん: create時に `createdAt == request.time`、`updatedAt == request.time` が必須。
- 審査内容改ざん: updateはstatus・審査者・審査日時・更新日時以外を変更不可。
- 非admin審査: `isAdmin()` により拒否。
- pending以外からの再審査: `resource.status == pending` のため拒否。
- 内勤承認時の部分更新: staffRequest、users、employeeNumbers、userRoles、shiftCandidateProfilesの `getAfter` 整合条件により、不完全な昇格を拒否。
- 内勤却下後の自己昇格: userRolesはguard/pendingのまま変更権限がなく、通常のadmin承認が必要。
- PII公開: usersのread規則は変更なし。staffRequestsの既存read範囲も変更なし。

## 監査評価

```json
{"score":5,"summary":"今回追加した登録時内勤希望フローは、本人による申請作成とadminによる権限確定を分離し、自己昇格と申請改ざんを拒否する。","findings":[]}
```
