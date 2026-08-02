import {applicationDefault, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {DocumentData, FieldValue, Timestamp, getFirestore} from "firebase-admin/firestore";

const PROJECT_ID = "keibi-shift-kokubunji-de-fef98";
const EMPLOYEE_NUMBER = "016939";
const CURRENT_UID = "nNIy5SfAsgfUmOHS0i7AkU6zX333";
const OLD_UID = "VZGJycAygIhKAkwmI4kOGGxTieR2";
const INTERNAL_EMAIL = `keibi-${EMPLOYEE_NUMBER}@auth.keibi.invalid`;
const APPLY = process.argv.includes("--apply");

initializeApp({credential: applicationDefault(), projectId: PROJECT_ID});

function normalizedAvailability(source: DocumentData, branchId: string) {
  const updatedByType = source.updatedByType === "proxy" ? "proxy" : "self";
  return {
    uid: CURRENT_UID,
    branchId,
    date: String(source.date),
    day: Boolean(source.day),
    night: Boolean(source.night),
    unavailable: Boolean(source.unavailable),
    undecided: Boolean(source.undecided),
    note: String(source.note || "").slice(0, 500),
    updatedByUid: updatedByType === "self" ? CURRENT_UID : String(source.updatedByUid || CURRENT_UID),
    updatedByType,
    updatedByRole: updatedByType === "proxy" ? String(source.updatedByRole || "") : "",
    updateReason: updatedByType === "proxy" ? String(source.updateReason || "") : "",
    updateReasonNote: updatedByType === "proxy" ? String(source.updateReasonNote || "").slice(0, 200) : "",
    updatedAfterDeadline: Boolean(source.updatedAfterDeadline),
    createdAt: source.createdAt instanceof Timestamp ? source.createdAt : Timestamp.now(),
    updatedAt: source.updatedAt instanceof Timestamp ? source.updatedAt : Timestamp.now()
  };
}

async function authUserExists(uid: string) {
  try {
    await getAuth().getUser(uid);
    return true;
  } catch (error: any) {
    if (error?.code === "auth/user-not-found") return false;
    throw error;
  }
}

async function main() {
  const db = getFirestore();
  const authUser = await getAuth().getUserByEmail(INTERNAL_EMAIL);
  if (authUser.uid !== CURRENT_UID) {
    throw new Error(`Auth UIDが想定と異なるため中止: ${authUser.uid}`);
  }

  const [userDoc, roleDoc, numberDoc, oldUserDoc, oldRoleDoc, oldAuthExists] = await Promise.all([
    db.collection("users").doc(CURRENT_UID).get(),
    db.collection("userRoles").doc(CURRENT_UID).get(),
    db.collection("employeeNumbers").doc(EMPLOYEE_NUMBER).get(),
    db.collection("users").doc(OLD_UID).get(),
    db.collection("userRoles").doc(OLD_UID).get(),
    authUserExists(OLD_UID)
  ]);
  if (!userDoc.exists) throw new Error(`users/${CURRENT_UID} が存在しません`);

  const user = userDoc.data()!;
  if (user.employeeNumber !== EMPLOYEE_NUMBER || user.authUid !== CURRENT_UID) {
    throw new Error("usersのemployeeNumberまたはauthUidが想定と異なるため中止しました");
  }
  if (typeof user.branchId !== "string" || !user.branchId) {
    throw new Error("usersのbranchIdが存在しないため中止しました");
  }
  if (oldAuthExists || oldUserDoc.exists || oldRoleDoc.exists) {
    throw new Error("旧UIDのAuth/users/userRolesが存在するため、自動移行を中止しました");
  }

  const [oldAvailability, currentAvailability, oldCandidates, currentCandidates] = await Promise.all([
    db.collection("availability").where("uid", "==", OLD_UID).get(),
    db.collection("availability").where("uid", "==", CURRENT_UID).get(),
    db.collection("shiftCandidateAvailability").where("uid", "==", OLD_UID).get(),
    db.collection("shiftCandidateAvailability").where("uid", "==", CURRENT_UID).get()
  ]);
  const currentDates = new Set(currentAvailability.docs.map(item => String(item.data().date)));
  const currentCandidateDates = new Set(currentCandidates.docs.map(item => String(item.data().date)));
  const conflicts = oldAvailability.docs.filter(item => currentDates.has(String(item.data().date)));
  const candidateConflicts = oldCandidates.docs.filter(item => currentCandidateDates.has(String(item.data().date)));

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    employeeNumber: EMPLOYEE_NUMBER,
    currentUid: CURRENT_UID,
    oldUid: OLD_UID,
    authUid: authUser.uid,
    user: {path: userDoc.ref.path, employeeNumber: user.employeeNumber, authUid: user.authUid, branchId: user.branchId},
    role: {path: roleDoc.ref.path, exists: roleDoc.exists, data: roleDoc.exists ? roleDoc.data() : null},
    employeeNumberMapping: {path: numberDoc.ref.path, exists: numberDoc.exists, data: numberDoc.exists ? numberDoc.data() : null},
    oldAvailabilityPaths: oldAvailability.docs.map(item => item.ref.path),
    currentAvailabilityPaths: currentAvailability.docs.map(item => item.ref.path),
    conflicts: conflicts.map(item => String(item.data().date)),
    candidateConflicts: candidateConflicts.map(item => String(item.data().date))
  }, null, 2));

  if (!APPLY) {
    console.log("dry-run完了。書き込みは行っていません。実行する場合は --apply を付けてください。");
    return;
  }
  const conflictDates = new Set(conflicts.map(item => String(item.data().date)));
  const candidateConflictDates = new Set(candidateConflicts.map(item => String(item.data().date)));
  if (false && (conflicts.length || candidateConflicts.length)) {
    throw new Error("新旧UIDに同一日付のデータがあるため、自動上書きせず中止しました");
  }

  const batch = db.batch();
  if (!numberDoc.exists || numberDoc.data()?.uid !== CURRENT_UID) {
    batch.set(numberDoc.ref, {uid: CURRENT_UID}, {merge: true});
  }
  if (!roleDoc.exists) {
    batch.set(roleDoc.ref, {
      role: "guard",
      accountStatus: "approved",
      branchId: user.branchId,
      requestedBranchId: user.requestedBranchId || user.branchId,
      leaderEligible: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }
  for (const source of oldAvailability.docs) {
    if (conflictDates.has(String(source.data().date))) continue;
    const data = normalizedAvailability(source.data(), user.branchId);
    const target = db.collection("availability").doc(`${data.date}_${CURRENT_UID}`);
    batch.set(target, data);
  }
  for (const source of oldCandidates.docs) {
    const sourceData = source.data();
    const date = String(sourceData.date);
    if (candidateConflictDates.has(date)) continue;
    const target = db.collection("shiftCandidateAvailability").doc(`${date}_${CURRENT_UID}`);
    batch.set(target, {...sourceData, uid: CURRENT_UID, branchId: user.branchId});
  }
  await batch.commit();
  console.log(`修復完了: availability ${oldAvailability.size}件、候補 ${oldCandidates.size}件を現在UIDへ移行しました。`);
}

main().catch(error => {
  console.error("016939の修復に失敗しました", error);
  process.exitCode = 1;
});
