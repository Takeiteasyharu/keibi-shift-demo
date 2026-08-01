import { db } from "./firebase-config.js";
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { ALL_BRANCHES, branchName, effectiveBranchId, isOperationalAccount } from "./branches.js";

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

export function removeInactiveAccountFromAdmin(worker, accountStatus) {
  if (!worker || isOperationalAccount(accountStatus)) return;
  const accountId = worker.uid || worker.id;
  if (!accountId) return;
  [el.adminTableBody, el.adminCards].forEach(container => {
    container.querySelectorAll("[data-account-id]").forEach(item => {
      if (item.dataset.accountId === accountId) item.remove();
    });
  });
  if (!el.adminTableBody.children.length) {
    el.adminTableBody.innerHTML = '<tr><td colspan="5">該当する利用者はいません</td></tr>';
  }
}

async function renderAdmin() {
  const branchId = effectiveBranchId(currentRole);
  const allBranches = currentRole.role === "admin" && branchId === ALL_BRANCHES;
  const isAdminView = currentRole.role === "admin";
  const date = el.adminDate.value;
  el.adminDateLabel.textContent = `${date} の勤務希望`;
  // adminは支社に所属しないため、特定支社表示でも全usersからadminを合流して絞り込む。
  const usersQuery = isAdminView
    ? collection(db, "users")
    : query(collection(db, "users"), where("branchId", "==", branchId));
  const availabilityQuery = allBranches
    ? query(collection(db, "availability"), where("date", "==", date))
    : query(collection(db, "availability"), where("branchId", "==", branchId), where("date", "==", date));
  const rolesQuery = isAdminView
    ? collection(db, "userRoles")
    : query(collection(db, "userRoles"), where("branchId", "==", branchId));
  const [usersSnapshot, availabilitySnapshot, rolesSnapshot] = await Promise.all([
    getDocs(usersQuery),
    getDocs(availabilityQuery),
    getDocs(rolesQuery)
  ]);
  const roles = createRoleLookup(rolesSnapshot);
  // 新旧データでusersの文書IDとAuthentication UIDが異なる場合も、
  // authUid / uid / workerIdを使ってuserRolesへ安全に結合する。
  const users = usersSnapshot.docs.map(d => {
    const data = d.data();
    const roleEntry = findRoleEntry(d.id, data, roles);
    return {
      ...data,
      id: d.id,
      uid: roleEntry?.id || data.authUid || data.uid || d.id,
      inputMode: data.inputMode === "managed" ? "managed" : "web",
      profileAccountStatus: data.accountStatus,
      roleData: roleEntry?.data || null
    };
  });
  const usersByUid = createUserLookup(users);
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
    // userRolesを優先し、分離前の旧users.role/accountStatusも読み取り互換として扱う。
    const roleData = user.roleData || user;
    const formalBranchId = resolveFormalBranchId(user, roleData);
    return {
      ...user,
      role: roleData?.role,
      roleBranchId: roleData?.branchId,
      branchId: formalBranchId,
      accountStatus: roleData?.accountStatus,
      disabledAt: roleData?.disabledAt ?? user.disabledAt ?? null,
      disabledByUid: roleData?.disabledByUid ?? user.disabledByUid ?? "",
      shift: availability.get(user.uid)
    };
  })
    .filter(user => isVisibleAccount(user) &&
      (allBranches || user.role === "admin" || user.branchId === branchId))
    .filter(user => matchesFilter(user.shift))
    .filter(user => !search || `${user.employeeNumber} ${user.name} ${user.city}`.toLowerCase().includes(search))
    // adminは支社に関係なく常に最後へ表示する。
    .sort((a, b) => Number(a.role === "admin") - Number(b.role === "admin") ||
      String(a.employeeNumber || "").localeCompare(String(b.employeeNumber || ""), "ja"));
  el.adminTableBody.replaceChildren();
  el.adminCards.replaceChildren();
  rows.forEach(user => {
    const shift = user.shift || {};
    const status = shift.unavailable ? "勤務不可" : shift.undecided ? "未定" :
      shift.day && shift.night ? "日勤・夜勤" : shift.day ? "日勤" : shift.night ? "夜勤" : "未入力";
    const updateType = ["staff", "proxy"].includes(shift.updatedByType) ? "代理入力" : shift.updatedByType === "self" ? "本人入力" : "記録なし";
    const tr = document.createElement("tr");
    tr.className = "admin-summary-row";
    tr.dataset.accountId = user.uid || user.id;
    const identityCell = document.createElement("td");
    identityCell.append(
      summaryLine(`警備員番号：${user.employeeNumber}`, "admin-summary-number"),
      summaryRoleLine(user),
      ...(allBranches ? [summaryLine(`支社：${displayBranchName(user)}`, "admin-summary-branch")] : [])
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
    card.dataset.accountId = user.uid || user.id;
    const heading = document.createElement("div");
    heading.className = "admin-card-heading";
    appendRoleName(heading, user);
    if (allBranches) heading.appendChild(summaryLine(displayBranchName(user), "admin-summary-branch"));
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

function resolveFormalBranchId(user, roleData) {
  if (roleData?.role === "admin") return null;
  if (roleData?.branchId || user.branchId) return roleData?.branchId || user.branchId;
  // 既存guard/staffのbranchId欠落は、旧システムの所属先である国分寺として互換表示する。
  return ["guard", "staff"].includes(roleData?.role) ? "kokubunji" : null;
}

function isVisibleAccount(user) {
  if (!isOperationalAccount(user.accountStatus)) return false;
  // 旧users側に停止状態が残るデータは、通常一覧へ戻さない。
  if (user.profileAccountStatus != null && !isOperationalAccount(user.profileAccountStatus)) return false;
  if (user.disabledAt || user.disabledByUid) return false;
  // managedはAuthenticationを持たない正式仕様。webで明示的にauthUidが空のデータだけを無効扱いにする。
  if (user.inputMode === "web" && Object.hasOwn(user, "authUid") && !user.authUid) return false;
  return ["guard", "staff", "admin"].includes(user.role);
}

function createRoleLookup(rolesSnapshot) {
  const lookup = new Map();
  rolesSnapshot.docs.forEach(item => {
    const data = item.data();
    const entry = { id: item.id, data };
    [item.id, data.uid, data.authUid, data.workerId].filter(Boolean).forEach(key => lookup.set(key, entry));
  });
  return lookup;
}

function findRoleEntry(documentId, user, roleLookup) {
  for (const key of [documentId, user.authUid, user.uid, user.workerId]) {
    if (key && roleLookup.has(key)) return roleLookup.get(key);
  }
  return null;
}

function createUserLookup(users) {
  const lookup = new Map();
  users.forEach(user => {
    [user.id, user.uid, user.authUid, user.workerId].filter(Boolean).forEach(key => lookup.set(key, user));
  });
  return lookup;
}

function displayBranchName(user) {
  return user.role === "admin" ? "全支社管理（所属なし）" : branchName(user.branchId);
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
  const selectedBranch = effectiveBranchId(currentRole);
  const requestsQuery = currentRole.role === "admin" && selectedBranch === ALL_BRANCHES
    ? collection(db, "staffRequests")
    : query(collection(db, "staffRequests"), where("branchId", "==", selectedBranch));
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
