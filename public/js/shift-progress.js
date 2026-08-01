import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { ALL_BRANCHES, branchName, effectiveBranchId } from "./branches.js";

let el;
let navigate;
let notify;
let currentProfile;
let currentRole;
let officeRows = [];
let activeFilter = "all";
let pendingDepartureResolve = null;

export function initShiftProgress(elements, showScreen, showToast) {
  el = elements;
  navigate = showScreen;
  notify = showToast;
  el.progressDate.value = dateKey(new Date());
  el.progressDate.addEventListener("change", loadOfficeProgress);
  el.progressShiftType.addEventListener("change", loadOfficeProgress);
  el.progressFilters.addEventListener("click", event => {
    const button = event.target.closest("button[data-progress-filter]");
    if (!button) return;
    activeFilter = button.dataset.progressFilter;
    el.progressFilters.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
    renderOfficeRows();
  });
  el.cancelDepartureTimeButton.addEventListener("click", () => closeDepartureTimeDialog(null));
  el.confirmDepartureTimeButton.addEventListener("click", confirmDepartureTime);
  el.departureTimeModal.addEventListener("click", event => {
    if (event.target === el.departureTimeModal) closeDepartureTimeDialog(null);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && el.departureTimeModal.classList.contains("show")) {
      closeDepartureTimeDialog(null);
    }
  });
}

export function showDailyProgress(profile, role) {
  currentProfile = profile;
  currentRole = role;
  if (!["staff", "admin"].includes(role?.role)) throw new Error("当日の勤務状況を開く権限がありません。");
  navigate("dailyProgress");
  return loadOfficeProgress();
}

export async function createSelfProgressSection(shift, profile) {
  const section = document.createElement("section");
  section.className = "self-progress-section";
  const heading = document.createElement("h3");
  heading.textContent = "勤務当日の確認";
  section.appendChild(heading);
  const ref = progressRef(shift.id, profile.uid);
  let progress = (await getDoc(ref)).data() || {};
  const departureTime = document.createElement("div");
  departureTime.className = "departure-check-time";
  departureTime.textContent = `出発確認時刻：${shift.departureCheckTime || "未設定"}`;
  section.appendChild(departureTime);
  const controls = [
    ["departureAcknowledgedAt", "出発確認", "出発確認", "出発確認済"],
    ["departedAt", "出発", "出発しました", "出発済"],
    ["arrivedAt", "現場到着", "現場に到着しました", "到着済"]
  ];
  controls.forEach(([field, label, buttonLabel, doneLabel]) => {
    const row = document.createElement("div");
    row.className = "self-progress-row";
    const title = document.createElement("strong");
    title.textContent = label;
    const status = document.createElement("span");
    status.textContent = progressStatus(progress, field, doneLabel);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = buttonLabel;
    button.disabled = Boolean(progress[field]) || !isReportingWindow(shift);
    button.addEventListener("click", async () => {
      const departureTime = field === "departureAcknowledgedAt"
        ? await requestDepartureTime(progress.departureTime)
        : "";
      if (field === "departureAcknowledgedAt" && !departureTime) return;
      if (field === "arrivedAt" && !progress.departedAt &&
          !confirm("出発報告がまだありません。このまま到着報告しますか？")) return;
      if (field !== "departureAcknowledgedAt" && !confirm(`${buttonLabel}として記録しますか？`)) return;
      button.disabled = true;
      try {
        progress = await recordSelfProgress(shift, profile, field, departureTime);
        status.textContent = progressStatus(progress, field, doneLabel);
        notify(`${buttonLabel}を記録しました。`);
      } catch (error) {
        console.error(error);
        notify("記録できませんでした。すでに報告済みか、操作可能期間外です。");
      } finally {
        button.disabled = Boolean(progress[field]) || !isReportingWindow(shift);
      }
    });
    row.append(title, status, button);
    section.appendChild(row);
  });
  if (!isReportingWindow(shift)) {
    const note = document.createElement("p");
    note.className = "small-text";
    note.textContent = "報告ボタンは勤務日前日18時から勤務翌日の所定時刻まで利用できます。";
    section.appendChild(note);
  }
  return section;
}

async function recordSelfProgress(shift, profile, field, departureTime = "") {
  const ref = progressRef(shift.id, profile.uid);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.data() || {};
    if (existing[field]) throw new Error("already-recorded");
    const values = {
      shiftGroupId: shift.id, workerId: profile.uid, branchId: shift.branchId,
      date: shift.date, shiftType: shift.shiftType,
      [field]: serverTimestamp(),
      createdAt: existing.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(), updatedByUid: profile.uid, updatedByType: "self"
    };
    if (field === "departureAcknowledgedAt") values.departureTime = departureTime;
    transaction.set(ref, values, { merge: true });
  });
  return (await getDoc(ref)).data();
}

async function loadOfficeProgress() {
  const branchId = effectiveBranchId(currentRole);
  const allBranches = currentRole.role === "admin" && branchId === ALL_BRANCHES;
  const date = el.progressDate.value;
  const shiftType = el.progressShiftType.value;
  el.dailyProgressMessage.textContent = "勤務状況を読み込んでいます。";
  el.dailyProgressMessage.className = "message show";
  try {
    const [shiftSnapshot, usersSnapshot] = await Promise.all([
      getDocs(allBranches
        ? query(collection(db, "shiftGroups"), where("date", "==", date), where("shiftType", "==", shiftType))
        : query(collection(db, "shiftGroups"), where("branchId", "==", branchId), where("date", "==", date), where("shiftType", "==", shiftType))),
      getDocs(allBranches ? collection(db, "users") : query(collection(db, "users"), where("branchId", "==", branchId)))
    ]);
    const users = new Map(usersSnapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }]));
    officeRows = [];
    const confirmedShifts = shiftSnapshot.docs.filter(item => item.data().status === "confirmed");
    for (const item of confirmedShifts) {
      const shift = { id: item.id, ...item.data() };
      const progressSnapshots = await Promise.all(shift.memberUids.map(uid => getDoc(progressRef(shift.id, uid))));
      shift.memberUids.forEach((uid, index) => {
        const user = users.get(uid);
        if (!user) return;
        officeRows.push({ shift, user, progress: progressSnapshots[index].data() || {} });
      });
    }
    el.dailyProgressMessage.className = "message";
    renderOfficeRows();
  } catch (error) {
    console.error(error);
    el.dailyProgressMessage.textContent = "勤務状況を読み込めませんでした。";
    el.dailyProgressMessage.className = "message show error";
  }
}

function renderOfficeRows() {
  const rows = officeRows.filter(item => matchesProgressFilter(item.progress));
  el.dailyProgressTableBody.replaceChildren();
  el.dailyProgressCards.replaceChildren();
  rows.forEach(item => {
    const values = [
      `${item.user.name}\n${item.user.employeeNumber}${currentRole.role === "admin" && effectiveBranchId(currentRole) === ALL_BRANCHES ? `\n${branchName(item.user.branchId)}` : ""}`,
      item.shift.title || "名称未設定",
      item.shift.leaderUid === item.user.id ? "隊長" : "隊員",
      item.progress.departureAcknowledgedAt
        ? `確認済 ${item.progress.departureTime || formatTime(item.progress.departureAcknowledgedAt)}`
        : "未確認",
      progressText(item.progress.departedAt, "出発済", "未出発"),
      progressText(item.progress.arrivedAt, "到着済", "未到着")
    ];
    const tr = document.createElement("tr");
    values.forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.appendChild(td); });
    const action = document.createElement("td");
    action.append(...staffActionButtons(item));
    tr.appendChild(action);
    el.dailyProgressTableBody.appendChild(tr);
    const card = document.createElement("article");
    card.className = "daily-progress-card";
    card.textContent = `${values.join("\n")}\n`;
    const actions = document.createElement("div");
    actions.className = "daily-progress-actions";
    actions.append(...staffActionButtons(item));
    card.appendChild(actions);
    el.dailyProgressCards.appendChild(card);
  });
  if (!rows.length) el.dailyProgressTableBody.innerHTML = '<tr><td colspan="7">該当する勤務者はいません。</td></tr>';
}

function staffActionButtons(item) {
  return [
    ["departureAcknowledgedAt", "確認済にする"],
    ["departedAt", "出発済にする"],
    ["arrivedAt", "到着済にする"]
  ].map(([field, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = label;
    button.addEventListener("click", async () => {
      const departureTime = field === "departureAcknowledgedAt"
        ? await requestDepartureTime(item.progress.departureTime)
        : "";
      if (field === "departureAcknowledgedAt" && !departureTime) return;
      if (item.progress[field] && !confirm(`すでに記録があります。${label}時刻を変更しますか？`)) return;
      if (field !== "departureAcknowledgedAt" && !item.progress[field] &&
          !confirm(`${item.user.name}さんを${label}として記録しますか？`)) return;
      const values = {
        shiftGroupId: item.shift.id, workerId: item.user.id, branchId: item.shift.branchId,
        date: item.shift.date, shiftType: item.shift.shiftType,
        [field]: serverTimestamp(), createdAt: item.progress.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(), updatedByUid: currentProfile.uid, updatedByType: "staff"
      };
      if (field === "departureAcknowledgedAt") values.departureTime = departureTime;
      await setDoc(progressRef(item.shift.id, item.user.id), values, { merge: true });
      notify("勤務状況を更新しました。");
      await loadOfficeProgress();
    });
    return button;
  });
}

function progressRef(shiftId, workerId) { return doc(db, "shiftProgress", shiftId, "workers", workerId); }
function statusBefore(field) { return field === "departureAcknowledgedAt" ? "未確認" : field === "departedAt" ? "未出発" : "未到着"; }
function progressText(value, done, pending) { return value ? `${done} ${formatTime(value)}` : pending; }
function progressStatus(progress, field, doneLabel) {
  if (!progress[field]) return statusBefore(field);
  const time = field === "departureAcknowledgedAt"
    ? progress.departureTime || formatTime(progress[field])
    : formatTime(progress[field]);
  return `${doneLabel} ${time}`;
}
function formatTime(value) { const d = value?.toDate?.(); return d ? d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : ""; }
function requestDepartureTime(existingTime = "") {
  const now = new Date();
  el.departureTimeInput.value = existingTime ||
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  el.departureTimeMessage.textContent = "";
  el.departureTimeMessage.className = "message";
  el.departureTimeModal.classList.add("show");
  requestAnimationFrame(() => el.departureTimeInput.focus());
  return new Promise(resolve => { pendingDepartureResolve = resolve; });
}
function confirmDepartureTime() {
  const value = el.departureTimeInput.value;
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
    el.departureTimeMessage.textContent = "出発時間を入力してください。";
    el.departureTimeMessage.className = "message show error";
    return;
  }
  closeDepartureTimeDialog(value);
}
function closeDepartureTimeDialog(value) {
  el.departureTimeModal.classList.remove("show");
  const resolve = pendingDepartureResolve;
  pendingDepartureResolve = null;
  resolve?.(value);
}
function matchesProgressFilter(progress) {
  if (activeFilter === "not-departed") return !progress.departedAt;
  if (activeFilter === "not-arrived") return !progress.arrivedAt;
  if (activeFilter === "arrived") return Boolean(progress.arrivedAt);
  return true;
}
function isReportingWindow(shift) {
  const [year, month, day] = shift.date.split("-").map(Number);
  const start = new Date(year, month - 1, day - 1, 18);
  const endHour = shift.shiftType === "night" ? 12 : 6;
  const end = new Date(year, month - 1, day + 1, endHour);
  const now = new Date();
  return now >= start && now <= end;
}
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
