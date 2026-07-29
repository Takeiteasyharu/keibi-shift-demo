import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

let availabilityByDate = new Map();

export async function loadOwnAvailability(uid, branchId = "") {
  const ownQuery = branchId
    ? query(collection(db, "availability"), where("uid", "==", uid), where("branchId", "==", branchId))
    : query(collection(db, "availability"), where("uid", "==", uid));
  const snapshot = await getDocs(ownQuery);
  availabilityByDate = new Map(snapshot.docs.map(item => [item.data().date, item.data()]));
  return availabilityByDate;
}

export function getAvailability(date) {
  return availabilityByDate.get(date) || null;
}

export async function saveAvailability(uid, date, values, branchId = "kokubunji", audit = {}) {
  const reference = doc(db, "availability", `${date}_${uid}`);
  const previous = availabilityByDate.get(date);
  const data = {
    uid,
    branchId,
    date,
    day: Boolean(values.day),
    night: Boolean(values.night),
    unavailable: Boolean(values.unavailable),
    undecided: Boolean(values.undecided),
    note: String(values.note || "").trim().slice(0, 500),
    updatedByUid: audit.updatedByUid || uid,
    updatedByType: audit.updatedByType === "staff" ? "staff" : "self",
    updatedAfterDeadline: Boolean(audit.updatedAfterDeadline),
    createdAt: previous?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(reference, data);
  availabilityByDate.set(date, { ...data, createdAt: previous?.createdAt || new Date() });
  return data;
}

export function clearAvailabilityCache() {
  availabilityByDate.clear();
}
