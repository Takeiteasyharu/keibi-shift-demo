import {applicationDefault, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";

initializeApp({credential: applicationDefault(), projectId: "keibi-shift-kokubunji-de-fef98"});
async function main() {
  const db = getFirestore();
  const users = await db.collection("users").get();
  for (const item of users.docs) {
    const data = item.data();
    const role = ["guard", "staff", "admin"].includes(data.role) ? data.role : "guard";
    const claims = {role, branchId: data.branchId || "kokubunji", accountStatus: data.accountStatus || "active"};
    await getAuth().setCustomUserClaims(item.id, claims);
    await db.collection("employeeNumbers").doc(data.employeeNumber).set({
      uid: item.id, ...claims, updatedAt: FieldValue.serverTimestamp()
    }, {merge: true});
  }
  const shifts = await db.collection("availability").get();
  const writer = db.bulkWriter();
  shifts.docs.forEach(item => writer.set(item.ref, {branchId: item.data().branchId || "kokubunji"}, {merge: true}));
  await writer.close();
  console.log(`Migrated ${users.size} users and ${shifts.size} availability documents.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
