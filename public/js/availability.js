import { auth, db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

let availabilityByDate = new Map();
let availabilityOwnerUid = "";
let loadVersion = 0;
let saveSequence = 0;
const saveQueues = new Map();
const lastSaveCompletedAt = new Map();
const MIN_SAVE_INTERVAL_MS = 750;

export async function loadOwnAvailability(uid, branchId = "") {
  if (!uid) throw new Error("勤務希望の対象UIDがありません。");
  const requestVersion = ++loadVersion;
  availabilityOwnerUid = uid;
  availabilityByDate = new Map();
  const ownQuery = branchId
    ? query(collection(db, "availability"), where("uid", "==", uid), where("branchId", "==", branchId))
    : query(collection(db, "availability"), where("uid", "==", uid));
  const snapshot = await getDocs(ownQuery);
  if (requestVersion !== loadVersion || availabilityOwnerUid !== uid) return null;
  availabilityByDate = new Map(snapshot.docs
    .map(item => item.data())
    .filter(item => item.uid === uid)
    .map(item => [item.date, item]));
  return availabilityByDate;
}

export function getAvailability(date, uid = availabilityOwnerUid) {
  if (!uid || uid !== availabilityOwnerUid) return null;
  return availabilityByDate.get(date) || null;
}

export async function saveAvailability(uid, date, values, branchId = "kokubunji", audit = {}) {
  if (!uid || uid !== availabilityOwnerUid) {
    const error = new Error("勤務希望の読込対象と保存対象が一致しません。");
    error.code = "availability/owner-mismatch";
    throw error;
  }
  const key = `${uid}_${date}`;
  const sequence = ++saveSequence;
  const snapshot = {
    uid,
    branchId,
    date,
    day: Boolean(values.day),
    night: Boolean(values.night),
    unavailable: Boolean(values.unavailable),
    undecided: Boolean(values.undecided),
    note: String(values.note || "").trim().slice(0, 500),
    updatedByUid: audit.updatedByUid || uid,
    updatedByType: audit.updatedByType === "proxy" ? "proxy" : "self",
    updatedByRole: audit.updatedByType === "proxy" ? String(audit.updatedByRole || "") : "",
    updateReason: audit.updatedByType === "proxy" ? String(audit.updateReason || "") : "",
    updateReasonNote: audit.updatedByType === "proxy"
      ? String(audit.updateReasonNote || "").trim().slice(0, 200)
      : "",
    updatedAfterDeadline: Boolean(audit.updatedAfterDeadline)
  };
  const previousQueue = saveQueues.get(key) || Promise.resolve();
  const queuedSave = previousQueue.catch(() => undefined).then(async () => {
    const remaining = MIN_SAVE_INTERVAL_MS - (Date.now() - (lastSaveCompletedAt.get(key) || 0));
    if (remaining > 0) await delay(remaining);
    try {
      return await executeSave(sequence, snapshot);
    } finally {
      lastSaveCompletedAt.set(key, Date.now());
    }
  });
  const trackedSave = queuedSave.finally(() => {
    if (saveQueues.get(key) === trackedSave) saveQueues.delete(key);
  });
  saveQueues.set(key, trackedSave);
  return trackedSave;
}

async function executeSave(sequence, values) {
  const { uid, date, branchId } = values;
  const expectedAuthUid = values.updatedByUid;
  const reference = doc(db, "availability", `${date}_${uid}`);
  const candidateReference = doc(db, "shiftCandidateAvailability", `${date}_${uid}`);
  let operation = "unknown";
  try {
    assertSaveContext(uid, expectedAuthUid);
    const current = availabilityOwnerUid === uid ? availabilityByDate.get(date) : null;
    operation = current ? "update" : "create";
    console.info("勤務希望保存開始", {
      sequence, operation, authUid: auth.currentUser?.uid || "", targetUid: uid, date,
      values: availabilityLogValues(values)
    });
    assertSaveContext(uid, expectedAuthUid);
    if (current && current.uid !== uid) {
      const error = new Error("勤務希望ドキュメントの所有者UIDが一致しません。");
      error.code = "availability/owner-mismatch";
      throw error;
    }
    const availabilityData = { ...values, updatedAt: serverTimestamp() };
    if (current) {
      await updateDoc(reference, availabilityData);
    } else {
      await setDoc(reference, {
        ...values,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
    await syncCandidateAvailability(candidateReference, {
      uid, branchId, date,
      day: values.day,
      night: values.night,
      unavailable: values.unavailable,
      undecided: values.undecided,
      note: values.note,
      updatedAt: serverTimestamp()
    });
    assertSaveContext(uid, expectedAuthUid);
    const latest = await getDoc(reference);
    if (!latest.exists() || latest.data().uid !== uid) {
      const error = new Error("保存後の勤務希望を確認できませんでした。");
      error.code = "availability/save-verification-failed";
      throw error;
    }
    if (availabilityOwnerUid === uid) availabilityByDate.set(date, latest.data());
    console.info("勤務希望保存完了", {
      sequence, operation, authUid: auth.currentUser?.uid || "", targetUid: uid, date,
      values: availabilityLogValues(values)
    });
    return latest.data();
  } catch (error) {
    if (operation === "update") {
      await refreshAvailabilityDate(uid, date).catch(refreshError => {
        console.error("勤務希望の最新値再取得に失敗しました", refreshError);
      });
    }
    console.error("勤務希望保存失敗", {
      sequence, operation, code: error?.code, authUid: auth.currentUser?.uid || "",
      targetUid: uid, date, values: availabilityLogValues(values)
    });
    throw error;
  }
}

function assertSaveContext(targetUid, expectedAuthUid) {
  if (!auth.currentUser?.uid || auth.currentUser.uid !== expectedAuthUid || availabilityOwnerUid !== targetUid) {
    const error = new Error("認証ユーザーまたは勤務希望の対象が保存開始時から変更されました。");
    error.code = "availability/owner-mismatch";
    throw error;
  }
}

async function refreshAvailabilityDate(uid, date) {
  const latest = await getDoc(doc(db, "availability", `${date}_${uid}`));
  if (availabilityOwnerUid !== uid) return;
  if (latest.exists() && latest.data().uid === uid) availabilityByDate.set(date, latest.data());
  else availabilityByDate.delete(date);
}

function availabilityLogValues(values) {
  return {
    day: values.day,
    night: values.night,
    unavailable: values.unavailable,
    undecided: values.undecided,
    note: values.note
  };
}

async function syncCandidateAvailability(reference, data) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await setDoc(reference, data);
      return;
    } catch (error) {
      lastError = error;
      console.warn("勤務希望候補データの同期を再試行します", {
        attempt, code: error?.code, targetUid: data.uid, date: data.date
      });
      if (attempt < 3) await delay(250 * attempt);
    }
  }
  console.error("勤務希望本体は保存されましたが候補データを同期できませんでした", {
    code: lastError?.code, targetUid: data.uid, date: data.date
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function clearAvailabilityCache() {
  loadVersion += 1;
  availabilityOwnerUid = "";
  availabilityByDate = new Map();
}
