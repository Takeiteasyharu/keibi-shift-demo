import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const authMessages = {
  "auth/email-already-in-use": "このメールアドレスは既に登録されています。",
  "auth/invalid-credential": "メールアドレスまたはパスワードが正しくありません。",
  "auth/invalid-email": "メールアドレスの形式が正しくありません。",
  "auth/missing-password": "パスワードを入力してください。",
  "auth/too-many-requests": "操作回数が多すぎます。しばらく待ってからお試しください。",
  "auth/weak-password": "パスワードは6文字以上で入力してください。"
};

export function friendlyAuthError(error) {
  console.error(error);
  return authMessages[error?.code] || "処理に失敗しました。通信状態を確認して、もう一度お試しください。";
}

export async function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function registerGuard(form) {
  const credential = await createUserWithEmailAndPassword(auth, form.email, form.password);
  const user = credential.user;
  try {
    await setDoc(doc(db, "users", user.uid), {
      employeeNumber: form.employeeNumber,
      name: form.name,
      email: user.email,
      postalCode: form.postalCode,
      prefecture: form.prefecture,
      city: form.city,
      addressLine: form.addressLine,
      building: form.building,
      nearestStation: form.nearestStation,
      branchId: "kokubunji",
      role: "guard",
      accountStatus: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await sendEmailVerification(user);
    return user;
  } catch (error) {
    await signOut(auth);
    throw error;
  }
}

export function sendVerification() {
  if (!auth.currentUser) throw new Error("ログインが必要です。");
  return sendEmailVerification(auth.currentUser);
}

export function sendPasswordReset(email) {
  return sendPasswordResetEmail(auth, email.trim());
}

export function logout() {
  return signOut(auth);
}

export async function reloadCurrentUser() {
  if (!auth.currentUser) return null;
  await auth.currentUser.reload();
  return auth.currentUser;
}

export async function loadOwnProfile(user) {
  const snapshot = await getDoc(doc(db, "users", user.uid));
  if (!snapshot.exists()) throw new Error("利用者情報が見つかりません。管理者へ連絡してください。");
  return { uid: user.uid, ...snapshot.data() };
}

export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}
