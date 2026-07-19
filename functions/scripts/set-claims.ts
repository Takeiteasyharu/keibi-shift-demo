import {applicationDefault, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";

initializeApp({credential: applicationDefault(), projectId: "keibi-shift-kokubunji-de-fef98"});
const [,, uid, employeeNumber, role = "guard", branchId = "kokubunji"] = process.argv;
if (!uid || !/^\d{6}$/.test(employeeNumber) || !["guard", "staff", "admin"].includes(role)) {
  throw new Error("Usage: npm run set-claims -- <uid> <6桁番号> <guard|staff|admin> [branchId]");
}
async function main() {
  const claims = {role, branchId, accountStatus: "active"};
  await getAuth().setCustomUserClaims(uid, claims);
  await getFirestore().collection("employeeNumbers").doc(employeeNumber).set({
    uid, ...claims, updatedAt: FieldValue.serverTimestamp()
  }, {merge: true});
  await getFirestore().collection("users").doc(uid).set({...claims, employeeNumber, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
  console.log("Claims and employee-number mapping updated:", {uid, employeeNumber, role, branchId});
}
main().catch(error => { console.error(error); process.exitCode = 1; });
