import { db } from "./firebase-config.js";
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

let el;
let navigate;
let currentProfile;
let currentRole;
let activeFilter = "all";
let createWorkerMenu;

export function initAdmin(elements, showScreen, workerMenuFactory) {
  el = elements;
  navigate = showScreen;
  createWorkerMenu = workerMenuFactory;
  const today = toLocalDateKey(new Date());
  el.adminDate.value = today;
  el.adminSearchButton.addEventListener("click", renderAdmin);
  el.adminClearButton.addEventListener("click", () => { el.adminSearch.value = ""; renderAdmin(); });
  el.adminDate.addEventListener("change", renderAdmin);
  el.adminPrevDay.addEventListener("click", () => moveDate(-1));
  el.adminToday.addEventListener("click", () => { el.adminDate.value = toLocalDateKey(new Date()); renderAdmin(); });
  el.adminNextDay.addEventListener("click", () => moveDate(1));
  el.adminFilters.addEventListener("click", event => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    activeFilter = button.dataset.filter;
    el.adminFilters.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
    renderAdmin();
  });
}

export async function showAdmin(profile = currentProfile, roleData = currentRole) {
  if (profile) currentProfile = profile;
  if (roleData) currentRole = roleData;
  if (!["staff", "admin"].includes(currentRole?.role)) throw new Error("管理画面を開く権限がありません。");
  navigate("admin");
  await renderAdmin();
}

async function renderAdmin() {
  const branchId = currentRole.branchId;
  const date = el.adminDate.value;
  el.adminDateLabel.textContent = `${date} の勤務希望`;
  const usersQuery = query(collection(db, "users"), where("branchId", "==", branchId));
  const availabilityQuery = query(
    collection(db, "availability"),
    where("branchId", "==", branchId),
    where("date", "==", date)
  );
  const rolesQuery = query(collection(db, "userRoles"), where("branchId", "==", branchId));
  const [usersSnapshot, availabilitySnapshot, rolesSnapshot] = await Promise.all([
    getDocs(usersQuery),
    getDocs(availabilityQuery),
    getDocs(rolesQuery)
  ]);
  const roles = new Map(rolesSnapshot.docs.map(d => [d.id, d.data()]));
  // Firestore document ID is the authoritative Authentication UID.
  // Ignore a legacy `uid` field inside users documents if one exists.
  const users = usersSnapshot.docs.map(d => {
    const data = d.data();
    return { ...data, inputMode: data.inputMode === "managed" ? "managed" : "web", uid: d.id };
  });
  const usersByUid = new Map(users.map(user => [user.uid, user]));
  const usersByEmployeeNumber = new Map(users.map(user => [user.employeeNumber, user]));
  const availability = new Map();
  availabilitySnapshot.docs.forEach(item => {
    const data = item.data();
    const uid = resolveAvailabilityUid(item.id, data, date, usersByUid, usersByEmployeeNumber);
    if (!uid) return;
    const previous = availability.get(uid);
    if (!previous || timestampMillis(data.updatedAt) >= timestampMillis(previous.updatedAt)) {
      availability.set(uid, data);
    }
  });
  const search = el.adminSearch.value.trim().toLowerCase();
  const rows = users.map(user => {
    const roleData = roles.get(user.uid);
    return {
      ...user,
      role: roleData?.role,
      roleBranchId: roleData?.branchId,
      accountStatus: roleData?.accountStatus,
      shift: availability.get(user.uid)
    };
  })
    .filter(user =>
      user.branchId === branchId &&
      user.roleBranchId === branchId &&
      user.accountStatus === "active"
    )
    .filter(user => matchesFilter(user.shift))
    .filter(user => !search || `${user.employeeNumber} ${user.name} ${user.city}`.toLowerCase().includes(search));
  el.adminTableBody.replaceChildren();
  el.adminCards.replaceChildren();
  rows.forEach(user => {
    const shift = user.shift || {};
    const status = shift.unavailable ? "勤務不可" : shift.undecided ? "未定" :
      shift.day && shift.night ? "日勤・夜勤" : shift.day ? "日勤" : shift.night ? "夜勤" : "未入力";
    const updateType = ["staff", "proxy"].includes(shift.updatedByType) ? "代理入力" : shift.updatedByType === "self" ? "本人入力" : "記録なし";
    const tr = document.createElement("tr");
    tr.className = "admin-summary-row";
    const identityCell = document.createElement("td");
    identityCell.append(
      summaryLine(`警備員番号：${user.employeeNumber}`, "admin-summary-number"),
      summaryRoleLine(user)
    );
    const wishCell = document.createElement("td");
    wishCell.append(
      summaryLine(status, "admin-summary-status"),
      summaryLine(`日勤：${shift.day ? "○" : "―"}　夜勤：${shift.night ? "○" : "―"}`)
    );
    const noteCell = document.createElement("td");
    noteCell.append(
      summaryLine(`備考：${shift.note || "なし"}`),
      summaryLine(`更新：${updateType}`, "admin-update-type")
    );
    const contactCell = document.createElement("td");
    contactCell.append(
      summaryLine(`〒${user.postalCode || "―"}　${user.prefecture || ""}${user.city || ""}${user.addressLine || ""}${user.building || ""}`),
      summaryLine(`最寄り駅：${user.nearestStation || "―"}`),
      summaryLine(`メール：${user.contactEmail || "―"}`)
    );
    const actionCell = document.createElement("td");
    actionCell.appendChild(createWorkerMenu(user, currentProfile, currentRole));
    tr.append(identityCell, wishCell, noteCell, contactCell, actionCell);
    el.adminTableBody.appendChild(tr);
    const card = document.createElement("article");
    card.className = "admin-card";
    const heading = document.createElement("div");
    heading.className = "admin-card-heading";
    appendRoleName(heading, user);
    const details = document.createElement("div");
    details.className = "admin-card-details";
    details.textContent = `${user.employeeNumber}\n${status}\n${updateType}\n${shift.note || "備考なし"}\n` +
      `${user.prefecture}${user.city}${user.addressLine}${user.building || ""}\n最寄り駅：${user.nearestStation || "―"}\n${user.contactEmail}`;
    card.append(heading, details);
    card.appendChild(createWorkerMenu(user, currentProfile, currentRole));
    el.adminCards.appendChild(card);
  });
  if (!rows.length) el.adminTableBody.innerHTML = '<tr><td colspan="5">該当する利用者はいません</td></tr>';
}

function summaryLine(text, className = "") {
  const line = document.createElement("div");
  line.className = `admin-summary-line ${className}`.trim();
  line.textContent = text;
  return line;
}

function summaryRoleLine(user) {
  const line = document.createElement("div");
  line.className = "admin-summary-line admin-summary-name";
  appendRoleName(line, user);
  return line;
}

function appendRoleName(container, user) {
  const name = document.createElement("span");
  name.textContent = user.name || "氏名未登録";
  const badge = document.createElement("span");
  badge.className = `role-badge role-badge-${user.role || "unknown"}`;
  badge.textContent = roleLabel(user.role);
  container.append(name, badge);
}

function roleLabel(role) {
  return { guard: "警備員", staff: "内勤者", admin: "管理者" }[role] || "区分不明";
}

export async function loadStaffRequests() {
  if (!["staff", "admin"].includes(currentRole?.role)) throw new Error("申請を表示する権限がありません。");
  const requestsQuery = currentRole.role === "admin"
    ? collection(db, "staffRequests")
    : query(collection(db, "staffRequests"), where("branchId", "==", currentRole.branchId));
  const snapshot = await getDocs(requestsQuery);
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function reviewStaffRequest(requestItem, decision) {
  if (currentRole?.role !== "admin") throw new Error("承認・却下は管理者だけが実行できます。");
  if (!["approved", "rejected"].includes(decision)) throw new Error("不正な操作です。");
  const batch = writeBatch(db);
  batch.update(doc(db, "staffRequests", requestItem.uid), {
    status: decision, reviewedBy: currentProfile.uid,
    reviewedAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  if (decision === "approved") {
    batch.update(doc(db, "userRoles", requestItem.uid), {
      role: "staff", updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
}

function moveDate(days) {
  const [year, month, day] = el.adminDate.value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  el.adminDate.value = toLocalDateKey(date);
  renderAdmin();
}

function toLocalDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function resolveAvailabilityUid(documentId, data, date, usersByUid, usersByEmployeeNumber) {
  const ownerCandidates = [data.uid, data.userId, data.userUid, data.employeeNumber, data.guardId];
  for (const owner of ownerCandidates) {
    if (!owner) continue;
    if (usersByUid.has(owner)) return owner;
    if (usersByEmployeeNumber.has(owner)) return usersByEmployeeNumber.get(owner).uid;
  }
  for (const user of usersByUid.values()) {
    if ([user.uid, `${date}_${user.uid}`, `${user.uid}_${date}`, `${date}_${user.employeeNumber}`].includes(documentId)) {
      return user.uid;
    }
  }
  return null;
}

function timestampMillis(value) {
  return value?.toMillis?.() ?? value?.toDate?.().getTime?.() ?? 0;
}

function matchesFilter(shift) {
  if (activeFilter === "all") return true;
  if (activeFilter === "none") return !shift;
  if (!shift) return false;
  if (activeFilter === "day") return shift.day;
  if (activeFilter === "night") return shift.night;
  if (activeFilter === "both") return shift.day && shift.night;
  if (activeFilter === "unavailable") return shift.unavailable;
  if (activeFilter === "undecided") return shift.undecided;
  return true;
}
