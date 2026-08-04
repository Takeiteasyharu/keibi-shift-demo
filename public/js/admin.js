import { auth, db } from "./firebase-config.js";
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { ALL_BRANCHES, branchName, effectiveBranchId, isOperationalAccount } from "./branches.js";

let el;
let navigate;
let currentProfile;
let currentRole;
let activeFilter = "all";
let activeKanaPage = "all";
let createWorkerMenu;
let notify;
let proxyTargetUid = "";
let selectedDate = "";
let stopAvailabilityObserver = null;
let availabilityObserverKey = "";
let latestAvailabilitySnapshot = null;
let latestUsersSnapshot = null;
let latestRolesSnapshot = null;
let renderGeneration = 0;
const pendingProxyCells = new Set();
const ROLE_SORT_ORDER = { guard: 0, staff: 1, admin: 2 };

export function initAdmin(elements, showScreen, workerMenuFactory, showToast) {
  el = elements;
  navigate = showScreen;
  createWorkerMenu = workerMenuFactory;
  notify = showToast;
  const today = toLocalDateKey(new Date()).slice(0, 7);
  el.adminDate.value = today;
  el.adminSearchButton.addEventListener("click", renderAdmin);
  el.adminClearButton.addEventListener("click", () => { el.adminSearch.value = ""; renderAdmin(); });
  el.adminDate.addEventListener("change", () => { resetSelectedDateAndFilter(); renderAdmin(); });
  el.adminPrevDay.addEventListener("click", () => moveDate(-1));
  el.adminToday.addEventListener("click", () => { resetSelectedDateAndFilter(); el.adminDate.value = toLocalDateKey(new Date()).slice(0, 7); renderAdmin(); });
  el.adminNextDay.addEventListener("click", () => moveDate(1));
  el.adminFilters.addEventListener("click", event => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    if (button.dataset.filter !== "all" && !selectedDate) {
      notify?.("先に日付を選択してください。");
      return;
    }
    activeFilter = button.dataset.filter;
    updateFilterButtons();
    renderAdmin();
  });
  el.adminKanaPages.addEventListener("click", event => {
    const button = event.target.closest("button[data-kana-page]");
    if (!button) return;
    activeKanaPage = button.dataset.kanaPage;
    updateKanaPageButtons();
    renderAdmin();
  });
}

export function stopAdminObserver() {
  stopAvailabilityObserver?.();
  stopAvailabilityObserver = null;
  availabilityObserverKey = "";
  latestAvailabilitySnapshot = null;
  latestUsersSnapshot = null;
  latestRolesSnapshot = null;
  proxyTargetUid = "";
  selectedDate = "";
  activeFilter = "all";
  activeKanaPage = "all";
  pendingProxyCells.clear();
  if (el?.adminFilters) updateFilterButtons();
  if (el?.adminKanaPages) updateKanaPageButtons();
}

export async function showAdmin(profile = currentProfile, roleData = currentRole) {
  if (profile) currentProfile = profile;
  if (roleData) currentRole = roleData;
  if (!["staff", "admin"].includes(currentRole?.role)) throw new Error("管理画面を開く権限がありません。");
  navigate("admin");
  updateFilterButtons();
  updateKanaPageButtons();
  await renderAdmin();
}

export function removeInactiveAccountFromAdmin(worker, accountStatus) {
  if (!worker || isOperationalAccount(accountStatus)) return;
  renderAdmin();
}

async function renderAdmin() {
  const generation = ++renderGeneration;
  const branchId = effectiveBranchId(currentRole);
  const allBranches = currentRole.role === "admin" && branchId === ALL_BRANCHES;
  const isAdminView = currentRole.role === "admin";
  const monthValue = /^\d{4}-\d{2}$/.test(el.adminDate.value)
    ? el.adminDate.value
    : toLocalDateKey(new Date()).slice(0, 7);
  el.adminDate.value = monthValue;
  const [year, month] = monthValue.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDate = `${monthValue}-01`;
  const lastDate = `${monthValue}-${String(daysInMonth).padStart(2, "0")}`;
  el.adminDateLabel.textContent = `${year}年${month}月 勤務日程表`;
  // adminは支社に所属しないため、特定支社表示でも全usersからadminを合流して絞り込む。
  const usersQuery = isAdminView
    ? collection(db, "users")
    : query(collection(db, "users"), where("branchId", "==", branchId));
  const availabilityQuery = allBranches
    ? query(collection(db, "availability"), where("date", ">=", firstDate), where("date", "<=", lastDate))
    : query(collection(db, "availability"), where("branchId", "==", branchId),
      where("date", ">=", firstDate), where("date", "<=", lastDate));
  const availabilityFallbackQuery = allBranches
    ? null
    : query(collection(db, "availability"), where("branchId", "==", branchId));
  ensureAvailabilityObserver(availabilityQuery, `${branchId}|${firstDate}|${lastDate}|${allBranches}`, availabilityFallbackQuery);
  const rolesQuery = isAdminView
    ? collection(db, "userRoles")
    : query(collection(db, "userRoles"), where("branchId", "==", branchId));
  const [usersSnapshot, availabilitySnapshot, rolesSnapshot] = await Promise.all([
    latestUsersSnapshot ? Promise.resolve(latestUsersSnapshot) : getDocs(usersQuery),
    latestAvailabilitySnapshot
      ? Promise.resolve(latestAvailabilitySnapshot)
      : getDocs(availabilityFallbackQuery || availabilityQuery),
    latestRolesSnapshot ? Promise.resolve(latestRolesSnapshot) : getDocs(rolesQuery)
  ]);
  if (generation !== renderGeneration) return;
  latestUsersSnapshot = usersSnapshot;
  latestRolesSnapshot = rolesSnapshot;
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
    const date = data.date;
    if (date < firstDate || date > lastDate) return;
    const uid = resolveAvailabilityUid(item.id, data, date, usersByUid, usersByEmployeeNumber);
    if (!uid) return;
    if (!availability.has(uid)) availability.set(uid, new Map());
    const byDate = availability.get(uid);
    const previous = byDate.get(date);
    if (!previous || timestampMillis(data.updatedAt) >= timestampMillis(previous.updatedAt)) {
      byDate.set(date, data);
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
      monthlyAvailability: availability.get(user.uid) || new Map()
    };
  })
    .filter(user => isVisibleAccount(user) &&
      (allBranches || user.role === "admin" || user.branchId === branchId))
    .filter(user => user.uid === proxyTargetUid || matchesSelectedDateFilter(user.monthlyAvailability))
    .filter(user => user.uid === proxyTargetUid || matchesKanaPage(user))
    .filter(user => !search || `${user.employeeNumber} ${user.name} ${user.city}`.toLowerCase().includes(search))
    .sort((a, b) => compareWorkerNames(a, b));
  renderScheduleHeader(year, month, daysInMonth);
  el.adminTableBody.replaceChildren();
  el.adminCards.replaceChildren();
  rows.forEach(user => {
    const dayRow = document.createElement("tr");
    const nightRow = document.createElement("tr");
    dayRow.dataset.accountId = user.uid || user.id;
    nightRow.dataset.accountId = user.uid || user.id;
    const identityCell = document.createElement("td");
    identityCell.className = "schedule-name-cell";
    identityCell.rowSpan = 2;
    const person = document.createElement("div");
    person.className = "schedule-person";
    const text = document.createElement("div");
    const number = document.createElement("span");
    number.className = "schedule-person-number";
    number.textContent = user.employeeNumber || "―";
    const name = document.createElement("span");
    name.className = "schedule-person-name";
    name.textContent = user.name || "氏名未登録";
    name.title = user.name || "氏名未登録";
    text.append(number, name);
    if (allBranches) text.appendChild(summaryLine(displayBranchName(user), "schedule-person-number"));
    if (proxyTargetUid === user.uid) {
      const proxyLabel = document.createElement("span");
      proxyLabel.className = "proxy-active-label";
      proxyLabel.textContent = "勤務希望を編集中";
      text.appendChild(proxyLabel);
      identityCell.classList.add("is-proxy-target-name");
      dayRow.classList.add("is-proxy-target", "is-proxy-target-day");
      nightRow.classList.add("is-proxy-target", "is-proxy-target-night");
    }
    if (proxyTargetUid === user.uid) {
      const finishButton = document.createElement("button");
      finishButton.type = "button";
      finishButton.className = "proxy-complete-button";
      finishButton.textContent = "✓";
      finishButton.setAttribute("aria-label", `${user.name || user.employeeNumber}の勤務希望編集を保存して終了`);
      finishButton.disabled = hasPendingProxySave(user.uid);
      finishButton.addEventListener("click", () => endTableProxyInput(user.uid));
      person.append(text, finishButton);
    } else {
      const workerMenu = createWorkerMenu(user, currentProfile, currentRole);
      addTableProxyMenuAction(workerMenu, user);
      person.append(text, workerMenu);
    }
    identityCell.appendChild(person);
    dayRow.append(identityCell, scheduleShiftLabel("日勤"));
    nightRow.append(scheduleShiftLabel("夜勤"));
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${monthValue}-${String(day).padStart(2, "0")}`;
      const wish = user.monthlyAvailability.get(date);
      dayRow.appendChild(scheduleMarkCell(wish, "day", user, date));
      nightRow.appendChild(scheduleMarkCell(wish, "night", user, date));
    }
    el.adminTableBody.append(dayRow, nightRow);
  });
  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = daysInMonth + 2;
    emptyCell.textContent = "該当する利用者はいません";
    emptyRow.appendChild(emptyCell);
    el.adminTableBody.appendChild(emptyRow);
  }
  applySelectedDateHighlight();
  updateAdminEditModeControls();
}

function updateAdminEditModeControls() {
  const editing = Boolean(proxyTargetUid);
  el.adminScreen.querySelectorAll("button").forEach(button => {
    if (button.classList.contains("proxy-complete-button")) return;
    if (editing) {
      if (!("editModeWasDisabled" in button.dataset)) button.dataset.editModeWasDisabled = String(button.disabled);
      button.disabled = true;
      return;
    }
    if ("editModeWasDisabled" in button.dataset) {
      button.disabled = button.dataset.editModeWasDisabled === "true";
      delete button.dataset.editModeWasDisabled;
    }
  });
}

function ensureAvailabilityObserver(availabilityQuery, key, fallbackQuery = null) {
  if (availabilityObserverKey === key && stopAvailabilityObserver) return;
  stopAvailabilityObserver?.();
  availabilityObserverKey = key;
  latestAvailabilitySnapshot = null;
  latestUsersSnapshot = null;
  latestRolesSnapshot = null;
  const handleSnapshot = snapshot => {
    latestAvailabilitySnapshot = snapshot;
    if (el.adminScreen.classList.contains("active")) renderAdmin().catch(reportAdminError);
  };
  const handleError = error => {
    console.error("勤務希望一覧のリアルタイム取得に失敗しました", { code: error?.code, error });
    if (error?.code === "failed-precondition" && fallbackQuery && availabilityObserverKey === key) {
      console.warn("複合インデックス構築中のため、自支社データ取得へ切り替えます");
      stopAvailabilityObserver = onSnapshot(fallbackQuery, handleSnapshot, reportAdminError);
      return;
    }
    reportAdminError(error);
  };
  stopAvailabilityObserver = onSnapshot(availabilityQuery, handleSnapshot, handleError);
}

function reportAdminError(error) {
  console.error("管理画面の勤務希望一覧を更新できませんでした", { code: error?.code, error });
  notify?.(error?.code === "permission-denied"
    ? "勤務希望一覧を表示する権限がありません。所属支社とアカウント状態を確認してください。"
    : "勤務希望一覧を更新できませんでした。時間をおいて再度お試しください。");
}

function renderScheduleHeader(year, month, daysInMonth) {
  const row = document.createElement("tr");
  const name = document.createElement("th");
  name.className = "schedule-name-head";
  name.textContent = "警備員";
  const shift = document.createElement("th");
  shift.className = "schedule-shift-head";
  shift.textContent = "区分";
  row.append(name, shift);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month - 1, day);
    const cell = document.createElement("th");
    cell.className = `schedule-day-header ${date.getDay() === 0 ? "is-sunday" : date.getDay() === 6 ? "is-saturday" : ""}`.trim();
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cell.dataset.date = dateKey;
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `${month}月${day}日を選択`);
    cell.setAttribute("aria-pressed", String(selectedDate === dateKey));
    cell.addEventListener("click", () => toggleSelectedDate(dateKey));
    cell.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleSelectedDate(dateKey);
    });
    cell.innerHTML = `${day}<br><small>${"日月火水木金土"[date.getDay()]}</small>`;
    row.appendChild(cell);
  }
  el.adminTableHead.replaceChildren(row);
}

function scheduleShiftLabel(label) {
  const cell = document.createElement("th");
  cell.scope = "row";
  cell.className = "schedule-shift-label";
  cell.textContent = label;
  return cell;
}

function scheduleMarkCell(wish, shiftType, user, date) {
  const cell = document.createElement("td");
  cell.className = "schedule-mark";
  cell.dataset.date = date;
  const isPast = date < toLocalDateKey(new Date());
  applyScheduleMark(cell, wish, shiftType, date);
  if (!isPast && proxyTargetUid === user.uid && canStartTableProxy(user)) {
    cell.classList.add("is-proxy-editable", "is-proxy-editable-range", `is-${shiftType}`);
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `${user.name} ${date} ${shiftType === "day" ? "日勤" : "夜勤"}を変更`);
    const activate = () => saveProxyCellChange(cell, wish, shiftType, user, date);
    cell.addEventListener("click", activate);
    cell.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
    if (pendingProxyCells.has(`${user.uid}_${date}_${shiftType}`)) {
      cell.classList.add("is-saving");
      cell.setAttribute("aria-disabled", "true");
    }
  }
  return cell;
}

function toggleSelectedDate(date) {
  const wasFiltering = activeFilter !== "all";
  selectedDate = selectedDate === date ? "" : date;
  if (!selectedDate && activeFilter !== "all") {
    activeFilter = "all";
    updateFilterButtons();
  }
  if (wasFiltering || activeFilter !== "all") renderAdmin().catch(reportAdminError);
  else applySelectedDateHighlight();
}

function applySelectedDateHighlight() {
  el.adminTableHead.querySelectorAll("[data-date]").forEach(cell => {
    const selected = Boolean(selectedDate) && cell.dataset.date === selectedDate;
    cell.classList.toggle("is-selected-date", selected);
    cell.setAttribute("aria-pressed", String(selected));
  });
  el.adminTableBody.querySelectorAll("[data-date]").forEach(cell => {
    cell.classList.toggle("is-selected-date", Boolean(selectedDate) && cell.dataset.date === selectedDate);
  });
}

function applyScheduleMark(cell, wish, shiftType, date) {
  cell.textContent = "";
  cell.classList.remove("is-available", "is-unavailable", "is-past-blank");
  const state = scheduleCellState(wish, shiftType);
  cell.dataset.state = state;
  if (state === "available") {
    cell.textContent = "○";
    cell.classList.add("is-available");
    cell.title = shiftType === "day" ? "日勤希望" : "夜勤希望";
  } else if (state === "unavailable") {
    cell.textContent = "×";
    cell.classList.add("is-unavailable");
    cell.title = shiftType === "day" ? "日勤不可" : "夜勤不可";
  } else {
    if (date < toLocalDateKey(new Date())) {
      cell.textContent = "×";
      cell.classList.add("is-past-blank");
      cell.title = shiftType === "day" ? "日勤未入力（過去）" : "夜勤未入力（過去）";
    } else {
      cell.title = shiftType === "day" ? "日勤未入力" : "夜勤未入力";
    }
  }
}

function scheduleCellState(wish, shiftType) {
  if (!wish || wish.undecided) return "blank";
  const enteredField = `${shiftType}Entered`;
  const entered = Object.hasOwn(wish, enteredField) ? Boolean(wish[enteredField]) : true;
  if (!entered) return "blank";
  return wish[shiftType] ? "available" : "unavailable";
}

function nextScheduleCellState(state) {
  if (state === "blank") return "available";
  if (state === "available") return "unavailable";
  return "blank";
}

function addTableProxyMenuAction(workerMenu, user) {
  if (!canStartTableProxy(user)) return;
  const menu = workerMenu.querySelector(".worker-action-menu");
  if (!menu) return;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "勤務希望を編集";
  button.addEventListener("click", () => {
    workerMenu.querySelector(".worker-action-menu-button")?.click();
    startTableProxyInput(user);
  });
  menu.prepend(button);
}

function canStartTableProxy(user) {
  if (!auth.currentUser || !["staff", "admin"].includes(currentRole?.role)) return false;
  if (!user.uid || !["guard", "staff", "admin"].includes(user.role)) return false;
  if (currentRole.role === "admin") return true;
  return user.role !== "admin" && user.branchId === effectiveBranchId(currentRole);
}

function startTableProxyInput(user) {
  proxyTargetUid = user.uid;
  renderAdmin().catch(reportAdminError);
}

function endTableProxyInput(targetUid = proxyTargetUid) {
  if (hasPendingProxySave(targetUid)) {
    notify?.("保存処理が完了するまでお待ちください。");
    return;
  }
  proxyTargetUid = "";
  renderAdmin().catch(reportAdminError);
}

function hasPendingProxySave(uid) {
  const prefix = `${uid}_`;
  return [...pendingProxyCells].some(key => key.startsWith(prefix));
}

function updateFilterButtons() {
  el.adminFilters.querySelectorAll("button[data-filter]").forEach(button => {
    const active = button.dataset.filter === activeFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateKanaPageButtons() {
  el.adminKanaPages.querySelectorAll("button[data-kana-page]").forEach(button => {
    const active = button.dataset.kanaPage === activeKanaPage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function resetSelectedDateAndFilter() {
  selectedDate = "";
  activeFilter = "all";
  updateFilterButtons();
}

async function saveProxyCellChange(cell, wish, shiftType, user, date) {
  if (date < toLocalDateKey(new Date())) return;
  const key = `${user.uid}_${date}_${shiftType}`;
  if (pendingProxyCells.has(key) || proxyTargetUid !== user.uid) return;
  const previousState = cell.dataset.state || scheduleCellState(wish, shiftType);
  const nextState = nextScheduleCellState(previousState);
  pendingProxyCells.add(key);
  cell.classList.add("is-saving");
  cell.setAttribute("aria-disabled", "true");
  try {
    const saved = await writeProxyAvailabilityCell(user, date, shiftType, nextState, wish);
    applyScheduleMark(cell, saved, shiftType, date);
  } catch (error) {
    console.error("勤務希望の編集に失敗しました", { error, targetUid: user.uid, date, shiftType });
    applyScheduleMark(cell, wish, shiftType, date);
    notify?.(error?.code === "permission-denied"
      ? "この勤務希望を変更する権限がありません。"
      : error?.code === "failed-precondition"
        ? "管理者自身の勤務希望を変更する場合は、先に表示する支社を選択してください。"
        : "勤務希望を保存できませんでした。直前の表示へ戻しました。");
  } finally {
    pendingProxyCells.delete(key);
    cell.classList.remove("is-saving");
    cell.removeAttribute("aria-disabled");
    renderAdmin().catch(reportAdminError);
  }
}

async function writeProxyAvailabilityCell(user, date, shiftType, nextState, current) {
  if (date < toLocalDateKey(new Date())) {
    throw Object.assign(new Error("past availability is read only"), { code: "failed-precondition" });
  }
  const operatorUid = auth.currentUser?.uid || "";
  if (!operatorUid || !canStartTableProxy(user)) throw Object.assign(new Error("proxy not allowed"), { code: "permission-denied" });
  const reference = doc(db, "availability", `${date}_${user.uid}`);
  const values = {
    day: Boolean(current?.day),
    night: Boolean(current?.night),
    dayEntered: current ? (Object.hasOwn(current, "dayEntered") ? Boolean(current.dayEntered) : !current.undecided) : false,
    nightEntered: current ? (Object.hasOwn(current, "nightEntered") ? Boolean(current.nightEntered) : !current.undecided) : false
  };
  values[shiftType] = nextState === "available";
  values[`${shiftType}Entered`] = nextState !== "blank";
  const isSelfEdit = operatorUid === user.uid;
  const selectedBranchId = effectiveBranchId(currentRole);
  const writeBranchId = user.branchId || current?.branchId ||
    (selectedBranchId !== ALL_BRANCHES ? selectedBranchId : "");
  if (!writeBranchId) {
    throw Object.assign(new Error("branch selection required"), { code: "failed-precondition" });
  }
  const result = {
    uid: user.uid,
    branchId: writeBranchId,
    date,
    day: values.day,
    night: values.night,
    dayEntered: values.dayEntered,
    nightEntered: values.nightEntered,
    unavailable: values.dayEntered && values.nightEntered && !values.day && !values.night,
    undecided: false,
    note: String(current?.note || ""),
    updatedByUid: operatorUid,
    updatedByName: String(currentProfile?.name || "").slice(0, 80),
    updatedByType: isSelfEdit ? "self" : "proxy",
    updatedByRole: isSelfEdit ? "" : currentRole.role,
    updateReason: isSelfEdit ? "" : "staff_correction",
    updateReasonNote: "",
    updatedAfterDeadline: isSelfEdit ? false : isAfterAvailabilityDeadline(date, shiftType),
    updatedAt: serverTimestamp()
  };
  if (current) await updateDoc(reference, result);
  else await setDoc(reference, { ...result, createdAt: serverTimestamp() });
  await setDoc(doc(db, "shiftCandidateAvailability", `${date}_${user.uid}`), {
    uid: user.uid, branchId: result.branchId, date,
    day: result.day, night: result.night, unavailable: result.unavailable,
    undecided: false, note: result.note, updatedAt: serverTimestamp()
  }).catch(error => console.warn("シフト候補データを同期できませんでした", error));
  return result;
}

function isAfterAvailabilityDeadline(dateKey, shiftType) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const deadline = new Date(year, month - 1, day - 1, shiftType === "night" ? 12 : 0, 0, 0);
  return new Date() >= deadline;
}

function compareWorkerNames(left, right) {
  return workerReading(left).localeCompare(workerReading(right), "ja", { sensitivity: "base" });
}

function workerReading(user) {
  return String(user.furigana || user.nameKana || user.kana || user.name || "")
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, character => String.fromCharCode(character.charCodeAt(0) - 0x60));
}

function matchesKanaPage(user) {
  if (activeKanaPage === "all") return true;
  const first = workerReading(user).replace(/^[\s　]+/, "").charAt(0);
  const groups = {
    a: "ぁあぃいぅうぇえぉおゔ",
    ka: "かがきぎくぐけげこご",
    sa: "さざしじすずせぜそぞ",
    ta: "ただちぢっつづてでとど",
    na: "なにぬねの",
    ha: "はばぱひびぴふぶぷへべぺほぼぽ",
    ma: "まみむめも",
    ya: "ゃやゅゆょよ",
    ra: "らりるれろ",
    wa: "ゎわをん"
  };
  return groups[activeKanaPage]?.includes(first) || false;
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
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(item => item.status === "pending");
}

export async function reviewStaffRequest(requestItem, decision) {
  if (currentRole?.role !== "admin") throw new Error("承認・却下は管理者だけが実行できます。");
  if (!["approved", "rejected"].includes(decision)) throw new Error("不正な操作です。");
  const [roleSnapshot, userSnapshot] = decision === "approved"
    ? await Promise.all([
      getDoc(doc(db, "userRoles", requestItem.uid)),
      getDoc(doc(db, "users", requestItem.uid))
    ])
    : [null, null];
  if (decision === "approved" && (!roleSnapshot.exists() || !userSnapshot.exists())) {
    const error = new Error("承認対象のユーザー情報が見つかりません。");
    error.code = "not-found";
    throw error;
  }
  if (decision === "approved" && typeof userSnapshot.data().nearestStation !== "string") {
    const error = new Error("承認対象ユーザーの最寄り駅が保存されていません。");
    error.code = "failed-precondition";
    throw error;
  }
  const isRegistrationApproval = roleSnapshot?.data()?.accountStatus === "pending";
  const batch = writeBatch(db);
  batch.update(doc(db, "staffRequests", requestItem.uid), {
    status: decision, reviewedBy: currentProfile.uid,
    reviewedAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  if (decision === "approved" && isRegistrationApproval) {
    const now = serverTimestamp();
    batch.update(doc(db, "users", requestItem.uid), { branchId: requestItem.branchId, updatedAt: now });
    batch.update(doc(db, "employeeNumbers", requestItem.employeeNumber), {
      accountStatus: "approved", branchId: requestItem.branchId
    });
    batch.update(doc(db, "userRoles", requestItem.uid), {
      role: "staff", branchId: requestItem.branchId, accountStatus: "approved",
      approvedByUid: currentProfile.uid, approvedAt: now, updatedAt: now
    });
    batch.set(doc(db, "shiftCandidateProfiles", requestItem.uid), {
      uid: requestItem.uid, employeeNumber: requestItem.employeeNumber, name: requestItem.name,
      nearestStation: userSnapshot.data().nearestStation, branchId: requestItem.branchId,
      accountStatus: "approved", updatedAt: now
    });
  } else if (decision === "approved") {
    batch.update(doc(db, "userRoles", requestItem.uid), {
      role: "staff", updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
}

function moveDate(months) {
  const [year, month] = el.adminDate.value.split("-").map(Number);
  const date = new Date(year, month - 1 + months, 1);
  resetSelectedDateAndFilter();
  el.adminDate.value = toLocalDateKey(date).slice(0, 7);
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

function matchesSelectedDateFilter(byDate) {
  if (activeFilter === "all" || !selectedDate) return true;
  const wish = byDate.get(selectedDate);
  if (activeFilter === "none") {
    return scheduleCellState(wish, "day") === "blank" && scheduleCellState(wish, "night") === "blank";
  }
  if (!wish || wish.undecided) return false;
  return scheduleCellState(wish, activeFilter) === "available";
}
