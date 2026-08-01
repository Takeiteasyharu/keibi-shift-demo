# 警備員番号重複判定の調査（2026-08-01）

## 現行処理

- Web新規登録は `public/js/auth.js` の `registerGuard()` で、最初に
  `keibi-{警備員番号}@auth.keibi.invalid` をFirebase Authenticationへ作成する。
- Auth作成後、同一バッチで `employeeNumbers/{警備員番号}`、`users/{uid}`、
  `userRoles/{uid}`（内勤希望時は `staffRequests/{uid}` も）を作成する。
- `firestore.rules` は `employeeNumbers/{警備員番号}` が既に存在する場合、
  Web登録者による新規作成を拒否する。
- 承認待ち・承認済み・利用中・利用停止済みは番号を予約し続ける。
- 却下処理は `employeeNumbers.accountStatus = "rejected"` と
  `userRoles.accountStatus = "rejected"` を使用しているが、従来ルールでは再申請できなかった。
- `public/js/app.js` はAuth重複とFirestore予約重複を同じ曖昧な文言で表示していた。

## 016939の本番読み取り結果

- `employeeNumbers/016939`: `{ uid: "VZGJycAygIhKAkwmI4kOGGxTieR2" }`
- `userRoles/VZGJycAygIhKAkwmI4kOGGxTieR2`:
  `role = "guard"`, `accountStatus = "active"`, `branchId = "kokubunji"`
- `users` の `employeeNumber == "016939"`: 0件
- Auth内部メール `keibi-016939@auth.keibi.invalid`: 0件
- `staffRequests/VZGJycAygIhKAkwmI4kOGGxTieR2`: なし

原因はAuthとusersプロフィールの削除後も、番号予約とactive状態のroleが残った不完全削除。
ユーザーの指示に従い、本作業では本番データを自動削除・自動変更しない。

## 修正方針

- `pending`, `approved`, `active`, `inactive` および状態不明の予約は引き続き拒否する。
- 既存フィールド `accountStatus == "rejected"` の予約だけ、旧roleもrejected（または不存在）なら、
  新しいAuth UIDのpending予約へ安全に更新できるようにする。
- 完全削除・再登録許可は `employeeNumbers/{番号}` と旧関連データが管理者により整理済みで、
  Auth内部メールも存在しない状態とする。新しい許可フィールドは追加しない。
- Auth重複とFirestore予約残存を区別してエラー表示する。

## 攻撃観点

- active/inactive/pending予約の奪取: rejected限定条件により拒否。
- rejected以外への状態偽装: old resourceと旧roleの両方がrejectedであることを要求。
- 他人のUID指定: 新UIDがrequest.auth.uid、内部メールが番号と一致することを要求。
- role昇格: 新roleは既存のusers/userRoles createルールによりguard/pending固定。
- 任意フィールド注入: employeeNumbersの許可キーを既存4フィールドに限定。
- バッチ不整合: getAfterで新しいusers/userRolesと予約UID・番号・pending状態を照合。

