import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  doc,
  deleteField,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

export function createInternalAuthEmail(employeeNumber) {
  return `keibi-${employeeNumber}@auth.keibi.invalid`;
}

export function loginWithEmployeeNumber(employeeNumber, password) {
  return signInWithEmailAndPassword(auth, createInternalAuthEmail(employeeNumber), password);
}

export async function registerGuard(form) {
  const credential = await createUserWithEmailAndPassword(
    auth, createInternalAuthEmail(form.employeeNumber), form.password
  );
  const user = credential.user;
  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.set(doc(db, "employeeNumbers", form.employeeNumber), {
    uid: user.uid, accountStatus: "pending", requestedBranchId: form.requestedBranchId
  });
  batch.set(doc(db, "users", user.uid), {
    employeeNumber: form.employeeNumber, name: form.name, contactEmail: "",
    postalCode: "", prefecture: "", city: "", addressLine: "", building: "",
    nearestStation: "", requestedBranchId: form.requestedBranchId,
    inputMode: "web", authUid: user.uid,
    createdAt: now, updatedAt: now
  });
  batch.set(doc(db, "userRoles", user.uid), {
    role: "guard", accountStatus: "pending", requestedBranchId: form.requestedBranchId,
    leaderEligible: false, createdAt: now, updatedAt: now
  });
  try {
    await batch.commit();
    return user;
  } catch (error) {
    await deleteUser(user).catch(() => undefined);
    throw error;
  }
}

export function logout() { return signOut(auth); }
export function observeAuthState(callback) { return onAuthStateChanged(auth, callback); }
export function observeOwnRole(uid, callback, onError) {
  return onSnapshot(doc(db, "userRoles", uid),
    snapshot => callback(snapshot.exists() ? snapshot.data() : null), onError);
}
export function removeLegacyAdminBranch(uid) {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.update(doc(db, "userRoles", uid), { branchId: deleteField(), updatedAt: now });
  batch.update(doc(db, "users", uid), { branchId: deleteField(), updatedAt: now });
  return batch.commit();
}
export async function loadOwnProfile(user) {
  const snapshot = await getDoc(doc(db, "users", user.uid));
  if (!snapshot.exists()) throw new Error("利用者情報が見つかりません。");
  // Authentication UID is authoritative even if a legacy profile contains a uid field.
  return { ...snapshot.data(), uid: user.uid };
}
