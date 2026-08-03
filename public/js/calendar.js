import { auth } from "./firebase-config.js";
import { getAvailability, saveAvailability } from "./availability.js?v=20260803-8";
import { loadOwnConfirmedShifts } from "./shifts.js?v=20260803-1";

const HOLIDAYS_2026 = {
  "2026-01-01": "元日", "2026-01-12": "成人の日", "2026-02-11": "建国記念の日",
  "2026-02-23": "天皇誕生日", "2026-03-20": "春分の日", "2026-04-29": "昭和の日",
  "2026-05-03": "憲法記念日", "2026-05-04": "みどりの日", "2026-05-05": "こどもの日",
  "2026-05-06": "振替休日", "2026-07-20": "海の日", "2026-08-11": "山の日",
  "2026-09-21": "敬老の日", "2026-09-22": "国民の休日", "2026-09-23": "秋分の日",
  "2026-10-12": "スポーツの日", "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日"
};
const PROXY_REASON_LABELS = {
  phone_request: "本人から電話で依頼",
  in_person_request: "本人から対面で依頼",
  paper_transfer: "紙の勤務希望表を転記",
  staff_correction: "内勤者による入力内容の訂正",
  other: "その他"
};

const state = {
  viewDate: new Date(),
  selectedDate: "",
  draft: emptyAvailability(),
  profile: null,
  proxy: false,
  operatorUid: "",
  operatorName: "",
  operatorRole: "",
  inputMode: "web",
  pendingSave: null,
  saving: false,
  returnAction: null
};
let el;
let notify;
let confirmedByDate = new Map();

export function setConfirmedShifts(items = []) {
  confirmedByDate = new Map(items.map(item => [item.date, item]));
}

export function resetCalendarState() {
  state.viewDate = new Date();
  state.selectedDate = "";
  state.draft = emptyAvailability();
  state.profile = null;
  state.proxy = false;
  state.operatorUid = "";
  state.operatorName = "";
  state.operatorRole = "";
  state.inputMode = "web";
  state.pendingSave = null;
  state.saving = false;
  state.returnAction = null;
  confirmedByDate = new Map();
  if (!el) return;
  el.calendarGrid.replaceChildren();
  el.currentUserName.textContent = "";
  el.currentUserId.textContent = "";
  el.proxyInputBanner.hidden = true;
  el.proxyInputEmployeeNumber.textContent = "";
  el.proxyInputName.textContent = "";
  el.proxyInputMode.textContent = "";
  el.shiftModalBackdrop.classList.remove("show");
  el.proxyReasonModal.classList.remove("show");
  el.shiftNote.value = "";
  el.availabilityAudit.hidden = true;
  el.availabilityAudit.textContent = "";
}

export function initCalendar(elements, showToast) {
  el = elements;
  notify = showToast;
  el.prevMonthButton.addEventListener("click", () => moveMonth(-1));
  el.nextMonthButton.addEventListener("click", () => moveMonth(1));
  el.todayButton.addEventListener("click", () => { state.viewDate = new Date(); renderCalendar(); });
  el.closeShiftButton.addEventListener("click", () => closeModal());
  el.shiftModalBackdrop.addEventListener("click", event => {
    if (event.target === el.shiftModalBackdrop) closeModal();
  });
  el.choiceDay.addEventListener("click", () => selectDraft("day"));
  el.choiceNight.addEventListener("click", () => selectDraft("night"));
  el.choiceBoth.addEventListener("click", () => selectDraft("both"));
  el.choiceUnavailable.addEventListener("click", () => selectDraft("unavailable"));
  el.saveShiftButton.addEventListener("click", save);
  el.exitProxyInputButton.addEventListener("click", () => state.returnAction?.());
  el.proxyUpdateReason.addEventListener("change", updateReasonNoteVisibility);
  el.cancelProxyReasonButton.addEventListener("click", closeProxyReasonModal);
  el.continueProxyReasonButton.addEventListener("click", showProxySaveConfirmation);
  el.backProxyReasonButton.addEventListener("click", showProxyReasonStep);
  el.confirmProxySaveButton.addEventListener("click", confirmProxySave);
  el.proxyReasonModal.addEventListener("click", event => {
    if (event.target === el.proxyReasonModal) closeProxyReasonModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (el.proxyReasonModal.classList.contains("show")) closeProxyReasonModal();
    else if (el.shiftModalBackdrop.classList.contains("show")) closeModal();
  });
}

export function showCalendar(profile, options = {}) {
  const proxy = Boolean(options.proxy);
  const authUid = auth.currentUser?.uid || "";
  const targetUid = proxy ? profile.uid : authUid;
  if (!targetUid || (!proxy && profile.uid !== authUid)) {
    resetCalendarState();
    throw new Error("認証ユーザーと勤務希望の表示対象が一致しません。");
  }
  state.profile = { ...profile, uid: targetUid };
  state.proxy = proxy;
  state.operatorUid = proxy ? options.operatorUid : authUid;
  state.operatorName = proxy ? String(options.operatorName || "") : String(profile.name || "");
  state.operatorRole = options.operatorRole || "";
  state.inputMode = options.inputMode || profile.inputMode || "web";
  state.pendingSave = null;
  state.saving = false;
  state.returnAction = options.returnAction || null;
  state.viewDate = new Date();
  el.currentUserName.textContent = profile.name;
  el.currentUserId.textContent = profile.employeeNumber;
  el.proxyInputBanner.hidden = !state.proxy;
  if (state.proxy) {
    const isWeb = state.inputMode === "web";
    el.proxyInputTitle.textContent = isWeb ? "Web利用者の勤務希望を編集中" : "勤務希望を編集中";
    el.proxyInputEmployeeNumber.textContent = `警備員番号：${profile.employeeNumber}`;
    el.proxyInputName.textContent = `氏名：${profile.name}`;
    el.proxyInputMode.textContent = `利用方法：${isWeb ? "Web利用" : "内勤者入力"}`;
    el.proxyInputWarning.hidden = !isWeb;
  }
  renderCalendar();
}

export function renderCalendar() {
  if (!el || !state.profile) return;
  const targetUid = calendarTargetUid();
  if (!targetUid) return;
  const year = state.viewDate.getFullYear();
  const month = state.viewDate.getMonth();
  el.monthLabel.textContent = `${year}年${month + 1}月`;
  el.calendarGrid.replaceChildren();

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  for (let index = 0; index < first.getDay(); index += 1) {
    const blank = document.createElement("div");
    blank.className = "day-cell blank";
    el.calendarGrid.appendChild(blank);
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const confirmed = confirmedByDate.get(dateKey);
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (date.getDay() === 0 || HOLIDAYS_2026[dateKey]) cell.classList.add("sunday");
    if (date.getDay() === 6) cell.classList.add("saturday");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-button";
    button.setAttribute("aria-label", `${formatDateLong(dateKey)}の勤務希望を編集`);
    if (!state.proxy && confirmed) {
      button.classList.add("confirmed-viewable");
      button.setAttribute("aria-label", `${formatDateLong(dateKey)}はシフト確定済みです。勤務希望の内容を確認できます`);
    }
    button.addEventListener("click", () => openModal(dateKey));

    const dateNumber = document.createElement("span");
    dateNumber.className = "date-number";
    dateNumber.textContent = String(day);
    button.appendChild(dateNumber);
    if (HOLIDAYS_2026[dateKey]) {
      const holiday = document.createElement("span");
      holiday.className = "holiday-name";
      holiday.textContent = HOLIDAYS_2026[dateKey];
      button.appendChild(holiday);
    }

    const status = confirmed ? { key: "confirmed", label: "確定" } : getStatus(getAvailability(dateKey, targetUid));
    const chip = document.createElement("span");
    chip.className = `status-chip status-${status.key}`;
    chip.textContent = status.label;
    button.appendChild(chip);

    const lock = getLockState(dateKey);
    if (!state.proxy && (lock.dayLocked || lock.nightLocked || isPastDate(dateKey))) {
      const locked = document.createElement("span");
      locked.className = "deadline-mini";
      locked.textContent = lockMessageShort(lock);
      button.appendChild(locked);
    }
    cell.appendChild(button);
    el.calendarGrid.appendChild(cell);
  }
}

function openModal(dateKey) {
  if (state.saving) return;
  const targetUid = calendarTargetUid();
  if (!targetUid) return;
  state.selectedDate = dateKey;
  state.draft = normalizeAvailability(getAvailability(dateKey, targetUid));
  el.modalTitle.textContent = `${formatDateLong(dateKey)}の勤務希望`;
  const confirmed = confirmedByDate.get(dateKey);
  const confirmedReadOnly = !state.proxy && Boolean(confirmed);
  el.confirmedShiftDetails.hidden = !confirmed;
  if (confirmed) el.confirmedShiftDetails.textContent = `${confirmed.title}\n${confirmed.clientName}\n${confirmed.address}\n集合：${confirmed.meetingPlace || "―"} ${confirmed.meetingTime}\n勤務：${confirmed.startTime}～${confirmed.endTime}\n役割：${confirmed.leaderUid === state.profile.uid ? "隊長" : "隊員"}`;
  el.shiftNote.value = state.draft.note;
  renderAvailabilityAudit(state.draft);
  const lock = getLockState(dateKey);
  const past = isPastDate(dateKey);
  const afterDeadline = past || lock.dayLocked || lock.nightLocked;
  el.modalLockNote.hidden = confirmedReadOnly ? false : !afterDeadline;
  el.modalLockNote.textContent = confirmedReadOnly
    ? "シフト確定済みです。登録した勤務希望は確認できますが、変更はできません。"
    : state.proxy && afterDeadline
    ? "締切後の変更です。保存前に確認します。"
    : past ? "過去の日付は変更できません。" : lockMessageFull(lock);
  el.shiftNote.disabled = confirmedReadOnly || (!state.proxy && (past || (lock.dayLocked && lock.nightLocked)));
  el.saveShiftButton.disabled = state.saving || confirmedReadOnly || (!state.proxy && (past || (lock.dayLocked && lock.nightLocked)));
  el.closeShiftButton.disabled = state.saving;
  el.saveShiftButton.textContent = confirmedReadOnly ? "確定済み（変更できません）" : "保存する";
  updateChoiceButtons();
  el.shiftModalBackdrop.classList.add("show");
}

function closeModal(force = false) {
  if (state.saving && !force) return;
  el.shiftModalBackdrop.classList.remove("show");
}

function selectDraft(kind) {
  if (!state.proxy && confirmedByDate.has(state.selectedDate)) return;
  const lock = getLockState(state.selectedDate);
  if (!state.proxy && isPastDate(state.selectedDate)) return;
  const next = availabilityForChoice(kind, state.draft.note);
  if (!state.proxy && ((lock.dayLocked && next.day !== Boolean(state.draft.day))
    || (lock.nightLocked && next.night !== Boolean(state.draft.night)))) return;
  state.draft = next;
  updateChoiceButtons();
}

function updateChoiceButtons() {
  const lock = getLockState(state.selectedDate);
  const past = isPastDate(state.selectedDate);
  const confirmedReadOnly = !state.proxy && confirmedByDate.has(state.selectedDate);
  const pairs = [
    [el.choiceDay, "day"],
    [el.choiceNight, "night"],
    [el.choiceBoth, "both"],
    [el.choiceUnavailable, "unavailable"]
  ];
  pairs.forEach(([button, key]) => {
    const candidate = availabilityForChoice(key, state.draft.note);
    const selected = availabilityChoiceKey(state.draft) === key;
    const changesLockedValue = !state.proxy && ((lock.dayLocked && candidate.day !== Boolean(state.draft.day))
      || (lock.nightLocked && candidate.night !== Boolean(state.draft.night)));
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = state.saving || confirmedReadOnly || (!state.proxy && past) || changesLockedValue;
  });
  el.choiceDay.textContent = "日勤";
  el.choiceNight.textContent = "夜勤";
  el.choiceBoth.textContent = "日勤・夜勤";
  el.choiceUnavailable.textContent = "勤務不可";
}

async function save() {
  if (state.saving) return;
  if (!state.proxy && confirmedByDate.has(state.selectedDate)) {
    closeModal();
    notify("シフト確定済みの日は勤務希望を変更できません。");
    return;
  }
  const lock = getLockState(state.selectedDate);
  const afterDeadline = isPastDate(state.selectedDate) || lock.dayLocked || lock.nightLocked;
  if (!state.proxy && (isPastDate(state.selectedDate) || (lock.dayLocked && lock.nightLocked))) return;
  const existing = normalizeAvailability(getAvailability(state.selectedDate));
  const next = normalizeAvailability({ ...state.draft, note: el.shiftNote.value });
  if (!availabilityChoiceKey(next)) {
    notify("勤務希望を選択してください。");
    return;
  }
  if (!state.proxy && lock.dayLocked) next.day = existing.day;
  if (!state.proxy && lock.nightLocked) next.night = existing.night;
  if (sameAvailability(existing, next)) {
    closeModal();
    notify("勤務希望は変更されていません。");
    return;
  }
  if (state.proxy && afterDeadline && !window.confirm("締切後ですが、この内容で変更しますか？")) return;
  if (state.proxy) {
    state.pendingSave = { next, afterDeadline };
    openProxyReasonModal();
    return;
  }
  await performSave(next, afterDeadline);
}

async function performSave(next, afterDeadline, reason = "", reasonNote = "") {
  if (state.saving) return;
  const authUid = auth.currentUser?.uid || "";
  const context = {
    proxy: state.proxy,
    authUid,
    targetUid: state.proxy ? state.profile?.uid || "" : authUid,
    selectedDate: state.selectedDate,
    branchId: state.profile?.branchId || "",
    operatorUid: state.proxy ? state.operatorUid : authUid,
    operatorName: state.proxy ? state.operatorName : state.profile?.name || "",
    operatorRole: state.operatorRole,
    profileName: state.profile?.name || ""
  };
  state.saving = true;
  el.saveShiftButton.disabled = true;
  el.closeShiftButton.disabled = true;
  el.confirmProxySaveButton.disabled = true;
  updateChoiceButtons();
  try {
    if (!context.proxy && confirmedByDate.has(context.selectedDate)) {
      const error = new Error("シフト確定済みの日は勤務希望を変更できません。");
      error.code = "availability/confirmed-shift";
      throw error;
    }
    if (!context.targetUid || !context.authUid || auth.currentUser?.uid !== context.authUid
        || (!context.proxy && state.profile?.uid !== context.authUid)) {
      const error = new Error("認証ユーザーと保存対象が一致しません。");
      error.code = "availability/owner-mismatch";
      throw error;
    }
    if (!context.proxy) {
      const latestConfirmedShifts = await loadOwnConfirmedShifts(context.targetUid, context.branchId);
      if (auth.currentUser?.uid !== context.authUid) {
        const error = new Error("保存中に認証ユーザーが変更されました。");
        error.code = "availability/owner-mismatch";
        throw error;
      }
      setConfirmedShifts(latestConfirmedShifts);
      if (confirmedByDate.has(context.selectedDate)) {
        renderCalendar();
        const error = new Error("シフト確定済みの日は勤務希望を変更できません。");
        error.code = "availability/confirmed-shift";
        throw error;
      }
    }
    await saveAvailability(context.targetUid, context.selectedDate, next, context.branchId, {
      updatedByUid: context.operatorUid,
      updatedByName: context.operatorName,
      updatedByType: context.proxy ? "proxy" : "self",
      updatedByRole: context.proxy ? context.operatorRole : "",
      updateReason: context.proxy ? reason : "",
      updateReasonNote: context.proxy ? reasonNote : "",
      updatedAfterDeadline: context.proxy && afterDeadline
    });
    closeProxyReasonModal();
    state.saving = false;
    closeModal(true);
    renderCalendar();
    notify(context.proxy ? `${context.profileName}さんの勤務希望を変更しました。` : "勤務希望を保存しました。");
  } catch (error) {
    if (state.selectedDate === context.selectedDate && calendarTargetUid() === context.targetUid) {
      state.draft = normalizeAvailability(getAvailability(context.selectedDate, context.targetUid));
      el.shiftNote.value = state.draft.note;
      renderCalendar();
    }
    console.error("勤務希望の保存に失敗しました", {
      code: error?.code,
      message: error?.message,
      authUid: auth.currentUser?.uid || "",
      targetUid: context.targetUid,
      date: context.selectedDate,
      values: next,
      inputMode: context.proxy ? "proxy" : "self",
      selectedProxyUid: context.proxy ? context.targetUid : ""
    });
    notify(availabilitySaveErrorMessage(error));
  } finally {
    state.saving = false;
    el.saveShiftButton.disabled = false;
    el.closeShiftButton.disabled = false;
    el.confirmProxySaveButton.disabled = false;
    if (el.shiftModalBackdrop.classList.contains("show")) {
      updateChoiceButtons();
      const confirmedReadOnly = !state.proxy && confirmedByDate.has(state.selectedDate);
      const lock = getLockState(state.selectedDate);
      const pastOrFullyLocked = !state.proxy && (isPastDate(state.selectedDate) || (lock.dayLocked && lock.nightLocked));
      el.saveShiftButton.disabled = confirmedReadOnly || pastOrFullyLocked;
      el.closeShiftButton.disabled = false;
    }
  }
}

function availabilitySaveErrorMessage(error) {
  const code = String(error?.code || "").replace("firestore/", "");
  if (code === "availability/owner-mismatch") {
    return "ログイン情報が切り替わりました。勤務希望画面を開き直してください。";
  }
  if (code === "availability/confirmed-shift") {
    return "シフト確定済みの日は勤務希望を変更できません。";
  }
  if (code === "permission-denied") {
    return "このアカウントでは勤務希望を保存する権限が確認できません。管理者にお問い合わせください。";
  }
  if (code === "not-found") {
    return "アカウント情報が見つかりません。管理者にお問い合わせください。";
  }
  if (["unavailable", "deadline-exceeded", "network-request-failed"].includes(code)) {
    return "通信に失敗しました。通信状況を確認して再度お試しください。";
  }
  return "勤務希望を保存できませんでした。時間をおいて再度お試しください。";
}

function calendarTargetUid() {
  if (state.proxy) return state.profile?.uid || "";
  const authUid = auth.currentUser?.uid || "";
  return state.profile?.uid === authUid ? authUid : "";
}

function sameAvailability(left, right) {
  return ["day", "night", "unavailable", "undecided", "note"]
    .every(key => key === "note"
      ? String(left[key] || "").trim() === String(right[key] || "").trim()
      : Boolean(left[key]) === Boolean(right[key]));
}

function openProxyReasonModal() {
  el.proxyUpdateReason.value = "";
  el.proxyUpdateReasonNote.value = "";
  el.proxyReasonMessage.className = "message";
  el.proxyReasonMessage.textContent = "";
  updateReasonNoteVisibility();
  showProxyReasonStep();
  el.proxyReasonModal.classList.add("show");
}

function closeProxyReasonModal() {
  el.proxyReasonModal.classList.remove("show");
  state.pendingSave = null;
}

function updateReasonNoteVisibility() {
  el.proxyUpdateReasonNoteWrap.hidden = el.proxyUpdateReason.value !== "other";
}

function showProxyReasonStep() {
  el.proxyReasonStep.hidden = false;
  el.proxyConfirmStep.hidden = true;
}

function showProxySaveConfirmation() {
  const reason = el.proxyUpdateReason.value;
  const reasonNote = el.proxyUpdateReasonNote.value.trim();
  if (!PROXY_REASON_LABELS[reason]) {
    showReasonError("変更理由を選択してください。");
    return;
  }
  if (reason === "other" && !reasonNote) {
    showReasonError("「その他」の理由の詳細を入力してください。");
    return;
  }
  if (reasonNote.length > 200) {
    showReasonError("理由の詳細は200文字以内で入力してください。");
    return;
  }
  el.proxyReasonMessage.className = "message";
  const warning = state.inputMode === "web"
    ? "\n\n本人が入力した勤務希望を上書きする可能性があります。"
    : "";
  const note = reason === "other" ? `\n詳細：${reasonNote}` : "";
  el.proxySaveConfirmation.textContent =
    `対象：\n警備員番号：${state.profile.employeeNumber}\n氏名：${state.profile.name}\n\n` +
    `変更理由：\n${PROXY_REASON_LABELS[reason]}${note}\n\nこの内容で保存しますか？${warning}`;
  el.proxyReasonStep.hidden = true;
  el.proxyConfirmStep.hidden = false;
}

function showReasonError(message) {
  el.proxyReasonMessage.textContent = message;
  el.proxyReasonMessage.className = "message show error";
}

async function confirmProxySave() {
  if (!state.pendingSave) return;
  const reason = el.proxyUpdateReason.value;
  const reasonNote = reason === "other" ? el.proxyUpdateReasonNote.value.trim() : "";
  const { next, afterDeadline } = state.pendingSave;
  await performSave(next, afterDeadline, reason, reasonNote);
}

function emptyAvailability() {
  return { day: false, night: false, unavailable: false, undecided: false, note: "" };
}

function availabilityForChoice(kind, note = "") {
  const choices = {
    day: { day: true, night: false, unavailable: false },
    night: { day: false, night: true, unavailable: false },
    both: { day: true, night: true, unavailable: false },
    unavailable: { day: false, night: false, unavailable: true }
  };
  return { ...emptyAvailability(), ...(choices[kind] || {}), note, undecided: false };
}

function availabilityChoiceKey(value) {
  const item = normalizeAvailability(value);
  if (item.unavailable) return "unavailable";
  if (item.day && item.night) return "both";
  if (item.day) return "day";
  if (item.night) return "night";
  return "";
}

function normalizeAvailability(value) {
  return { ...emptyAvailability(), ...(value || {}) };
}

function renderAvailabilityAudit(item) {
  const date = item?.updatedAt?.toDate?.();
  if (!date || !item?.updatedByName) {
    el.availabilityAudit.hidden = true;
    el.availabilityAudit.textContent = "";
    return;
  }
  const proxy = item.updatedByType === "proxy" ? "（内勤者が変更）" : "";
  el.availabilityAudit.textContent =
    `最終更新：${date.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}\n` +
    `更新者：${item.updatedByName}${proxy}`;
  el.availabilityAudit.hidden = false;
}

function getStatus(value) {
  const item = normalizeAvailability(value);
  if (item.unavailable) return { key: "unavailable", label: "不可" };
  if (item.day && item.night) return { key: "both", label: "日夜" };
  if (item.day) return { key: "day", label: "日勤" };
  if (item.night) return { key: "night", label: "夜勤" };
  return { key: "none", label: "未入力" };
}

export function getLockState(dateKey, now = new Date()) {
  const workDate = parseDateKey(dateKey);
  return {
    dayLocked: now >= new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate() - 1, 0, 0, 0),
    nightLocked: now >= new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate() - 1, 12, 0, 0)
  };
}

function lockMessageShort(lock) {
  if (lock.dayLocked || lock.nightLocked) return "締切";
  return "";
}

function lockMessageFull(lock) {
  if (lock.dayLocked && lock.nightLocked) return "日勤・夜勤ともに締切済みです。";
  if (lock.dayLocked) return "日勤は前日0時で締め切りました。夜勤のみ変更できます。";
  if (lock.nightLocked) return "夜勤は前日12時で締め切りました。";
  return "";
}

function isPastDate(dateKey) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDateKey(dateKey) < today;
}

function moveMonth(amount) {
  state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + amount, 1);
  renderCalendar();
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLong(dateKey) {
  const date = parseDateKey(dateKey);
  const holiday = HOLIDAYS_2026[dateKey] ? `・${HOLIDAYS_2026[dateKey]}` : "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${"日月火水木金土"[date.getDay()]}）${holiday}`;
}
