import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc, where
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
let pendingActionResolve = null;
let stopOfficeAvailabilityObserver = null;
let officeProgressObservers = [];
let stopSelfAvailabilityObserver = null;

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
  el.departureHourInput.addEventListener("change", updateDepartureConfirmButton);
  el.departureMinuteInput.addEventListener("change", updateDepartureConfirmButton);
  el.departureTimeModal.addEventListener("click", event => {
    if (event.target === el.departureTimeModal) closeDepartureTimeDialog(null);
  });
  el.confirmProgressActionButton.addEventListener("click", () => closeActionConfirmation(true));
  el.cancelProgressActionButton.addEventListener("click", () => closeActionConfirmation(false));
  el.progressActionConfirmModal.addEventListener("click", event => {
    if (event.target === el.progressActionConfirmModal) closeActionConfirmation(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && el.departureTimeModal.classList.contains("show")) closeDepartureTimeDialog(null);
    if (event.key === "Escape" && el.progressActionConfirmModal.classList.contains("show")) closeActionConfirmation(false);
  });
}

export function showDailyProgress(profile, role, options = {}) {
  stopSelfAvailabilityObserver?.();
  stopSelfAvailabilityObserver = null;
  currentProfile = profile;
  currentRole = role;
  if (!["staff", "admin"].includes(role?.role)) throw new Error("当日の勤務を開く権限がありません。");
  if (/^\d{4}-\d{2}-\d{2}$/.test(options.date || "")) el.progressDate.value = options.date;
  if (["day", "night"].includes(options.shiftType)) el.progressShiftType.value = options.shiftType;
  navigate("dailyProgress");
  return loadOfficeProgress();
}

export function showDepartureContact(profile) {
  stopOfficeObservers();
  currentProfile = profile;
  navigate("departureContact");
  stopSelfAvailabilityObserver?.();
  const today = dateKey(new Date());
  el.departureContactMessage.textContent = "本日の勤務希望を確認しています。";
  el.departureContactMessage.className = "message show";
  el.departureContactList.replaceChildren();
  stopSelfAvailabilityObserver = onSnapshot(doc(db, "availability", `${today}_${profile.uid}`), async snapshot => {
    const availability = snapshot.data();
    const targets = availabilityTargets(availability, profile.uid);
    el.departureContactList.replaceChildren();
    if (!targets.length) {
      el.departureContactMessage.textContent = "本日の勤務可能（○）はありません。";
      el.departureContactMessage.className = "message show";
      return;
    }
    el.departureContactMessage.className = "message";
    for (const target of targets) el.departureContactList.appendChild(await createSelfProgressSection(target, profile));
  }, error => {
    console.error(error);
    el.departureContactMessage.textContent = "本日の勤務希望を読み込めませんでした。";
    el.departureContactMessage.className = "message show error";
  });
}

export function stopDepartureProgressObservers() {
  stopSelfAvailabilityObserver?.();
  stopSelfAvailabilityObserver = null;
  stopOfficeObservers();
}

export async function createSelfProgressSection(target, profile) {
  const section = document.createElement("section");
  section.className = "self-progress-section";
  const heading = document.createElement("h3");
  heading.textContent = `${target.date}　${target.shiftType === "night" ? "夜勤" : "日勤"}`;
  section.appendChild(heading);
  const reference = progressRef(target.date, target.shiftType, profile.uid);
  let progress = (await getDoc(reference)).data() || {};
  const audit = document.createElement("div");
  audit.className = "audit-meta";
  renderProgressAudit(audit, progress);
  section.appendChild(audit);
  const controls = [
    ["departureAcknowledgedAt", "出発時間確認", "出発時間を確認", "出発時間確認済"],
    ["departedAt", "出発", "出発しました", "出発済"],
    ["startedAt", "上番", "上番しました", "上番済"],
    ["finishedAt", "下番", "下番しました", "下番済"]
  ];
  const rendered = [];
  controls.forEach(([field, label, buttonLabel, doneLabel]) => {
    const row = document.createElement("div");
    row.className = "self-progress-row";
    const title = document.createElement("strong");
    title.textContent = label;
    const status = document.createElement("span");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = buttonLabel;
    const refresh = () => {
      status.textContent = progressStatus(progress, field, doneLabel);
      button.disabled = !canRecordStep(progress, field, target);
      button.title = field === "departedAt" && progress.departureAcknowledgedAt && !isDepartureWindowOpen(progress, target)
        ? `${departureWindowLabel(progress, target)}から出発を記録できます` : "";
      button.hidden = !isButtonWindowOpen(target);
      row.classList.toggle("is-complete", Boolean(progress[field]));
    };
    button.addEventListener("click", async () => {
      if (!canRecordStep(progress, field, target)) return;
      const recordedTime = field === "departureAcknowledgedAt"
        ? await requestTimeInput("departure", progress.departureTime, target.shiftType)
        : field === "finishedAt" ? await requestTimeInput("finished", progress.finishedTime, target.shiftType) : "";
      if ((field === "departureAcknowledgedAt" || field === "finishedAt") && !recordedTime) return;
      if ((field === "departedAt" || field === "startedAt") && !await requestActionConfirmation(
        field === "departedAt" ? "出発の確認" : "上番の確認",
        `${buttonLabel}として記録しますか？`,
        field === "departedAt" ? "出発を記録する" : "上番を記録する"
      )) return;
      button.disabled = true;
      try {
        progress = await recordProgress(target, profile, field, recordedTime, "self");
        rendered.forEach(item => item.refresh());
        renderProgressAudit(audit, progress);
        notify(`${buttonLabel}を記録しました。`);
      } catch (error) {
        console.error(error);
        notify("記録できませんでした。操作順または勤務希望を確認してください。");
        refresh();
      }
    });
    row.append(title, status, button);
    rendered.push({ refresh });
    refresh();
    section.appendChild(row);
  });
  const refreshTimer = window.setInterval(() => {
    if (!section.isConnected) { window.clearInterval(refreshTimer); return; }
    rendered.forEach(item => item.refresh());
  }, 30000);
  if (!isButtonWindowOpen(target)) {
    const note = document.createElement("p");
    note.className = "small-text";
    note.textContent = target.shiftType === "night" ? "夜勤の打刻ボタンは当日6時から表示されます。" : "日勤の打刻ボタンは前日18時から表示されます。";
    section.appendChild(note);
  }
  return section;
}

async function recordProgress(target, profile, field, recordedTime = "", updatedByType = "self") {
  const reference = progressRef(target.date, target.shiftType, target.workerId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const existing = snapshot.data() || {};
    if (!canRecordStep(existing, field, target)) throw new Error("invalid-progress-order");
    const values = {
      workerId: target.workerId,
      branchId: target.branchId,
      date: target.date,
      shiftType: target.shiftType,
      [field]: serverTimestamp(),
      createdAt: existing.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: profile.uid,
      updatedByName: profile.name,
      updatedByType
    };
    if (field === "departureAcknowledgedAt") values.departureTime = recordedTime;
    if (field === "finishedAt") values.finishedTime = recordedTime;
    transaction.set(reference, values, { merge: true });
  });
  return (await getDoc(reference)).data();
}

async function loadOfficeProgress() {
  const branchId = effectiveBranchId(currentRole);
  const allBranches = currentRole.role === "admin" && branchId === ALL_BRANCHES;
  const date = el.progressDate.value;
  const shiftType = el.progressShiftType.value;
  el.dailyProgressMessage.textContent = "勤務希望を読み込んでいます。";
  el.dailyProgressMessage.className = "message show";
  stopOfficeObservers();
  try {
    const usersSnapshot = await getDocs(allBranches ? collection(db, "users") : query(collection(db, "users"), where("branchId", "==", branchId)));
    const users = new Map(usersSnapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }]));
    const availabilityQuery = allBranches
      ? query(collection(db, "availability"), where("date", "==", date))
      : query(collection(db, "availability"), where("branchId", "==", branchId), where("date", "==", date));
    stopOfficeAvailabilityObserver = onSnapshot(availabilityQuery, snapshot => {
      officeProgressObservers.forEach(stop => stop());
      officeProgressObservers = [];
      officeRows = [];
      snapshot.docs.forEach(item => {
        const availability = item.data();
        if (!isAvailableFor(availability, shiftType)) return;
        const user = users.get(availability.uid);
        if (!user) return;
        const target = { workerId: availability.uid, branchId: availability.branchId, date, shiftType };
        const row = { target, user, progress: {} };
        officeRows.push(row);
        officeProgressObservers.push(onSnapshot(progressRef(date, shiftType, availability.uid), progressSnapshot => {
          row.progress = progressSnapshot.data() || {};
          renderOfficeRows();
        }));
      });
      el.dailyProgressMessage.className = "message";
      renderOfficeRows();
    }, reportOfficeError);
  } catch (error) {
    reportOfficeError(error);
  }
}

function renderOfficeRows() {
  const rows = officeRows.filter(item => matchesProgressFilter(item.progress));
  el.dailyProgressTableBody.replaceChildren();
  el.dailyProgressCards.replaceChildren();
  rows.forEach(item => {
    const values = [
      `${item.user.name}\n${item.user.employeeNumber}${currentRole.role === "admin" && effectiveBranchId(currentRole) === ALL_BRANCHES ? `\n${branchName(item.user.branchId)}` : ""}`,
      item.target.shiftType === "night" ? "夜勤" : "日勤",
      item.progress.departureAcknowledgedAt ? `確認済 ${item.progress.departureTime || formatTime(item.progress.departureAcknowledgedAt)}` : "未確認",
      progressText(item.progress.departedAt, "出発済", "未出発"),
      progressText(item.progress.startedAt, "上番済", "未上番"),
      progressText(item.progress.finishedAt, "下番済", "未下番", item.progress.finishedTime)
    ];
    const tr = document.createElement("tr");
    values.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (index >= 2) td.className = `progress-state ${value.startsWith("未") ? "is-pending" : "is-done"}`;
      tr.appendChild(td);
    });
    const action = document.createElement("td");
    action.append(...staffActionButtons(item));
    tr.appendChild(action);
    el.dailyProgressTableBody.appendChild(tr);
    const card = document.createElement("article");
    card.className = "daily-progress-card";
    card.textContent = values.join("\n");
    const actions = document.createElement("div");
    actions.className = "daily-progress-actions";
    actions.append(...staffActionButtons(item));
    card.appendChild(actions);
    el.dailyProgressCards.appendChild(card);
  });
  if (!rows.length) el.dailyProgressTableBody.innerHTML = '<tr><td colspan="7">当日の○に該当する警備員はいません。</td></tr>';
}

function staffActionButtons(item) {
  return [
    ["departureAcknowledgedAt", "確認済にする"],
    ["departedAt", "出発済にする"],
    ["startedAt", "上番済にする"],
    ["finishedAt", "下番済にする"]
  ].map(([field, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = label;
    button.disabled = !canRecordStep(item.progress, field, item.target);
    button.title = field === "departedAt" && item.progress.departureAcknowledgedAt && !isDepartureWindowOpen(item.progress, item.target)
      ? `${departureWindowLabel(item.progress, item.target)}から出発を記録できます` : "";
    button.hidden = !isButtonWindowOpen(item.target);
    button.addEventListener("click", async () => {
      if (!canRecordStep(item.progress, field, item.target)) return;
      const recordedTime = field === "departureAcknowledgedAt"
        ? await requestTimeInput("departure", item.progress.departureTime, item.target.shiftType)
        : field === "finishedAt" ? await requestTimeInput("finished", item.progress.finishedTime, item.target.shiftType) : "";
      if ((field === "departureAcknowledgedAt" || field === "finishedAt") && !recordedTime) return;
      if ((field === "departedAt" || field === "startedAt") && !await requestActionConfirmation(
        field === "departedAt" ? "出発の確認" : "上番の確認",
        `${item.user.name}さんを${label}として記録しますか？`,
        field === "departedAt" ? "出発を記録する" : "上番を記録する"
      )) return;
      try {
        await recordProgress(item.target, currentProfile, field, recordedTime, "staff");
        notify("打刻状況を更新しました。");
      } catch (error) {
        console.error(error);
        notify("更新できませんでした。勤務希望または操作順を確認してください。");
      }
    });
    return button;
  });
}

function availabilityTargets(availability, workerId) {
  if (!availability || availability.uid !== workerId) return [];
  return ["day", "night"].filter(type => isAvailableFor(availability, type)).map(shiftType => ({
    workerId, branchId: availability.branchId, date: availability.date, shiftType
  }));
}
function isAvailableFor(availability, shiftType) {
  const enteredField = `${shiftType}Entered`;
  const entered = Object.hasOwn(availability || {}, enteredField) ? Boolean(availability[enteredField]) : !availability?.undecided;
  return Boolean(availability?.[shiftType]) && entered && !availability.unavailable && !availability.undecided;
}
function progressRef(date, shiftType, workerId) { return doc(db, "attendanceProgress", date, shiftType, workerId); }
function prerequisiteComplete(progress, field) {
  if (field === "departureAcknowledgedAt") return true;
  if (field === "departedAt") return Boolean(progress.departureAcknowledgedAt);
  if (field === "startedAt") return Boolean(progress.departedAt);
  if (field === "finishedAt") return Boolean(progress.startedAt);
  return false;
}
function canRecordStep(progress, field, target) {
  if (progress[field] || !prerequisiteComplete(progress, field)) return false;
  return field !== "departedAt" || isDepartureWindowOpen(progress, target);
}
function isDepartureWindowOpen(progress, target) {
  const start = departureWindowStart(progress, target);
  return Boolean(start) && new Date() >= start;
}
function departureWindowStart(progress, target) {
  if (!progress.departureTime) return false;
  const [year, month, day] = target.date.split("-").map(Number);
  const [hour, minute] = progress.departureTime.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return false;
  const departure = new Date(year, month - 1, day, hour, minute);
  return new Date(departure.getTime() - 2 * 60 * 60 * 1000);
}
function departureWindowLabel(progress, target) {
  const start = departureWindowStart(progress, target);
  return start ? start.toLocaleString("ja-JP", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }) : "";
}
function isButtonWindowOpen(target) {
  const [year, month, day] = target.date.split("-").map(Number);
  const start = target.shiftType === "night" ? new Date(year, month - 1, day, 6) : new Date(year, month - 1, day - 1, 18);
  return new Date() >= start;
}
function progressStatus(progress, field, doneLabel) {
  if (!progress[field]) return { departureAcknowledgedAt:"未確認", departedAt:"未出発", startedAt:"未上番", finishedAt:"未下番" }[field];
  const time = field === "departureAcknowledgedAt" ? progress.departureTime || formatTime(progress[field])
    : field === "finishedAt" ? progress.finishedTime || formatTime(progress[field]) : formatTime(progress[field]);
  return `${doneLabel} ${time}`;
}
function progressText(value, done, pending, enteredTime = "") { return value ? `${done} ${enteredTime || formatTime(value)}` : pending; }
function renderProgressAudit(target, progress) {
  const date = progress?.updatedAt?.toDate?.();
  if (!date || !progress?.updatedByName) { target.hidden = true; target.textContent = ""; return; }
  target.textContent = `最終打刻：${progress.updatedByName}　${date.toLocaleString("ja-JP", { hour12:false })}`;
  target.hidden = false;
}
function formatTime(value) { const date = value?.toDate?.(); return date ? date.toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit", hour12:false }) : ""; }
function requestTimeInput(kind, existingTime = "", shiftType = "day") {
  const validExistingTime = /^([01][0-9]|2[0-4]):(00|05|10|15|20|25|30|35|40|45|50|55)$/.test(existingTime);
  const defaultHour = kind === "finished" ? (shiftType === "night" ? "03" : "15") : (shiftType === "night" ? "18" : "07");
  const [hour, minute] = validExistingTime ? existingTime.split(":") : [defaultHour, "00"];
  el.departureTimeTitle.textContent = kind === "finished" ? "下番時刻を入力してください" : "出発時間を入力してください";
  el.timeInputLegend.textContent = kind === "finished" ? "下番時刻" : "出発時間";
  el.departureHourInput.value = hour;
  el.departureMinuteInput.value = minute;
  el.departureTimeMessage.textContent = "";
  el.departureTimeMessage.className = "message";
  updateDepartureConfirmButton();
  el.departureTimeModal.classList.add("show");
  requestAnimationFrame(() => el.departureHourInput.focus());
  return new Promise(resolve => { pendingDepartureResolve = resolve; });
}

function requestActionConfirmation(title, message, confirmLabel) {
  el.progressActionConfirmTitle.textContent = title;
  el.progressActionConfirmMessage.textContent = message;
  el.confirmProgressActionButton.textContent = confirmLabel;
  el.progressActionConfirmModal.classList.add("show");
  requestAnimationFrame(() => el.confirmProgressActionButton.focus());
  return new Promise(resolve => { pendingActionResolve = resolve; });
}
function closeActionConfirmation(value) {
  el.progressActionConfirmModal.classList.remove("show");
  const resolve = pendingActionResolve;
  pendingActionResolve = null;
  resolve?.(value);
}
function selectedDepartureTime() { return `${el.departureHourInput.value}:${el.departureMinuteInput.value}`; }
function updateDepartureConfirmButton() {
  el.confirmDepartureTimeButton.disabled = !/^([01][0-9]|2[0-4]):(00|05|10|15|20|25|30|35|40|45|50|55)$/.test(selectedDepartureTime());
}
function confirmDepartureTime() {
  if (el.confirmDepartureTimeButton.disabled) return;
  closeDepartureTimeDialog(selectedDepartureTime());
}
function closeDepartureTimeDialog(value) {
  el.departureTimeModal.classList.remove("show");
  const resolve = pendingDepartureResolve;
  pendingDepartureResolve = null;
  resolve?.(value);
}
function matchesProgressFilter(progress) {
  if (activeFilter === "not-departed") return !progress.departedAt;
  if (activeFilter === "not-started") return !progress.startedAt;
  if (activeFilter === "finished") return Boolean(progress.finishedAt);
  return true;
}
function reportOfficeError(error) {
  console.error(error);
  el.dailyProgressMessage.textContent = "勤務希望を読み込めませんでした。";
  el.dailyProgressMessage.className = "message show error";
}
function stopOfficeObservers() {
  stopOfficeAvailabilityObserver?.();
  stopOfficeAvailabilityObserver = null;
  officeProgressObservers.forEach(stop => stop());
  officeProgressObservers = [];
}
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
