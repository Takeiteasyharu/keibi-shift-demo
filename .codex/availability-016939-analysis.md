# 016939 勤務希望 permission-denied 調査（2026-08-02）

## 保存処理

- `public/js/calendar.js` の `performSave()` が `state.profile.uid` を `saveAvailability()` へ渡す。
- `state.profile.uid` は `public/js/auth.js` の `loadOwnProfile()` がFirebase Authenticationの
  `user.uid`で上書きするため、本人入力はAuth UIDが基準。
- `public/js/availability.js` は同一バッチで以下をsetする。
  - `availability/{date}_{uid}`
  - `shiftCandidateAvailability/{date}_{uid}`
- 本人入力と代理入力で保存先形式は同一。代理入力だけ監査フィールドがproxyになる。
- 保存フィールドにundefinedはなく、文字列・真偽値へ正規化されている。

## 本番データ

- 正しい現在UID: `nNIy5SfAsgfUmOHS0i7AkU6zX333`（`OHS`の次は英字Oではなく数字0）
- Auth内部メール: `keibi-016939@auth.keibi.invalid`、UIDは現在UID、無効化なし。
- `users/{currentUid}`: employeeNumber=016939、authUid=currentUid、branchId=kokubunji、inputMode=web。
- `userRoles/{currentUid}`: role=guard、accountStatus=approved、branchId=kokubunji。
- `employeeNumbers/016939`: uid=currentUid、accountStatus=approved、branchId=kokubunji。
- 現在UIDのavailability/shiftCandidateAvailability: 0件。
- 旧UID `VZGJycAygIhKAkwmI4kOGGxTieR2` のavailability: 10件。
- 旧UIDのusers/userRoles/staffRequests/shiftCandidateAvailability: 0件。
- 新旧で同一日付のavailability競合: 0件。

## permission-deniedの原因

- `isValidAvailability()` が `isSameBranch(data.branchId)` を全利用者へ要求している。
- `isSameBranch()` はadmin、またはstaffかつ同支社だけをtrueにするoffice向け関数。
- guard本人は `isSelfAvailability()` を満たしても先行する支社条件で必ずfalseになる。
- 修正は `isAdmin() || data.branchId == myRole().branchId` とし、guard本人は自分のroleの支社だけ、
  staffは自支社だけ、adminは全支社という既存境界を維持する。

## 攻撃観点

- guardが他人UIDへ書込: `isSelfAvailability()` のuid/Auth一致で拒否。
- guardが別支社を偽装: 新支社条件でmyRole.branchId不一致となり拒否。
- 未ログイン: `isActive()`で拒否。
- inactive/pending/rejected: `isActive()`で拒否。
- staff/admin代理入力: `isManagedAvailability()`、監査項目、対象支社条件を引き続き要求。
- UID・日付・createdAt変更: create/update双方のvalidatorと更新不変条件で拒否。
- スキーマ外フィールド・巨大文字列: `hasOnly`と文字数制限で拒否。

